// Ported from the <nav> markup in frontend/index.html. One deliberate departure from
// the original, per product decision: there is no mock wallet/balance in this app, so
// the "Balance" + avatar slot is replaced with the real Privy embedded wallet address,
// and a "Devnet" topic pill is added to reach the real on-chain devnet-proof screen
// (slices 2-4). Everything else — logo, search, tabs, topic pills, Groups — is unchanged.
export function Nav({
  comboCount,
  walletAddress,
  usdcBalance,
  activeTab,
  onLogoClick,
  onOpenDeposit,
  onOpenSlip,
  onOpenGroupsView,
  onOpenDevnet,
  onOpenProfile,
}: {
  comboCount: number
  walletAddress: string | undefined
  usdcBalance: number | null
  activeTab: 'devnet' | 'product'
  onLogoClick: () => void
  onOpenDeposit: () => void
  onOpenSlip: () => void
  onOpenGroupsView: () => void
  onOpenDevnet: () => void
  onOpenProfile: () => void
}) {
  return (
    <nav>
      <div className="wrap">
        <div className="nav1">
          <div className="logo" onClick={onLogoClick}>
            <span className="dot"></span>Volmarket
          </div>
          <div className="search">
            <span>⌕</span>
            <input id="search" placeholder="Search matches, teams" />
            <span className="kbd">/</span>
          </div>
          <div className="nav-right">
            {walletAddress && (
              <div className="bal">
                <div className="k">Balance</div>
                <div className="v mono" style={{ color: 'var(--green)' }}>
                  {usdcBalance == null ? '—' : `$${usdcBalance.toFixed(2)}`}
                </div>
              </div>
            )}
            <button className="btn btn-blue" onClick={onOpenDeposit}>
              Deposit
            </button>
            <button className="iconbtn" title="Combo slip" onClick={onOpenSlip}>
              🎟️<span className={`badge${comboCount > 0 ? ' show' : ''}`}>{comboCount}</span>
            </button>
            <button
              className="avatar"
              title="Profile"
              onClick={onOpenProfile}
              style={{ cursor: 'pointer', border: 'none', padding: 0 }}
            ></button>
          </div>
        </div>
        <div className="nav2">
          <span className="tab on">Trending</span>
          <span className="tab">Live</span>
          <span className="tab">Today</span>
          <span className="tab">Upcoming</span>
          <span className="sep"></span>
          <span className="topic">
            <span className="pdot"></span>Live now
          </span>
          <span className="topic">World Cup</span>
          <span className="topic">Signals</span>
          <span className="topic" onClick={onOpenGroupsView}>
            Groups
          </span>
          <span className={`topic${activeTab === 'devnet' ? ' on' : ''}`} onClick={onOpenDevnet}>
            Devnet
          </span>
        </div>
      </div>
    </nav>
  )
}
