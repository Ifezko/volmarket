import { useState } from 'react'

// Shared "Send to group" control - a group picker + button, shown under the Place button on both
// predict surfaces (the Slip drawer and the desktop PredictPanel). Stakes the current slip into the
// group's shared pool (group_deposit) instead of an individual position. Hidden when the user is in
// no groups.
export function SendToGroupControl({
  sendableGroups,
  sending,
  onSendToGroup,
}: {
  sendableGroups: { address: string; name: string }[]
  sending: boolean
  onSendToGroup: (groupAddress: string) => void
}) {
  const [sendGroup, setSendGroup] = useState('')
  if (sendableGroups.length === 0) return null
  const selected = sendGroup || sendableGroups[0].address
  return (
    <div style={{ marginTop: 10 }}>
      <div className="cplbl">Or send this to a group</div>
      <div className="cprow">
        <select value={selected} onChange={(e) => setSendGroup(e.target.value)} className="tinput" style={{ flex: 1 }}>
          {sendableGroups.map((g) => (
            <option key={g.address} value={g.address}>
              {g.name}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost" disabled={sending} onClick={() => onSendToGroup(selected)}>
          {sending ? 'Sending…' : 'Send to group'}
        </button>
      </div>
      <div className="s" style={{ color: 'var(--dim)', marginTop: 6 }}>
        Stakes into the group's shared pool - your call shows in the group activity feed.
      </div>
    </div>
  )
}
