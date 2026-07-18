import { Sparkline } from './Sparkline'
import { Flag } from './Flag'
import { matchState, type LiveFixture } from './liveFixtures'
import { buildPick, DEFAULT_WIN, type RealPredictMeta } from './PredictBuilder'

// Ported from renderGrid()/liveTag() in frontend/index.html, now driven by real on-chain
// fixtures (grouped Market accounts) instead of the mock array. Standard scoreboard model:
// the top-right tag is the status/clock (live dot + minute, HT/FT, or kickoff time) and the
// middle of the teams row shows the score - see matchState. The Holds/Breaks buttons are a quick
// predict on the primary odd (default 5m window) - adding to the slip, same as the detail panel;
// tap anywhere else on the card to open the full detail (other odds + window selector).
export function MatchCard({
  m,
  now,
  onOpen,
  onAdd,
  isSelected,
}: {
  m: LiveFixture
  now: number
  onOpen: (id: string) => void
  onAdd: (id: string, label: string, prob: number, meta: RealPredictMeta) => void
  isSelected: (id: string) => boolean
}) {
  const st = matchState(m, now)
  const primary = m.odds[0]
  const prob = primary?.prob ?? 50
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)
  const canPredict = primary != null && m.status !== 'ended'
  const hold = canPredict ? buildPick(m.fixtureId, primary, 'hold', DEFAULT_WIN) : null
  const brk = canPredict ? buildPick(m.fixtureId, primary, 'break', DEFAULT_WIN) : null
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
      {hold && brk ? (
        <div className="mact">
          <button
            className={`mactbtn hold${isSelected(hold.id) ? ' sel' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onAdd(hold.id, hold.label, hold.prob, hold.meta)
            }}
          >
            Holds {level}%+
          </button>
          <button
            className={`mactbtn break${isSelected(brk.id) ? ' sel' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onAdd(brk.id, brk.label, brk.prob, brk.meta)
            }}
          >
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
