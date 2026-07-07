import { matches } from './data'
import { MatchCard } from './MatchCard'

// Ported verbatim from the .intro/.legend/.filters/.grid markup in frontend/index.html.
export function Board({ onOpenMatch, onOpenHow }: { onOpenMatch: (id: string) => void; onOpenHow: () => void }) {
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

      <div className="filters">
        <span className="chip on">All</span>
        <span className="chip">Live now</span>
        <span className="chip">Starting soon</span>
        <span className="chip">Group stage</span>
        <div className="right">
          <span className="chip">Sort: Volume ▾</span>
        </div>
      </div>

      <div className="grid" id="grid">
        {matches.map((m) => (
          <MatchCard key={m.id} m={m} onOpen={onOpenMatch} />
        ))}
      </div>
    </div>
  )
}
