import { useState } from 'react'
import { feeLabel } from './groups'
import { describeMarket } from './liveFixtures'
import { GroupActivityFeed } from './GroupActivityFeed'
import type { OnchainGroup, OnchainMember, GroupActivityItem } from '../lib/onchainGroups'

function pctToBps(pct: string): number {
  const n = parseFloat(pct)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(10_000, Math.round(n * 100))
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

// Full-screen detail for one of the user's groups, opened from the profile's "My groups".
// Owner: edit settings + approve pending requests + roster. Member: latest calls (Join this call),
// members, your own calls, and Leave group.
export function GroupDetail({
  open,
  group,
  role,
  members,
  activity,
  currentUser,
  saving,
  leaving,
  onClose,
  onSave,
  onLeave,
  onApprove,
  onJoinCall,
}: {
  open: boolean
  group: OnchainGroup | null
  role: 'owner' | 'member'
  members: OnchainMember[]
  activity: GroupActivityItem[]
  currentUser?: string
  saving: boolean
  leaving: boolean
  onClose: () => void
  onSave: (opts: { name: string; feeBps: number; visibility: 'Public' | 'Private'; roster: boolean }) => void
  onLeave: () => void
  onApprove: (memberAddress: string) => void
  onJoinCall: (item: GroupActivityItem) => void
}) {
  // Edit-form state (owner). Seeded from the group; keyed on group.address so switching groups resets.
  const [name, setName] = useState(group?.name ?? '')
  const [feePct, setFeePct] = useState(group ? String((group.feeBps / 100)) : '0')
  const [visibility, setVisibility] = useState<'Public' | 'Private'>(group?.visibility ?? 'Public')
  const [roster, setRoster] = useState(group?.roster ?? false)
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (group && seededFor !== group.address) {
    setSeededFor(group.address)
    setName(group.name)
    setFeePct(String(group.feeBps / 100))
    setVisibility(group.visibility)
    setRoster(group.roster)
  }

  if (!group) return <div className={`gview${open ? ' show' : ''}`} />

  const approved = members.filter((m) => m.approved)
  const pending = members.filter((m) => !m.approved)
  const myCalls = activity.filter((a) => a.member === currentUser)
  const feeBps = pctToBps(feePct)

  return (
    <div className={`gview${open ? ' show' : ''}`}>
      <div className="gvhead">
        <div className="wrap gvhead-in">
          <button className="back" onClick={onClose}>
            ← Back
          </button>
          <span className="ttl">{group.name}</span>
          <span className="gpub">{role === 'owner' ? 'Owner' : 'Member'}</span>
        </div>
      </div>
      <div className="wrap" style={{ paddingBottom: 40 }}>
        <div className="gstats" style={{ margin: '18px 0' }}>
          <div className="gs"><div className="gk">Members</div><div className="gv">{group.memberCount}</div></div>
          <div className="gs"><div className="gk">Visibility</div><div className="gv">{group.visibility}</div></div>
          <div className="gs"><div className="gk">Group fee</div><div className="gv">{feeLabel(group.feeBps)}</div></div>
        </div>

        {role === 'owner' && (
          <>
            <p className="seltitle" style={{ margin: '4px 0 10px' }}>Edit group</p>
            <div className="gfield">
              <label className="flbl">Group name</label>
              <input className="tinput" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="gfield">
              <label className="flbl">Visibility</label>
              <div className="seg">
                <button className={`segbtn${visibility === 'Public' ? ' on' : ''}`} onClick={() => setVisibility('Public')}>Public</button>
                <button className={`segbtn${visibility === 'Private' ? ' on' : ''}`} onClick={() => setVisibility('Private')}>Private</button>
              </div>
            </div>
            <div className="gfield">
              <label className="flbl">Group fee</label>
              <div className="cprow">
                <input className="tinput" type="number" min="0" max="100" step="0.1" inputMode="decimal"
                  value={feePct} onChange={(e) => setFeePct(e.target.value)} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <span style={{ alignSelf: 'center', color: 'var(--dim)', minWidth: 56, textAlign: 'right' }}>% · {feeLabel(feeBps)}</span>
              </div>
            </div>
            <div className="gfield">
              <label className="flbl">Roster</label>
              <button className={`selrow joinopt${roster ? ' on' : ''}`} onClick={() => setRoster(!roster)}
                style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                <div><div className="l">Show members to approved joiners</div>
                  <div className="s" style={{ color: 'var(--dim)' }}>{roster ? 'On' : 'Off - members private'}</div></div>
                <span className="rad" style={{ borderColor: roster ? 'var(--blue)' : 'var(--faint)' }} />
              </button>
            </div>
            <button className="btn btn-blue" style={{ width: '100%', marginBottom: 18 }} disabled={saving}
              onClick={() => onSave({ name: name.trim() || group.name, feeBps, visibility, roster })}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>

            {pending.length > 0 && (
              <>
                <p className="seltitle" style={{ margin: '4px 0 10px' }}>Pending requests</p>
                {pending.map((m) => (
                  <div className="selrow" key={m.address} style={{ marginBottom: 6 }}>
                    <div className="s mono">{short(m.member)}</div>
                    <button className="btn btn-blue" onClick={() => onApprove(m.member)}>Approve</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        <p className="seltitle" style={{ margin: '14px 0 10px' }}>Latest calls</p>
        {activity.length === 0 ? (
          <div className="s" style={{ color: 'var(--dim)' }}>No calls yet. Send a prediction to the group to start one.</div>
        ) : (
          <GroupActivityFeed items={activity} canJoin={role === 'member' || role === 'owner'} currentUser={currentUser} onJoin={onJoinCall} />
        )}

        {myCalls.length > 0 && (
          <>
            <p className="seltitle" style={{ margin: '14px 0 10px' }}>Your calls</p>
            {myCalls.map((it) => (
              <div className="selrow" key={it.address} style={{ marginBottom: 6, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="s">{describeMarket(it.fixtureId, it.oddKey, it.marketParams, it.side, it.level)}</div>
                  <div className="s" style={{ color: 'var(--dim)' }}>{it.amountUsdc} USDC · {it.side === 'hold' ? 'Holds' : 'Breaks'}{it.status === 'resolved' ? ' · settled' : ''}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {(role === 'owner' || group.roster) && (
          <>
            <p className="seltitle" style={{ margin: '14px 0 10px' }}>Members ({approved.length + 1})</p>
            <div className="selrow" style={{ marginBottom: 6 }}>
              <div className="s mono">{short(group.owner)}</div>
              <span className="s" style={{ color: 'var(--dim)' }}>Owner</span>
            </div>
            {approved.map((m) => (
              <div className="selrow" key={m.address} style={{ marginBottom: 6 }}>
                <div className="s mono">{short(m.member)}{m.member === currentUser ? ' (you)' : ''}</div>
                <span className="s" style={{ color: 'var(--dim)' }}>Member</span>
              </div>
            ))}
          </>
        )}

        {role === 'member' && (
          <button
            className="btn"
            style={{ width: '100%', marginTop: 22, background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)', ...(leaving ? { opacity: 0.5 } : {}) }}
            disabled={leaving}
            onClick={onLeave}
          >
            {leaving ? 'Leaving…' : 'Leave group'}
          </button>
        )}
      </div>
    </div>
  )
}
