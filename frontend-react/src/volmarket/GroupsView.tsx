import { fmtK, feeLabel, type Group } from './groups'

export interface PendingRequest {
  memberAccount: string
  member: string
}

// Ported from #gview / renderGroupsView() in frontend/index.html. Now backed by on-chain groups:
// the join button reflects real GroupMember state, and cards you own list pending join requests to
// approve (there's no separate admin screen in the design, so approvals live inline on your cards).
export function GroupsView({
  open,
  groups,
  requested,
  joined,
  currentUser,
  pendingByIdx,
  onClose,
  onCreateGroup,
  onRequestJoin,
  onApprove,
}: {
  open: boolean
  groups: Group[]
  requested: Set<number>
  joined: Set<number>
  currentUser?: string
  pendingByIdx: Map<number, PendingRequest[]>
  onClose: () => void
  onCreateGroup: () => void
  onRequestJoin: (idx: number) => void
  onApprove: (idx: number, memberAccount: string) => void
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
            const isMember = joined.has(idx)
            const isOwner = !!currentUser && g.owner === currentUser
            const pending = pendingByIdx.get(idx) ?? []
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
                  {g.roster ? '👥 Members shown to approved joiners' : '🔒 Members private'} · Group fee: {feeLabel(g.feeBps ?? 0)}
                </div>

                {isOwner && pending.length > 0 && (
                  <div style={{ margin: '4px 0 8px' }}>
                    <div className="gk" style={{ marginBottom: 6 }}>Pending requests</div>
                    {pending.map((p) => (
                      <div className="selrow" key={p.memberAccount} style={{ marginBottom: 6 }}>
                        <div className="s" style={{ fontFamily: 'monospace' }}>
                          {p.member.slice(0, 4)}…{p.member.slice(-4)}
                        </div>
                        <button className="btn btn-blue" onClick={() => onApprove(idx, p.member)}>
                          Approve
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isOwner ? (
                  <button className="gjoin req" disabled>
                    You own this group
                  </button>
                ) : isMember ? (
                  <button className="gjoin req" disabled>
                    Member ✓
                  </button>
                ) : (
                  <button className={`gjoin${req ? ' req' : ''}`} disabled={req} onClick={() => onRequestJoin(idx)}>
                    {req ? 'Requested · pending approval' : 'Request to join'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
