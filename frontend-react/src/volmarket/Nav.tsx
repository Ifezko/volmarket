import { useEffect, useRef } from 'react'
import type { BoardFilter } from './liveFixtures'

// The app's top nav: logo + search + wallet/balance/deposit/profile (nav1), and the
// secondary row of board filters + sort (nav2). The nav1 balance shows the real embedded-
// wallet USDC balance; the avatar opens the profile. The nav2 filters/sort actually drive
// the board (see applyBoardView) - clicking one re-filters/re-sorts the fixtures grid.
export function Nav({
  comboCount,
  authenticated,
  usdcBalance,
  search,
  filter,
  sortLabel,
  onSearch,
  onSelectFilter,
  onCycleSort,
  onLogoClick,
  onLogin,
  onOpenDeposit,
  onOpenSlip,
  onOpenGroupsView,
  onOpenProfile,
}: {
  comboCount: number
  authenticated: boolean
  usdcBalance: number | null
  search: string
  filter: BoardFilter
  sortLabel: string
  onSearch: (q: string) => void
  onSelectFilter: (f: BoardFilter) => void
  onCycleSort: () => void
  onLogoClick: () => void
  onLogin: () => void
  onOpenDeposit: () => void
  onOpenSlip: () => void
  onOpenGroupsView: () => void
  onOpenProfile: () => void
}) {
  // The full-screen overlays (match detail, groups) now sit *below* the nav rather than
  // covering it, so the top header stays visible on every page. They read the live nav
  // height from --nav-h; measure it here (it changes with the responsive breakpoints).
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const setH = () => document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`)
    setH()
    const ro = new ResizeObserver(setH)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <nav ref={navRef}>
      <div className="wrap">
        <div className="nav1">
          <div className="logo" onClick={onLogoClick}>
            <img className="logomark" src="/volmarket-mark.png" alt="Volmarket" />
            Volmarket
          </div>
          <div className="search">
            <span>⌕</span>
            <input
              id="search"
              placeholder="Search matches, teams"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onSearch('')
              }}
            />
            {search ? (
              <span className="kbd" style={{ cursor: 'pointer' }} title="Clear" onClick={() => onSearch('')}>
                ✕
              </span>
            ) : (
              <span className="kbd">/</span>
            )}
          </div>
          <div className="nav-right">
            {authenticated ? (
              <>
                <div className="bal">
                  <div className="k">Balance</div>
                  <div className="v mono" style={{ color: 'var(--green)' }}>
                    {usdcBalance == null ? '-' : `$${usdcBalance.toFixed(2)}`}
                  </div>
                </div>
                <button className="btn btn-blue" onClick={onOpenDeposit}>
                  Deposit
                </button>
                {/* The combo slip is available before login too (predicting is free until you Place). */}
                <button className="iconbtn" title="Combo slip" onClick={onOpenSlip}>
                  🎟️<span className={`badge${comboCount > 0 ? ' show' : ''}`}>{comboCount}</span>
                </button>
                <button
                  className="avatar"
                  title="Profile"
                  onClick={onOpenProfile}
                  style={{ cursor: 'pointer', border: 'none', padding: 0 }}
                ></button>
              </>
            ) : (
              <>
                <button className="iconbtn" title="Combo slip" onClick={onOpenSlip}>
                  🎟️<span className={`badge${comboCount > 0 ? ' show' : ''}`}>{comboCount}</span>
                </button>
                <button className="btn btn-ghost" onClick={onLogin}>
                  Log in
                </button>
                <button className="btn btn-blue" onClick={onLogin}>
                  Sign up
                </button>
              </>
            )}
          </div>
        </div>
        <div className="nav2">
          <span className={`tab${filter === 'all' ? ' on' : ''}`} onClick={() => onSelectFilter('all')}>
            All
          </span>
          <span className={`tab${filter === 'trending' ? ' on' : ''}`} onClick={() => onSelectFilter('trending')}>
            Trending
          </span>
          <span className={`topic${filter === 'live' ? ' on' : ''}`} onClick={() => onSelectFilter('live')}>
            <span className="pdot"></span>Live now
          </span>
          <span className={`tab${filter === 'today' ? ' on' : ''}`} onClick={() => onSelectFilter('today')}>
            Today
          </span>
          <span className={`tab${filter === 'upcoming' ? ' on' : ''}`} onClick={() => onSelectFilter('upcoming')}>
            Upcoming
          </span>
          <span className="topic" onClick={onOpenGroupsView}>
            Groups
          </span>
          <span className="tab sortpill" onClick={onCycleSort}>
            Sort: {sortLabel} ▾
          </span>
        </div>
      </div>
    </nav>
  )
}
