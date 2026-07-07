import { useEffect, useMemo, useRef, useState } from 'react'
import './volmarket.css'
import { matches, rng } from './data'
import { Nav } from './Nav'
import { Board } from './Board'
import { Footer } from './Footer'
import { MatchDetail } from './MatchDetail'
import { WINDOWS, WSECS, type PredictMeta, type PredictionLine } from './SignalChart'
import { Slip, type SlipItem, type Ticket } from './Slip'
import { SettleModal } from './SettleModal'
import { HowModal } from './HowModal'

export interface ActivePrediction {
  matchKey: string
  level: number
  side: 'hold' | 'break'
  label: string
  winLabel: string
  stake: number
  mult: number
  endsAt: number
  settled: boolean
  win?: boolean
}

function genCode(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const p = (n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `${p(2)}${Math.floor(Math.random() * 9)}-${p(3)}-${p(3)}`
}

// paste a friend's code -> loads a mock prediction into the slip, ported from pasteCode()
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
// Built up one screen at a time — board/nav/footer (5a), match detail (5b), the canvas
// signal chart + predict buttons (5c), the combo slip drawer (5d), and now end-of-window
// settlement (5e). How-it-works, groups, and deposit follow in later commits.
export function VolmarketApp({
  walletAddress,
  onOpenDevnet,
}: {
  walletAddress: string | undefined
  onOpenDevnet: () => void
}) {
  const [curMatchId, setCurMatchId] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [followed, setFollowed] = useState<Set<string>>(new Set())
  const [slip, setSlip] = useState<SlipItem[]>([])
  const [predMeta, setPredMeta] = useState<Record<string, PredictMeta>>({})
  const [slipOpen, setSlipOpen] = useState(false)
  const [stake, setStake] = useState(25)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [activePreds, setActivePreds] = useState<ActivePrediction[]>([])
  const [liveProb, setLiveProb] = useState<number | null>(null)
  const [settleShown, setSettleShown] = useState<ActivePrediction | null>(null)
  const [settleQueueLen, setSettleQueueLen] = useState(0)
  const [howOpen, setHowOpen] = useState(false)

  const curMatch = curMatchId ? matches.find((m) => m.id === curMatchId) ?? null : null

  const activePredsRef = useRef(activePreds)
  activePredsRef.current = activePreds
  const settleQueueRef = useRef<ActivePrediction[]>([])
  const settleShownRef = useRef(settleShown)
  settleShownRef.current = settleShown
  const curMatchRef = useRef(curMatch)
  curMatchRef.current = curMatch
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const liveProbRef = useRef(liveProb)
  liveProbRef.current = liveProb

  useEffect(() => {
    document.body.classList.toggle('lock', curMatch !== null)
  }, [curMatch])

  useEffect(() => {
    setLiveProb(null)
  }, [curMatchId, activeKey])

  // Ported from the global keydown handler in the original: Escape closes any open
  // overlay, "/" focuses search (unless already typing in an input).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setHowOpen(false)
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

  function pumpSettle() {
    if (settleShownRef.current) return
    const next = settleQueueRef.current.shift()
    setSettleQueueLen(settleQueueRef.current.length)
    if (next) setSettleShown(next)
  }

  // Ported from the setInterval(...,600) end-of-window settlement checker in the
  // original: sweeps activePreds for anything past its endsAt, decides win/lose (using
  // the live chart probability if that odd is on screen, otherwise a mult-implied coin
  // flip), and queues the result for the settlement popup.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      let changed = false
      const updated = activePredsRef.current.map((p) => {
        if (p.settled || now < p.endsAt) return p
        changed = true
        const cm = curMatchRef.current
        const ak = activeKeyRef.current
        const lp = liveProbRef.current
        const onScreen = cm !== null && ak !== null && lp !== null && p.matchKey === `${cm.id}-${ak}`
        const win = onScreen ? (lp as number) >= p.level : Math.random() * 100 < 100 / p.mult
        const settledPred: ActivePrediction = { ...p, settled: true, win }
        settleQueueRef.current.push(settledPred)
        return settledPred
      })
      if (changed) {
        activePredsRef.current = updated
        setActivePreds(updated)
        setSettleQueueLen(settleQueueRef.current.length)
        pumpSettle()
      }
    }, 600)
    return () => clearInterval(t)
  }, [])

  function closeSettle() {
    setSettleShown(null)
    setTimeout(pumpSettle, 180)
  }

  function openMatch(id: string) {
    const m = matches.find((x) => x.id === id)
    if (!m) return
    setCurMatchId(id)
    const live = m.status === 'live' || m.status === 'ht'
    setActiveKey(live ? 'res-h' : null)
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
  // its match/side/level so drawSignal and place() can find it again.
  function addPrediction(id: string, label: string, prob: number, meta: PredictMeta) {
    if (ticket) setTicket(null)
    setPredMeta((prev) => ({ ...prev, [id]: meta }))
    setSlip((prev) => {
      if (prev.some((s) => s.id === id)) return prev.filter((s) => s.id !== id)
      const mult = 100 / Math.max(1, prob)
      return [...prev, { id, label, mult }]
    })
  }

  function removeFromSlip(id: string) {
    setSlip((prev) => prev.filter((s) => s.id !== id))
  }

  function isSelected(id: string) {
    return slip.some((s) => s.id === id)
  }

  const predictionLines = useMemo<PredictionLine[]>(() => {
    if (!curMatch || !activeKey) return []
    const mk = `${curMatch.id}-${activeKey}`
    const lines: PredictionLine[] = []
    slip.forEach((s) => {
      const m = predMeta[s.id]
      if (m && m.mk === mk) lines.push({ level: m.level, side: m.side })
    })
    activePreds.forEach((p) => {
      if (p.matchKey === mk && !p.settled) lines.push({ level: p.level, side: p.side })
    })
    return lines
  }, [slip, predMeta, activePreds, curMatch, activeKey])

  function place() {
    if (!slip.length) return
    const combo = slip.reduce((a, s) => a * s.mult, 1)
    const perStake = +(stake / slip.length).toFixed(2)
    const now = Date.now()
    const scheduled: ActivePrediction[] = []
    slip.forEach((s) => {
      const m = predMeta[s.id]
      if (!m) return
      const secs = WSECS[m.windowIdx] ?? 300
      scheduled.push({
        matchKey: m.mk,
        level: m.level,
        side: m.side,
        label: s.label,
        winLabel: WINDOWS[m.windowIdx] ?? '',
        stake: perStake,
        mult: s.mult,
        endsAt: now + secs * 1000,
        settled: false,
      })
    })
    const updated = [...activePredsRef.current, ...scheduled]
    activePredsRef.current = updated
    setActivePreds(updated)
    setTicket({ code: genCode(), sel: slip, stake, mult: combo })
    setSlip([])
  }

  function copyCode(code: string) {
    navigator.clipboard?.writeText(code).catch(() => {})
  }

  function pasteCode(code: string) {
    setSlip(pasteCodePool(code))
    setTicket(null)
  }

  return (
    <>
      <Nav
        comboCount={slip.length}
        walletAddress={walletAddress}
        activeTab="product"
        onLogoClick={closeMatch}
        onOpenDeposit={() => {}}
        onOpenSlip={() => setSlipOpen(true)}
        onOpenGroupsView={() => {}}
        onOpenDevnet={onOpenDevnet}
      />
      <Board onOpenMatch={openMatch} onOpenHow={() => setHowOpen(true)} />
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
          onLiveProb={setLiveProb}
        />
      )}

      <Slip
        open={slipOpen}
        slip={slip}
        stake={stake}
        ticket={ticket}
        onOpen={() => setSlipOpen(true)}
        onClose={() => setSlipOpen(false)}
        onRemove={removeFromSlip}
        onSetStake={setStake}
        onPlace={place}
        onCopyCode={copyCode}
        onMakeGroup={() => {}}
        onNewSlip={() => setTicket(null)}
        onPasteCode={pasteCode}
      />

      <SettleModal pred={settleShown} hasNext={settleQueueLen > 0} onClose={closeSettle} />

      <HowModal open={howOpen} onClose={() => setHowOpen(false)} />
    </>
  )
}
