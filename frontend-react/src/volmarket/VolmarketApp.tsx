import { useEffect, useState } from 'react'
import './volmarket.css'
import { matches } from './data'
import { Nav } from './Nav'
import { Board } from './Board'
import { Footer } from './Footer'
import { MatchDetail } from './MatchDetail'

// Top-level composition for the ported Volmarket product UI (see frontend/index.html).
// Built up one screen at a time — board/nav/footer (slice5a) and match detail (slice5b)
// are wired in; the canvas signal chart, combo slip, settlement, how-it-works, and
// groups follow in later commits.
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

  return (
    <>
      <Nav
        comboCount={0}
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
        />
      )}
    </>
  )
}
