import type { GroupActivityItem } from '../lib/onchainGroups'
import { describeMarket } from './liveFixtures'

// Recent group calls (group_deposits by members into shared markets). "Join this call" copies a
// call's market/side into the viewer's own signed group_deposit. Shown compactly inside each group
// card in the browser.
export function GroupActivityFeed({
  items,
  canJoin,
  currentUser,
  onJoin,
  showHeader = true,
}: {
  items: GroupActivityItem[]
  /** whether the viewer may join (approved member / owner of this group) */
  canJoin: boolean
  currentUser?: string
  onJoin: (item: GroupActivityItem) => void
  /** header is shown by default; hide it where the caller already renders its own section title */
  showHeader?: boolean
}) {
  return (
    <div className="gcalls">
      {showHeader && <div className="gk" style={{ marginBottom: 6 }}>Recent predictions</div>}
      {items.length === 0 && (
        <div className="gcalls-empty">No predictions yet — members' calls will show up here.</div>
      )}
      {items.slice(0, 3).map((it) => {
        const label = describeMarket(it.fixtureId, it.oddKey, it.marketParams, it.side, it.level)
        const mine = currentUser && it.member === currentUser
        return (
          <div className="selrow" key={it.address} style={{ marginBottom: 6, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="s" style={{ whiteSpace: 'normal' }}>{label}</div>
              <div className="s" style={{ color: 'var(--dim)' }}>
                <span style={{ fontFamily: 'monospace' }}>{it.member.slice(0, 4)}…{it.member.slice(-4)}</span>
                {mine ? ' (you)' : ''} · {it.amountUsdc} USDC · {it.side === 'hold' ? 'Holds' : 'Breaks'}
                {it.status === 'resolved' ? ' · settled' : ''}
              </div>
            </div>
            {canJoin && it.status === 'open' && (
              <button className="btn btn-blue" onClick={() => onJoin(it)} style={{ flexShrink: 0 }}>
                Join this call
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
