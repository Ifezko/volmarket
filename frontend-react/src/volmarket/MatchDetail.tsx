import { FL } from './data'
import { Sparkline } from './Sparkline'
import { SignalChart, type PredictionLine } from './SignalChart'
import { RealPredictPanel } from './RealPredictPanel'
import type { LiveFixture } from './liveFixtures'
import type { RealMarket } from '../lib/onchainMarkets'

// Ported from openMatch() in frontend/index.html: the .detail overlay — score header,
// grouped odds selector (live only), the .sig volume-signal panel, the all-odds list,
// and the pre-match "markets open at kickoff" state. `match` is now a real on-chain
// fixture (grouped Market accounts, see liveFixtures.ts) instead of the mock array.
export function MatchDetail({
  match,
  activeKey,
  isFollowed,
  onClose,
  onSelectOdd,
  onToggleFollow,
  onOpenHow,
  predictionLines,
  authenticated,
  onLogin,
  onDeposit,
  onLiveProb,
}: {
  match: LiveFixture
  activeKey: string | null
  isFollowed: boolean
  onClose: () => void
  onSelectOdd: (key: string, scroll?: boolean) => void
  onToggleFollow: (id: string) => void
  onOpenHow: () => void
  predictionLines: PredictionLine[]
  authenticated: boolean
  onLogin: () => void
  onDeposit: (market: RealMarket, amountUsdc: number) => Promise<string>
  onLiveProb: (prob: number) => void
}) {
  const live = match.status === 'live'
  const curOdds = match.odds
  const activeOdd = curOdds.find((o) => o.key === activeKey)
  const totalVol = curOdds.reduce((sum, o) => sum + o.markets.reduce((s, m) => s + m.totalYes + m.totalNo, 0), 0)

  const minTag =
    match.status === 'live' ? (
      <span className="min">
        <span className="pdot"></span>
        Live
      </span>
    ) : match.status === 'soon' ? (
      <span className="min" style={{ color: 'var(--dim)' }}>
        Opens {match.ko}
      </span>
    ) : (
      <span className="min" style={{ color: 'var(--dim)' }}>
        Resolved
      </span>
    )

  const mid = <span className="sc">{match.status.toUpperCase()}</span>

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
          {match.comp} · ${totalVol.toFixed(2)} staked on-chain ·{' '}
          {live ? `${curOdds.length} real market${curOdds.length === 1 ? '' : 's'}` : 'pre-match odds · signals at kickoff'}
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
                      <span className="op">{o.prob.toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            ))}
            {activeOdd && (
              <>
                <SignalChart
                  title={`${activeOdd.label} — ${activeOdd.prob.toFixed(1)}%`}
                  onOpenHow={onOpenHow}
                  matchId={match.id}
                  oddKey={activeOdd.key}
                  prob={activeOdd.prob}
                  windowSecs={activeOdd.markets[0] ? activeOdd.markets[0].windowEnd - activeOdd.markets[0].windowStart : 300}
                  predictionLines={predictionLines}
                  onLiveProb={onLiveProb}
                />
                <RealPredictPanel key={activeOdd.key} odd={activeOdd} authenticated={authenticated} onLogin={onLogin} onDeposit={onDeposit} />
              </>
            )}
          </>
        ) : match.status === 'soon' ? (
          <div className="prematch">
            <div className="pmk">
              <span className="pmclock">⏱</span> Markets open at kickoff
            </div>
            <p className="pmsub">
              These markets aren't in their trading window yet. Follow this match and its hold/break markets open
              at {match.ko}.
            </p>
            <button
              className={`btn ${isFollowed ? 'btn-ghost' : 'btn-blue'}`}
              onClick={() => onToggleFollow(match.id)}
              style={{ width: '100%' }}
            >
              {isFollowed ? '✓ Following — alerts at kickoff' : '🔔 Follow match'}
            </button>
          </div>
        ) : (
          <div className="prematch">
            <div className="pmk">Markets resolved</div>
            <p className="pmsub">Every market on this fixture has closed. Check the all-odds list below for outcomes.</p>
          </div>
        )}

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
              <span className="pc">{o.prob.toFixed(0)}%</span>
              {live ? (
                <button className="sg" onClick={() => onSelectOdd(o.key, true)}>
                  Signal →
                </button>
              ) : (
                <span className="sgsoon">{match.status === 'soon' ? 'Opens at KO' : 'Resolved'}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
