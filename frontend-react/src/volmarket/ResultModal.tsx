import { useEffect, useState } from 'react'
import { describeOdd, matchWindowLabel } from './liveFixtures'
import type { ActivePosition } from '../lib/claimMarkets'
import { fetchReceipt, type SettlementReceipt } from '../lib/signalFeed'

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
  const wins = results.filter((r) => r.status === 'won')
  const anyWin = wins.length > 0
  // Total winnings = full payout (stake + winnings at the market's fixed odds), NOT just the
  // stake back - this is what the auto-claim actually credited to the balance.
  const credited = wins.reduce((sum, r) => sum + r.payoutUsdc, 0)

  return (
    <div className="setmodal show" onClick={onClose}>
      <div className={`setcard ${anyWin ? 'won' : 'lost'}`} onClick={(e) => e.stopPropagation()}>
        <div className="setres">{anyWin ? (wins.length === results.length ? 'YOU WON' : 'RESULTS') : 'YOU LOST'}</div>
        <div className="setlabel">
          {results.length} prediction{results.length > 1 ? 's' : ''} settled.{' '}
          {anyWin ? 'Winnings were credited to your balance automatically.' : 'Better luck next time.'}
        </div>

        {results.map((r) => (
          <div key={r.position.toBase58()}>
            <div className="setrow">
              <div style={{ minWidth: 0 }}>
                <div>{describeOdd(r.fixtureId, r.oddKey, r.marketParams)}</div>
                {/* the exact percentage and the prediction's window (start->end) in match-clock time */}
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                  {outcomePhrase(r.side, r.status, r.level)} · {matchWindowLabel(r.fixtureId, r.windowStart, r.windowEnd)}
                </div>
              </div>
              <span className={r.status === 'won' ? 'pg' : 'pr'}>{r.status === 'won' ? 'WON' : 'LOST'}</span>
            </div>
            <ProofReceipt market={r.market.toBase58()} />
          </div>
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
