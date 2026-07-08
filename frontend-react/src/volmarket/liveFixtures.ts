import { FL, rng } from './data'
import type { RealMarket } from '../lib/onchainMarkets'

const ODD_LABELS: Record<number, { grp: string; base: string }> = {
  0: { grp: 'Match result', base: 'home' },
  1: { grp: 'Match result', base: 'draw' },
  2: { grp: 'Match result', base: 'away' },
  3: { grp: 'Over/Under', base: 'over' },
  4: { grp: 'Over/Under', base: 'under' },
}
// The canonical odd set every fixture offers — matches the original mock's oddsLines()
// (1X2 + Over/Under; BTTS omitted, see keeper/src/markets.ts ODD_OUTCOMES). Users can
// predict hold/break on any of these, not just whichever side happens to already have a
// real market — placing a prediction creates the market on demand (see depositMarkets.ts).
const CANONICAL_ODD_KEYS = [0, 1, 2, 3, 4]
const DEFAULT_OU_LINE = 250 // 2.5 goals, ×100 — the default line shown before a real market picks one

export interface LiveOdd {
  key: string
  oddKey: number
  marketParams: number
  grp: string
  label: string
  fl: string
  /** reference probability (%) for this odd — a real market's level if one exists, else a
   *  stable pseudo-value seeded from the fixture+odd, same idea as the sparkline seeding */
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

function pseudoProb(fixtureId: number, oddKey: number): number {
  const r = rng(`prob-${fixtureId}-${oddKey}`)
  return Math.round(30 + r() * 40) // 30-70%, a plausible mid-range default
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

/**
 * A human label for a market from its on-chain fields alone — the same deterministic team
 * and odd naming the board uses, so a claim popup reads like the board did (e.g.
 * "Brazil v Argentina · Over 2.5 goals: holds 58%"). Used by the settlement modal.
 */
export function describeMarket(
  fixtureId: number,
  oddKey: number,
  marketParams: number,
  side: 'hold' | 'break',
  level: number,
): string {
  const { a, b } = pseudoTeams(fixtureId)
  const { label } = oddLabel(oddKey, marketParams, a, b)
  const verb = side === 'hold' ? 'holds' : 'breaks'
  return `${a} v ${b} · ${label}: ${verb} ${level}%`
}

/**
 * Groups the flat list of real on-chain Market accounts into board-shaped fixtures. Every
 * known fixture always offers the full canonical odd set (both teams, draw, over/under) —
 * real markets attach to whichever odds already have one, the rest get a placeholder
 * reference probability so they're still selectable and predictable.
 */
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

    const odds: LiveOdd[] = CANONICAL_ODD_KEYS.map((oddKey) => {
      const oddMarkets = byOdd.get(oddKey) ?? []
      const primary = oddMarkets[0]
      const marketParams = primary ? primary.marketParams : oddKey >= 3 ? DEFAULT_OU_LINE : 0
      const { grp, label, fl } = oddLabel(oddKey, marketParams, a, b)
      const prob = primary ? primary.level : pseudoProb(fixtureId, oddKey)
      return { key: String(oddKey), oddKey, marketParams, grp, label, fl, prob, markets: oddMarkets }
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
