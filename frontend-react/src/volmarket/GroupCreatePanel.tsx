import { useState } from 'react'
import { feeLabel } from './groups'

function genShort(): string {
  const s = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 4 }, () => s[Math.floor(Math.random() * s.length)]).join('')
}

// Fee presets the creator picks from — "Free" (0%) plus a few common cuts. Stored on-chain as
// fee_bps (× 100), the group's cut on winnings at claim_group.
const FEE_OPTIONS: { label: string; bps: number }[] = [
  { label: 'Free', bps: 0 },
  { label: '1%', bps: 100 },
  { label: '2.5%', bps: 250 },
  { label: '5%', bps: 500 },
]

// Ported from openGroups()/gVis()/gJoin()/gSlug()/createGroup() in frontend/index.html —
// rendered inside the Slip drawer's `override` slot (see Slip.tsx), same as the
// original swaps #slipBody's innerHTML for this form.
export function GroupCreatePanel({
  seedCode,
  onCreate,
  onCopyCode,
  onDone,
  onStageChange,
}: {
  seedCode?: string
  onCreate: (group: { name: string; visibility: 'Public' | 'Private'; joinMode: 'link' | 'invite'; feeBps: number }) => void
  onCopyCode: (code: string) => void
  onDone: () => void
  onStageChange?: (stage: 'form' | 'created') => void
}) {
  const [gCode] = useState(() => seedCode || genShort())
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'Public' | 'Private'>('Private')
  const [joinMode, setJoinMode] = useState<'link' | 'invite'>('link')
  const [feeBps, setFeeBps] = useState(0)
  const [created, setCreated] = useState(false)

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group'
  const link = `volmarket.fun/g/${slug}-${gCode.slice(0, 3).toLowerCase()}`
  const finalName = name.trim() || 'Untitled group'

  function handleCreate() {
    onCreate({ name: finalName, visibility, joinMode, feeBps })
    setCreated(true)
    onStageChange?.('created')
  }

  if (created) {
    return (
      <>
        <div className="selrow" style={{ marginBottom: 12 }}>
          <div>
            <div className="l">{finalName}</div>
            <div className="s" style={{ color: 'var(--dim)' }}>
              {visibility} · {joinMode === 'link' ? 'Anyone with link can join' : 'Invite only'} · Group fee: {feeLabel(feeBps)}
            </div>
          </div>
        </div>
        <div className="cplbl">Share link</div>
        <div className="linkbox" style={{ marginBottom: 12, wordBreak: 'break-all' }}>
          {link}
        </div>
        <button className="btn btn-blue" style={{ width: '100%', marginBottom: 8 }} onClick={() => onCopyCode(link)}>
          Copy link
        </button>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onDone}>
          Done
        </button>
      </>
    )
  }

  return (
    <>
      <div className="gfield">
        <label className="flbl">Group name</label>
        <input className="tinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lagos Sharps" />
      </div>
      <div className="gfield">
        <label className="flbl">Visibility</label>
        <div className="seg">
          <button className={`segbtn${visibility === 'Public' ? ' on' : ''}`} onClick={() => setVisibility('Public')}>
            Public
          </button>
          <button className={`segbtn${visibility === 'Private' ? ' on' : ''}`} onClick={() => setVisibility('Private')}>
            Private
          </button>
        </div>
      </div>
      <div className="gfield">
        <label className="flbl">Who can join</label>
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            className={`selrow joinopt${joinMode === 'link' ? ' on' : ''}`}
            onClick={() => setJoinMode('link')}
            style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            <div>
              <div className="l">Anyone with the link</div>
              <div className="s" style={{ color: 'var(--dim)' }}>
                View and join your side
              </div>
            </div>
            <span className="rad" style={{ borderColor: joinMode === 'link' ? 'var(--blue)' : 'var(--faint)' }}></span>
          </button>
          <button
            className={`selrow joinopt${joinMode === 'invite' ? ' on' : ''}`}
            onClick={() => setJoinMode('invite')}
            style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            <div>
              <div className="l">Invite only</div>
              <div className="s" style={{ color: 'var(--dim)' }}>
                Only people you invite
              </div>
            </div>
            <span className="rad" style={{ borderColor: joinMode === 'invite' ? 'var(--blue)' : 'var(--faint)' }}></span>
          </button>
        </div>
      </div>
      <div className="gfield">
        <label className="flbl">Group fee</label>
        <div className="seg">
          {FEE_OPTIONS.map((o) => (
            <button key={o.bps} className={`segbtn${feeBps === o.bps ? ' on' : ''}`} onClick={() => setFeeBps(o.bps)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="s" style={{ color: 'var(--dim)', marginTop: 6 }}>
          {feeBps === 0 ? 'No cut — members keep all winnings.' : `Your cut on members' winnings at settlement (${feeLabel(feeBps)}).`}
        </div>
      </div>
      <div className="linkbox">{link}</div>
      <button className="btn btn-blue" style={{ width: '100%', marginTop: 12 }} onClick={handleCreate}>
        Create group
      </button>
    </>
  )
}
