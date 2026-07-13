import { useEffect, useState } from 'react'

const PRESETS = [5, 25, 100]

// Stake selector: quick-pick presets plus a free-form custom amount. Keeps a local text buffer so
// the field can be cleared and retyped (a controlled number that snaps back can't be edited); it
// re-syncs whenever `stake` changes from the outside (e.g. a preset click). Any positive number is
// accepted - the Place button / insufficient-funds guard upstream handle balance limits.
export function StakePicker({ stake, onSetStake }: { stake: number; onSetStake: (amount: number) => void }) {
  const [text, setText] = useState(String(stake))
  useEffect(() => {
    setText((t) => (Number(t) === stake ? t : String(stake)))
  }, [stake])

  return (
    <div className="stake">
      {PRESETS.map((a) => (
        <button key={a} className={stake === a ? 'on' : ''} onClick={() => onSetStake(a)}>
          {a}
        </button>
      ))}
      <input
        className="stakein"
        type="number"
        min={1}
        inputMode="decimal"
        value={text}
        aria-label="Custom stake in USDC"
        placeholder="Custom"
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) onSetStake(v)
        }}
      />
    </div>
  )
}
