import { fmtK, type Group } from './groups'

// Ported from #gview / renderGroupsView() in frontend/index.html.
export function GroupsView({
  open,
  groups,
  requested,
  onClose,
  onCreateGroup,
  onRequestJoin,
}: {
  open: boolean
  groups: Group[]
  requested: Set<number>
  onClose: () => void
  onCreateGroup: () => void
  onRequestJoin: (idx: number) => void
}) {
  const pub = groups
    .map((g, idx) => ({ g, idx }))
    .filter(({ g }) => g.visibility === 'Public')

  return (
    <div className={`gview${open ? ' show' : ''}`}>
      <div className="gvhead">
        <div className="wrap gvhead-in">
          <button className="back" onClick={onClose}>
            ← Back
          </button>
          <span className="ttl">Groups</span>
          <button className="btn btn-blue" onClick={onCreateGroup}>
            + Create group
          </button>
        </div>
      </div>
      <div className="wrap">
        <p className="seltitle" style={{ margin: '20px 0 0' }}>
          Public groups · request to join
        </p>
        <div className="ggrid">
          {pub.map(({ g, idx }) => {
            const req = requested.has(idx)
            const pnlCol = g.pnl >= 0 ? 'var(--green)' : 'var(--red)'
            const pnlStr = (g.pnl >= 0 ? '+' : '−') + fmtK(g.pnl) + ' USDC'
            return (
              <div className="gcard" key={idx}>
                <div className="gctop">
                  <span className="gname">{g.name}</span>
                  <span className="gpub">Public</span>
                </div>
                <div className="gstats">
                  <div className="gs">
                    <div className="gk">Members</div>
                    <div className="gv">{g.members}</div>
                  </div>
                  <div className="gs">
                    <div className="gk">Predictions</div>
                    <div className="gv">{g.preds}</div>
                  </div>
                  <div className="gs">
                    <div className="gk">PnL</div>
                    <div className="gv" style={{ color: pnlCol }}>
                      {pnlStr}
                    </div>
                  </div>
                  <div className="gs">
                    <div className="gk">Win rate</div>
                    <div className="gv">{g.wr}%</div>
                  </div>
                </div>
                <div className="gpriv">
                  {g.roster ? '👥 Members shown to approved joiners' : '🔒 Members private'}
                </div>
                <button
                  className={`gjoin${req ? ' req' : ''}`}
                  disabled={req}
                  onClick={() => onRequestJoin(idx)}
                >
                  {req ? 'Requested · pending approval' : 'Request to join'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
