import { useEffect, useState } from 'react'
import { describeOdd, matchWindowLabel } from './liveFixtures'
import type { ActivePosition } from '../lib/claimMarkets'
import { fetchReceipt, fetchSignal, type SettlementReceipt } from '../lib/signalFeed'

// Verifiable-resolution receipt: the TxLINE datapoint (messageId + ts) that decided this market and
// a link to the on-chain resolve transaction, so the outcome can be traced without trusting us.
// Falls back to a link to the market account when the keeper has no datapoint receipt (e.g. a market
// that settled to its default at window close, with no crossing datapoint).
function ProofReceipt({ market }: { market: string }) {
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchReceipt(market).then((r) => {
      if (cancelled) return
      setReceipt(r)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [market])

  const href = receipt
    ? `https://explorer.solana.com/tx/${receipt.resolveTx}?cluster=devnet`
    : `https://explorer.solana.com/address/${market}?cluster=devnet`

  return (
    <div className="setproof">
      {receipt ? (
        <div>
          Settled on TxLINE datapoint <span className="mono">{receipt.messageId}</span> ·{' '}
          {new Date(receipt.ts).toLocaleString()} · {(receipt.value / 1000).toFixed(1)}%
        </div>
      ) : loaded ? (
        <div>Settled on-chain at window close.</div>
      ) : (
        <div>Loading proof…</div>
      )}
      <a href={href} target="_blank" rel="noreferrer">
        {receipt ? 'Verify resolve tx on Solana Explorer ↗' : 'Verify on Solana Explorer ↗'}
      </a>
    </div>
  )
}

/**
 * Provisional outcome, read straight off the stream the moment the window closes - BEFORE the
 * on-chain proof exists. The market resolves NO (the HOLD is defeated) if the signal dipped below
 * the level at any point in the window, else YES. A 'hold' pick wins on YES, a 'break' pick on NO.
 * Returns null while we have no in-window samples to judge from.
 */
function provisionalStatus(points: { t: number; v: number }[], r: ActivePosition): 'won' | 'lost' | null {
  const inWindow = points.filter((p) => p.t >= r.windowStart && p.t <= r.windowEnd)
  if (!inWindow.length) return null
  const defeated = inWindow.some((p) => p.v < r.level) // outcome NO
  const won = r.side === 'hold' ? !defeated : defeated
  return won ? 'won' : 'lost'
}

/**
 * One settled prediction. Two-phase by design (see keeper txline.ts): detection is real-time off the
 * stream, but trustless verification waits for TxLINE's next 5-minute proof batch. So we show the
 * provisional outcome immediately ("WON - verifying on-chain…") and upgrade to "Verified" with the
 * proof receipt once the on-chain resolution lands.
 */
function ResultRow({ r }: { r: ActivePosition }) {
  const verified = r.status !== 'pending'
  const [provisional, setProvisional] = useState<'won' | 'lost' | null>(null)

  useEffect(() => {
    if (verified) return
    let cancelled = false
    const pull = () =>
      fetchSignal(r.fixtureId, r.oddKey, r.marketParams).then((pts) => {
        if (!cancelled) setProvisional(provisionalStatus(pts, r))
      })
    pull()
    const id = setInterval(pull, 10_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [verified, r])

  const shown = verified ? (r.status as 'won' | 'lost') : provisional
  return (
    <div>
      <div className="setrow">
        <div style={{ minWidth: 0 }}>
          <div>{describeOdd(r.fixtureId, r.oddKey, r.marketParams)}</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
            {shown ? outcomePhrase(r.side, shown, r.level) : 'settling'} ·{' '}
            {matchWindowLabel(r.fixtureId, r.windowStart, r.windowEnd)}
          </div>
        </div>
        {verified ? (
          <span className={shown === 'won' ? 'pg' : 'pr'}>{shown === 'won' ? 'WON' : 'LOST'}</span>
        ) : (
          <span className="pp">{shown ? `${shown === 'won' ? 'WON' : 'LOST'} · verifying…` : 'verifying…'}</span>
        )}
      </div>
      {verified ? (
        <ProofReceipt market={r.market.toBase58()} />
      ) : (
        <div className="setproof">
          <div>
            Outcome known from the live TxLINE feed. Proof publishes on the next 5-minute batch, then
            this settles on-chain and shows its receipt.
          </div>
        </div>
      )}
    </div>
  )
}

// The exact level-% event that decided it, phrased per side + outcome (e.g. "held 46%", "broke 46%").
function outcomePhrase(side: 'hold' | 'break', status: 'pending' | 'won' | 'lost', level: number): string {
  if (side === 'hold') return status === 'won' ? `held ${level}%` : `fell below ${level}%`
  return status === 'won' ? `broke ${level}%` : `stayed under ${level}%`
}

// Pops when one or more of the user's predictions reach the end of their window and settle
// on-chain - the counterpart to the WINNING/LOSING chips going final. Purely informational:
// winnings are credited to the balance automatically (see the auto-claim in VolmarketApp), so
// there's nothing to click - just a summary of what won/lost.
export function ResultModal({
  open,
  results,
  onClose,
}: {
  open: boolean
  results: ActivePosition[]
  onClose: () => void
}) {
  if (!open || !results.length) return null
  // Header/credited reflect only VERIFIED (on-chain settled) rows - provisional rows haven't paid out
  // yet. If nothing has verified, the modal reads as still settling rather than claiming a result.
  const verifiedRows = results.filter((r) => r.status !== 'pending')
  const wins = verifiedRows.filter((r) => r.status === 'won')
  const anyWin = wins.length > 0
  const allVerified = verifiedRows.length === results.length
  // Total winnings = full payout (stake + winnings at the market's fixed odds), NOT just the
  // stake back - this is what the auto-claim actually credited to the balance.
  const credited = wins.reduce((sum, r) => sum + r.payoutUsdc, 0)

  return (
    <div className="setmodal show" onClick={onClose}>
      <div className={`setcard ${anyWin ? 'won' : 'lost'}`} onClick={(e) => e.stopPropagation()}>
        <div className="setres">
          {!verifiedRows.length ? 'SETTLING' : anyWin ? (wins.length === verifiedRows.length ? 'YOU WON' : 'RESULTS') : 'YOU LOST'}
        </div>
        <div className="setlabel">
          {results.length} prediction{results.length > 1 ? 's' : ''}{' '}
          {allVerified ? 'settled.' : 'settling - verifying on-chain.'}{' '}
          {anyWin ? 'Winnings were credited to your balance automatically.' : allVerified ? 'Better luck next time.' : ''}
        </div>

        {results.map((r) => (
          <ResultRow key={r.position.toBase58()} r={r} />
        ))}
        {anyWin && (
          <div className="setrow">
            <span>Credited to balance</span>
            <span className="pg">+{credited.toFixed(2)} USDC</span>
          </div>
        )}

        <button className="btn btn-blue" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
