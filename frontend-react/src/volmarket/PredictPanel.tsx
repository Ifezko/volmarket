import { PredictBuilder, type RealPredictMeta } from './PredictBuilder'
import type { LiveOdd } from './liveFixtures'
import type { SlipItem, Ticket } from './Slip'

const STAKE_OPTIONS = [5, 25, 100]

// The desktop match-detail right column: the prediction builder (window + Holds/Breaks) stacked
// over the live slip, so a user reads the signal on the left and builds + places from here without
// opening the drawer. It shares VolmarketApp's slip/stake/ticket state with the drawer Slip — the
// two are just different surfaces onto the same combo — so a pick added on the board still shows,
// and placing here still yields the shareable ticket. On mobile this whole panel stacks under the
// chart (see .detailgrid), which keeps the original single-column flow.
export function PredictPanel({
  odd,
  fixtureId,
  isSelected,
  onAdd,
  slip,
  stake,
  ticket,
  placing,
  placeError,
  insufficientFunds,
  balance,
  onRemove,
  onSetStake,
  onPlace,
  onOpenDeposit,
  onCopyCode,
  onMakeGroup,
  onNewSlip,
}: {
  odd: LiveOdd
  fixtureId: number
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: RealPredictMeta) => void
  slip: SlipItem[]
  stake: number
  ticket: Ticket | null
  placing: boolean
  placeError: string | null
  insufficientFunds: boolean
  balance: number | null
  onRemove: (id: string) => void
  onSetStake: (amount: number) => void
  onPlace: () => void
  onOpenDeposit: () => void
  onCopyCode: (code: string) => void
  onMakeGroup: (code: string) => void
  onNewSlip: () => void
}) {
  const combo = slip.reduce((a, s) => a * s.mult, 1)

  return (
    <div className="predpanel">
      {ticket ? (
        <div className="pp-placed">
          <div className="pp-head">
            <h3>Prediction placed</h3>
            <span className="sigbadge" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>
              CONFIRMED
            </span>
          </div>
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
          <div className="pp-actions">
            <button className="btn btn-ghost" onClick={() => onMakeGroup(ticket.code)}>
              Make a group
            </button>
            <button className="btn btn-ghost" onClick={onNewSlip}>
              New prediction
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pp-head">
            <h3>Predict</h3>
            {slip.length > 0 && <span className="pp-count">{slip.length} in slip</span>}
          </div>
          <PredictBuilder odd={odd} fixtureId={fixtureId} isSelected={isSelected} onAdd={onAdd} />

          <div className="pp-slip">
            {slip.length === 0 ? (
              <div className="pp-empty">
                Tap <b>Holds</b> or <b>Breaks</b> above to add a prediction. Stack several to combine
                them into one payout.
              </div>
            ) : (
              <>
                <div className="pp-sliplbl">{slip.length > 1 ? `Combo · ${slip.length} signals` : 'Your prediction'}</div>
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
                <div className="pp-stakelbl">Stake · USDC</div>
                <div className="stake">
                  {STAKE_OPTIONS.map((a) => (
                    <button key={a} className={stake === a ? 'on' : ''} onClick={() => onSetStake(a)}>
                      {a}
                    </button>
                  ))}
                </div>
                <div className="summary">
                  <span>
                    {slip.length > 1 ? 'Combined' : 'Pays'} {combo.toFixed(2)}×
                  </span>
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
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
