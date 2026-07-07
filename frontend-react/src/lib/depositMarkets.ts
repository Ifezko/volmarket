import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'

const SIDE_HOLD = 0
const SIDE_BREAK = 1
const SIDE_YES = 1
const FEE_BPS = 500
// Each pick costs 2 instructions (create_market + deposit) plus ~13 account metas; a
// mint-setup + 4-pick transaction measured out at 1311 bytes against the 1232-byte
// legacy-transaction limit, but 3 picks fit comfortably (~1120 bytes) — verified against
// devnet. Larger combos are sent as sequential transactions instead of erroring.
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

async function placeBatch(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  picks: PendingPick[],
): Promise<string> {
  const userPublicKey = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)

  const mintKeypair = Keypair.generate()
  const mintLamports = await getMinimumBalanceForRentExemptMint(connection)
  const userToken = getAssociatedTokenAddressSync(mintKeypair.publicKey, userPublicKey)
  const totalStake = picks.reduce((sum, p) => sum + p.amountUsdc, 0)

  const tx = new Transaction()
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: userPublicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: mintLamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mintKeypair.publicKey, 6, userPublicKey, null),
    createAssociatedTokenAccountIdempotentInstruction(userPublicKey, userToken, userPublicKey, mintKeypair.publicKey),
    createMintToInstruction(mintKeypair.publicKey, userToken, userPublicKey, Math.round(totalStake * 1e6)),
  )

  const now = Math.floor(Date.now() / 1000)

  for (const pick of picks) {
    const sideVal = pick.side === 'hold' ? SIDE_HOLD : SIDE_BREAK
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
        Buffer.from([sideVal]),
        level.toArrayLike(Buffer, 'le', 8),
        windowStart.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    )
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], program.programId)
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), market.toBuffer(), userPublicKey.toBuffer(), Buffer.from([SIDE_YES])],
      program.programId,
    )

    const createMarketIx = await program.methods
      .createMarket(fixtureId, oddKey, marketParams, sideVal, level, windowStart, windowEnd, FEE_BPS)
      .accounts({
        authority: userPublicKey,
        market,
        usdcMint: mintKeypair.publicKey,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction()

    const depositIx = await program.methods
      .deposit(SIDE_YES, new BN(Math.round(pick.amountUsdc * 1e6)))
      .accounts({
        user: userPublicKey,
        market,
        position,
        vault,
        userToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    tx.add(createMarketIx, depositIx)
  }

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  tx.feePayer = userPublicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  // The mint keypair co-signs locally (we generated it, no Privy round-trip needed);
  // the Privy wallet's signature is added by anchorWallet.signTransaction below.
  tx.partialSign(mintKeypair)

  const signedTx = await anchorWallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signedTx.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

/**
 * Places one or more predictions. Unlike depositing into an existing market, a user
 * picking a level/duration nobody has opened yet has nothing to deposit into — so this
 * creates that market first (permissionless, same as the keeper's seed scripts:
 * `create_market` accepts any signer as authority), funded by a throwaway USDC mint
 * minted to the wallet in the same transaction (same pattern as slice3's devnet proof),
 * then deposits YES (agreeing with the market's own hold/break thesis) on each one.
 * Combos larger than fit in one transaction are sent as sequential batches, each its own
 * signature — the wallet signs once per batch, not once per pick.
 */
export async function placeRealPredictions(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  picks: PendingPick[],
): Promise<{ signatures: string[] }> {
  if (!picks.length) throw new Error('no picks to place')

  await ensureDevnetSol(connection, new PublicKey(wallet.address))

  const signatures: string[] = []
  for (let i = 0; i < picks.length; i += MAX_PICKS_PER_TX) {
    const batch = picks.slice(i, i + MAX_PICKS_PER_TX)
    signatures.push(await placeBatch(connection, wallet, privySignTransaction, batch))
  }
  return { signatures }
}
