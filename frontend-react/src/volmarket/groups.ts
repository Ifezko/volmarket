import { getProfile } from '../lib/profileStore'

// Board-shaped group, backed by on-chain Group accounts (see lib/onchainGroups.ts + the
// boardGroups memo in VolmarketApp). `members`/`feeBps`/`owner` are real on-chain fields;
// `preds`/`pnl`/`wr` are derived from the group's GroupPosition accounts joined to their
// markets by lib/onchainGroups.groupStats, which mirrors the claim_group payout math.
export interface Group {
  name: string
  members: number
  preds: number
  pnl: number
  wr: number
  roster: boolean
  visibility: 'Public' | 'Private'
  /** on-chain fields */
  address?: string
  owner?: string
  feeBps?: number
}

// "Free" for a 0% group, else e.g. "2.5%". Mirrors lib/onchainGroups.feeLabel.
export function feeLabel(feeBps: number): string {
  return feeBps === 0 ? 'Free' : `${(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2)}%`
}

export function fmtK(n: number): string {
  const a = Math.abs(n)
  return a >= 1000 ? (a / 1000).toFixed(1) + 'K' : '' + a
}

// A friendly, stable username for a wallet - so the UI never shows a raw address. Owner-set names
// aren't stored yet, so this is the SYSTEM-generated generic handle: adjective + noun + a short
// suffix, deterministically derived from the address (same wallet -> same handle, effectively
// unique). Swap in a real owner-set username here once a profile/name store exists.
const HANDLE_ADJ = ['Swift', 'Bold', 'Sharp', 'Lucky', 'Prime', 'Iron', 'Golden', 'Rapid', 'Silent', 'Bright', 'Wild', 'Noble', 'Brave', 'Sly', 'Vivid', 'Cosmic']
const HANDLE_NOUN = ['Falcon', 'Otter', 'Trader', 'Whale', 'Shark', 'Fox', 'Hawk', 'Bull', 'Tiger', 'Wolf', 'Cobra', 'Lynx', 'Raven', 'Puma', 'Comet', 'Ace']

export function userHandle(address?: string, name?: string): string {
  if (name && name.trim()) return name.trim() // owner-set display name (when a name store exists)
  const stored = getProfile(address).username // this browser's signed-in user, if they set one
  if (stored && stored.trim()) return stored.trim()
  if (!address) return 'Anonymous'
  let h = 0
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0
  const adj = HANDLE_ADJ[h % HANDLE_ADJ.length]
  const noun = HANDLE_NOUN[Math.floor(h / HANDLE_ADJ.length) % HANDLE_NOUN.length]
  const num = (h % 900) + 100 // 3-digit suffix so distinct wallets rarely collide
  return `${adj}${noun}${num}`
}
