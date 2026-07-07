import type { ActivePrediction } from './VolmarketApp'

// Ported from #settleModal/showSettle() in frontend/index.html. One change from the
// original, consistent with dropping the mock wallet: a win no longer credits a global
// balance — there's none left to credit.
export function SettleModal({
  pred,
  hasNext,
  onClose,
}: {
  pred: ActivePrediction | null
  hasNext: boolean
  onClose: () => void
}) {
  if (!pred) return null
  const payout = pred.win ? +(pred.stake * pred.mult).toFixed(2) : 0

  return (
    <div className="setmodal show">
      <div className={`setcard ${pred.win ? 'won' : 'lost'}`}>
        <div className="setres">{pred.win ? 'WON' : 'LOST'}</div>
        <div className="setlabel">{pred.label}</div>
        <div className="setrow">
          <span>Window</span>
          <span>{pred.winLabel}</span>
        </div>
        <div className="setrow">
          <span>Stake</span>
          <span>{pred.stake} USDC</span>
        </div>
        <div className="setrow">
          <span>{pred.win ? 'Payout' : 'Lost'}</span>
          <span className={pred.win ? 'pg' : 'pr'}>{pred.win ? `+${payout} USDC` : `−${pred.stake} USDC`}</span>
        </div>
        <button className="btn btn-blue" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>
          {hasNext ? 'Next result' : 'Done'}
        </button>
      </div>
    </div>
  )
}
