import { useState, type ReactNode } from 'react'
import { StakePicker } from './StakePicker'
import { SendToGroupControl } from './SendToGroupControl'

export interface SlipItem {
  id: string
  label: string
  mult: number
}

export interface Ticket {
  code: string
  sel: SlipItem[]
  stake: number
  mult: number
}

// Ported from the .fab / .scrim / .slip markup and renderSlip()/place()/pasteCode() in
// frontend/index.html. Group-creation and deposit reuse this same drawer in the
// original (via `ticket==='group'|'dep'`) — those land in later commits.
export function Slip({
  open,
  slip,
  stake,
  ticket,
  override,
  placing,
  placeError,
  insufficientFunds,
  balance,
  onOpenDeposit,
  onOpen,
  onClose,
  onRemove,
  onSetStake,
  onPlace,
  onCopyCode,
  onMakeGroup,
  onNewSlip,
  onPasteCode,
  sendableGroups,
  sending,
  onSendToGroup,
}: {
  open: boolean
  slip: SlipItem[]
  stake: number
  ticket: Ticket | null
  // The original swaps #slipTitle/#slipBody for group-creation and deposit forms
  // (ticket==='group'|'dep'); this is that same swap, done as a prop instead.
  override: { title: string; body: ReactNode } | null
  placing: boolean
  placeError: string | null
  // true when the signed-in wallet's USDC balance can't cover the stake — block Place and steer
  // to Deposit instead (a common external-wallet snag: SOL/other USDC present, but no app USDC).
  insufficientFunds: boolean
  balance: number | null
  onOpenDeposit: () => void
  onOpen: () => void
  onClose: () => void
  onRemove: (id: string) => void
  onSetStake: (amount: number) => void
  onPlace: () => void
  onCopyCode: (code: string) => void
  onMakeGroup: (code: string) => void
  onNewSlip: () => void
  onPasteCode: (code: string) => void
  // Groups the signed-in user can stake this slip into (owned or approved-member). Empty when the
  // user is in no groups — the "Send to group" control is hidden entirely then.
  sendableGroups: { address: string; name: string }[]
  sending: boolean
  onSendToGroup: (groupAddress: string) => void
}) {
  const [codeInput, setCodeInput] = useState('')
  const combo = slip.reduce((a, s) => a * s.mult, 1)
  const title = override
    ? override.title
    : ticket
      ? 'Prediction placed'
      : slip.length > 1
        ? `Combo · ${slip.length} signals`
        : 'Combo slip'

  function submitPaste() {
    const v = codeInput.trim().toUpperCase()
    if (!v) return
    onPasteCode(v)
    setCodeInput('')
  }

  const codePaste = (
    <div className="codepaste">
      <div className="cplbl">Got a code from a friend?</div>
      <div className="cprow">
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="Paste code e.g. BR7-K2M-9QX"
        />
        <button className="btn btn-blue" onClick={submitPaste}>
          Load
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button className={`fab${slip.length > 0 && !open ? ' show' : ''}`} onClick={onOpen}>
        View slip <span className="cnt">{slip.length}</span>
      </button>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose}></div>
      <aside className={`slip${open ? ' show' : ''}`}>
        <div className="sliphead">
          <h3>{title}</h3>
          <button className="x" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="grow">
          {override ? (
            override.body
          ) : ticket ? (
            <>
              {ticket.sel.map((s) => (
                <div className="selrow" key={s.id}>
                  <div className="l">{s.label}</div>
                </div>
              ))}
              <div className="summary">
                <span>
                  {ticket.stake} USDC @ {ticket.mult.toFixed(2)}×
                </span>
                <span style={{ color: 'var(--green)' }}>win {(ticket.stake * ticket.mult).toFixed(2)}</span>
              </div>
              <div className="ticket">
                <div style={{ fontSize: 10, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Share code · anyone can copy this
                </div>
                <div className="code">{ticket.code}</div>
              </div>
              <button className="btn btn-blue" style={{ width: '100%', marginBottom: 8 }} onClick={() => onCopyCode(ticket.code)}>
                Copy code
              </button>
              <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => onMakeGroup(ticket.code)}>
                Make this a group
              </button>
              <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onNewSlip}>
                New prediction
              </button>
            </>
          ) : slip.length === 0 ? (
            <>
              <div className="empty">
                Open a match, read an odd's signal, and predict it. Stack several signals to combine them into one.
              </div>
              {codePaste}
            </>
          ) : (
            <>
              {slip.map((s) => (
                <div className="selrow" key={s.id}>
                  <div>
                    <div className="l">{s.label}</div>
                    <div className="s">{s.mult.toFixed(2)}×</div>
                  </div>
                  <button className="rm" onClick={() => onRemove(s.id)}>
                    ✕
                  </button>
                </div>
              ))}
              <StakePicker stake={stake} onSetStake={onSetStake} />
              <div className="summary">
                <span>{slip.length > 1 ? 'Combined' : 'Pays'} {combo.toFixed(2)}×</span>
                <span>
                  To win <b style={{ color: 'var(--green)' }}>{(stake * combo).toFixed(2)}</b>
                </span>
              </div>
              {placeError && (
                <div className="empty" style={{ color: 'var(--red)', padding: '8px 0' }}>
                  {placeError}
                </div>
              )}
              {insufficientFunds ? (
                <>
                  <div className="s" style={{ color: 'var(--dim)', margin: '2px 0 8px', textAlign: 'center' }}>
                    Your balance ({(balance ?? 0).toFixed(2)} USDC) doesn't cover this {stake} USDC stake.
                    Deposit to place.
                  </div>
                  <button className="btn btn-blue" style={{ width: '100%' }} onClick={onOpenDeposit}>
                    Deposit to place
                  </button>
                </>
              ) : (
                <button className="btn btn-blue" style={{ width: '100%' }} onClick={onPlace} disabled={placing}>
                  {placing ? 'Placing…' : `Place prediction · ${stake} USDC`}
                </button>
              )}
              {!insufficientFunds && (
                <SendToGroupControl sendableGroups={sendableGroups} sending={sending} onSendToGroup={onSendToGroup} />
              )}
              {codePaste}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
