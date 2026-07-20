import { WINDOWS, WSECS, breakProb, holdProb } from './predictWindows'
import type { LiveOdd } from './liveFixtures'

export interface RealPredictMeta {
  fixtureId: number
  oddKey: number
  marketParams: number
  side: 'hold' | 'break'
  /** implied probability × 1000 - the on-chain scale */
  levelRaw: number
  windowSecs: number
}

// Builds a slip pick (id/label/prob/meta) for one odd + side + window. Factored out of the two
// Holds/Breaks buttons so their construction lives in one place.
function buildPick(
  fixtureId: number,
  odd: LiveOdd,
  side: 'hold' | 'break',
  winIdx: number,
): { id: string; label: string; prob: number; meta: RealPredictMeta } {
  const level = Math.round(Math.max(8, Math.min(92, odd.prob)))
  const prob = side === 'hold' ? holdProb(winIdx) : breakProb(winIdx)
  const id = `${fixtureId}-${odd.oddKey}-${side}-${winIdx}`
  const label = `${odd.label}: ${side === 'hold' ? 'holds' : 'breaks'} ${level}%+ within ${WINDOWS[winIdx]}`
  return {
    id,
    label,
    prob,
    meta: { fixtureId, oddKey: odd.oddKey, marketParams: odd.marketParams, side, levelRaw: level * 1000, windowSecs: WSECS[winIdx] },
  }
}

// Ported from renderCtrls() in frontend/index.html: the window selector + Holds/Breaks
// buttons. Adding a pick here is free - no wallet, no login, no chain call - exactly like
// the original's add(). Only "Place prediction" (in the slip) touches the chain, and only
// then does Privy ask you to log in. Both sides are always offered for whichever odd is
// selected, regardless of whether a real market already exists for it - placing creates
// one on demand (see lib/depositMarkets.ts).
export function PredictBuilder({
  odd,
  fixtureId,
  isSelected,
  onAdd,
  activeWin,
  onWindowChange,
}: {
  odd: LiveOdd
  fixtureId: number
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: RealPredictMeta) => void
  // Selected window is owned by MatchDetail so the chart's time axis stays in sync with it.
  activeWin: number
  onWindowChange: (i: number) => void
}) {
  const wl = WINDOWS[activeWin]
  // One level per odd = the odd's implied probability (%). The fixed decimal odds come from it:
  // Holds pays 1/p, Breaks pays 1/(1-p) with p = level/100 (see VolmarketApp). "Holds L%+" bets the
  // signal stays at/above L (Holds pool); "Breaks L%+" bets it falls below L. Both are ONE market.
  const level = Math.round(Math.max(8, Math.min(92, odd.prob)))
  const hold = buildPick(fixtureId, odd, 'hold', activeWin)
  const brk = buildPick(fixtureId, odd, 'break', activeWin)

  return (
    <div>
      <p className="predlbl">Predict the signal · tap to add</p>
      <div className="winrow">
        <span className="winlbl">Window</span>
        <div className="wchips">
          {/* Only windows the keeper can realistically verify in-window against the live signal.
              Sub-30s durations close before a freshly-created market is even observed, so they'd
              always settle to the default outcome rather than a verified one - hidden to keep the
              "verified within your window" promise honest. Indices are kept absolute (WSECS/probs
              unchanged) so the odds math and pick ids stay consistent. */}
          {WINDOWS.map((w, i) =>
            WSECS[i] < 30 ? null : (
              <span key={w}>
                {(i === 4 || i === 10) && <span className="wdiv"></span>}
                <button className={`wchip${i === activeWin ? ' on' : ''}`} onClick={() => onWindowChange(i)}>
                  {w}
                </button>
              </span>
            ),
          )}
        </div>
      </div>
      <div className="sigact">
        <button
          className={`sigbtn sup${isSelected(hold.id) ? ' sel' : ''}`}
          onClick={() => onAdd(hold.id, hold.label, hold.prob, hold.meta)}
        >
          Holds {level}%+
          <small>within {wl}</small>
        </button>
        <button
          className={`sigbtn res${isSelected(brk.id) ? ' sel' : ''}`}
          onClick={() => onAdd(brk.id, brk.label, brk.prob, brk.meta)}
        >
          Breaks {level}%+
          <small>within {wl}</small>
        </button>
      </div>
    </div>
  )
}
