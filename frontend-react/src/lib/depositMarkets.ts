import {
  Connection,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'
import { USDC_MINT, FEE_RECIPIENT, topUpGas } from './funds'

// Markets are now single two-sided markets: the on-chain `side` is always HOLD, and its two pools
// are the Holds side (SIDE_YES / total_yes, signal stays >= level) and the Breaks side (SIDE_NO /
// total_no, signal falls below level). A pick's hold/break selects which POOL to deposit into — NOT
// a separate market — so Holds and Breaks on the same (odd, level, window) are one market. (lib.rs)
const SIDE_HOLD = 0
const SIDE_YES = 1
const SIDE_NO = 2
export const FEE_BPS = 500
// Each pick costs 2 instructions (create_market + deposit) plus ~13 account metas. Now that the
// stake is the user's already-deposited USDC (no per-tx mint setup), a single idempotent ATA
// instruction plus 3 picks fits comfortably under the 1232-byte legacy limit; larger combos are
// sent as sequential transactions instead of erroring.
const MAX_PICKS_PER_TX = 3

export interface PendingPick {
  fixtureId: number
  oddKey: number
  marketParams: number
  side: 'hold' | 'break'
  /** implied probability × 1000 — the on-chain scale (see onchainMarkets.ts) */
  levelRaw: number
  windowSecs: number
  /** stake for this pick, in whole USDC */
  amountUsdc: number
}

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

// web3.js hides the useful part of a failed send behind SendTransactionError.getLogs(). Pull the
// program logs into the thrown message so the UI shows *why* it failed instead of the bare
// "simulation failed … Logs: []. Catch the SendTransactionError and call getLogs()".
async function explainSendError(err: unknown, connection: Connection): Promise<Error> {
  if (err instanceof SendTransactionError) {
    let logs = err.logs ?? null
    if (!logs || logs.length === 0) {
      try {
        logs = await err.getLogs(connection)
      } catch {
        /* logs unavailable — fall back to the bare message */
      }
    }
    const detail = logs && logs.length ? `\n${logs.join('\n')}` : ''
    return new Error(`${err.message}${detail}`)
  }
  return err instanceof Error ? err : new Error(String(err))
}

// A fresh embedded wallet holds 0 SOL, but placing a prediction creates several rent-
// exempt accounts (mint + per-pick market + vault + position), so it needs some SOL to
// pay for them. On devnet we top it up with a best-effort airdrop when it's low — this is
// the "fund your account" step, done automatically for the demo. Airdrop rate limits mean
// this can fail; we swallow that (the user may have funded manually) and let the real
// transaction surface any genuine insufficient-funds error.
export async function ensureDevnetSol(connection: Connection, owner: PublicKey, minLamports = 100_000_000): Promise<void> {
  let balance = 0
  try {
    balance = await connection.getBalance(owner, 'confirmed')
  } catch {
    return
  }
  if (balance >= minLamports) return
  try {
    const sig = await connection.requestAirdrop(owner, 1_000_000_000) // 1 SOL
    const latest = await connection.getLatestBlockhash()
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
  } catch {
    // rate-limited or unavailable — proceed; the tx will report a real error if truly unfunded
  }
}

// Enough SOL to cover fees + account rent for a place batch. Matches the treasury's gas floor.
const GAS_MIN_LAMPORTS = 50_000_000 // 0.05 SOL

/**
 * Guarantees the wallet has gas SOL *as seen by the connection we're about to send on*, before
 * placing. An external wallet (e.g. Solflare) that only holds app-USDC has 0 SOL, so it can't pay
 * fees/rent — the tx would fail preflight with "Attempt to debit an account but found no record of
 * a prior credit". We top it up via the treasury (reliable for any wallet), then POLL this same
 * connection until the credit is visible: the treasury confirms on its own RPC, but the client's
 * RPC (Alchemy / public devnet) can lag, and sending before it sees the balance is exactly what
 * produces that error. If it truly can't be funded, throw a clear, actionable message.
 */
export async function ensureGasReady(connection: Connection, address: string): Promise<void> {
  const owner = new PublicKey(address)
  const hasGas = async () => {
    try {
      return (await connection.getBalance(owner, 'confirmed')) >= GAS_MIN_LAMPORTS
    } catch {
      return false
    }
  }
  if (await hasGas()) return

  // Prefer the treasury top-up (works for external wallets too); fall back to the rate-limited
  // devnet airdrop only if the endpoint is unreachable.
  try {
    await topUpGas(address)
  } catch {
    await ensureDevnetSol(connection, owner)
  }

  // Wait for THIS connection's RPC to reflect the credit (cross-RPC propagation lag).
  for (let i = 0; i < 20; i++) {
    if (await hasGas()) return
    await new Promise((r) => setTimeout(r, 750))
  }

  let bal = 0
  try {
    bal = await connection.getBalance(owner, 'confirmed')
  } catch {
    /* ignore — reported below as best-effort */
  }
  throw new Error(
    `Couldn't get devnet gas SOL to ${address.slice(0, 4)}…${address.slice(-4)} in time ` +
      `(balance ${(bal / 1e9).toFixed(4)} SOL). Your USDC balance can't pay network fees — ` +
      `wait a few seconds and try again, or airdrop devnet SOL to this wallet.`,
  )
}

async function placeBatch(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  picks: PendingPick[],
): Promise<string> {
  const userPublicKey = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)

  // Stakes are the user's real deposited USDC on the canonical mint (funded via the deposit
  // sheet / /api/fund) — no more throwaway per-pick mint. The USDC ATA already exists from
  // depositing; create it idempotently just in case so a deposit never fails on a missing ATA.
  const userToken = getAssociatedTokenAddressSync(USDC_MINT, userPublicKey)

  const tx = new Transaction()
  tx.add(createAssociatedTokenAccountIdempotentInstruction(userPublicKey, userToken, userPublicKey, USDC_MINT))

  const now = Math.floor(Date.now() / 1000)

  // Derive each pick's PDAs first so we can check which markets already exist. A market for
  // this exact odd/level/window may already be open (created by an earlier prediction on the
  // same line, or by another user) — re-running create_market on it fails with "already in
  // use". So we only create markets that don't exist yet and deposit into the rest; deposit's
  // init_if_needed position + additive stake makes topping up an existing market safe (this is
  // the "create whatever markets don't exist yet and deposit on all of them" behavior).
  const derived = picks.map((pick) => {
    // The market is always a HOLD market (one two-sided market per odd/level/window); the pick's
    // hold/break chooses the pool it deposits into.
    const marketSide = SIDE_HOLD
    const depositSide = pick.side === 'hold' ? SIDE_YES : SIDE_NO
    const windowStart = new BN(now)
    const windowEnd = new BN(now + pick.windowSecs)
    const fixtureId = new BN(pick.fixtureId)
    const oddKey = new BN(pick.oddKey)
    const marketParams = new BN(pick.marketParams)
    const level = new BN(pick.levelRaw)

    const [market] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('market'),
        fixtureId.toArrayLike(Buffer, 'le', 8),
        oddKey.toArrayLike(Buffer, 'le', 8),
        marketParams.toArrayLike(Buffer, 'le', 8),
        Buffer.from([marketSide]),
        level.toArrayLike(Buffer, 'le', 8),
        windowStart.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    )
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], program.programId)
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), market.toBuffer(), userPublicKey.toBuffer(), Buffer.from([depositSide])],
      program.programId,
    )
    return { pick, marketSide, depositSide, windowStart, windowEnd, fixtureId, oddKey, marketParams, level, market, vault, position }
  })

  const marketInfos = await connection.getMultipleAccountsInfo(derived.map((d) => d.market))
  const willCreate = new Set<string>() // guard against two picks in one batch sharing a market

  for (let i = 0; i < derived.length; i++) {
    const d = derived[i]
    const key = d.market.toBase58()
    const exists = marketInfos[i] !== null || willCreate.has(key)

    if (!exists) {
      willCreate.add(key)
      const createMarketIx = await program.methods
        .createMarketV2(d.fixtureId, d.oddKey, d.marketParams, d.marketSide, d.level, d.windowStart, d.windowEnd, FEE_BPS, FEE_RECIPIENT)
        .accounts({
          authority: userPublicKey,
          market: d.market,
          usdcMint: USDC_MINT,
          vault: d.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction()
      tx.add(createMarketIx)
    }

    const depositIx = await program.methods
      .deposit(d.depositSide, new BN(Math.round(d.pick.amountUsdc * 1e6)))
      .accounts({
        user: userPublicKey,
        market: d.market,
        position: d.position,
        vault: d.vault,
        userToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
    tx.add(depositIx)
  }

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  tx.feePayer = userPublicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  const signedTx = await anchorWallet.signTransaction(tx)
  try {
    const signature = await connection.sendRawTransaction(signedTx.serialize())
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return signature
  } catch (err) {
    throw await explainSendError(err, connection)
  }
}

/**
 * Places one or more predictions. Unlike depositing into an existing market, a user
 * picking a level/duration nobody has opened yet has nothing to deposit into — so this
 * creates that market first (permissionless, same as the keeper's seed scripts:
 * `create_market` accepts any signer as authority), then deposits YES (agreeing with the
 * market's own hold/break thesis) on each one, staked with the user's real deposited USDC
 * (the canonical mint — funded via the deposit sheet / /api/fund). Combos larger than fit in
 * one transaction are sent as sequential batches, each its own signature — the wallet signs
 * once per batch, not once per pick.
 */
export async function placeRealPredictions(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  picks: PendingPick[],
): Promise<{ signatures: string[] }> {
  if (!picks.length) throw new Error('no picks to place')

  // Placing creates several rent-exempt accounts + pays fees, so the wallet needs SOL. Ensure it's
  // funded AND that this connection's RPC can see the funds before we send — otherwise an unfunded
  // external wallet (or one whose top-up hasn't propagated) fails simulation with "Attempt to debit
  // an account but found no record of a prior credit".
  await ensureGasReady(connection, wallet.address)

  const signatures: string[] = []
  for (let i = 0; i < picks.length; i += MAX_PICKS_PER_TX) {
    const batch = picks.slice(i, i + MAX_PICKS_PER_TX)
    signatures.push(await placeBatch(connection, wallet, privySignTransaction, batch))
  }
  return { signatures }
}
