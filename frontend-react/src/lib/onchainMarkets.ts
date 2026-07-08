import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import idl from '../idl/signal_markets.json'

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
const SIDE_HOLD = 0
const STATUS_RESOLVED = 1
const OUTCOME_UNSET = 0
const OUTCOME_YES = 1

export interface RealMarket {
  address: PublicKey
  fixtureId: number
  oddKey: number
  marketParams: number
  side: 'hold' | 'break'
  /** implied probability × 1000, the on-chain scale (see docs/volmarket-technical-doc.md §5) */
  levelRaw: number
  /** same value as a percent, e.g. 45000 -> 45 */
  level: number
  windowStart: number
  windowEnd: number
  status: 'open' | 'resolved'
  outcome: 'unset' | 'yes' | 'no'
  totalYes: number
  totalNo: number
  usdcMint: PublicKey
  vault: PublicKey
  authority: PublicKey
  feeBps: number
}

// Read-only account fetches never sign anything, so a throwaway keypair satisfies
// AnchorProvider's wallet requirement (see markets.ts for the same pattern from slice4).
class ReadonlyWallet {
  publicKey = Keypair.generate().publicKey
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error('ReadonlyWallet cannot sign transactions')
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error('ReadonlyWallet cannot sign transactions')
  }
}

export function getReadonlyProgram(connection: Connection): Program {
  const provider = new AnchorProvider(connection, new ReadonlyWallet(), { commitment: 'confirmed' })
  return new Program(idl as Idl, provider)
}

// getProgramAccounts (what account.all() uses) is heavy and the public devnet RPC frequently
// rate-limits it (HTTP 429), which would otherwise blank the board on a transient failure.
// Retry with exponential backoff so a throttled read recovers instead of showing "no markets".
// (For production, point VITE_RPC_URL at a dedicated RPC — the public endpoint isn't reliable
// for getProgramAccounts under a live app's polling.)
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 600): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i))
    }
  }
  throw lastErr
}

export async function fetchRealMarkets(connection: Connection): Promise<RealMarket[]> {
  const program = getReadonlyProgram(connection)
  const accounts = await withRetry<any[]>(() => (program.account as any).market.all())

  return accounts.map(({ publicKey, account }: { publicKey: PublicKey; account: any }) => {
    const levelRaw = Number(account.level)
    return {
      address: publicKey,
      fixtureId: Number(account.fixtureId),
      oddKey: Number(account.oddKey),
      marketParams: Number(account.marketParams),
      side: account.side === SIDE_HOLD ? 'hold' : 'break',
      levelRaw,
      level: levelRaw / 1000,
      windowStart: Number(account.windowStart),
      windowEnd: Number(account.windowEnd),
      status: account.status === STATUS_RESOLVED ? 'resolved' : 'open',
      outcome: account.outcome === OUTCOME_UNSET ? 'unset' : account.outcome === OUTCOME_YES ? 'yes' : 'no',
      totalYes: Number(account.totalYes) / 1e6,
      totalNo: Number(account.totalNo) / 1e6,
      usdcMint: account.usdcMint,
      vault: account.vault,
      authority: account.authority,
      feeBps: account.feeBps,
    }
  })
}
