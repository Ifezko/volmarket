import { useState } from 'react'

const METHODS: [string, string][] = [
  ['USDC', 'From your Solana wallet'],
  ['Naira', 'Bank or card → converts to USDC'],
  ['Card', 'Visa / Mastercard via partner'],
]
const AMOUNTS = [20, 50, 200]

// Ported from openDeposit()/pickM()/depAmt()/doDeposit() in frontend/index.html, rendered
// inside the Slip drawer's `override` slot. Now a REAL deposit: Continue funds the embedded
// wallet with `amount` devnet USDC (and tops up gas SOL) via the treasury endpoint, so the
// user has spendable balance to place predictions. On devnet the payment rails are illustrative
// — every method resolves to minting the same canonical USDC to the wallet.
export function DepositPanel({
  balance,
  onDeposit,
}: {
  balance: number
  onDeposit: (amount: number) => Promise<void>
}) {
  const [method, setMethod] = useState(METHODS[0][0])
  const [amount, setAmount] = useState(AMOUNTS[1])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  async function deposit() {
    setBusy(true)
    setError(null)
    try {
      await onDeposit(amount)
      setDone(amount)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="selrow" style={{ marginBottom: 12 }}>
        <div className="l">Current balance</div>
        <div className="l mono" style={{ color: 'var(--green)' }}>
          {balance.toFixed(2)} USDC
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {METHODS.map(([name, sub]) => (
          <button
            key={name}
            className="selrow"
            style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
            onClick={() => setMethod(name)}
          >
            <div>
              <div className="l">{name}</div>
              <div className="s" style={{ color: 'var(--dim)' }}>
                {sub}
              </div>
            </div>
            <span className="rad" style={{ borderColor: method === name ? 'var(--blue)' : 'var(--faint)' }}></span>
          </button>
        ))}
      </div>
      <div className="stake">
        {AMOUNTS.map((a) => (
          <button key={a} className={amount === a ? 'on' : ''} onClick={() => setAmount(a)} disabled={busy}>
            {a}
          </button>
        ))}
      </div>

      {error && (
        <div className="s" style={{ color: 'var(--red)', margin: '4px 0 10px' }}>
          {error}
        </div>
      )}
      {done != null && !error && (
        <div className="s" style={{ color: 'var(--green)', margin: '4px 0 10px' }}>
          Deposited {done} USDC — you're funded and ready to predict.
        </div>
      )}

      <button
        className="btn btn-blue"
        style={{ width: '100%', ...(busy ? { opacity: 0.6 } : {}) }}
        disabled={busy}
        onClick={deposit}
      >
        {busy ? 'Depositing…' : `Deposit ${amount} USDC`}
      </button>
    </>
  )
}
