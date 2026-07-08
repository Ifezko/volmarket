import { useEffect, useState } from 'react'
import type { TxHistoryItem } from '../lib/funds'

// Rendered in the Slip drawer's `override` slot (same pattern as Deposit). Two views via a
// segmented control: "Account" (wallet address + withdraw) and "History" (recent on-chain
// transactions). The wallet address moved here out of the Nav. Withdraw and everything else
// sign silently via Privy, same as placing/depositing.
export function ProfilePanel({
  walletAddress,
  balance,
  onCopyAddress,
  onWithdraw,
  loadHistory,
}: {
  walletAddress: string | undefined
  balance: number
  onCopyAddress: (address: string) => void
  onWithdraw: (destination: string, amount: number) => Promise<void>
  loadHistory: () => Promise<TxHistoryItem[]>
}) {
  const [view, setView] = useState<'account' | 'history'>('account')
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const [history, setHistory] = useState<TxHistoryItem[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const amt = Number(amount)
  const canWithdraw = !busy && destination.trim() !== '' && amt > 0 && amt <= balance

  // load history the first time the History tab is opened (and on manual refresh)
  useEffect(() => {
    if (view !== 'history' || history !== null) return
    let cancelled = false
    loadHistory()
      .then((items) => !cancelled && setHistory(items))
      .catch((err) => !cancelled && setHistoryError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [view, history, loadHistory])

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
      setHistory(null) // force a refresh next time History is opened
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
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
        </>
      ) : (
        <HistoryList history={history} error={historyError} />
      )}
    </>
  )
}

function HistoryList({ history, error }: { history: TxHistoryItem[] | null; error: string | null }) {
  if (error) {
    return (
      <div className="s" style={{ color: 'var(--red)' }}>
        Couldn't load history: {error}
      </div>
    )
  }
  if (history === null) {
    return <div className="empty">Loading transactions…</div>
  }
  if (history.length === 0) {
    return <div className="empty">No transactions yet — deposit and place a prediction to get started.</div>
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {history.map((tx) => (
        <a
          key={tx.signature}
          className="selrow"
          href={`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <div>
            <div className="l mono" style={{ fontSize: 12 }}>
              {tx.signature.slice(0, 8)}…{tx.signature.slice(-8)}
            </div>
            <div className="s" style={{ color: 'var(--dim)' }}>
              {tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString() : 'pending'}
            </div>
          </div>
          <span className="s mono" style={{ color: tx.err ? 'var(--red)' : 'var(--green)', whiteSpace: 'nowrap' }}>
            {tx.err ? 'failed' : 'success'} ↗
          </span>
        </a>
      ))}
    </div>
  )
}
