import { useState } from 'react'
import type { ActivePosition } from '../lib/claimMarkets'
import { describeMarket } from './liveFixtures'

// Rendered in the Slip drawer's `override` slot (same pattern as Deposit). Two views via a
// segmented control: "Account" (wallet address + withdraw) and "History" (recent on-chain
// transactions). The wallet address moved here out of the Nav. Withdraw and everything else
// sign silently via Privy, same as placing/depositing.
export function ProfilePanel({
  walletAddress,
  balance,
  accountLabel,
  onCopyAddress,
  onWithdraw,
  onLogout,
  positions,
}: {
  walletAddress: string | undefined
  balance: number
  accountLabel: string | undefined
  onCopyAddress: (address: string) => void
  onWithdraw: (destination: string, amount: number) => Promise<void>
  onLogout: () => Promise<void>
  positions: ActivePosition[]
}) {
  const [view, setView] = useState<'account' | 'history'>('account')
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const amt = Number(amount)
  const canWithdraw = !busy && destination.trim() !== '' && amt > 0 && amt <= balance

  function copy() {
    if (!walletAddress) return
    onCopyAddress(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  async function withdraw() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await onWithdraw(destination.trim(), amt)
      setDone(amt)
      setAmount('')
      setDestination('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  if (!walletAddress) {
    return <div className="empty">Sign in to view your profile.</div>
  }

  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={`segbtn${view === 'account' ? ' on' : ''}`} onClick={() => setView('account')}>
          Account
        </button>
        <button className={`segbtn${view === 'history' ? ' on' : ''}`} onClick={() => setView('history')}>
          History
        </button>
      </div>

      {view === 'account' ? (
        <>
          {accountLabel && (
            <div className="gfield">
              <label className="flbl">Signed in as</label>
              <div className="l" style={{ wordBreak: 'break-all' }}>
                {accountLabel}
              </div>
            </div>
          )}

          <div className="gfield">
            <label className="flbl">Balance</label>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
              ${balance.toFixed(2)}
            </div>
          </div>

          <div className="gfield">
            <label className="flbl">Wallet address</label>
            <button
              className="selrow"
              onClick={copy}
              style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
              title="Copy address"
            >
              <div className="l mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>
                {walletAddress}
              </div>
              <span className="s" style={{ color: 'var(--blue)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
          </div>

          <div className="gfield">
            <label className="flbl">Withdraw USDC</label>
            <input
              className="tinput"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Destination Solana address"
              style={{ marginBottom: 8 }}
            />
            <input
              className="tinput"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder={`Amount (max ${balance.toFixed(2)})`}
            />
          </div>

          {error && (
            <div className="s" style={{ color: 'var(--red)', margin: '2px 0 10px' }}>
              {error}
            </div>
          )}
          {done != null && !error && (
            <div className="s" style={{ color: 'var(--green)', margin: '2px 0 10px' }}>
              Withdrew {done} USDC.
            </div>
          )}

          <button
            className="btn btn-blue"
            style={{ width: '100%', ...(canWithdraw ? {} : { opacity: 0.5 }) }}
            disabled={!canWithdraw}
            onClick={withdraw}
          >
            {busy ? 'Withdrawing…' : amt > balance ? 'Not enough balance' : `Withdraw${amt > 0 ? ` ${amt} USDC` : ''}`}
          </button>

          <div style={{ borderTop: '1px solid var(--border)', margin: '18px 0 0', paddingTop: 14 }}>
            <button
              className="btn"
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                ...(loggingOut ? { opacity: 0.5 } : {}),
              }}
              disabled={loggingOut}
              onClick={logout}
            >
              {loggingOut ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <HistoryList positions={positions} />
      )}
    </>
  )
}

// History = the wallet's predictions, newest first. Each row shows the human-readable
// prediction (teams · market: holds/breaks N%), how it settled, and the amount at stake —
// green +payout for wins, red −stake for losses, dim for still-open. Sourced from the same
// position scan the board/chart already poll (no extra RPC), so it stays live.
function HistoryList({ positions }: { positions: ActivePosition[] }) {
  if (positions.length === 0) {
    return <div className="empty">No predictions yet — pick a window and place one to get started.</div>
  }
  const sorted = [...positions].sort((a, b) => b.windowEnd - a.windowEnd)

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {sorted.map((p) => {
        const won = p.status === 'won'
        const lost = p.status === 'lost'
        const statusColor = won ? 'var(--green)' : lost ? 'var(--red)' : 'var(--dim)'
        const statusText = won ? 'WON' : lost ? 'LOST' : 'PENDING'
        const amount = won
          ? `+${p.stakeUsdc.toFixed(2)}`
          : lost
            ? `−${p.stakeUsdc.toFixed(2)}`
            : `${p.stakeUsdc.toFixed(2)}`

        return (
          <div className="selrow" key={p.position.toBase58()} style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="l" style={{ fontSize: 13, lineHeight: 1.35 }}>
                {describeMarket(p.fixtureId, p.oddKey, p.marketParams, p.side, p.level)}
              </div>
              <div className="s" style={{ color: 'var(--dim)', marginTop: 2 }}>
                <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
                {' · '}
                {new Date(p.windowEnd * 1000).toLocaleString()}
              </div>
            </div>
            <span className="s mono" style={{ color: statusColor, whiteSpace: 'nowrap', fontWeight: 700, marginLeft: 8 }}>
              {amount}
            </span>
          </div>
        )
      })}
    </div>
  )
}
