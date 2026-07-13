import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import type { BN, Idl } from '@coral-xyz/anchor'
import idl from '../idl/signal_markets.json'

const MARKET_SIDE = { 0: 'HOLD', 1: 'BREAK' } as const
const STATUS = { 0: 'OPEN', 1: 'RESOLVED' } as const
const OUTCOME = { 0: 'UNSET', 1: 'YES', 2: 'NO' } as const

export interface MarketView {
  address: string
  fixtureId: string
  oddKey: string
  level: string
  side: string
  status: string
  outcome: string
  totalYes: string
  totalNo: string
}

// Fetching accounts is read-only and never signs anything, so a throwaway keypair
// stands in for AnchorProvider's required `wallet` - its signing methods are never called.
class ReadonlyWallet {
  publicKey = Keypair.generate().publicKey

  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error('ReadonlyWallet cannot sign transactions')
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error('ReadonlyWallet cannot sign transactions')
  }
}

function toBn(value: BN): string {
  return value.toString()
}

export async function fetchMarkets(connection: Connection): Promise<MarketView[]> {
  const provider = new AnchorProvider(connection, new ReadonlyWallet(), { commitment: 'confirmed' })
  const program = new Program(idl as Idl, provider)

  const accounts = await (program.account as any).market.all()

  return accounts.map(({ publicKey, account }: { publicKey: PublicKey; account: unknown }) => {
    const m = account as {
      fixtureId: BN
      oddKey: BN
      level: BN
      side: number
      status: number
      outcome: number
      totalYes: BN
      totalNo: BN
    }
    return {
      address: publicKey.toBase58(),
      fixtureId: toBn(m.fixtureId),
      oddKey: toBn(m.oddKey),
      level: toBn(m.level),
      side: MARKET_SIDE[m.side as keyof typeof MARKET_SIDE] ?? String(m.side),
      status: STATUS[m.status as keyof typeof STATUS] ?? String(m.status),
      outcome: OUTCOME[m.outcome as keyof typeof OUTCOME] ?? String(m.outcome),
      totalYes: (Number(toBn(m.totalYes)) / 1e6).toString(),
      totalNo: (Number(toBn(m.totalNo)) / 1e6).toString(),
    }
  })
}
