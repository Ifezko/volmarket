import { FL, splitResult, type Match } from './data'
import { Sparkline } from './Sparkline'

// Ported verbatim from renderGrid()/liveTag() in frontend/index.html.
function liveTag(m: Match) {
  switch (m.status) {
    case 'live':
      return (
        <span className="mlive">
          <span className="pdot"></span>
          {m.min}'
        </span>
      )
    case 'ht':
      return (
        <span className="mlive" style={{ color: 'var(--amber)' }}>
          HT
        </span>
      )
    case 'soon':
      return <span className="msoon">{m.ko}</span>
  }
}

export function MatchCard({ m, onOpen }: { m: Match; onOpen: (id: string) => void }) {
  const [H] = splitResult(m.prob)
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
        {m.status === 'soon' ? (
          <div className="mmid ko">{m.ko}</div>
        ) : (
          <div className="mmid">
            {m.score[0]}–{m.score[1]}
          </div>
        )}
        <div className="mt r">
          <span className="nm">{m.b}</span>
          <span className="fl">{FL[m.b]}</span>
        </div>
      </div>
      <Sparkline seed={m.id + '-h'} prob={H} />
      <div className="sigline">
        <span className="lab">{m.a} win signal</span>
        <span>
          S {H - 6}% · {H}% · R {H + 7}%
        </span>
      </div>
      <div className="mfoot">
        <span>5 odds · live signals</span>
        <span className="vol">${m.vol} Vol.</span>
      </div>
    </div>
  )
}
