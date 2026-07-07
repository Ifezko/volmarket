// Ported verbatim from the groups2 mock dataset in frontend/index.html.
export interface Group {
  name: string
  members: number
  preds: number
  pnl: number
  wr: number
  roster: boolean
  visibility: 'Public' | 'Private'
}

export const initialGroups: Group[] = [
  { name: 'Lagos Sharps', members: 128, preds: 842, pnl: 12450, wr: 58, roster: false, visibility: 'Public' },
  { name: 'SuperteamNG Predictors', members: 212, preds: 1530, pnl: 34800, wr: 61, roster: false, visibility: 'Public' },
  { name: 'Naija Degens', members: 64, preds: 410, pnl: -2300, wr: 46, roster: true, visibility: 'Public' },
  { name: 'World Cup Whales', members: 301, preds: 2210, pnl: -8900, wr: 49, roster: true, visibility: 'Public' },
  { name: 'Signal Hunters', members: 39, preds: 188, pnl: 5600, wr: 55, roster: false, visibility: 'Public' },
  { name: 'Enugu Predicts', members: 22, preds: 96, pnl: 1240, wr: 52, roster: false, visibility: 'Public' },
]

export function fmtK(n: number): string {
  const a = Math.abs(n)
  return a >= 1000 ? (a / 1000).toFixed(1) + 'K' : '' + a
}
