// Ported verbatim (logic-for-logic) from frontend/index.html's inline <script> -
// flags, mock match list, and the odds/probability math the whole UI is built on.
// Do not change these formulas; they're what the rest of the port renders against.

export const FL: Record<string, string> = {
  Brazil: '🇧🇷',
  Argentina: '🇦🇷',
  France: '🇫🇷',
  England: '🏴',
  Spain: '🇪🇸',
  Germany: '🇩🇪',
  Portugal: '🇵🇹',
  Netherlands: '🇳🇱',
  USA: '🇺🇸',
  Mexico: '🇲🇽',
  Croatia: '🇭🇷',
  Belgium: '🇧🇪',
  Italy: '🇮🇹',
  Uruguay: '🇺🇾',
  Japan: '🇯🇵',
  Senegal: '🇸🇳',
  Nigeria: '🇳🇬',
  Ghana: '🇬🇭',
  Morocco: '🇲🇦',
  Colombia: '🇨🇴',
  Draw: '⚖️',
}

interface MatchLive {
  id: string
  comp: string
  a: string
  b: string
  status: 'live' | 'ht'
  score: [number, number]
  min: number
  prob: number
  vol: string
}

interface MatchSoon {
  id: string
  comp: string
  a: string
  b: string
  status: 'soon'
  ko: string
  prob: number
  vol: string
}

export type Match = MatchLive | MatchSoon

export const matches: Match[] = [
  { id: 'bra-arg', comp: 'World Cup · Group F', a: 'Brazil', b: 'Argentina', status: 'live', score: [1, 1], min: 58, prob: 64, vol: '3.2M' },
  { id: 'nga-gha', comp: 'World Cup · Group D', a: 'Nigeria', b: 'Ghana', status: 'live', score: [2, 2], min: 66, prob: 53, vol: '1.4M' },
  { id: 'esp-ger', comp: 'World Cup · Group E', a: 'Spain', b: 'Germany', status: 'live', score: [2, 1], min: 71, prob: 68, vol: '2.8M' },
  { id: 'fra-eng', comp: 'World Cup · Group A', a: 'France', b: 'England', status: 'live', score: [0, 0], min: 23, prob: 55, vol: '2.1M' },
  { id: 'por-ned', comp: 'World Cup · Group C', a: 'Portugal', b: 'Netherlands', status: 'live', score: [0, 1], min: 39, prob: 42, vol: '1.9M' },
  { id: 'jpn-sen', comp: 'World Cup · Group H', a: 'Japan', b: 'Senegal', status: 'ht', score: [1, 1], min: 45, prob: 51, vol: '620K' },
  { id: 'usa-mex', comp: 'World Cup · Group B', a: 'USA', b: 'Mexico', status: 'soon', ko: '19:00', prob: 58, vol: '910K' },
  { id: 'cro-bel', comp: 'World Cup · Group G', a: 'Croatia', b: 'Belgium', status: 'soon', ko: '21:00', prob: 47, vol: '740K' },
  { id: 'ita-uru', comp: 'World Cup · Group I', a: 'Italy', b: 'Uruguay', status: 'soon', ko: '22:00', prob: 60, vol: '680K' },
  { id: 'mar-col', comp: 'World Cup · Group J', a: 'Morocco', b: 'Colombia', status: 'soon', ko: 'Tomorrow', prob: 49, vol: '410K' },
]

export function splitResult(prob: number): [number, number, number] {
  const draw = Math.round(Math.max(18, Math.min(30, 30 - Math.abs(prob - 50) / 3)))
  const H = Math.round((prob * (100 - draw)) / 100)
  const A = 100 - draw - H
  return [H, draw, A]
}

export interface OddLine {
  grp: string
  key: string
  label: string
  fl: string
  prob: number
}

// odds lines per match - each has its own volume signal.
// Feature 1X2 (Match result) and Over/Under only. BTTS ("both teams score") is intentionally
// omitted: TxLINE isn't serving its SuperOddsType in the feed right now, so we can't settle it.
// Re-add the BTTS lines here (and in ODD_OUTCOMES in keeper/src/markets.ts) once the feed carries it.
export function oddsLines(m: Match): OddLine[] {
  const [H, D, A] = splitResult(m.prob)
  return [
    { grp: 'Match result', key: 'res-h', label: m.a, fl: FL[m.a], prob: H },
    { grp: 'Match result', key: 'res-d', label: 'Draw', fl: FL.Draw, prob: D },
    { grp: 'Match result', key: 'res-a', label: m.b, fl: FL[m.b], prob: A },
    { grp: 'Goals', key: 'ov25', label: 'Over 2.5 goals', fl: '⚽', prob: 48 },
    { grp: 'Goals', key: 'un25', label: 'Under 2.5 goals', fl: '🛡️', prob: 52 },
    // BTTS removed - not available in the TxLINE feed at present.
  ]
}

// ---- seeded RNG (for the static board/odds-list sparklines) ----
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
