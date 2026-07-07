import { FL } from './data'
import { Sparkline } from './Sparkline'
import type { LiveFixture } from './liveFixtures'

// Ported from renderGrid()/liveTag() in frontend/index.html, now driven by real on-chain
// fixtures (grouped Market accounts) instead of the mock array — see liveFixtures.ts for
// why there's no live score/minute (that needs TxLINE, not wired into the browser yet).
function liveTag(m: LiveFixture) {
  if (m.status === 'live') {
    return (
      <span className="mlive">
        <span className="pdot"></span>
        Live
      </span>
    )
  }
  if (m.status === 'soon') {
    return <span className="msoon">{m.ko}</span>
  }
  return <span className="msoon">Resolved</span>
}

export function MatchCard({ m, onOpen }: { m: LiveFixture; onOpen: (id: string) => void }) {
  const primary = m.odds[0]
  const prob = primary?.prob ?? 50
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)

  return (
    <div className="mcard" onClick={() => onOpen(m.id)}>
      <div className="mtop">
        <span className="comp">{m.comp}</span>
        {liveTag(m)}
      </div>
      <div className="mteams">
        <div className="mt">
          <span className="fl">{FL[m.a]}</span>
          <span className="nm">{m.a}</span>
        </div>
        <div className="mmid">vs</div>
        <div className="mt r">
          <span className="nm">{m.b}</span>
          <span className="fl">{FL[m.b]}</span>
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
