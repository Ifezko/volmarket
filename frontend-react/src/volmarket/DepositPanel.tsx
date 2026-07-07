import { useState } from 'react'

const METHODS: [string, string][] = [
  ['USDC', 'From your Solana wallet'],
  ['Naira', 'Bank or card → converts to USDC'],
  ['Card', 'Visa / Mastercard via partner'],
]
const AMOUNTS = [20, 50, 200]

// Ported from openDeposit()/pickM()/depAmt()/doDeposit() in frontend/index.html,
// rendered inside the Slip drawer's `override` slot (see Slip.tsx). One change from
// the original, consistent with dropping the mock wallet: Continue doesn't credit a
// balance — there's none left — it just closes the sheet.
export function DepositPanel({ onContinue }: { onContinue: () => void }) {
  const [method, setMethod] = useState(METHODS[0][0])
  const [amount, setAmount] = useState(AMOUNTS[1])

  return (
    <>
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
          <button key={a} className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>
            {a}
          </button>
        ))}
      </div>
      <button className="btn btn-blue" style={{ width: '100%' }} onClick={onContinue}>
        Continue
      </button>
    </>
  )
}
