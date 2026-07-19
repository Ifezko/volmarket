import { MatchCard } from './MatchCard'
import { useNow } from './useNow'
import type { LiveFixture } from './liveFixtures'

// The board's .intro/.legend header + the fixtures .grid. The filter/sort controls that used
// to sit here moved up into the secondary nav (see Nav.tsx). `fixtures` are real on-chain
// fixtures now (see liveFixtures.ts), not the mock array.
export function Board({
  fixtures,
  hasAnyMarkets,
  onOpenMatch,
  onOpenHow,
  replay,
}: {
  fixtures: LiveFixture[]
  hasAnyMarkets: boolean
  onOpenMatch: (id: string, oddKey?: string) => void
  onOpenHow: () => void
  /** keeper is replaying captured TxLINE events (no live match in play) - shown as a quiet note */
  replay?: boolean
}) {
  const now = Math.floor(useNow(1000) / 1000)
  return (
    <div className="wrap">
      <div className="intro">
        <div>
          <h1>Live volume signals</h1>
          {replay && (
            <div className="replaynote">
              <span className="rdot" /> Replaying captured TxLINE data
            </div>
          )}
          <p>
            Open a match, pick a country or odd, and predict where the money holds support or breaks resistance - on
            every available line.
          </p>
          <button className="howbtn" onClick={onOpenHow} style={{ marginTop: 8 }}>
            How signals work →
          </button>
        </div>
      </div>

      {/* Chart key — sits directly above the grid it explains (was floating far-right on the heading). */}
      <div className="legend">
        <span>
          <i style={{ background: 'var(--green)' }}></i>Support
        </span>
        <span>
          <i style={{ background: 'var(--red)' }}></i>Resistance
        </span>
        <span>
          <i style={{ background: 'var(--cyan)' }}></i>Live line
        </span>
      </div>

      <div className="grid" id="grid">
        {fixtures.length === 0 ? (
          <div className="empty" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
            <img
              src="/volmarket-mark.png"
              alt=""
              height={48}
              style={{ width: 'auto', opacity: 0.85, filter: 'drop-shadow(0 0 16px rgba(134,59,255,.4))' }}
            />
            <span>
              {hasAnyMarkets
                ? 'No fixtures are streaming a live signal right now - the board only lists matches with a real, live feed, so every chart and settlement is genuine.'
                : 'No real markets on devnet yet - seed some with keeper/scripts/seed-devnet.ts.'}
            </span>
          </div>
        ) : (
          fixtures.map((m) => <MatchCard key={m.id} m={m} now={now} onOpen={onOpenMatch} />)
        )}
      </div>
    </div>
  )
}
