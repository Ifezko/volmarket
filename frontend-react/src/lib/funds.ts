import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

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
