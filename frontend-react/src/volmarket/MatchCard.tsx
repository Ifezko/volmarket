import { Sparkline } from './Sparkline'
import { Flag } from './Flag'
import { matchState, type LiveFixture } from './liveFixtures'

// Ported from renderGrid()/liveTag() in frontend/index.html, now driven by real on-chain
// fixtures (grouped Market accounts) instead of the mock array. Standard scoreboard model:
// the top-right tag is the status/clock (live dot + minute, HT/FT, or kickoff time) and the
// middle of the teams row shows the score - see matchState.

export function MatchCard({ m, now, onOpen }: { m: LiveFixture; now: number; onOpen: (id: string) => void }) {
  const st = matchState(m, now)
  const primary = m.odds[0]
  const prob = primary?.prob ?? 50
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)

  return (
    <div className="mcard" onClick={() => onOpen(m.id)}>
      <div className="mtop">
        <span className="comp">{m.comp}</span>
        <span className={st.live ? 'mlive' : 'msoon'}>
          {st.live && <span className="pdot"></span>}
          {st.clock}
        </span>
      </div>
      <div className="mteams">
        <div className="mt">
          <Flag country={m.a} />
          <span className="nm">{m.a}</span>
        </div>
        <div className={`mmid${st.score ? ' score' : ''}`}>{st.score ? `${st.score[0]}–${st.score[1]}` : 'vs'}</div>
        <div className="mt r">
          <span className="nm">{m.b}</span>
          <Flag country={m.b} />
        </div>
      </div>
      <Sparkline seed={m.id + '-h'} prob={prob} />
      <div className="sigline">
        <span className="lab">{primary ? `${primary.label} signal` : 'no market yet'}</span>
        <span>{primary ? `S ${(prob - 6).toFixed(0)}% · ${prob.toFixed(0)}% · R ${(prob + 7).toFixed(0)}%` : ''}</span>
      </div>
      <div className="mfoot">
        <span>
          {m.odds.length} real market{m.odds.length === 1 ? '' : 's'}
        </span>
        <span className="vol">${vol.toFixed(2)} Vol.</span>
      </div>
    </div>
  )
}
