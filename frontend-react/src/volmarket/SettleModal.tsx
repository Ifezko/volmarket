import { describeMarket, matchElapsedAt, matchClockLabel } from './liveFixtures'
import type { ClaimablePosition } from '../lib/claimMarkets'

// Real on-chain settlement popup - the counterpart to the original's mock settle modal
// (frontend/index.html showSettle()), but driven by markets the keeper actually resolved.
// Reuses the ported .setmodal/.setcard styling. When the user holds winning positions on
// resolved markets, this surfaces the total and claims their USDC back on click.
export function SettleModal({
  open,
  claimables,
  claiming,
  claimed,
  error,
  onClaim,
  onClose,
}: {
  open: boolean
  claimables: ClaimablePosition[]
  claiming: boolean
  claimed: boolean
  error: string | null
  onClaim: () => void
  onClose: () => void
}) {
  if (!open || !claimables.length) return null
  const total = claimables.reduce((sum, c) => sum + c.payoutUsdc, 0)

  return (
    <div className="setmodal show" onClick={onClose}>
      <div className="setcard won" onClick={(e) => e.stopPropagation()}>
        <div className="setres">{claimed ? 'CLAIMED' : 'YOU WON'}</div>
        <div className="setlabel">
          {claimed
            ? `${total.toFixed(2)} USDC settled to your wallet.`
            : `${claimables.length} winning prediction${claimables.length > 1 ? 's' : ''} settled on-chain.`}
        </div>

        {claimables.map((c) => (
          <div className="setrow" key={c.position.toBase58()}>
            <div style={{ minWidth: 0 }}>
              <div>{describeMarket(c.fixtureId, c.oddKey, c.marketParams, c.side, c.level)}</div>
              {/* the exact percentage and match-clock time it won at */}
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                Won · {c.side === 'hold' ? 'held' : 'broke'} {c.level}% · {matchClockLabel(matchElapsedAt(c.fixtureId, c.windowEnd))}
              </div>
            </div>
            <span className="pg">+{c.payoutUsdc.toFixed(2)}</span>
          </div>
        ))}
        <div className="setrow">
          <span>Total payout</span>
          <span className="pg">+{total.toFixed(2)} USDC</span>
        </div>

        {error && (
          <div className="setrow" style={{ borderTop: 'none' }}>
            <span className="pr" style={{ fontSize: 12 }}>
              {error}
            </span>
          </div>
        )}

        {claimed ? (
          <button className="btn btn-blue" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button
              className="btn btn-blue"
              style={{ width: '100%', marginTop: 14, ...(claiming ? { opacity: 0.6 } : {}) }}
              disabled={claiming}
              onClick={onClaim}
            >
              {claiming ? 'Claiming…' : `Claim ${total.toFixed(2)} USDC`}
            </button>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 8 }}
              disabled={claiming}
              onClick={onClose}
            >
              Later
            </button>
          </>
        )}
      </div>
    </div>
  )
}
