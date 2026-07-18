// Client for the keeper's live-signal HTTP feed (keeper/src/httpServer.ts). The keeper is the only
// place with an authenticated TxLINE session, so it buffers the real demargined-% signal per odd and
// serves it here. The board shows only fixtures that appear in /fixtures (a genuinely live feed), and
// the chart draws /signal for the viewed odd - so what you see is the same signal that settles.
const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL || 'https://keeper-production-e15a.up.railway.app').replace(/\/$/, '')

export interface SignalPoint {
  t: number // unix seconds
  v: number // demargined implied probability, percent
}

export interface LiveSeries {
  fixtureId: number
  oddKey: number
  marketParams: number
  v: number
  t: number
}

export interface FixtureName {
  a: string
  b: string
  comp: string
  startTime?: number // kickoff, unix seconds - present for real fixtures; classifies upcoming vs live
}

export interface LiveFeed {
  series: LiveSeries[]
  names: Record<number, FixtureName>
}

// Fixtures/odds currently streaming a live signal, plus real fixture names. Empty (not throwing) if
// the keeper is unreachable.
export async function fetchLiveSeries(): Promise<LiveFeed> {
  try {
    const res = await fetch(`${KEEPER_URL}/fixtures`, { cache: 'no-store' })
    if (!res.ok) return { series: [], names: {} }
    const json = await res.json()
    return {
      series: Array.isArray(json?.series) ? json.series : [],
      names: json?.names && typeof json.names === 'object' ? json.names : {},
    }
  } catch {
    return { series: [], names: {} }
  }
}

export interface SettlementReceipt {
  market: string
  messageId: string // TxLINE record id of the deciding odds update
  ts: number
  value: number // settlement value (demargined % x1000)
  resolveTx: string // on-chain resolve_market signature
  at: number
}

// The settlement "receipt" for a market: the TxLINE datapoint that decided it + the resolve tx.
// null when the keeper didn't record one (e.g. a market that timed out to its default with no
// crossing datapoint, or the keeper is unreachable).
export async function fetchReceipt(market: string): Promise<SettlementReceipt | null> {
  try {
    const res = await fetch(`${KEEPER_URL}/receipt?market=${encodeURIComponent(market)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return json?.receipt ?? null
  } catch {
    return null
  }
}

// Recent {t, v} points for one odd. Empty if none / unreachable.
export async function fetchSignal(fixtureId: number, oddKey: number, marketParams: number): Promise<SignalPoint[]> {
  try {
    const url = `${KEEPER_URL}/signal?fixtureId=${fixtureId}&oddKey=${oddKey}&marketParams=${marketParams}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.points) ? json.points : []
  } catch {
    return []
  }
}
