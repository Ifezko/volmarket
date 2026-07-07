import { FL, rng } from './data'
import type { RealMarket } from '../lib/onchainMarkets'

const ODD_LABELS: Record<number, { grp: string; base: string }> = {
  0: { grp: 'Match result', base: 'home' },
  1: { grp: 'Match result', base: 'draw' },
  2: { grp: 'Match result', base: 'away' },
  3: { grp: 'Over/Under', base: 'over' },
  4: { grp: 'Over/Under', base: 'under' },
}

export interface LiveOdd {
  key: string
  oddKey: number
  grp: string
  label: string
  fl: string
  /** the level (%) of the primary market, used to seed the chart — see SignalChart */
  prob: number
  markets: RealMarket[]
}

export interface LiveFixture {
  id: string
  fixtureId: number
  comp: string
  a: string
  b: string
  status: 'live' | 'soon' | 'ended'
  ko?: string
  odds: LiveOdd[]
}

// There's no fixture metadata on-chain (team names, competition, kickoff) — that lives in
// TxLINE's feed, which isn't wired into the browser yet (see README "Open" items). Rather
// than hand-maintain a lookup table that only covers today's seeded demo fixtures, derive
// stable display names deterministically from the fixture id itself, the same way the
// sparklines are seeded — so ANY fixture (today's or a future real one) renders sensibly.
function pseudoTeams(fixtureId: number): { comp: string; a: string; b: string } {
  const countries = Object.keys(FL).filter((k) => k !== 'Draw')
  const r = rng(`fixture-${fixtureId}`)
  const ai = Math.floor(r() * countries.length)
  let bi = Math.floor(r() * countries.length)
  if (bi === ai) bi = (bi + 1) % countries.length
  const group = String.fromCharCode(65 + (fixtureId % 8)) // A..H
  return { comp: `World Cup · Group ${group}`, a: countries[ai], b: countries[bi] }
}

function oddLabel(oddKey: number, marketParams: number, a: string, b: string): { grp: string; label: string; fl: string } {
  const spec = ODD_LABELS[oddKey]
  if (!spec) return { grp: 'Other', label: `Odd ${oddKey}`, fl: '❓' }
  switch (spec.base) {
    case 'home':
      return { grp: spec.grp, label: a, fl: FL[a] }
    case 'away':
      return { grp: spec.grp, label: b, fl: FL[b] }
    case 'draw':
      return { grp: spec.grp, label: 'Draw', fl: FL.Draw }
    case 'over':
      return { grp: spec.grp, label: `Over ${(marketParams / 100).toFixed(1)} goals`, fl: '⚽' }
    case 'under':
      return { grp: spec.grp, label: `Under ${(marketParams / 100).toFixed(1)} goals`, fl: '🛡️' }
    default:
      return { grp: 'Other', label: `Odd ${oddKey}`, fl: '❓' }
  }
}

/** Groups the flat list of real on-chain Market accounts into board-shaped fixtures. */
export function buildLiveFixtures(markets: RealMarket[]): LiveFixture[] {
  const byFixture = new Map<number, RealMarket[]>()
  for (const m of markets) {
    const arr = byFixture.get(m.fixtureId) ?? []
    arr.push(m)
    byFixture.set(m.fixtureId, arr)
  }

  const now = Date.now() / 1000
  const fixtures: LiveFixture[] = []

  for (const [fixtureId, fixtureMarkets] of byFixture) {
    const { comp, a, b } = pseudoTeams(fixtureId)

    const byOdd = new Map<number, RealMarket[]>()
    for (const m of fixtureMarkets) {
      const arr = byOdd.get(m.oddKey) ?? []
      arr.push(m)
      byOdd.set(m.oddKey, arr)
    }

    const odds: LiveOdd[] = [...byOdd.entries()]
      .sort(([x], [y]) => x - y)
      .map(([oddKey, oddMarkets]) => {
        const primary = oddMarkets[0]
        const { grp, label, fl } = oddLabel(oddKey, primary.marketParams, a, b)
        return { key: String(oddKey), oddKey, grp, label, fl, prob: primary.level, markets: oddMarkets }
      })

    const openMarkets = fixtureMarkets.filter((m) => m.status === 'open')
    const liveNow = openMarkets.some((m) => m.windowStart <= now && now < m.windowEnd)
    const upcoming = openMarkets.filter((m) => now < m.windowStart).sort((x, y) => x.windowStart - y.windowStart)[0]
    const status: LiveFixture['status'] = liveNow ? 'live' : upcoming ? 'soon' : openMarkets.length ? 'live' : 'ended'
    const ko = upcoming ? new Date(upcoming.windowStart * 1000).toLocaleString() : undefined

    fixtures.push({ id: String(fixtureId), fixtureId, comp, a, b, status, ko, odds })
  }

  return fixtures.sort((x, y) => x.fixtureId - y.fixtureId)
}
