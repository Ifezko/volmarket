import { useState } from 'react'
import type { RealMarket } from '../lib/onchainMarkets'
import type { LiveOdd } from './liveFixtures'

const STAKE_OPTIONS = [5, 25, 100]

type DepositState = { status: 'idle' | 'pending' | 'done' | 'error'; message?: string }

// Replaces the original's window-selector + Holds/Breaks predict buttons (now in
// SignalChart's git history) with real markets: each on-chain Market for this odd is
// already fixed to one side (hold or break) and one window at creation time (see
// docs/volmarket-technical-doc.md §5), so there's nothing to pick — just whichever real
// markets exist, each depositing YES (agreeing with that market's thesis) for a real
// devnet USDC amount, signed via Privy.
export function RealPredictPanel({
  odd,
  authenticated,
  onLogin,
  onDeposit,
}: {
  odd: LiveOdd
  authenticated: boolean
  onLogin: () => void
  onDeposit: (market: RealMarket, amountUsdc: number) => Promise<string>
}) {
  const [stake, setStake] = useState(STAKE_OPTIONS[0])
  const [state, setState] = useState<Record<string, DepositState>>({})

  async function handleDeposit(market: RealMarket) {
    if (!authenticated) {
      onLogin()
      return
    }
    const key = market.address.toBase58()
    setState((s) => ({ ...s, [key]: { status: 'pending' } }))
    try {
      const signature = await onDeposit(market, stake)
      setState((s) => ({ ...s, [key]: { status: 'done', message: signature } }))
    } catch (err) {
      setState((s) => ({ ...s, [key]: { status: 'error', message: err instanceof Error ? err.message : String(err) } }))
    }
  }

  if (odd.markets.length === 0) {
    return <p className="predlbl">No real market yet for this odd.</p>
  }

  return (
    <div>
      <p className="predlbl">Predict the signal · real devnet USDC</p>
      <div className="stake">
        {STAKE_OPTIONS.map((a) => (
          <button key={a} className={stake === a ? 'on' : ''} onClick={() => setStake(a)}>
            {a}
          </button>
        ))}
      </div>
      <div className="sigact">
        {odd.markets.map((market) => {
          const key = market.address.toBase58()
          const st = state[key]
          const resolved = market.status === 'resolved'
          const label = market.side === 'hold' ? `Holds ${market.level.toFixed(1)}%+` : `Breaks ${market.level.toFixed(1)}%`
          const sub = resolved
            ? `resolved · ${market.outcome.toUpperCase()}`
            : st?.status === 'pending'
              ? 'Sending…'
              : st?.status === 'done'
                ? 'Placed ✓'
                : st?.status === 'error'
                  ? st.message
                  : `ends ${new Date(market.windowEnd * 1000).toLocaleString()}`
          return (
            <button
              key={key}
              className={`sigbtn ${market.side === 'hold' ? 'sup' : 'res'}`}
              disabled={resolved || st?.status === 'pending'}
              onClick={() => handleDeposit(market)}
            >
              {authenticated ? `${label} · ${stake} USDC` : `Log in to ${label}`}
              <small>{sub}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
