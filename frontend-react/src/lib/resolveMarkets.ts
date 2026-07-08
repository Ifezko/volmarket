import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

// The TxLINE validator program, pinned by the on-chain program (address = TXLINE_PROGRAM_ID in
// signal_markets/src/lib.rs; mirrored as txline_program.address in the IDL). It's required as an
// account even on the timeout path (where it isn't actually CPI'd), so we pass it explicitly.
const TXLINE_PROGRAM_ID = new PublicKey('FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse')
const MAX_RESOLVE_PER_TX = 6
// mirror onchainMarkets STATUS_RESOLVED
const STATUS_RESOLVED = 1

// The keeper (or another tab) may resolve a market between our read and our send; the program
// then rejects our resolve with AlreadyResolved. That's not a failure — the market is settled
// either way — so we treat it as a no-op.
function isAlreadyResolved(err: unknown): boolean {
  return String((err as { message?: string })?.message ?? err).includes('AlreadyResolved')
}

async function resolveBatch(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  markets: PublicKey[],
): Promise<string> {
  const userPublicKey = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)

  const tx = new Transaction()
  for (const market of markets) {
    // Past window_end, resolve_market takes the timeout branch: it settles the default outcome
    // (HOLD wins, BREAK loses) with no proof and no TxLINE CPI, so value/proof are dummies and
    // there are no remaining_accounts. Permissionless — the user signs as `resolver`.
    const ix = await program.methods
      .resolveMarket(new BN(0), Buffer.from([]))
      .accounts({ resolver: userPublicKey, market, txlineProgram: TXLINE_PROGRAM_ID } as any)
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
 * Browser-side fallback that settles the given markets once their trading window has closed —
 * so a user's predictions resolve at the duration they picked even if the keeper isn't running
 * (the same spirit as the hidden manual-claim fallback). Only pass markets whose window_end has
 * passed; the program rejects a premature, proofless resolve. Batched so the wallet signs once
 * per batch. Best-effort: callers should swallow failures (a market may get resolved out from
 * under us by the keeper, which surfaces as AlreadyResolved).
 */
export async function resolveMarkets(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  markets: PublicKey[],
): Promise<string[]> {
  if (!markets.length) return []

  // Drop any already resolved (commonly the keeper got there first) before building a tx —
  // otherwise one resolved market would fail the whole batch. A resolved market is null-safe
  // here; treat a failed fetch as still-open and let the send-time guard catch the race.
  const program = getReadonlyProgram(connection)
  const accounts = await (program.account as any).market.fetchMultiple(markets)
  const open = markets.filter((_, i) => !accounts[i] || accounts[i].status !== STATUS_RESOLVED)
  if (!open.length) return []

  const signatures: string[] = []
  for (let i = 0; i < open.length; i += MAX_RESOLVE_PER_TX) {
    try {
      signatures.push(await resolveBatch(connection, wallet, privySignTransaction, open.slice(i, i + MAX_RESOLVE_PER_TX)))
    } catch (err) {
      // AlreadyResolved is a benign race (settled by the keeper mid-flight); anything else is real.
      if (!isAlreadyResolved(err)) throw err
    }
  }
  return signatures
}
