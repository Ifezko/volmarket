import { LiveSparkline } from './LiveSparkline'
import { matchState, type LiveFixture } from './liveFixtures'

// A board card, Polymarket-style: a headline real-feed chart for the home line, then the 1X2
// outcomes (home / draw / away) as rows - each with the current signal level and Hold/Break buttons
// that open the match detail FOCUSED on that odd, so you can jump straight into any market. Tapping
// elsewhere on the card opens the detail on the default odd. Driven by real on-chain fixtures
// (grouped Market accounts); the top-right tag is the live minute + score, or the kickoff time.
export function MatchCard({
  m,
  now,
  onOpen,
}: {
  m: LiveFixture
  now: number
  onOpen: (id: string, oddKey?: string) => void
}) {
  const st = matchState(m, now)
  // The 1X2 outcomes (home/draw/away) as the tradeable rows; home also seeds the headline chart.
  const rows = m.odds.filter((o) => o.oddKey === 0 || o.oddKey === 1 || o.oddKey === 2)
  const home = m.odds.find((o) => o.oddKey === 0) ?? m.odds[0]
  const vol = m.odds.reduce((sum, o) => sum + o.markets.reduce((s, mk) => s + mk.totalYes + mk.totalNo, 0), 0)
  const canPredict = m.status !== 'ended'

  return (
    <div className="mcard" onClick={() => onOpen(m.id)}>
      <div className="mtop">
        <span className="comp">{m.comp}</span>
        <span className={st.live ? 'mlive' : 'msoon'}>
          {st.live && <span className="pdot"></span>}
          {st.clock}
          {st.score ? ` · ${st.score[0]}–${st.score[1]}` : ''}
        </span>
      </div>

      {home && (
        <LiveSparkline fixtureId={m.fixtureId} oddKey={home.oddKey} marketParams={home.marketParams} prob={home.prob} seed={m.id + '-h'} />
      )}

      <div className="mrows">
        {rows.map((o) => (
          <div className="mrow" key={o.key}>
            <span className="mrow-flag">{o.fl}</span>
            <span className="mrow-lab">{o.label}</span>
            <span className="mrow-pct">{o.prob.toFixed(0)}%</span>
            {canPredict && (
              <>
                <button
                  className="mrowbtn hold"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(m.id, o.key)
                  }}
                >
                  Hold
                </button>
                <button
                  className="mrowbtn break"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(m.id, o.key)
                  }}
                >
                  Break
                </button>
              </>
            )}
          </div>
        ))}
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
