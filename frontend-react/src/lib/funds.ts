import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { PrivyAnchorWallet } from './privyAnchorWallet'
import { SIGNAL_MARKETS_PROGRAM_ID } from './onchainMarkets'

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

// The app's canonical devnet USDC mint (treasury-controlled — see keeper/scripts/setup-treasury.ts).
// Overridable per-env via VITE_USDC_MINT; the fallback is the mint created for this deployment.
export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT ?? '3aakQUJ6vvWphAr18ZoAJfoHs3w148tWJmKsgsnUj12q',
)

const FUND_ENDPOINT = import.meta.env.VITE_FUND_ENDPOINT ?? '/api/fund'

export interface FundResult {
  signature: string | null
  usdcMinted: number
  solToppedUp: number
}

// Calls the treasury funding endpoint: tops up a little gas SOL and mints `amount` USDC to the
// wallet. This is the "deposit" — on devnet there's no real USDC to move, so funding IS minting.
export async function fundWallet(address: string, amount: number): Promise<FundResult> {
  const res = await fetch(FUND_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, amount }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `funding failed (${res.status})`)
  return data as FundResult
}

// The wallet's spendable USDC balance (its canonical-mint ATA), in whole USDC. 0 if no ATA yet.
export async function fetchUsdcBalance(connection: Connection, owner: PublicKey): Promise<number> {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner)
  try {
    const bal = await connection.getTokenAccountBalance(ata)
    return Number(bal.value.amount) / 1e6
  } catch {
    return 0
  }
}

export interface FundingEvent {
  signature: string
  blockTime: number | null
  kind: 'deposit' | 'withdraw'
  /** movement size, in whole USDC (always positive) */
  amountUsdc: number
}

// Deposit/withdrawal history for the wallet's canonical-USDC account, newest first — the money-in/
// money-out half of the profile's History (predictions are the other half). We scan the USDC ATA's
// signatures, then classify each by the ATA's USDC balance delta: a credit is a deposit (treasury
// mint), a debit is a withdrawal. Predictions ALSO move USDC on this account (place debits into a
// market vault, claim credits back), so we drop any transaction that touches the signal_markets
// program — those already appear as predictions and would otherwise double-count as deposits/
// withdrawals. Only loaded when the History tab opens, so the per-tx parse cost is paid rarely.
export async function fetchFundingHistory(
  connection: Connection,
  owner: PublicKey,
  limit = 30,
): Promise<FundingEvent[]> {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner)
  const sigs = await connection.getSignaturesForAddress(ata, { limit })
  if (!sigs.length) return []

  const parsed = await connection.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 },
  )

  const ownerStr = owner.toBase58()
  const mintStr = USDC_MINT.toBase58()
  const programStr = SIGNAL_MARKETS_PROGRAM_ID.toBase58()

  const events: FundingEvent[] = []
  parsed.forEach((tx, i) => {
    if (!tx || tx.meta?.err) return

    // skip prediction placements/claims (they run through the signal_markets program) — those are
    // shown as predictions, not deposits/withdrawals.
    const touchesProgram =
      tx.transaction.message.instructions.some((ix) => ix.programId.toBase58() === programStr) ||
      (tx.meta?.innerInstructions ?? []).some((inner) =>
        inner.instructions.some((ix) => ix.programId.toBase58() === programStr),
      )
    if (touchesProgram) return

    const pre = tx.meta?.preTokenBalances?.find((b) => b.mint === mintStr && b.owner === ownerStr)
    const post = tx.meta?.postTokenBalances?.find((b) => b.mint === mintStr && b.owner === ownerStr)
    const deltaRaw = (post ? Number(post.uiTokenAmount.amount) : 0) - (pre ? Number(pre.uiTokenAmount.amount) : 0)
    if (deltaRaw === 0) return

    events.push({
      signature: sigs[i].signature,
      blockTime: sigs[i].blockTime ?? tx.blockTime ?? null,
      kind: deltaRaw > 0 ? 'deposit' : 'withdraw',
      amountUsdc: Math.abs(deltaRaw) / 1e6,
    })
  })
  return events
}

const USDC_DECIMALS = 6

// Withdraws USDC from the embedded wallet to any Solana address (signed silently by Privy,
// same as placing). Creates the destination's USDC token account if it doesn't exist yet, then
// transfers — so the recipient doesn't have to have opened one first.
export async function withdrawUsdc(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  destination: string,
  amount: number,
): Promise<string> {
  const owner = new PublicKey(wallet.address)
  let dest: PublicKey
  try {
    dest = new PublicKey(destination.trim())
  } catch {
    throw new Error('Enter a valid Solana address to withdraw to.')
  }
  const raw = Math.round(amount * 10 ** USDC_DECIMALS)
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('Enter an amount greater than 0.')

  const ownerAta = getAssociatedTokenAddressSync(USDC_MINT, owner)
  const destAta = getAssociatedTokenAddressSync(USDC_MINT, dest)

  const tx = new Transaction()
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(owner, destAta, dest, USDC_MINT),
    createTransferCheckedInstruction(ownerAta, USDC_MINT, destAta, owner, raw, USDC_DECIMALS),
  )
  tx.feePayer = owner
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  const signed = await anchorWallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}
