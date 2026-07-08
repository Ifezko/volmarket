import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { fetchRealMarkets, getReadonlyProgram, type RealMarket } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
const SIDE_YES = 1
// Position layout: discriminator(8) + market(32) + owner(32) -> owner starts at byte 40.
const POSITION_OWNER_OFFSET = 40
// A claim ix touches ~6 accounts and no rent-paying inits (the ATAs already exist from the
// deposit), so several fit in one legacy transaction. Kept conservative — each pick used a
// distinct throwaway mint, so batched claims don't share vault/token accounts.
const MAX_CLAIMS_PER_TX = 4

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

export interface ClaimablePosition {
  market: PublicKey
  position: PublicKey
  fixtureId: number
  oddKey: number
  marketParams: number
  side: 'hold' | 'break'
  level: number
  /** the winning stake, in whole USDC */
  stakeUsdc: number
  /** stake back + pro-rata winnings net of fee, in whole USDC (matches the program's math) */
  payoutUsdc: number
  usdcMint: PublicKey
  vault: PublicKey
  authority: PublicKey
}

// Pro-rata payout, mirroring `claim` in the program: winners split the losing pool in
// proportion to stake, fee is taken only on the winnings. With an all-YES demo market
// (no NO stake) the losing pool is 0, so payout == stake — the user gets their vaulted
// USDC back. Computed here for display only; the on-chain instruction is authoritative.
function computePayout(market: RealMarket, stakeUsdc: number): number {
  const winTotal = market.outcome === 'yes' ? market.totalYes : market.totalNo
  const loseTotal = market.outcome === 'yes' ? market.totalNo : market.totalYes
  if (winTotal <= 0) return stakeUsdc
  const winnings = (stakeUsdc * loseTotal) / winTotal
  const fee = (winnings * market.feeBps) / 10000
  return +(stakeUsdc + winnings - fee).toFixed(6)
}

/**
 * Finds every position the wallet holds that has become claimable: its market is resolved,
 * the outcome matches the side it took, and it hasn't been claimed yet. This is what turns
 * the keeper's autonomous `resolve_market` settlements into "you won, collect your USDC".
 */
export async function fetchClaimablePositions(connection: Connection, owner: PublicKey): Promise<ClaimablePosition[]> {
  const program = getReadonlyProgram(connection)

  const positions = await (program.account as any).position.all([
    { memcmp: { offset: POSITION_OWNER_OFFSET, bytes: owner.toBase58() } },
  ])
  if (!positions.length) return []

  const markets = await fetchRealMarkets(connection)
  const byAddress = new Map<string, RealMarket>(markets.map((m) => [m.address.toBase58(), m]))

  const claimable: ClaimablePosition[] = []
  for (const { publicKey, account } of positions as { publicKey: PublicKey; account: any }[]) {
    if (account.claimed) continue
    const market = byAddress.get(account.market.toBase58())
    if (!market || market.status !== 'resolved') continue
    // positions are always YES (agreeing with the market thesis, see depositMarkets.ts), so
    // a position wins iff the market resolved YES.
    const positionSide = account.side === SIDE_YES ? 'yes' : 'no'
    if (market.outcome !== positionSide) continue

    const stakeUsdc = Number(account.amount) / 1e6
    claimable.push({
      market: market.address,
      position: publicKey,
      fixtureId: market.fixtureId,
      oddKey: market.oddKey,
      marketParams: market.marketParams,
      side: market.side,
      level: market.level,
      stakeUsdc,
      payoutUsdc: computePayout(market, stakeUsdc),
      usdcMint: market.usdcMint,
      vault: market.vault,
      authority: market.authority,
    })
  }
  return claimable
}

export interface ActivePosition {
  market: PublicKey
  position: PublicKey
  fixtureId: number
  oddKey: number
  marketParams: number
  side: 'hold' | 'break'
  level: number
  /** unix seconds the trading window closes — when the prediction is due to resolve */
  windowEnd: number
  /** the staked amount, in whole USDC */
  stakeUsdc: number
  /** pending while the market is open; won/lost once resolved */
  status: 'pending' | 'won' | 'lost'
}

/**
 * Every position the wallet holds, joined to its market and tagged pending/won/lost. Unlike
 * fetchClaimablePositions (winners still awaiting payout), this is the full set — including
 * live and already-lost markets — so the signal chart can draw the user's calls with their
 * outcome. Positions are always YES (agreeing with the market thesis, see depositMarkets.ts),
 * so a resolved market's YES/NO outcome is directly the position's win/loss.
 */
export async function fetchActivePositions(connection: Connection, owner: PublicKey): Promise<ActivePosition[]> {
  const program = getReadonlyProgram(connection)

  const positions = await (program.account as any).position.all([
    { memcmp: { offset: POSITION_OWNER_OFFSET, bytes: owner.toBase58() } },
  ])
  if (!positions.length) return []

  const markets = await fetchRealMarkets(connection)
  const byAddress = new Map<string, RealMarket>(markets.map((m) => [m.address.toBase58(), m]))

  const out: ActivePosition[] = []
  for (const { publicKey, account } of positions as { publicKey: PublicKey; account: any }[]) {
    const market = byAddress.get(account.market.toBase58())
    if (!market) continue
    const status: ActivePosition['status'] =
      market.status !== 'resolved' ? 'pending' : market.outcome === 'yes' ? 'won' : 'lost'
    out.push({
      market: market.address,
      position: publicKey,
      fixtureId: market.fixtureId,
      oddKey: market.oddKey,
      marketParams: market.marketParams,
      side: market.side,
      level: market.level,
      windowEnd: market.windowEnd,
      stakeUsdc: Number(account.amount) / 1e6,
      status,
    })
  }
  return out
}

async function claimBatch(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  positions: ClaimablePosition[],
): Promise<string> {
  const userPublicKey = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)

  const tx = new Transaction()
  for (const p of positions) {
    const userToken = getAssociatedTokenAddressSync(p.usdcMint, userPublicKey)
    // fee_token must be owned by market.authority; the user created the market so authority
    // == user and the fee ATA is the same account as user_token (same throwaway mint).
    const feeToken = getAssociatedTokenAddressSync(p.usdcMint, p.authority)

    const ix = await program.methods
      .claim()
      // claim is permissionless (payer/owner split) — the keeper normally pushes these payouts
      // automatically; this self-claim is the hidden fallback, so the user is both payer and owner.
      .accounts({
        payer: userPublicKey,
        owner: userPublicKey,
        market: p.market,
        position: p.position,
        vault: p.vault,
        userToken,
        feeToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
    tx.add(ix)
  }

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  tx.feePayer = userPublicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  const signedTx = await anchorWallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signedTx.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

/**
 * Claims the given winning positions, collecting each market's payout back to the wallet.
 * Batched so the wallet signs once per batch rather than once per position; combos larger
 * than fit in one transaction are sent as sequential batches (same pattern as placing).
 */
export async function claimPositions(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  positions: ClaimablePosition[],
): Promise<{ signatures: string[] }> {
  if (!positions.length) throw new Error('no positions to claim')

  const signatures: string[] = []
  for (let i = 0; i < positions.length; i += MAX_CLAIMS_PER_TX) {
    const batch = positions.slice(i, i + MAX_CLAIMS_PER_TX)
    signatures.push(await claimBatch(connection, wallet, privySignTransaction, batch))
  }
  return { signatures }
}
