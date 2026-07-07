import { useCallback, useEffect, useState } from 'react'
import { Connection } from '@solana/web3.js'
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
import { initialGroups, type Group } from './groups'
import { fetchRealMarkets, type RealMarket } from '../lib/onchainMarkets'
import { placeRealDeposits } from '../lib/depositMarkets'
import { buildLiveFixtures, type LiveFixture } from './liveFixtures'

const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'

function genCode(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const p = (n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `${p(2)}${Math.floor(Math.random() * 9)}-${p(3)}-${p(3)}`
}

// paste a friend's code -> loads a mock prediction into the slip, ported from pasteCode()
// (this demo path never was wired to real settlement — see place() below)
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
// The board/detail now trade REAL on-chain Market accounts (fetchRealMarkets, grouped by
// liveFixtures.ts) instead of the mock array, and predicting deposits real devnet USDC via
// a Privy-signed transaction (RealPredictPanel -> placeRealDeposits) — Privy login is only
// prompted at that point, not as a gate on the whole app (see App.tsx). The combo-slip
// share-code demo (paste a friend's code) is unrelated to real trading and still works as
// pure UI fidelity; nothing populates it from real predictions anymore, since each real
// deposit is its own immediate signed transaction, not a batched slip.
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
  const [slipOpen, setSlipOpen] = useState(false)
  const [stake, setStake] = useState(25)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [howOpen, setHowOpen] = useState(false)
  const [groups, setGroups] = useState<Group[]>(initialGroups)
  const [requestedGroups, setRequestedGroups] = useState<Set<number>>(new Set())
  const [groupsViewOpen, setGroupsViewOpen] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState<{ seedCode?: string; stage: 'form' | 'created' } | null>(null)
  const [depositOpen, setDepositOpen] = useState(false)

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

  useEffect(() => {
    refreshMarkets()
  }, [refreshMarkets])

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

  // Ported from place() in the original, minus settlement scheduling — a real prediction
  // settles on-chain (the keeper resolves it), not against a mult-implied coin flip, so
  // there's nothing to schedule here anymore. This still produces a shareable ticket code
  // for the paste-a-friend's-code demo path.
  function place() {
    if (!slip.length) return
    const combo = slip.reduce((a, s) => a * s.mult, 1)
    setTicket({ code: genCode(), sel: slip, stake, mult: combo })
    setSlip([])
  }

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

  // Real deposit — builds and sends one signed devnet transaction via Privy, then
  // refreshes the board so totals/status reflect the new stake immediately.
  async function handleDeposit(market: RealMarket, amountUsdc: number): Promise<string> {
    if (!solanaWallet) throw new Error('no embedded wallet — log in first')
    const connection = new Connection(RPC_URL, 'confirmed')
    const { signature } = await placeRealDeposits(connection, solanaWallet, signTransaction, [
      { market, side: 'yes', amountUsdc },
    ])
    await refreshMarkets()
    return signature
  }

  // Ported from openGroups()/createGroup() — opens the group-creation form in the slip
  // drawer, pre-seeded with a ticket's share code when reached via "Make this a group".
  function openGroupCreate(seedCode?: string) {
    setCreatingGroup({ seedCode, stage: 'form' })
    setDepositOpen(false)
    setSlipOpen(true)
  }

  // Ported from openDeposit() — reuses the slip drawer's override slot, same as group
  // creation.
  function openDeposit() {
    setDepositOpen(true)
    setCreatingGroup(null)
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
        activeTab="product"
        onLogoClick={closeMatch}
        onOpenDeposit={openDeposit}
        onOpenSlip={() => {
          setCreatingGroup(null)
          setDepositOpen(false)
          setSlipOpen(true)
        }}
        onOpenGroupsView={() => setGroupsViewOpen(true)}
        onOpenDevnet={onOpenDevnet}
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
          predictionLines={[]}
          authenticated={authenticated}
          onLogin={login}
          onDeposit={handleDeposit}
          onLiveProb={() => {}}
        />
      )}

      <Slip
        open={slipOpen}
        slip={slip}
        stake={stake}
        ticket={ticket}
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
              ? { title: 'Deposit', body: <DepositPanel onContinue={() => setSlipOpen(false)} /> }
              : null
        }
        onOpen={() => {
          setCreatingGroup(null)
          setDepositOpen(false)
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
