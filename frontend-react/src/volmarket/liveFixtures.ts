import { FL, rng } from './data'
import type { RealMarket } from '../lib/onchainMarkets'
import { USDC_MINT } from '../lib/funds'
import realFixtures from './realFixtures.json'

// Real fixtures seeded from the live TxLINE feed carry no team names on-chain, so we keep a
// fixtureId -> real team names map (written by keeper/scripts/seed-live-fixtures.ts from the
// fixtures/snapshot response). Consulted ONLY for real TxLINE ids (>= REAL_FIXTURE_MIN); the
// synthetic demo fixtures (99xxx) fall through to pseudoTeams unchanged.
const REAL_FIXTURE_MIN = 18_000_000
const REAL_NAMES = realFixtures as Record<string, { a: string; b: string; comp: string }>

function fixtureIdentity(fixtureId: number): { comp: string; a: string; b: string } {
  if (fixtureId >= REAL_FIXTURE_MIN) {
    const real = REAL_NAMES[String(fixtureId)]
    if (real) return { comp: real.comp, a: real.a, b: real.b }
  }
  return pseudoTeams(fixtureId)
}

const ODD_LABELS: Record<number, { grp: string; base: string }> = {
  0: { grp: 'Match result', base: 'home' },
  1: { grp: 'Match result', base: 'draw' },
  2: { grp: 'Match result', base: 'away' },
  3: { grp: 'Over/Under', base: 'over' },
  4: { grp: 'Over/Under', base: 'under' },
}
// The canonical odd set every fixture offers - matches the original mock's oddsLines()
// (1X2 + Over/Under; BTTS omitted, see keeper/src/markets.ts ODD_OUTCOMES). Users can
// predict hold/break on any of these, not just whichever side happens to already have a
// real market - placing a prediction creates the market on demand (see depositMarkets.ts).
const CANONICAL_ODD_KEYS = [0, 1, 2, 3, 4]
const DEFAULT_OU_LINE = 250 // 2.5 goals, ×100 - the default line shown before a real market picks one

export interface LiveOdd {
  key: string
  oddKey: number
  marketParams: number
  grp: string
  label: string
  fl: string
  /** reference probability (%) for this odd - a real market's level if one exists, else a
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
  /** unix seconds the match clock counts from: the current live window's start (live) or the
   *  next window's start (soon). Undefined only if the fixture has no timed markets at all. */
  kickoff?: number
  odds: LiveOdd[]
}

// The scoreboard follows the standard football mental model: a live dot + match minute (or
// HT/FT) on the LEFT, and the SCORE in the middle. There's no real match feed on-chain - the
// market windows are week-long trading windows (see keeper/scripts/seed-devnet.ts), not match
// clocks - so, exactly like the team names/odds/sparklines, the score and minute are derived
// deterministically from the fixture id. Each fixture runs its own seeded 45+45 timeline that
// ticks in real time (with a half-time break), so a "live" match shows a believable, advancing
// minute in 1'..90' instead of a stale elapsed count.
const HALF = 45 * 60 // seconds of play per half
const HT_BREAK = 2 * 60 // half-time break on the display timeline
const FULL = HALF * 2 + HT_BREAK

export interface MatchState {
  /** left-hand label: "67'", "45+1'", "HT", "FT", or a kickoff time for upcoming */
  clock: string
  /** middle score, e.g. [2, 1]; null before kickoff (shown as "vs") */
  score: [number, number] | null
  /** whether to show the live pulse dot */
  live: boolean
}

function pseudoScore(fixtureId: number): [number, number] {
  const r = rng(`score-${fixtureId}`)
  return [Math.floor(r() * 4), Math.floor(r() * 4)]
}

export function matchState(f: LiveFixture, nowSecs: number): MatchState {
  if (f.status === 'soon') {
    const clock =
      f.kickoff != null
        ? new Date(f.kickoff * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : (f.ko ?? 'Upcoming')
    return { clock, score: null, live: false }
  }
  if (f.status === 'ended') {
    return { clock: 'FT', score: pseudoScore(f.fixtureId), live: false }
  }
  // live: advance a per-fixture seeded timeline in real time so each match shows a different,
  // ticking minute rather than a shared stale count.
  const offset = Math.floor(rng(`clock-${f.fixtureId}`)() * FULL)
  const t = (nowSecs + offset) % FULL
  const score = pseudoScore(f.fixtureId)
  if (t < HALF) return { clock: `${Math.floor(t / 60) + 1}'`, score, live: true }
  if (t < HALF + HT_BREAK) return { clock: 'HT', score, live: true }
  return { clock: `${46 + Math.floor((t - HALF - HT_BREAK) / 60)}'`, score, live: true }
}

// Elapsed match-timeline seconds (0..FULL) at a real time, from the fixture's seeded clock. This
// is the same value the scoreboard derives its minute from. The chart offsets FROM this single
// value (rather than re-computing the modulo per axis label), so the axis stays monotonic instead
// of wrapping around the loop boundary.
export function matchElapsedAt(fixtureId: number, nowSecs: number): number {
  const offset = Math.floor(rng(`clock-${fixtureId}`)() * FULL)
  return (((nowSecs + offset) % FULL) + FULL) % FULL
}

// Formats a match-timeline position (seconds) as mm:ss (e.g. "67:12"), matching the scoreboard's
// 1-indexed minute so the two stay in sync. "HT" during the break. The input is CLAMPED to the
// match bounds [0, FULL] so an offset before kickoff or past full time reads the kickoff (1:00) /
// full-time (90:00) bound rather than wrapping into another part of the timeline.
export function matchClockLabel(t: number): string {
  const tt = Math.max(0, Math.min(FULL, t))
  const mmss = (min: number, sec: number) => `${min}:${String(sec).padStart(2, '0')}`
  if (tt < HALF) return mmss(Math.floor(tt / 60) + 1, Math.floor(tt % 60))
  if (tt < HALF + HT_BREAK) return 'HT'
  const t2 = Math.min(HALF, tt - HALF - HT_BREAK)
  if (t2 >= HALF) return '90:00'
  return mmss(46 + Math.floor(t2 / 60), Math.floor(t2 % 60))
}

// The secondary-nav filters + sort. These actually drive the board (see applyBoardView).
export type BoardFilter = 'all' | 'trending' | 'live' | 'today' | 'upcoming'
export type BoardSort = 'volume' | 'recent'

// Total USDC staked across all of a fixture's markets - the "volume" the board sorts on.
export function fixtureVolume(f: LiveFixture): number {
  let v = 0
  for (const o of f.odds) for (const m of o.markets) v += m.totalYes + m.totalNo
  return v
}

// Most recent market window on the fixture - used for the "Recent" sort.
function fixtureLatest(f: LiveFixture): number {
  let t = 0
  for (const o of f.odds) for (const m of o.markets) t = Math.max(t, m.windowStart)
  return t
}

/**
 * Applies the selected secondary-nav filter + sort to the board's fixtures. Filters narrow by
 * status (live / upcoming / today = live-or-soon); "Trending" shows everything ranked by volume;
 * "All" keeps the current sort. This is what makes the nav tabs do something visible.
 */
export function applyBoardView(fixtures: LiveFixture[], filter: BoardFilter, sort: BoardSort): LiveFixture[] {
  // Only surface real TxLINE-seeded fixtures on the user-facing board. The synthetic demo
  // fixtures (99xxx/77xxx/91xxx) stay in the underlying data (still openable/testable and their
  // pseudoTeams naming is unchanged) - they're just hidden from what users see here.
  let list = fixtures.filter((f) => f.fixtureId >= REAL_FIXTURE_MIN)
  if (filter === 'live') list = list.filter((f) => f.status === 'live')
  else if (filter === 'upcoming') list = list.filter((f) => f.status === 'soon')
  else if (filter === 'today') list = list.filter((f) => f.status === 'live' || f.status === 'soon')

  const s: BoardSort = filter === 'trending' ? 'volume' : sort
  return [...list].sort((a, b) =>
    s === 'volume' ? fixtureVolume(b) - fixtureVolume(a) : fixtureLatest(b) - fixtureLatest(a),
  )
}

// There's no fixture metadata on-chain (team names, competition, kickoff) - that lives in
// TxLINE's feed, which isn't wired into the browser yet (see README "Open" items). Rather
// than hand-maintain a lookup table that only covers today's seeded demo fixtures, derive
// stable display names deterministically from the fixture id itself, the same way the
// sparklines are seeded - so ANY fixture (today's or a future real one) renders sensibly.
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
 * A human label for a market from its on-chain fields alone - the same deterministic team
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
  const { a, b } = fixtureIdentity(fixtureId)
  const { label } = oddLabel(oddKey, marketParams, a, b)
  const verb = side === 'hold' ? 'holds' : 'breaks'
  return `${a} v ${b} · ${label}: ${verb} ${level}%`
}

// Just the matchup + odd ("Argentina v Switzerland · Argentina"), no side/level - so callers can
// place the prediction's percentage/outcome elsewhere without repeating it.
export function describeOdd(fixtureId: number, oddKey: number, marketParams: number): string {
  const { a, b } = fixtureIdentity(fixtureId)
  const { label } = oddLabel(oddKey, marketParams, a, b)
  return `${a} v ${b} · ${label}`
}

// A prediction's window as match-clock times ("45:00→50:00") - when it starts and ends, for the
// chart call-line labels, the settlement popups, and the profile history.
export function matchWindowLabel(fixtureId: number, startSecs: number, endSecs: number): string {
  return `${matchClockLabel(matchElapsedAt(fixtureId, startSecs))}→${matchClockLabel(matchElapsedAt(fixtureId, endSecs))}`
}

/**
 * Groups the flat list of real on-chain Market accounts into board-shaped fixtures. Every
 * known fixture always offers the full canonical odd set (both teams, draw, over/under) -
 * real markets attach to whichever odds already have one, the rest get a placeholder
 * reference probability so they're still selectable and predictable.
 */
export function buildLiveFixtures(markets: RealMarket[]): LiveFixture[] {
  const byFixture = new Map<number, RealMarket[]>()
  for (const m of markets) {
    // Only surface markets on the app's canonical USDC mint. `market.all()` returns EVERY market
    // on the program regardless of mint, so markets created on throwaway/ephemeral mints (the
    // self-contained devnetProof flow, backend verification scripts, etc.) would otherwise show up
    // as stray board cards with pseudo team names. Their fixture ids clear REAL_FIXTURE_MIN but
    // they aren't real tradeable fixtures for this app.
    if (!m.usdcMint.equals(USDC_MINT)) continue
    const arr = byFixture.get(m.fixtureId) ?? []
    arr.push(m)
    byFixture.set(m.fixtureId, arr)
  }

  const now = Date.now() / 1000
  const fixtures: LiveFixture[] = []

  for (const [fixtureId, fixtureMarkets] of byFixture) {
    const { comp, a, b } = fixtureIdentity(fixtureId)

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

    // Clock reference: the earliest open window that's already running (the live session the
    // minute counts from), else the next window to open (soon), else nothing (resolved).
    const startedOpen = openMarkets.filter((m) => m.windowStart <= now).map((m) => m.windowStart)
    const kickoff = startedOpen.length ? Math.min(...startedOpen) : upcoming ? upcoming.windowStart : undefined

    fixtures.push({ id: String(fixtureId), fixtureId, comp, a, b, status, ko, kickoff, odds })
  }

  return fixtures.sort((x, y) => x.fixtureId - y.fixtureId)
}
