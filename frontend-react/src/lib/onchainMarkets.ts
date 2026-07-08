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
// rate-limits it (HTTP 429), which would otherwise blank the board. Alchemy's devnet RPC is far
// more tolerant of it, so we fall back to it (then to the public endpoint) when the primary
// throttles. Configure it with VITE_ALCHEMY_RPC_URL (full URL) or VITE_ALCHEMY_API_KEY.
const PUBLIC_DEVNET = 'https://api.devnet.solana.com'
const ALCHEMY_RPC_URL =
  import.meta.env.VITE_ALCHEMY_RPC_URL ||
  (import.meta.env.VITE_ALCHEMY_API_KEY
    ? `https://solana-devnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
    : undefined)

// The RPC the app should prefer for everything (reads + writes): an explicit VITE_RPC_URL wins,
// else Alchemy if configured, else the public devnet endpoint.
export const PRIMARY_RPC_URL = import.meta.env.VITE_RPC_URL || ALCHEMY_RPC_URL || PUBLIC_DEVNET

// Read-only fallbacks tried after the primary connection, in order. Deduped so we never hit the
// same endpoint twice, and the public endpoint is always kept as a last resort.
const FALLBACK_URLS = [...new Set([ALCHEMY_RPC_URL, PUBLIC_DEVNET].filter(Boolean) as string[])]
const fallbackConnections = FALLBACK_URLS.map((url) => new Connection(url, 'confirmed'))

// Startup diagnostic: log which RPC hosts are wired in (host only — never the URL, which
// contains the Alchemy key). If this prints `api.devnet.solana.com` as primary with no Alchemy
// host in the fallbacks, the VITE_ALCHEMY_* env var wasn't present at *build* time — set it in
// Vercel and redeploy (Vite bakes env vars at build, not runtime).
try {
  const host = (u: string) => new URL(u).host
  console.info('[volmarket] RPC primary:', host(PRIMARY_RPC_URL), '· fallbacks:', FALLBACK_URLS.map(host).join(', '))
} catch {
  /* URL parse guard — never block startup on a diagnostic */
}

// Runs `run` against the primary connection, failing over to each configured fallback endpoint
// (notably Alchemy) when a read throws — e.g. the public RPC 429-ing getProgramAccounts — with a
// short backoff between full passes. Used for every account scan so throttling degrades instead
// of blanking the UI.
export async function withFailover<T>(
  primary: Connection,
  run: (program: Program) => Promise<T>,
  passes = 2,
  baseMs = 500,
): Promise<T> {
  const conns = [primary, ...fallbackConnections.filter((c) => c.rpcEndpoint !== primary.rpcEndpoint)]
  let lastErr: unknown
  for (let pass = 0; pass < passes; pass++) {
    for (const conn of conns) {
      try {
        return await run(getReadonlyProgram(conn))
      } catch (err) {
        lastErr = err
      }
    }
    if (pass < passes - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** pass))
  }
  throw lastErr
}

export async function fetchRealMarkets(connection: Connection): Promise<RealMarket[]> {
  const accounts = await withFailover<any[]>(connection, (program) => (program.account as any).market.all())

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
