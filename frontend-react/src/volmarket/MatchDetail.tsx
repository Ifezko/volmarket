import { useState } from 'react'
import { Sparkline } from './Sparkline'
import { Flag } from './Flag'
import { useNow } from './useNow'
import { SignalChart, type PredictionLine } from './SignalChart'
import { PredictPanel } from './PredictPanel'
import { type RealPredictMeta } from './PredictBuilder'
import { WSECS } from './predictWindows'
import { matchState, type LiveFixture } from './liveFixtures'
import type { SlipItem, Ticket } from './Slip'

// Ported from openMatch() in frontend/index.html: the .detail overlay - score header,
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
  isSelected,
  onAdd,
  onLiveProb,
  slip,
  stake,
  ticket,
  placing,
  placeError,
  insufficientFunds,
  balance,
  onRemoveFromSlip,
  onSetStake,
  onPlace,
  onOpenDeposit,
  onCopyCode,
  onMakeGroup,
  onNewSlip,
  sendableGroups,
  sending,
  onSendToGroup,
}: {
  match: LiveFixture
  activeKey: string | null
  isFollowed: boolean
  onClose: () => void
  onSelectOdd: (key: string, scroll?: boolean) => void
  onToggleFollow: (id: string) => void
  onOpenHow: () => void
  predictionLines: PredictionLine[]
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: RealPredictMeta) => void
  onLiveProb: (prob: number) => void
  slip: SlipItem[]
  stake: number
  ticket: Ticket | null
  placing: boolean
  placeError: string | null
  insufficientFunds: boolean
  balance: number | null
  onRemoveFromSlip: (id: string) => void
  onSetStake: (amount: number) => void
  onPlace: () => void
  onOpenDeposit: () => void
  onCopyCode: (code: string) => void
  onMakeGroup: (code: string) => void
  onNewSlip: () => void
  sendableGroups: { address: string; name: string }[]
  sending: boolean
  onSendToGroup: (groupAddress: string) => void
}) {
  // Selected prediction window (index into WINDOWS/WSECS), lifted here so the chart's time axis
  // and the window selector stay in sync. Default 7 = 5m, matching the selector's default.
  const [activeWin, setActiveWin] = useState(7)
  const live = match.status === 'live'
  const curOdds = match.odds
  const activeOdd = curOdds.find((o) => o.key === activeKey)
  const totalVol = curOdds.reduce((sum, o) => sum + o.markets.reduce((s, m) => s + m.totalYes + m.totalNo, 0), 0)

  const now = Math.floor(useNow(1000) / 1000)
  const st = matchState(match, now)

  // Left side: the live dot + match minute / HT / FT (or the kickoff time for upcoming) -
  // the standard scoreboard status column.
  const minTag = st.live ? (
    <span className="min">
      <span className="pdot"></span>
      {st.clock}
    </span>
  ) : (
    <span className="min" style={{ color: 'var(--dim)' }}>
      {match.status === 'soon' ? `Kickoff ${st.clock}` : st.clock}
    </span>
  )

  // Middle: the score, where a scoreboard puts it (not the clock/status).
  const mid = <span className="sc">{st.score ? `${st.score[0]} – ${st.score[1]}` : 'vs'}</span>

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
              <Flag country={match.a} />
              {match.a}
            </div>
            {mid}
            <div className="t">
              {match.b}
              <Flag country={match.b} />
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
                      <Flag country={o.label} fallback={o.fl} />
                      {o.label}
                      <span className="op">{o.prob.toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            ))}
            {activeOdd && (
              <div className="detailgrid">
                <div className="dg-chart">
                  <SignalChart
                    title={`${activeOdd.label} - ${activeOdd.prob.toFixed(1)}%`}
                    onOpenHow={onOpenHow}
                    matchId={match.id}
                    oddKey={activeOdd.key}
                    prob={activeOdd.prob}
                    windowSecs={WSECS[activeWin]}
                    predictionLines={predictionLines}
                    onLiveProb={onLiveProb}
                  />
                </div>
                <div className="dg-predict">
                  <PredictPanel
                    key={activeOdd.key}
                    odd={activeOdd}
                    fixtureId={match.fixtureId}
                    isSelected={isSelected}
                    onAdd={onAdd}
                    activeWin={activeWin}
                    onWindowChange={setActiveWin}
                    slip={slip}
                    stake={stake}
                    ticket={ticket}
                    placing={placing}
                    placeError={placeError}
                    insufficientFunds={insufficientFunds}
                    balance={balance}
                    onRemove={onRemoveFromSlip}
                    onSetStake={onSetStake}
                    onPlace={onPlace}
                    onOpenDeposit={onOpenDeposit}
                    onCopyCode={onCopyCode}
                    onMakeGroup={onMakeGroup}
                    onNewSlip={onNewSlip}
                    sendableGroups={sendableGroups}
                    sending={sending}
                    onSendToGroup={onSendToGroup}
                  />
                </div>
              </div>
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
              {isFollowed ? '✓ Following - alerts at kickoff' : '🔔 Follow match'}
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
