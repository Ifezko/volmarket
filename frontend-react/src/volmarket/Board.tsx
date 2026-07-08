import { MatchCard } from './MatchCard'
import type { LiveFixture } from './liveFixtures'

// The board's .intro/.legend header + the fixtures .grid. The filter/sort controls that used
// to sit here moved up into the secondary nav (see Nav.tsx). `fixtures` are real on-chain
// fixtures now (see liveFixtures.ts), not the mock array.
export function Board({
  fixtures,
  hasAnyMarkets,
  onOpenMatch,
  onOpenHow,
}: {
  fixtures: LiveFixture[]
  hasAnyMarkets: boolean
  onOpenMatch: (id: string) => void
  onOpenHow: () => void
}) {
  return (
    <div className="wrap">
      <div className="intro">
        <div>
          <h1>Live volume signals</h1>
          <p>
            Open a match, pick a country or odd, and predict where the money holds support or breaks resistance — on
            every available line.
          </p>
          <button className="howbtn" onClick={onOpenHow} style={{ marginTop: 8 }}>
            How signals work →
          </button>
        </div>
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
      </div>

      <div className="grid" id="grid">
        {fixtures.length === 0 ? (
          <p className="empty">
            {hasAnyMarkets
              ? 'No matches in this view — try another filter.'
              : 'No real markets on devnet yet — seed some with keeper/scripts/seed-devnet.ts.'}
          </p>
        ) : (
          fixtures.map((m) => <MatchCard key={m.id} m={m} onOpen={onOpenMatch} />)
        )}
      </div>
    </div>
  )
}
