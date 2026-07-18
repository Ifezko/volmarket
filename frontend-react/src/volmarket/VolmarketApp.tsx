import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { usePrivy } from '@privy-io/react-auth'
import { useSignTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import './volmarket.css'
import { rng } from './data'
import { Nav } from './Nav'
import { Board } from './Board'
import { Footer } from './Footer'
import { MatchDetail } from './MatchDetail'
import { Slip, type SlipItem, type Ticket } from './Slip'
import { HowModal } from './HowModal'
import { GroupsView, type PendingRequest } from './GroupsView'
import { GroupCreatePanel } from './GroupCreatePanel'
import { DepositPanel } from './DepositPanel'
import { ProfilePanel, type MyGroup } from './ProfilePanel'
import { SettleModal } from './SettleModal'
import { ResultModal } from './ResultModal'
import { type Group } from './groups'
import {
  fetchGroups,
  fetchGroupActivity,
  createGroupOnchain,
  requestJoinOnchain,
  approveMemberOnchain,
  groupDepositOnchain,
  updateGroupOnchain,
  leaveGroupOnchain,
  groupStats,
  type OnchainGroup,
  type OnchainMember,
  type GroupActivityItem,
} from '../lib/onchainGroups'
import { GroupDetail } from './GroupDetail'
import { fetchRealMarkets, makeConnection, type RealMarket } from '../lib/onchainMarkets'
import { placeRealPredictions, placeGroupPredictions, FEE_BPS, type PendingPick } from '../lib/depositMarkets'
import { claimPositions, fetchWalletState, previewMultiplier, type ClaimablePosition, type ActivePosition } from '../lib/claimMarkets'
import { resolveMarkets } from '../lib/resolveMarkets'
import { fetchLiveSeries } from '../lib/signalFeed'
import { getProfile, avatarGradient } from '../lib/profileStore'
import { fundWallet, fetchUsdcBalance, withdrawUsdc, fetchFundingHistory } from '../lib/funds'
import { buildLiveFixtures, applyBoardView, setRuntimeNames, type LiveFixture, type BoardFilter, type BoardSort } from './liveFixtures'
import type { PredictionLine } from './SignalChart'
import type { RealPredictMeta } from './PredictBuilder'

// Odds are FIXED decimal odds implied by the market level (the odd's probability), NOT a function
// of stake: Holds pays 1/p, Breaks pays 1/(1-p) with p = levelRaw/100000. The keeper (house) makes
// the pari-mutuel contract pay those odds by seeding the opposing pool with stake×(odds−1) - see
// keeper/src/config.ts / bootstrap.ts. BOOTSTRAP_CAP_USDC MUST match the keeper's cap: past it, the
// house can't fully back the true odds, so the delivered odds fall to 1 + cap/stake. Combos multiply.
const BOOTSTRAP_CAP_USDC = 1000
// The KEEPER is the settlement authority: it settles each market from the real TxLINE feed (the
// same signal the chart shows), resolving crossings/defeats in-window and holds at window close.
// The frontend must NOT preempt that with its blind timeout-resolve (which always makes Holds win
// and Breaks lose, disagreeing with the real outcome). So the frontend only force-resolves as a
// genuine last resort, long after close, when the keeper is clearly down. Reading the keeper's
// outcome, by contrast, happens promptly (a timer fires a refresh shortly after window_end).
const RESOLVE_GRACE_SECS = 45
// How soon after window_end to read (not resolve) so the keeper's fresh outcome shows promptly.
const SETTLE_READ_DELAY_SECS = 3
function oddsFromLevelRaw(levelRaw: number, side: 'hold' | 'break') {
  const p = Math.min(0.98, Math.max(0.02, levelRaw / 100000))
  return side === 'hold' ? 1 / p : 1 / (1 - p)
}

function genCode(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const p = (n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `${p(2)}${Math.floor(Math.random() * 9)}-${p(3)}-${p(3)}`
}

// paste a friend's code -> loads a mock prediction into the slip, ported from pasteCode()
// (this demo path has no real on-chain meta - placing it just produces a ticket, no tx)
function pasteCodePool(code: string): SlipItem[] {
  const r = rng(code)
  const pool = [
    'Brazil v Argentina · Brazil: holds 58%+ within 2m',
    'Brazil v Argentina · Over 2.5 goals - Yes',
    'Spain v Germany · Spain: breaks 75% within 5m',
    'France v England · Draw - Yes',
    'Nigeria v Ghana · Nigeria: holds 60%+ within 1m',
    'Italy v Uruguay · BTTS - Yes',
  ]
  const n = 1 + Math.floor(r() * 3)
  const used = new Set<number>()
  const items: SlipItem[] = []
  for (let k = 0; k < n; k++) {
    let i = Math.floor(r() * pool.length)
    while (used.has(i)) i = (i + 1) % pool.length
    used.add(i)
    items.push({ id: code + '-' + i, label: pool[i], mult: +(1.4 + r() * 2.6).toFixed(2) })
  }
  return items
}

// Top-level composition for the ported Volmarket product UI (see frontend/index.html).
// The board/detail trade REAL on-chain Market accounts (fetchRealMarkets, grouped by
// liveFixtures.ts). Predicting is free - pick a window and holds/breaks, add it to the
// slip, no wallet needed (see PredictBuilder.tsx) - Privy only asks you to log in when
// you hit "Place prediction", which then creates whatever markets don't exist yet and
// deposits real devnet USDC on all of them in one signed transaction.
export function VolmarketApp() {
  const { authenticated, login, logout, user } = usePrivy()
  const { wallets } = useSolanaWallets()
  const { signTransaction } = useSignTransaction()
  const solanaWallet = wallets[0]

  // Raw on-chain markets; the board (fixtures) is derived so it rebuilds when the keeper pushes real
  // names (namesVersion) as well as when markets change.
  const [rawMarkets, setRawMarkets] = useState<RealMarket[]>([])
  const [namesVersion, setNamesVersion] = useState(0)
  const fixtures = useMemo<LiveFixture[]>(() => buildLiveFixtures(rawMarkets), [rawMarkets, namesVersion])
  const [curMatchId, setCurMatchId] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [followed, setFollowed] = useState<Set<string>>(new Set())
  const [slip, setSlip] = useState<SlipItem[]>([])
  const [predMeta, setPredMeta] = useState<Record<string, RealPredictMeta>>({})
  const [slipOpen, setSlipOpen] = useState(false)
  const [stake, setStake] = useState(25)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  // Real on-chain groups (Group + GroupMember accounts). The board-shaped `groups` array, the
  // request/approve state and the owner's pending-approval lists are all derived from these.
  const [onchainGroups, setOnchainGroups] = useState<OnchainGroup[]>([])
  const [groupMembers, setGroupMembers] = useState<OnchainMember[]>([])
  const [groupActivity, setGroupActivity] = useState<GroupActivityItem[]>([])
  const [groupsViewOpen, setGroupsViewOpen] = useState(false)
  const [openGroupDetail, setOpenGroupDetail] = useState<string | null>(null) // group address
  const [savingGroup, setSavingGroup] = useState(false)
  const [leavingGroup, setLeavingGroup] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState<{ seedCode?: string; stage: 'form' | 'created' } | null>(null)
  const [depositOpen, setDepositOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [claimables, setClaimables] = useState<ClaimablePosition[]>([])
  // snapshot of what was claimed, so the "Claimed" success view survives the poll that
  // (correctly) empties `claimables` once the positions are marked claimed on-chain.
  const [claimedItems, setClaimedItems] = useState<ClaimablePosition[]>([])
  const [settleOpen, setSettleOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  // Winners are auto-claimed in the background (see refreshWalletState); `surfaceFallback` reveals
  // the hidden manual-claim affordance only once auto-claim has exhausted its retries, so funds
  // can never get stuck.
  const [surfaceFallback, setSurfaceFallback] = useState(false)
  // Background auto-claim so winnings land in the balance automatically (no "Claim" click): a
  // per-position attempt counter (retry-capped, then the manual fallback surfaces) and a guard.
  const autoClaimAttempts = useRef<Map<string, number>>(new Map())
  const autoClaiming = useRef(false)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  // Every position the wallet holds (pending/won/lost) - drawn onto the signal chart as the
  // user's "calls", so placed predictions and their outcome show up alongside the live tape.
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([])
  // "Your prediction ended" popup: the positions that just settled this session.
  const [endedResults, setEndedResults] = useState<ActivePosition[]>([])
  const [resultOpen, setResultOpen] = useState(false)
  // position keys already settled (so we only pop for ones that end while you're watching, not
  // for history); a per-market resolve-attempt counter (so a transient failure retries a few
  // times instead of stranding the prediction forever, but can't spin indefinitely); and a
  // re-entrancy guard around the resolve tx.
  const resolvedSeen = useRef<Set<string>>(new Set())
  const resolveSeeded = useRef(false)
  const resolveAttempts = useRef<Map<string, number>>(new Map())
  const resolvingEnded = useRef(false)
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')
  const [boardSort, setBoardSort] = useState<BoardSort>('volume')
  const [search, setSearch] = useState('')
  // Fixtures the keeper reports as streaming a live signal right now. null = not fetched yet. The
  // board shows ONLY these, so every chart draws a real feed and every settlement matches it.
  const [liveFixtureIds, setLiveFixtureIds] = useState<Set<number> | null>(null)

  // The signed-in user's local profile (username + avatar). profileVersion bumps on save so the nav
  // avatar and username re-read from the store.
  const [profileVersion, setProfileVersion] = useState(0)
  const myProfile = useMemo(() => getProfile(solanaWallet?.address), [solanaWallet?.address, profileVersion])
  const avatarBg = avatarGradient(solanaWallet?.address)
  const avatarInitial = (myProfile.username || solanaWallet?.address || '?').slice(0, 1).toUpperCase()

  const namesJsonRef = useRef('')
  const refreshLive = useCallback(async () => {
    const { series, names } = await fetchLiveSeries()
    setRuntimeNames(names) // real match names for the auto-created live cards
    const namesJson = JSON.stringify(names)
    if (namesJson !== namesJsonRef.current) {
      namesJsonRef.current = namesJson
      setNamesVersion((v) => v + 1) // rebuild the board so the new names take effect
    }
    setLiveFixtureIds(new Set(series.map((s) => s.fixtureId)))
  }, [])
  useEffect(() => {
    refreshLive()
    const id = setInterval(refreshLive, 15_000)
    return () => clearInterval(id)
  }, [refreshLive])

  const curMatch = curMatchId ? fixtures.find((m) => m.id === curMatchId) ?? null : null
  const displayedFixtures = useMemo(() => {
    const view = applyBoardView(fixtures, boardFilter, boardSort)
    // Only surface fixtures with a live signal feed (empty until the keeper's live set loads).
    const live = liveFixtureIds ? view.filter((f) => liveFixtureIds.has(f.fixtureId)) : []
    const q = search.trim().toLowerCase()
    if (!q) return live
    // Match on either team or the competition, so "arg", "switz", "world cup" all work.
    return live.filter((f) => `${f.a} ${f.b} ${f.comp}`.toLowerCase().includes(q))
  }, [fixtures, boardFilter, boardSort, search, liveFixtureIds])

  // Every on-chain market currently loaded (flattened from the board data), for pricing the slip.
  // The slip priced with the REAL payout multiplier. Placing ALWAYS opens a fresh market - its
  // PDA is keyed by window_start = now, so a prediction never deposits into an existing pool
  // (and the odd's level is deterministic, so other bettors' markets on the same line are separate
  // window_starts). Each leg's odds are the FIXED decimal odds from its level (oddsFromLevelRaw) -
  // the keeper seeds the opposing pool with perStake×(odds−1), capped at BOOTSTRAP_CAP_USDC, so the
  // pro-rata claim pays perStake×odds minus the protocol fee. previewMultiplier mirrors that claim
  // math. Beyond the cap the house can't fully back the odds, so the delivered multiplier drops
  // accordingly (kept in lock-step with the keeper). The FEE_BPS protocol fee is priced in here: it
  // is taken on the winnings and routes to the dedicated fee wallet (create_market's fee_recipient),
  // so - unlike before - it does NOT wash back to the placer. computePayout subtracts the same fee,
  // so the settled amount matches this preview. Pasted demo picks (no meta) keep their placeholder.
  const pricedSlip = useMemo<SlipItem[]>(() => {
    const perStake = slip.length ? stake / slip.length : stake
    return slip.map((s) => {
      const meta = predMeta[s.id]
      if (!meta) return s
      const odds = oddsFromLevelRaw(meta.levelRaw, meta.side)
      const seed = Math.min(BOOTSTRAP_CAP_USDC, perStake * (odds - 1))
      return { ...s, mult: previewMultiplier(0, seed, perStake, FEE_BPS) }
    })
  }, [slip, predMeta, stake])

  const refreshMarkets = useCallback(async () => {
    try {
      const connection = makeConnection()
      const real = await fetchRealMarkets(connection)
      setRawMarkets(real)
    } catch (err) {
      console.error('failed to fetch real markets', err)
    }
  }, [])

  useEffect(() => {
    refreshMarkets()
  }, [refreshMarkets])

  const refreshGroups = useCallback(async () => {
    try {
      const connection = makeConnection()
      const [{ groups, members }, activity] = await Promise.all([
        fetchGroups(connection),
        fetchGroupActivity(connection),
      ])
      setOnchainGroups(groups)
      setGroupMembers(members)
      setGroupActivity(activity)
    } catch (err) {
      console.error('failed to fetch groups', err)
    }
  }, [])

  useEffect(() => {
    refreshGroups()
  }, [refreshGroups])

  // Refresh groups whenever the browser opens, so a just-created/joined group shows immediately.
  useEffect(() => {
    if (groupsViewOpen) refreshGroups()
  }, [groupsViewOpen, refreshGroups])

  // Derive the board-shaped group list + per-group membership state from the on-chain accounts.
  // Index alignment matters: GroupsView keys its request/approve callbacks by array index, so the
  // `boardGroups` order is the source of truth the sets and pending-map are all built against.
  const { boardGroups, requestedGroups, joinedGroups, pendingByIdx, activityByIdx, sendableGroups, myGroups } = useMemo(() => {
    const me = solanaWallet?.address
    const boardGroups: Group[] = []
    const requestedGroups = new Set<number>()
    const joinedGroups = new Set<number>()
    const pendingByIdx = new Map<number, PendingRequest[]>()
    const activityByIdx = new Map<number, GroupActivityItem[]>()
    const sendableGroups: { address: string; name: string }[] = []
    const myGroups: MyGroup[] = []
    const activityByGroup = new Map<string, GroupActivityItem[]>()
    for (const a of groupActivity) {
      const arr = activityByGroup.get(a.group) ?? []
      arr.push(a)
      activityByGroup.set(a.group, arr)
    }
    onchainGroups.forEach((g, idx) => {
      const act = activityByGroup.get(g.address) ?? []
      if (act.length) activityByIdx.set(idx, act)
      // Live stats derived from the group's on-chain calls + their market outcomes.
      const stats = groupStats(act, g.feeBps)
      boardGroups.push({
        name: g.name,
        members: g.memberCount,
        preds: stats.preds,
        pnl: stats.pnl,
        wr: stats.wr,
        roster: g.roster,
        visibility: g.visibility,
        address: g.address,
        owner: g.owner,
        feeBps: g.feeBps,
      })
      const mine = me ? groupMembers.find((m) => m.group === g.address && m.member === me) : undefined
      const isOwner = !!me && g.owner === me
      if (mine?.approved) joinedGroups.add(idx)
      else if (mine) requestedGroups.add(idx)
      // Groups the user can stake into: owned or approved-member (matches the on-chain gate).
      if (isOwner || mine?.approved) sendableGroups.push({ address: g.address, name: g.name })
      // "My groups" for the profile: owned or approved-member.
      if (isOwner || mine?.approved) {
        myGroups.push({ address: g.address, name: g.name, feeBps: g.feeBps, role: isOwner ? 'Owner' : 'Member', members: g.memberCount })
      }
      if (me && g.owner === me) {
        const pending = groupMembers
          .filter((m) => m.group === g.address && !m.approved)
          .map((m) => ({ memberAccount: m.address, member: m.member }))
        if (pending.length) pendingByIdx.set(idx, pending)
      }
    })
    return { boardGroups, requestedGroups, joinedGroups, pendingByIdx, activityByIdx, sendableGroups, myGroups }
  }, [onchainGroups, groupMembers, groupActivity, solanaWallet?.address])

  const refreshUsdc = useCallback(async () => {
    if (!authenticated || !solanaWallet) {
      setUsdcBalance(null)
      return
    }
    try {
      const connection = makeConnection()
      setUsdcBalance(await fetchUsdcBalance(connection, new PublicKey(solanaWallet.address)))
    } catch (err) {
      console.error('failed to fetch USDC balance', err)
    }
  }, [authenticated, solanaWallet])

  // Surfaces the "prediction ended" popup for any settled positions not seen yet. Seeds the
  // seen-set silently on the first pass so we don't pop for predictions that settled before
  // this session - only for ones that end while you're here.
  const surfaceEnded = useCallback((positions: ActivePosition[]) => {
    const settled = positions.filter((p) => p.status !== 'pending')
    if (!resolveSeeded.current) {
      resolvedSeen.current = new Set(settled.map((p) => p.position.toBase58()))
      resolveSeeded.current = true
      return
    }
    const fresh = settled.filter((p) => !resolvedSeen.current.has(p.position.toBase58()))
    if (!fresh.length) return
    fresh.forEach((p) => resolvedSeen.current.add(p.position.toBase58()))
    setEndedResults(fresh)
    setResultOpen(true)
  }, [])

  // One consolidated poll: a single combined read (fetchWalletState = one position scan + one
  // market scan) drives the board, the chart's active positions, and claimables - then we
  // auto-resolve ended predictions and auto-claim winners off that same data. Halves the
  // getProgramAccounts load vs. the old separate claimables + active-positions polls.
  const refreshWalletState = useCallback(
    async (depth = 0) => {
      if (!authenticated || !solanaWallet) {
        setActivePositions([])
        setClaimables([])
        setSurfaceFallback(false)
        resolvedSeen.current = new Set()
        resolveSeeded.current = false
        resolveAttempts.current = new Map()
        autoClaimAttempts.current = new Map()
        return
      }
      // don't overlap a still-running resolve/claim from a previous cycle
      if (claiming || ((autoClaiming.current || resolvingEnded.current) && depth === 0)) return
      try {
        const connection = makeConnection()
        const owner = new PublicKey(solanaWallet.address)
        const { markets, active, claimable } = await fetchWalletState(connection, owner)
        setRawMarkets(markets)
        setActivePositions(active)
        surfaceEnded(active)

        const MAX_CLAIM_ATTEMPTS = 6
        const MAX_RESOLVE_ATTEMPTS = 6

        setClaimables(claimable)
        // manual fallback surfaces only once auto-claim has exhausted its retries on a winner
        setSurfaceFallback(
          claimable.some((c) => (autoClaimAttempts.current.get(c.position.toBase58()) ?? 0) >= MAX_CLAIM_ATTEMPTS),
        )

        // bound the per-cycle resolve→claim cascade; each pass that does work re-reads once more
        if (depth >= 2) return

        // Auto-resolve our own predictions whose window has closed but nothing settled them yet, so
        // they resolve at the chosen duration (the keeper is the primary, in-window verified
        // resolver; this covers it not running / not seeing the market in time). Wait RESOLVE_GRACE
        // past close so a running keeper wins, and cap retries so a transient failure doesn't strand.
        const nowSecs = Math.floor(Date.now() / 1000)
        const ended = active.filter(
          (p) =>
            p.status === 'pending' &&
            nowSecs >= p.windowEnd + RESOLVE_GRACE_SECS &&
            (resolveAttempts.current.get(p.market.toBase58()) ?? 0) < MAX_RESOLVE_ATTEMPTS,
        )
        const toClaim = claimable.filter(
          (c) => (autoClaimAttempts.current.get(c.position.toBase58()) ?? 0) < MAX_CLAIM_ATTEMPTS,
        )
        if (!ended.length && !toClaim.length) return

        let didWork = false
        if (ended.length && !resolvingEnded.current) {
          resolvingEnded.current = true
          ended.forEach((p) => {
            const k = p.market.toBase58()
            resolveAttempts.current.set(k, (resolveAttempts.current.get(k) ?? 0) + 1)
          })
          try {
            const mk = [...new Set(ended.map((p) => p.market.toBase58()))].map((s) => new PublicKey(s))
            await resolveMarkets(connection, solanaWallet, signTransaction, mk)
            didWork = true
          } catch (err) {
            console.error('auto-resolve failed', err)
          } finally {
            resolvingEnded.current = false
          }
        }
        if (toClaim.length && !autoClaiming.current) {
          autoClaiming.current = true
          toClaim.forEach((c) => {
            const k = c.position.toBase58()
            autoClaimAttempts.current.set(k, (autoClaimAttempts.current.get(k) ?? 0) + 1)
          })
          try {
            await claimPositions(connection, solanaWallet, signTransaction, toClaim)
            setUsdcBalance(await fetchUsdcBalance(connection, owner))
            didWork = true
          } catch (err) {
            console.error('auto-claim failed', err)
          } finally {
            autoClaiming.current = false
          }
        }
        // reflect the resolve/claim results with a single follow-up combined read
        if (didWork) await refreshWalletState(depth + 1)
      } catch (err) {
        console.error('failed to refresh wallet state', err)
      }
    },
    [authenticated, solanaWallet, signTransaction, claiming, surfaceEnded],
  )

  useEffect(() => {
    refreshWalletState()
    refreshUsdc()
    const id = setInterval(() => {
      refreshWalletState()
      refreshUsdc()
      refreshGroups()
    }, 20_000)
    return () => clearInterval(id)
  }, [refreshWalletState, refreshUsdc, refreshGroups])

  // Show the keeper's outcome promptly: schedule a READ (not a resolve) shortly after the soonest
  // pending prediction's window closes, so the keeper's fresh settlement surfaces without waiting for
  // the next 20s poll. It's a read because RESOLVE_GRACE_SECS >> SETTLE_READ_DELAY_SECS, so this
  // refresh won't itself force-resolve - the keeper stays the settlement authority.
  useEffect(() => {
    const pending = activePositions.filter((p) => p.status === 'pending')
    if (!pending.length) return
    const nowSecs = Date.now() / 1000
    const soonest = Math.min(...pending.map((p) => p.windowEnd + SETTLE_READ_DELAY_SECS))
    const delayMs = Math.max(0, (soonest - nowSecs) * 1000) + 600
    const id = setTimeout(() => refreshWalletState(), delayMs)
    return () => clearTimeout(id)
  }, [activePositions, refreshWalletState])

  useEffect(() => {
    document.body.classList.toggle('lock', curMatch !== null || groupsViewOpen)
  }, [curMatch, groupsViewOpen])

  // Ported from the global keydown handler in the original: Escape closes any open
  // overlay, "/" focuses search (unless already typing in an input).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setHowOpen(false)
        setGroupsViewOpen(false)
        setSlipOpen(false)
        setCurMatchId(null)
      }
      if (e.key === '/' && (document.activeElement as HTMLElement | null)?.tagName !== 'INPUT') {
        e.preventDefault()
        document.getElementById('search')?.focus()
      }
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [])

  function openMatch(id: string) {
    const m = fixtures.find((x) => x.id === id)
    if (!m) return
    setCurMatchId(id)
    setActiveKey(m.status === 'live' ? (m.odds[0]?.key ?? null) : null)
    window.scrollTo(0, 0)
  }

  function closeMatch() {
    setCurMatchId(null)
  }

  function selectOdd(key: string, scroll?: boolean) {
    setActiveKey(key)
    if (scroll) {
      const el = document.querySelector('.sig')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function toggleFollow(id: string) {
    setFollowed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Ported from add() in the original - toggles a pick in/out of the slip and records
  // its fixture/odd/side/level/window so place() can find it again. No wallet touched.
  function addPrediction(id: string, label: string, prob: number, meta: RealPredictMeta) {
    if (ticket) setTicket(null)
    setPlaceError(null)
    setPredMeta((prev) => ({ ...prev, [id]: meta }))
    setSlip((prev) => {
      if (prev.some((s) => s.id === id)) return prev.filter((s) => s.id !== id)
      const mult = 100 / Math.max(1, prob)
      return [...prev, { id, label, mult }]
    })
  }

  function isSelected(id: string) {
    return slip.some((s) => s.id === id)
  }

  // "Your call" lines for the currently-viewed odd: only ACTIVE calls - live (pending) placed
  // positions and not-yet-placed slip picks. Settled predictions (won/lost) drop off the chart
  // once resolved, so only in-play calls are ever drawn.
  const predictionLines = useMemo<PredictionLine[]>(() => {
    if (!curMatch || !activeKey) return []
    const oddKey = Number(activeKey)
    const lines: PredictionLine[] = []
    activePositions.forEach((p) => {
      if (p.status === 'pending' && p.fixtureId === curMatch.fixtureId && p.oddKey === oddKey) {
        lines.push({ level: p.level, side: p.side, status: 'pending', windowStart: p.windowStart, windowEnd: p.windowEnd })
      }
    })
    slip.forEach((s) => {
      const m = predMeta[s.id]
      if (m && m.fixtureId === curMatch.fixtureId && m.oddKey === oddKey) {
        lines.push({ level: m.levelRaw / 1000, side: m.side })
      }
    })
    return lines
  }, [slip, predMeta, curMatch, activeKey, activePositions])

  function removeFromSlip(id: string) {
    setSlip((prev) => prev.filter((s) => s.id !== id))
  }

  function copyCode(code: string) {
    navigator.clipboard?.writeText(code).catch(() => {})
  }

  function pasteCode(code: string) {
    setSlip(pasteCodePool(code))
    setTicket(null)
  }

  // Ported from place() in the original. Real picks (from PredictBuilder) create whatever
  // markets don't exist yet and deposit on them, all in one Privy-signed transaction -
  // login is only asked for here, at the moment of placing. Pasted demo picks (no real
  // meta) just produce a shareable ticket, same as the original mock.
  async function place() {
    if (!slip.length) return
    // Use the real-pool-priced slip for the combo/ticket so the recorded payout matches the UI.
    const combo = pricedSlip.reduce((a, s) => a * s.mult, 1)
    const perStake = +(stake / slip.length).toFixed(2)
    const picks: PendingPick[] = slip.flatMap((s) => {
      const m = predMeta[s.id]
      return m ? [{ ...m, amountUsdc: perStake }] : []
    })

    if (picks.length) {
      if (!authenticated) {
        login()
        return
      }
      if (!solanaWallet) {
        setPlaceError('Wallet not ready yet - try again in a moment.')
        return
      }
      setPlacing(true)
      setPlaceError(null)
      try {
        const connection = makeConnection()
        await placeRealPredictions(connection, solanaWallet, signTransaction, picks)
      } catch (err) {
        setPlaceError(err instanceof Error ? err.message : String(err))
        setPlacing(false)
        return
      }
      setPlacing(false)
      // The prediction is confirmed on-chain - show success now. Refresh board / balance /
      // positions in the background rather than making the user wait on more round-trips.
      void refreshWalletState()
      void refreshUsdc()
    }

    setTicket({ code: genCode(), sel: pricedSlip, stake, mult: combo })
    setSlip([])
  }

  // "Send to group": stake the current slip into a group (group_deposit) instead of an individual
  // position, so it lands in the shared pool and surfaces in the group activity feed. Same picks and
  // per-pick stake split as place(); requires real picks + an approved membership in the target group.
  async function sendToGroup(groupAddress: string) {
    if (!slip.length) return
    const combo = pricedSlip.reduce((a, s) => a * s.mult, 1)
    const perStake = +(stake / slip.length).toFixed(2)
    const picks: PendingPick[] = slip.flatMap((s) => {
      const m = predMeta[s.id]
      return m ? [{ ...m, amountUsdc: perStake }] : []
    })
    if (!picks.length) return
    if (!authenticated) {
      login()
      return
    }
    if (!solanaWallet) {
      setPlaceError('Wallet not ready yet - try again in a moment.')
      return
    }
    setSending(true)
    setPlaceError(null)
    try {
      const connection = makeConnection()
      await placeGroupPredictions(connection, solanaWallet, signTransaction, groupAddress, picks)
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : String(err))
      setSending(false)
      return
    }
    setSending(false)
    setTicket({ code: genCode(), sel: pricedSlip, stake, mult: combo })
    setSlip([])
    void refreshGroups()
    void refreshUsdc()
  }

  // Collects every winning position back to the wallet by calling the program's `claim`
  // (signed silently, same as placing). On success the positions flip to claimed on-chain,
  // so the next refresh drops them from the list.
  async function claimWinnings() {
    if (!claimables.length || !solanaWallet) return
    setClaiming(true)
    setClaimError(null)
    setClaimedItems(claimables)
    try {
      const connection = makeConnection()
      await claimPositions(connection, solanaWallet, signTransaction, claimables)
      setClaimed(true)
      await refreshWalletState()
      await refreshUsdc()
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : String(err))
    } finally {
      setClaiming(false)
    }
  }

  function openSettle() {
    setClaimed(false)
    setClaimError(null)
    setSettleOpen(true)
  }

  function closeSettle() {
    setSettleOpen(false)
    if (claimed) {
      setClaimed(false)
      // resync now that the claim landed so the fallback affordance clears.
      setSurfaceFallback(false)
      refreshWalletState()
    }
  }

  // Real deposit: funds the embedded wallet with `amount` devnet USDC (and a little gas SOL)
  // via the treasury endpoint, then refreshes the on-screen balance. Login is prompted here if
  // needed, same as placing - you can't deposit into a wallet you haven't signed into yet.
  async function depositUsdc(amount: number) {
    if (!authenticated) {
      login()
      throw new Error('Sign in to deposit.')
    }
    if (!solanaWallet) throw new Error('Wallet not ready yet - try again in a moment.')
    await fundWallet(solanaWallet.address, amount)
    await refreshUsdc()
  }

  // Withdraws USDC from the embedded wallet to an external address, then refreshes the balance.
  async function withdraw(destination: string, amount: number) {
    if (!solanaWallet) throw new Error('Wallet not ready yet - try again in a moment.')
    const connection = makeConnection()
    await withdrawUsdc(connection, solanaWallet, signTransaction, destination, amount)
    await refreshUsdc()
  }

  // Opens the profile (wallet address + withdraw) in the slip drawer's override slot. Login is
  // prompted if needed - the profile is meaningless without a signed-in embedded wallet.
  function openProfile() {
    if (!authenticated) {
      login()
      return
    }
    setProfileOpen(true)
    setDepositOpen(false)
    setCreatingGroup(null)
    setSlipOpen(true)
  }

  // Ported from openGroups()/createGroup() - opens the group-creation form in the slip
  // drawer, pre-seeded with a ticket's share code when reached via "Make this a group".
  function openGroupCreate(seedCode?: string) {
    setCreatingGroup({ seedCode, stage: 'form' })
    setDepositOpen(false)
    setProfileOpen(false)
    setSlipOpen(true)
  }

  // Ported from openDeposit() - reuses the slip drawer's override slot, same as group
  // creation.
  function openDeposit() {
    setDepositOpen(true)
    setCreatingGroup(null)
    setProfileOpen(false)
    setSlipOpen(true)
  }

  // create_group on-chain. roster = "anyone with link" (members shown to approved joiners); fee_bps
  // is the group's cut chosen in the form. The panel flips to its "created" view optimistically; on
  // failure we log and refresh so the list stays truthful to chain.
  async function createGroup(group: { name: string; visibility: 'Public' | 'Private'; joinMode: 'link' | 'invite'; feeBps: number }) {
    if (!authenticated || !solanaWallet) {
      login()
      return
    }
    try {
      const connection = makeConnection()
      await createGroupOnchain(connection, solanaWallet, signTransaction, {
        name: group.name,
        feeBps: group.feeBps,
        visibility: group.visibility,
        roster: group.joinMode === 'link',
      })
    } catch (err) {
      console.error('create_group failed', err)
    }
    await refreshGroups()
  }

  // request_join on-chain. The button latches to "Requested" from real GroupMember state after the
  // refresh (and re-requesting would fail at init anyway).
  async function requestJoinGroup(idx: number) {
    if (!authenticated || !solanaWallet) {
      login()
      return
    }
    const g = onchainGroups[idx]
    if (!g) return
    try {
      const connection = makeConnection()
      await requestJoinOnchain(connection, solanaWallet, signTransaction, g.address)
    } catch (err) {
      console.error('request_join failed', err)
    }
    await refreshGroups()
  }

  // approve_member on-chain (owner only; the UI only offers it on groups you own).
  async function approveMember(idx: number, memberAddress: string) {
    if (!authenticated || !solanaWallet) {
      login()
      return
    }
    const g = onchainGroups[idx]
    if (!g) return
    try {
      const connection = makeConnection()
      await approveMemberOnchain(connection, solanaWallet, signTransaction, g.address, memberAddress)
    } catch (err) {
      console.error('approve_member failed', err)
    }
    await refreshGroups()
  }

  // "Join this call": the viewer's own group_deposit copying a feed item's market/side, staked with
  // the app's current stake amount. Terminates in a signed group_deposit (same instruction as the
  // proposer's "Send to group"), then refreshes so the new call appears in the feed.
  async function joinCall(idx: number, item: GroupActivityItem) {
    if (!authenticated || !solanaWallet) {
      login()
      return
    }
    const g = onchainGroups[idx]
    if (!g) return
    try {
      const connection = makeConnection()
      await groupDepositOnchain(connection, solanaWallet, signTransaction, {
        group: g.address,
        market: item.market,
        side: item.side,
        amountUsdc: stake,
      })
    } catch (err) {
      console.error('group_deposit (join call) failed', err)
    }
    await Promise.all([refreshGroups(), refreshUsdc()])
  }

  // ---- group detail (opened from the profile's "My groups") ----
  function openGroup(address: string) {
    setOpenGroupDetail(address)
    setProfileOpen(false)
    setSlipOpen(false)
    setGroupsViewOpen(false)
  }

  async function saveGroupDetail(opts: { name: string; feeBps: number; visibility: 'Public' | 'Private'; roster: boolean }) {
    if (!openGroupDetail || !authenticated || !solanaWallet) return
    setSavingGroup(true)
    try {
      const connection = makeConnection()
      await updateGroupOnchain(connection, solanaWallet, signTransaction, openGroupDetail, opts)
    } catch (err) {
      console.error('update_group failed', err)
    }
    setSavingGroup(false)
    await refreshGroups()
  }

  async function leaveGroupDetail() {
    if (!openGroupDetail || !authenticated || !solanaWallet) return
    setLeavingGroup(true)
    try {
      const connection = makeConnection()
      await leaveGroupOnchain(connection, solanaWallet, signTransaction, openGroupDetail)
    } catch (err) {
      console.error('leave_group failed', err)
      setLeavingGroup(false)
      return
    }
    setLeavingGroup(false)
    setOpenGroupDetail(null)
    await refreshGroups()
  }

  async function approveGroupDetail(memberAddress: string) {
    if (!openGroupDetail || !authenticated || !solanaWallet) return
    try {
      const connection = makeConnection()
      await approveMemberOnchain(connection, solanaWallet, signTransaction, openGroupDetail, memberAddress)
    } catch (err) {
      console.error('approve_member failed', err)
    }
    await refreshGroups()
  }

  async function joinCallDetail(item: GroupActivityItem) {
    if (!authenticated || !solanaWallet) {
      login()
      return
    }
    if (!openGroupDetail) return
    try {
      const connection = makeConnection()
      await groupDepositOnchain(connection, solanaWallet, signTransaction, {
        group: openGroupDetail,
        market: item.market,
        side: item.side,
        amountUsdc: stake,
      })
    } catch (err) {
      console.error('group_deposit (join call) failed', err)
    }
    await Promise.all([refreshGroups(), refreshUsdc()])
  }

  // The group currently open in the detail view + its derived slices.
  const detailGroup = openGroupDetail ? onchainGroups.find((g) => g.address === openGroupDetail) ?? null : null
  const detailRole: 'owner' | 'member' = detailGroup && detailGroup.owner === solanaWallet?.address ? 'owner' : 'member'
  const detailMembers = openGroupDetail ? groupMembers.filter((m) => m.group === openGroupDetail) : []
  const detailActivity = openGroupDetail ? groupActivity.filter((a) => a.group === openGroupDetail) : []

  return (
    <>
      <Nav
        comboCount={slip.length}
        authenticated={authenticated}
        usdcBalance={usdcBalance}
        search={search}
        filter={boardFilter}
        sortLabel={boardSort === 'volume' ? 'Volume' : 'Recent'}
        onSearch={setSearch}
        onSelectFilter={setBoardFilter}
        onCycleSort={() => setBoardSort((s) => (s === 'volume' ? 'recent' : 'volume'))}
        onLogoClick={closeMatch}
        onLogin={login}
        onOpenDeposit={openDeposit}
        onOpenSlip={() => {
          setCreatingGroup(null)
          setDepositOpen(false)
          setProfileOpen(false)
          setSlipOpen(true)
        }}
        onOpenGroupsView={() => setGroupsViewOpen(true)}
        onOpenProfile={openProfile}
        avatarUrl={myProfile.avatar}
        avatarBg={avatarBg}
        avatarInitial={avatarInitial}
      />
      <Board
        fixtures={displayedFixtures}
        hasAnyMarkets={fixtures.length > 0}
        onOpenMatch={openMatch}
        onOpenHow={() => setHowOpen(true)}
      />
      <Footer
        onGoHome={closeMatch}
        onOpenHow={() => setHowOpen(true)}
        onOpenGroupsView={() => setGroupsViewOpen(true)}
        onOpenDeposit={openDeposit}
      />

      {curMatch && (
        <MatchDetail
          match={curMatch}
          activeKey={activeKey}
          isFollowed={followed.has(curMatch.id)}
          onClose={closeMatch}
          onSelectOdd={selectOdd}
          onToggleFollow={toggleFollow}
          onOpenHow={() => setHowOpen(true)}
          predictionLines={predictionLines}
          isSelected={isSelected}
          onAdd={addPrediction}
          onLiveProb={() => {}}
          slip={pricedSlip}
          stake={stake}
          ticket={ticket}
          placing={placing}
          placeError={placeError}
          insufficientFunds={authenticated && usdcBalance != null && usdcBalance < stake}
          balance={usdcBalance}
          onRemoveFromSlip={removeFromSlip}
          onSetStake={setStake}
          onPlace={place}
          onOpenDeposit={openDeposit}
          onCopyCode={copyCode}
          onMakeGroup={(code) => openGroupCreate(code)}
          onNewSlip={() => setTicket(null)}
          sendableGroups={sendableGroups}
          sending={sending}
          onSendToGroup={sendToGroup}
        />
      )}

      <Slip
        open={slipOpen}
        slip={pricedSlip}
        stake={stake}
        ticket={ticket}
        placing={placing}
        placeError={placeError}
        insufficientFunds={authenticated && usdcBalance != null && usdcBalance < stake}
        balance={usdcBalance}
        onOpenDeposit={openDeposit}
        override={
          creatingGroup
            ? {
                title: creatingGroup.stage === 'created' ? 'Group created' : 'Create a group',
                body: (
                  <GroupCreatePanel
                    seedCode={creatingGroup.seedCode}
                    onCreate={createGroup}
                    onCopyCode={copyCode}
                    onDone={() => setSlipOpen(false)}
                    onStageChange={(stage) => setCreatingGroup((prev) => (prev ? { ...prev, stage } : prev))}
                  />
                ),
              }
            : depositOpen
              ? { title: 'Deposit', body: <DepositPanel balance={usdcBalance ?? 0} onDeposit={depositUsdc} /> }
              : profileOpen
                ? {
                    title: 'Profile',
                    body: (
                      <ProfilePanel
                        walletAddress={solanaWallet?.address}
                        balance={usdcBalance ?? 0}
                        accountLabel={
                          user?.email?.address ??
                          user?.google?.email ??
                          (user?.wallet ? 'External wallet' : undefined)
                        }
                        onCopyAddress={copyCode}
                        onWithdraw={withdraw}
                        onLogout={async () => {
                          await logout()
                          setSlipOpen(false)
                          setProfileOpen(false)
                        }}
                        positions={activePositions}
                        myGroups={myGroups}
                        onOpenGroups={() => {
                          setProfileOpen(false)
                          setSlipOpen(false)
                          setGroupsViewOpen(true)
                        }}
                        onOpenGroup={openGroup}
                        loadFunding={async () => {
                          if (!solanaWallet) return []
                          const connection = makeConnection()
                          return fetchFundingHistory(connection, new PublicKey(solanaWallet.address))
                        }}
                        onProfileSaved={() => setProfileVersion((v) => v + 1)}
                      />
                    ),
                  }
                : null
        }
        onOpen={() => {
          setCreatingGroup(null)
          setDepositOpen(false)
          setProfileOpen(false)
          setSlipOpen(true)
        }}
        onClose={() => setSlipOpen(false)}
        onRemove={removeFromSlip}
        onSetStake={setStake}
        onPlace={place}
        onCopyCode={copyCode}
        onMakeGroup={(code) => openGroupCreate(code)}
        onNewSlip={() => setTicket(null)}
        onPasteCode={pasteCode}
        sendableGroups={sendableGroups}
        sending={sending}
        onSendToGroup={sendToGroup}
      />

      <HowModal open={howOpen} onClose={() => setHowOpen(false)} />

      {/* Hidden fallback: only appears if the keeper hasn't paid out a winning position, so a
          user can always recover stuck funds manually. Invisible in the normal auto-paid flow. */}
      {surfaceFallback && !settleOpen && claimables.length > 0 && (
        <button className="claim-fallback" onClick={openSettle}>
          Claim {claimables.length} winning prediction{claimables.length > 1 ? 's' : ''}
        </button>
      )}

      <ResultModal open={resultOpen} results={endedResults} onClose={() => setResultOpen(false)} />

      <SettleModal
        open={settleOpen}
        claimables={claimed ? claimedItems : claimables}
        claiming={claiming}
        claimed={claimed}
        error={claimError}
        onClaim={claimWinnings}
        onClose={closeSettle}
      />

      <GroupsView
        open={groupsViewOpen}
        groups={boardGroups}
        requested={requestedGroups}
        joined={joinedGroups}
        currentUser={solanaWallet?.address}
        pendingByIdx={pendingByIdx}
        activityByIdx={activityByIdx}
        onClose={() => setGroupsViewOpen(false)}
        onCreateGroup={() => openGroupCreate()}
        onRequestJoin={requestJoinGroup}
        onApprove={approveMember}
        onJoinCall={joinCall}
      />

      <GroupDetail
        open={openGroupDetail != null}
        group={detailGroup}
        role={detailRole}
        members={detailMembers}
        activity={detailActivity}
        currentUser={solanaWallet?.address}
        saving={savingGroup}
        leaving={leavingGroup}
        onClose={() => setOpenGroupDetail(null)}
        onSave={saveGroupDetail}
        onLeave={leaveGroupDetail}
        onApprove={approveGroupDetail}
        onJoinCall={joinCallDetail}
      />
    </>
  )
}
