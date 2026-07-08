import { Sparkline } from './Sparkline'
import { Flag } from './Flag'
import { matchClock, type LiveFixture } from './liveFixtures'

// Ported from renderGrid()/liveTag() in frontend/index.html, now driven by real on-chain
// fixtures (grouped Market accounts) instead of the mock array. The top-right tag is a real
// match clock (matchClock): live -> minute since kickoff, upcoming -> kickoff time, resolved -> FT.
function clockTag(m: LiveFixture, now: number) {
  const { text, live } = matchClock(m, now)
  return (
    <span className={live ? 'mlive' : 'msoon'}>
      {live && <span className="pdot"></span>}
      {text}
    </span>
  )
}

export function MatchCard({ m, now, onOpen }: { m: LiveFixture; now: number; onOpen: (id: string) => void }) {
  const primary = m.odds[0]
  const prob = primary?.prob ?? 50
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)

  return (
    <div className="mcard" onClick={() => onOpen(m.id)}>
      <div className="mtop">
        <span className="comp">{m.comp}</span>
        {clockTag(m, now)}
      </div>
      <div className="mteams">
        <div className="mt">
          <Flag country={m.a} />
          <span className="nm">{m.a}</span>
        </div>
        <div className="mmid">vs</div>
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
