import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
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
import { GroupsView } from './GroupsView'
import { GroupCreatePanel } from './GroupCreatePanel'
import { DepositPanel } from './DepositPanel'
import { ProfilePanel } from './ProfilePanel'
import { SettleModal } from './SettleModal'
import { initialGroups, type Group } from './groups'
import { fetchRealMarkets } from '../lib/onchainMarkets'
import { placeRealPredictions, type PendingPick } from '../lib/depositMarkets'
import { fetchClaimablePositions, claimPositions, type ClaimablePosition } from '../lib/claimMarkets'
import { fundWallet, fetchUsdcBalance, withdrawUsdc } from '../lib/funds'
import { buildLiveFixtures, type LiveFixture } from './liveFixtures'
import type { PredictionLine } from './SignalChart'
import type { RealPredictMeta } from './PredictBuilder'

const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'

function genCode(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const p = (n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `${p(2)}${Math.floor(Math.random() * 9)}-${p(3)}-${p(3)}`
}

// paste a friend's code -> loads a mock prediction into the slip, ported from pasteCode()
// (this demo path has no real on-chain meta — placing it just produces a ticket, no tx)
function pasteCodePool(code: string): SlipItem[] {
  const r = rng(code)
  const pool = [
    'Brazil v Argentina · Brazil: holds 58%+ within 2m',
    'Brazil v Argentina · Over 2.5 goals — Yes',
    'Spain v Germany · Spain: breaks 75% within 5m',
    'France v England · Draw — Yes',
    'Nigeria v Ghana · Nigeria: holds 60%+ within 1m',
    'Italy v Uruguay · BTTS — Yes',
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
// liveFixtures.ts). Predicting is free — pick a window and holds/breaks, add it to the
// slip, no wallet needed (see PredictBuilder.tsx) — Privy only asks you to log in when
// you hit "Place prediction", which then creates whatever markets don't exist yet and
// deposits real devnet USDC on all of them in one signed transaction.
export function VolmarketApp({ onOpenDevnet }: { onOpenDevnet: () => void }) {
  const { authenticated, login } = usePrivy()
  const { wallets } = useSolanaWallets()
  const { signTransaction } = useSignTransaction()
  const solanaWallet = wallets[0]

  const [fixtures, setFixtures] = useState<LiveFixture[]>([])
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
  const [howOpen, setHowOpen] = useState(false)
  const [groups, setGroups] = useState<Group[]>(initialGroups)
  const [requestedGroups, setRequestedGroups] = useState<Set<number>>(new Set())
  const [groupsViewOpen, setGroupsViewOpen] = useState(false)
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
  // The keeper auto-claims winners, so a winning position is normally marked claimed on-chain
  // within seconds and never shows up here. `surfaceFallback` only turns true for a position
  // still unclaimed after a full poll cycle (~20s) — i.e. the keeper didn't settle it — which
  // reveals the hidden manual-claim affordance so funds can never get stuck.
  const [surfaceFallback, setSurfaceFallback] = useState(false)
  const prevClaimKeys = useRef<Set<string>>(new Set())
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)

  const curMatch = curMatchId ? fixtures.find((m) => m.id === curMatchId) ?? null : null

  const refreshMarkets = useCallback(async () => {
    try {
      const connection = new Connection(RPC_URL, 'confirmed')
      const real = await fetchRealMarkets(connection)
      setFixtures(buildLiveFixtures(real))
    } catch (err) {
      console.error('failed to fetch real markets', err)
    }
  }, [])

  // Poll for winning positions the keeper hasn't paid out. In the happy path this stays empty
  // (the keeper claims within seconds); we only reveal the manual fallback for a position that
  // is still unclaimed after a full poll cycle, so a transient race doesn't flash the affordance.
  const refreshClaimables = useCallback(async () => {
    if (claiming) return // don't clobber the list mid-claim
    if (!authenticated || !solanaWallet) {
      setClaimables([])
      setSurfaceFallback(false)
      prevClaimKeys.current = new Set()
      return
    }
    try {
      const connection = new Connection(RPC_URL, 'confirmed')
      const found = await fetchClaimablePositions(connection, new PublicKey(solanaWallet.address))
      setClaimables(found)
      const keys = new Set(found.map((c) => c.position.toBase58()))
      const stuck = found.some((c) => prevClaimKeys.current.has(c.position.toBase58()))
      setSurfaceFallback(stuck)
      prevClaimKeys.current = keys
    } catch (err) {
      console.error('failed to fetch claimable positions', err)
    }
  }, [authenticated, solanaWallet, claiming])

  useEffect(() => {
    refreshMarkets()
  }, [refreshMarkets])

  const refreshUsdc = useCallback(async () => {
    if (!authenticated || !solanaWallet) {
      setUsdcBalance(null)
      return
    }
    try {
      const connection = new Connection(RPC_URL, 'confirmed')
      setUsdcBalance(await fetchUsdcBalance(connection, new PublicKey(solanaWallet.address)))
    } catch (err) {
      console.error('failed to fetch USDC balance', err)
    }
  }, [authenticated, solanaWallet])

  useEffect(() => {
    refreshClaimables()
    refreshUsdc()
    const id = setInterval(() => {
      refreshClaimables()
      refreshUsdc()
    }, 20_000)
    return () => clearInterval(id)
  }, [refreshClaimables, refreshUsdc])

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

  // Ported from add() in the original — toggles a pick in/out of the slip and records
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

  // "Your call" lines for the currently-viewed odd, drawn from pending slip picks.
  const predictionLines = useMemo<PredictionLine[]>(() => {
    if (!curMatch || !activeKey) return []
    const oddKey = Number(activeKey)
    const lines: PredictionLine[] = []
    slip.forEach((s) => {
      const m = predMeta[s.id]
      if (m && m.fixtureId === curMatch.fixtureId && m.oddKey === oddKey) {
        lines.push({ level: m.levelRaw / 1000, side: m.side })
      }
    })
    return lines
  }, [slip, predMeta, curMatch, activeKey])

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
  // markets don't exist yet and deposit on them, all in one Privy-signed transaction —
  // login is only asked for here, at the moment of placing. Pasted demo picks (no real
  // meta) just produce a shareable ticket, same as the original mock.
  async function place() {
    if (!slip.length) return
    const combo = slip.reduce((a, s) => a * s.mult, 1)
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
        setPlaceError('Wallet not ready yet — try again in a moment.')
        return
      }
      setPlacing(true)
      setPlaceError(null)
      try {
        const connection = new Connection(RPC_URL, 'confirmed')
        await placeRealPredictions(connection, solanaWallet, signTransaction, picks)
        await refreshMarkets()
        await refreshUsdc()
      } catch (err) {
        setPlaceError(err instanceof Error ? err.message : String(err))
        setPlacing(false)
        return
      }
      setPlacing(false)
    }

    setTicket({ code: genCode(), sel: slip, stake, mult: combo })
    setSlip([])
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
      const connection = new Connection(RPC_URL, 'confirmed')
      await claimPositions(connection, solanaWallet, signTransaction, claimables)
      setClaimed(true)
      await refreshMarkets()
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
      prevClaimKeys.current = new Set()
      setSurfaceFallback(false)
      refreshClaimables()
    }
  }

  // Real deposit: funds the embedded wallet with `amount` devnet USDC (and a little gas SOL)
  // via the treasury endpoint, then refreshes the on-screen balance. Login is prompted here if
  // needed, same as placing — you can't deposit into a wallet you haven't signed into yet.
  async function depositUsdc(amount: number) {
    if (!authenticated) {
      login()
      throw new Error('Sign in to deposit.')
    }
    if (!solanaWallet) throw new Error('Wallet not ready yet — try again in a moment.')
    await fundWallet(solanaWallet.address, amount)
    await refreshUsdc()
  }

  // Withdraws USDC from the embedded wallet to an external address, then refreshes the balance.
  async function withdraw(destination: string, amount: number) {
    if (!solanaWallet) throw new Error('Wallet not ready yet — try again in a moment.')
    const connection = new Connection(RPC_URL, 'confirmed')
    await withdrawUsdc(connection, solanaWallet, signTransaction, destination, amount)
    await refreshUsdc()
  }

  // Opens the profile (wallet address + withdraw) in the slip drawer's override slot. Login is
  // prompted if needed — the profile is meaningless without a signed-in embedded wallet.
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

  // Ported from openGroups()/createGroup() — opens the group-creation form in the slip
  // drawer, pre-seeded with a ticket's share code when reached via "Make this a group".
  function openGroupCreate(seedCode?: string) {
    setCreatingGroup({ seedCode, stage: 'form' })
    setDepositOpen(false)
    setProfileOpen(false)
    setSlipOpen(true)
  }

  // Ported from openDeposit() — reuses the slip drawer's override slot, same as group
  // creation.
  function openDeposit() {
    setDepositOpen(true)
    setCreatingGroup(null)
    setProfileOpen(false)
    setSlipOpen(true)
  }

  function createGroup(group: { name: string; visibility: 'Public' | 'Private'; joinMode: 'link' | 'invite' }) {
    setGroups((prev) => [
      { name: group.name, members: 1, preds: 0, pnl: 0, wr: 0, roster: group.joinMode === 'link', visibility: group.visibility },
      ...prev,
    ])
  }

  function requestJoinGroup(idx: number) {
    setRequestedGroups((prev) => new Set(prev).add(idx))
  }

  return (
    <>
      <Nav
        comboCount={slip.length}
        walletAddress={solanaWallet?.address}
        usdcBalance={usdcBalance}
        activeTab="product"
        onLogoClick={closeMatch}
        onOpenDeposit={openDeposit}
        onOpenSlip={() => {
          setCreatingGroup(null)
          setDepositOpen(false)
          setProfileOpen(false)
          setSlipOpen(true)
        }}
        onOpenGroupsView={() => setGroupsViewOpen(true)}
        onOpenDevnet={onOpenDevnet}
        onOpenProfile={openProfile}
      />
      <Board fixtures={fixtures} onOpenMatch={openMatch} onOpenHow={() => setHowOpen(true)} />
      <Footer />

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
        />
      )}

      <Slip
        open={slipOpen}
        slip={slip}
        stake={stake}
        ticket={ticket}
        placing={placing}
        placeError={placeError}
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
                        onCopyAddress={copyCode}
                        onWithdraw={withdraw}
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
      />

      <HowModal open={howOpen} onClose={() => setHowOpen(false)} />

      {/* Hidden fallback: only appears if the keeper hasn't paid out a winning position, so a
          user can always recover stuck funds manually. Invisible in the normal auto-paid flow. */}
      {surfaceFallback && !settleOpen && claimables.length > 0 && (
        <button className="claim-fallback" onClick={openSettle}>
          Claim {claimables.length} winning prediction{claimables.length > 1 ? 's' : ''}
        </button>
      )}

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
        groups={groups}
        requested={requestedGroups}
        onClose={() => setGroupsViewOpen(false)}
        onCreateGroup={() => openGroupCreate()}
        onRequestJoin={requestJoinGroup}
      />
    </>
  )
}
