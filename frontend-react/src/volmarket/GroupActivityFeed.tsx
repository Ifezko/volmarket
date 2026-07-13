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
}: {
  items: GroupActivityItem[]
  /** whether the viewer may join (approved member / owner of this group) */
  canJoin: boolean
  currentUser?: string
  onJoin: (item: GroupActivityItem) => void
}) {
  if (items.length === 0) return null
  return (
    <div style={{ margin: '4px 0 8px' }}>
      <div className="gk" style={{ marginBottom: 6 }}>Recent calls</div>
      {items.slice(0, 4).map((it) => {
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
