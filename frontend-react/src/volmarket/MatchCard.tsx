import { Sparkline } from './Sparkline'
import { Flag } from './Flag'
import { matchState, type LiveFixture } from './liveFixtures'

// Ported from renderGrid()/liveTag() in frontend/index.html, now driven by real on-chain
// fixtures (grouped Market accounts) instead of the mock array. Standard scoreboard model:
// the top-right tag is the status/clock (live dot + minute, HT/FT, or kickoff time) and the
// middle of the teams row shows the score - see matchState. The Holds/Breaks buttons open the
// match detail (same as tapping the card) so the user picks the odd/window and places there -
// they're a signposted entry into the market, not a one-tap slip add.
export function MatchCard({ m, now, onOpen }: { m: LiveFixture; now: number; onOpen: (id: string) => void }) {
  const st = matchState(m, now)
  const primary = m.odds[0]
  const prob = primary?.prob ?? 50
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)
  const canPredict = primary != null && m.status !== 'ended'
  const level = Math.round(Math.max(8, Math.min(92, prob)))

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
      {canPredict ? (
        <div className="mact">
          <button className="mactbtn hold" onClick={() => onOpen(m.id)}>
            Holds {level}%+
          </button>
          <button className="mactbtn break" onClick={() => onOpen(m.id)}>
            Breaks {level}%+
          </button>
        </div>
      ) : (
        <div className="sigline">
          <span className="lab">no market yet</span>
        </div>
      )}
      <div className="mfoot">
        <span>
          {m.odds.length} real market{m.odds.length === 1 ? '' : 's'}
        </span>
        <span className="vol">${vol.toFixed(2)} Vol.</span>
      </div>
    </div>
  )
}
