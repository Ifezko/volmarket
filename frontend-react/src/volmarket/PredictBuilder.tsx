import { useState } from 'react'
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
}: {
  odd: LiveOdd
  fixtureId: number
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: RealPredictMeta) => void
}) {
  const [activeWin, setActiveWin] = useState(7) // default 5m

  const wl = WINDOWS[activeWin]
  // One level per odd = the odd's implied probability (%). The fixed decimal odds come from it:
  // Holds pays 1/p, Breaks pays 1/(1-p) with p = level/100 (see VolmarketApp). "Holds L%+" bets the
  // signal stays at/above L (Holds pool); "Breaks L%+" bets it falls below L. Both are ONE market.
  const level = Math.round(Math.max(8, Math.min(92, odd.prob)))
  const hp = holdProb(activeWin)
  const bp = breakProb(activeWin)
  const b = `${fixtureId}-${odd.oddKey}`
  const holdId = `${b}-hold-${activeWin}`
  const breakId = `${b}-break-${activeWin}`

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
                <button className={`wchip${i === activeWin ? ' on' : ''}`} onClick={() => setActiveWin(i)}>
                  {w}
                </button>
              </span>
            ),
          )}
        </div>
      </div>
      <div className="sigact">
        <button
          className={`sigbtn sup${isSelected(holdId) ? ' sel' : ''}`}
          onClick={() =>
            onAdd(holdId, `${odd.label}: holds ${level}%+ within ${wl}`, hp, {
              fixtureId,
              oddKey: odd.oddKey,
              marketParams: odd.marketParams,
              side: 'hold',
              levelRaw: level * 1000,
              windowSecs: WSECS[activeWin],
            })
          }
        >
          Holds {level}%+
          <small>within {wl}</small>
        </button>
        <button
          className={`sigbtn res${isSelected(breakId) ? ' sel' : ''}`}
          onClick={() =>
            onAdd(breakId, `${odd.label}: breaks ${level}%+ within ${wl}`, bp, {
              fixtureId,
              oddKey: odd.oddKey,
              marketParams: odd.marketParams,
              side: 'break',
              levelRaw: level * 1000,
              windowSecs: WSECS[activeWin],
            })
          }
        >
          Breaks {level}%+
          <small>within {wl}</small>
        </button>
      </div>
    </div>
  )
}
