import { FL, oddsLines, type Match, type OddLine } from './data'
import { Sparkline } from './Sparkline'
import { SignalChart, type PredictMeta, type PredictionLine } from './SignalChart'

// Ported from openMatch() in frontend/index.html: the .detail overlay — score header,
// grouped odds selector (live only), the .sig volume-signal panel, the all-odds list,
// and the pre-match "markets open at kickoff" state.
export function MatchDetail({
  match,
  activeKey,
  isFollowed,
  onClose,
  onSelectOdd,
  onToggleFollow,
  onOpenHow,
  predictionLines,
  isSelected,
  onAdd,
  onLiveProb,
}: {
  match: Match
  activeKey: string | null
  isFollowed: boolean
  onClose: () => void
  onSelectOdd: (key: string, scroll?: boolean) => void
  onToggleFollow: (id: string) => void
  onOpenHow: () => void
  predictionLines: PredictionLine[]
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: PredictMeta) => void
  onLiveProb: (prob: number) => void
}) {
  const live = match.status === 'live' || match.status === 'ht'
  const curOdds: OddLine[] = oddsLines(match)
  const activeOdd = curOdds.find((o) => o.key === activeKey)

  let minTag
  switch (match.status) {
    case 'live':
      minTag = (
        <span className="min">
          <span className="pdot"></span>
          {match.min}'
        </span>
      )
      break
    case 'ht':
      minTag = (
        <span className="min" style={{ color: 'var(--amber)' }}>
          Half time
        </span>
      )
      break
    case 'soon':
      minTag = (
        <span className="min" style={{ color: 'var(--dim)' }}>
          Kickoff {match.ko}
        </span>
      )
      break
  }

  const mid =
    match.status === 'soon' ? (
      <span className="sc" style={{ color: 'var(--dim)' }}>
        {match.ko}
      </span>
    ) : (
      <span className="sc">
        {match.score[0]}–{match.score[1]}
      </span>
    )

  const groups = [...new Set(curOdds.map((o) => o.grp))]

  return (
    <div className="detail show">
      <div className="dhead">
        <div className="wrap dhead-in">
          <button className="back" onClick={onClose}>
            ← All matches
          </button>
          <span style={{ color: 'var(--dim)', fontSize: 13 }}>{match.comp}</span>
        </div>
      </div>
      <div className="wrap" style={{ paddingBottom: 90 }}>
        <div className="dscore">
          <div className="dclock">{minTag}</div>
          <div className="dline">
            <div className="t">
              <span className="fl">{FL[match.a]}</span>
              {match.a}
            </div>
            {mid}
            <div className="t">
              {match.b}
              <span className="fl">{FL[match.b]}</span>
            </div>
          </div>
        </div>
        <div className="dsub">
          {match.comp} · ${match.vol} traded · {live ? '5 odds with live signals' : 'pre-match odds · signals at kickoff'}
        </div>

        {live ? (
          <>
            <p className="seltitle">Select a country or odd to read its volume signal</p>
            {groups.map((g) => (
              <div className="ogroup" key={g}>
                <span className="gl">{g}</span>
                {curOdds
                  .filter((o) => o.grp === g)
                  .map((o) => (
                    <div
                      key={o.key}
                      className={`ochip${o.key === activeKey ? ' on' : ''}`}
                      onClick={() => onSelectOdd(o.key)}
                    >
                      <span className="fl">{o.fl}</span>
                      {o.label}
                      <span className="op">{o.prob}%</span>
                    </div>
                  ))}
              </div>
            ))}
            {activeOdd && (
              <SignalChart
                title={`${activeOdd.label} — ${activeOdd.prob}%`}
                onOpenHow={onOpenHow}
                matchId={match.id}
                oddKey={activeOdd.key}
                oddLabel={activeOdd.label}
                prob={activeOdd.prob}
                predictionLines={predictionLines}
                isSelected={isSelected}
                onAdd={onAdd}
                onLiveProb={onLiveProb}
              />
            )}
          </>
        ) : match.status === 'soon' ? (
          <div className="prematch">
            <div className="pmk">
              <span className="pmclock">⏱</span> Markets open at kickoff
            </div>
            <p className="pmsub">
              Odds are live now, but volume signals need the match in play — there's no movement to trade before
              kickoff. Follow this match and its hold/break markets open the moment it starts, {match.ko}.
            </p>
            <button
              className={`btn ${isFollowed ? 'btn-ghost' : 'btn-blue'}`}
              onClick={() => onToggleFollow(match.id)}
              style={{ width: '100%' }}
            >
              {isFollowed ? '✓ Following — alerts at kickoff' : '🔔 Follow match'}
            </button>
          </div>
        ) : null}

        <p className="allh">
          All odds · {match.a} v {match.b}
        </p>
        <div className="allbox">
          {curOdds.map((o) => (
            <div className="orow2" key={o.key}>
              <div className="mini">
                <Sparkline seed={match.id + o.key} prob={o.prob} height={30} />
              </div>
              <div className="nm">
                {o.label}
                <small>{o.grp}</small>
              </div>
              <span className="pc">{o.prob}%</span>
              {live ? (
                <button className="sg" onClick={() => onSelectOdd(o.key, true)}>
                  Signal →
                </button>
              ) : (
                <span className="sgsoon">Opens at KO</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
