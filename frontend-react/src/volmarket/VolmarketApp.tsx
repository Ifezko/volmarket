import { useEffect, useMemo, useState } from 'react'
import './volmarket.css'
import { matches } from './data'
import { Nav } from './Nav'
import { Board } from './Board'
import { Footer } from './Footer'
import { MatchDetail } from './MatchDetail'
import type { PredictMeta, PredictionLine } from './SignalChart'

interface SlipItem {
  id: string
  label: string
  mult: number
}

// Top-level composition for the ported Volmarket product UI (see frontend/index.html).
// Built up one screen at a time — board/nav/footer (slice5a), match detail (slice5b),
// and the canvas signal chart + predict buttons (slice5c) are wired in. The combo slip
// UI, settlement, how-it-works, and groups follow in later commits; for now `add()`
// only tracks which picks are pending (drives the .sel highlight + chart lines) with
// no drawer to place them from yet.
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

  const curMatch = curMatchId ? matches.find((m) => m.id === curMatchId) ?? null : null

  useEffect(() => {
    document.body.classList.toggle('lock', curMatch !== null)
  }, [curMatch])

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
  // its match/side/level so drawSignal (and, later, place()) can find it again.
  function addPrediction(id: string, label: string, prob: number, meta: PredictMeta) {
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

  const predictionLines = useMemo<PredictionLine[]>(() => {
    if (!curMatch || !activeKey) return []
    const mk = `${curMatch.id}-${activeKey}`
    return slip.flatMap((s) => {
      const m = predMeta[s.id]
      return m && m.mk === mk ? [{ level: m.level, side: m.side }] : []
    })
  }, [slip, predMeta, curMatch, activeKey])

  return (
    <>
      <Nav
        comboCount={slip.length}
        walletAddress={walletAddress}
        activeTab="product"
        onLogoClick={closeMatch}
        onOpenDeposit={() => {}}
        onOpenSlip={() => {}}
        onOpenGroupsView={() => {}}
        onOpenDevnet={onOpenDevnet}
      />
      <Board onOpenMatch={openMatch} onOpenHow={() => {}} />
      <Footer />

      {curMatch && (
        <MatchDetail
          match={curMatch}
          activeKey={activeKey}
          isFollowed={followed.has(curMatch.id)}
          onClose={closeMatch}
          onSelectOdd={selectOdd}
          onToggleFollow={toggleFollow}
          onOpenHow={() => {}}
          predictionLines={predictionLines}
          isSelected={isSelected}
          onAdd={addPrediction}
        />
      )}
    </>
  )
}
