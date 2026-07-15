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

// Fixtures/odds currently streaming a live signal. Empty (not throwing) if the keeper is unreachable.
export async function fetchLiveSeries(): Promise<LiveSeries[]> {
  try {
    const res = await fetch(`${KEEPER_URL}/fixtures`, { cache: 'no-store' })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.series) ? json.series : []
  } catch {
    return []
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
