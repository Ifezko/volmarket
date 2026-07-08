import { useState } from 'react'

// Rendered in the Slip drawer's `override` slot (same pattern as Deposit). Shows the embedded
// wallet address (moved here out of the Nav) and a withdraw form to send USDC to any Solana
// address. Withdrawing signs silently via Privy, same as placing/depositing.
export function ProfilePanel({
  walletAddress,
  balance,
  onCopyAddress,
  onWithdraw,
}: {
  walletAddress: string | undefined
  balance: number
  onCopyAddress: (address: string) => void
  onWithdraw: (destination: string, amount: number) => Promise<void>
}) {
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

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

  if (!walletAddress) {
    return <div className="empty">Sign in to view your profile.</div>
  }

  return (
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
  )
}
