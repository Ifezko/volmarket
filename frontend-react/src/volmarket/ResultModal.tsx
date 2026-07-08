import { describeMarket } from './liveFixtures'
import type { ActivePosition } from '../lib/claimMarkets'

// Pops when one or more of the user's predictions reach the end of their window and settle
// on-chain — the counterpart to the WINNING/LOSING chips going final. Shows each ended
// prediction's WON/LOST, and offers to collect winnings when any of them won.
export function ResultModal({
  open,
  results,
  onCollect,
  onClose,
}: {
  open: boolean
  results: ActivePosition[]
  onCollect: () => void
  onClose: () => void
}) {
  if (!open || !results.length) return null
  const wins = results.filter((r) => r.status === 'won')
  const anyWin = wins.length > 0

  return (
    <div className="setmodal show" onClick={onClose}>
      <div className={`setcard ${anyWin ? 'won' : 'lost'}`} onClick={(e) => e.stopPropagation()}>
        <div className="setres">{anyWin ? (wins.length === results.length ? 'YOU WON' : 'RESULTS') : 'YOU LOST'}</div>
        <div className="setlabel">
          {results.length} prediction{results.length > 1 ? 's' : ''} reached the end of {results.length > 1 ? 'their' : 'its'}{' '}
          window and settled.
        </div>

        {results.map((r) => (
          <div className="setrow" key={r.position.toBase58()}>
            <span>{describeMarket(r.fixtureId, r.oddKey, r.marketParams, r.side, r.level)}</span>
            <span className={r.status === 'won' ? 'pg' : 'pr'}>{r.status === 'won' ? 'WON ▲' : 'LOST ▼'}</span>
          </div>
        ))}

        {anyWin ? (
          <>
            <button className="btn btn-blue" style={{ width: '100%', marginTop: 14 }} onClick={onCollect}>
              Collect winnings
            </button>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>
              Later
            </button>
          </>
        ) : (
          <button className="btn btn-blue" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
