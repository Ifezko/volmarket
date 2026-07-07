// Ported verbatim from frontend/index.html's WINDOWS/WSECS/holdProb/breakProb — the
// duration chips users pick when predicting. A real market's window is fixed once
// created, but the user chooses it up front (same as the original), and placing the
// prediction creates a fresh on-chain market for exactly that window if the wallet is
// the first person to bet that side/level/duration combo.
export const WINDOWS = ['5s', '15s', '25s', '30s', '1m', '2m', '3m', '5m', '15m', '30m', '1h']
export const WSECS = [5, 15, 25, 30, 60, 120, 180, 300, 900, 1800, 3600]
export const holdProb = (i: number) => Math.max(22, Math.min(84, Math.round(80 - i * 4.4)))
export const breakProb = (i: number) => Math.max(12, Math.min(80, Math.round(16 + i * 4.4)))
