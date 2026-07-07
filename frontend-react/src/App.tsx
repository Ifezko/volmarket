import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { DevnetProof } from './DevnetProof'
import { VolmarketApp } from './volmarket/VolmarketApp'

// The real product (frontend/index.html) has no login wall at all — it's fully open.
// Privy auth is only needed for the "Devnet" screen and for real predictions (both
// prompted where they happen, inside VolmarketApp), not as a gate in front of the app.
function App() {
  const { ready, authenticated, user, login } = usePrivy()
  const [tab, setTab] = useState<'product' | 'devnet'>('product')

  if (!ready) {
    return null
  }

  if (tab === 'devnet') {
    return (
      <>
        <button type="button" onClick={() => setTab('product')} style={{ margin: 12 }}>
          ← Back to Volmarket
        </button>
        {authenticated ? (
          <DevnetProof userEmail={user?.email?.address} />
        ) : (
          <main style={{ padding: 20, color: 'var(--text)' }}>
            <p>Log in with Privy to run the real devnet signing proof.</p>
            <button type="button" onClick={login}>
              Log in
            </button>
          </main>
        )}
      </>
    )
  }

  return <VolmarketApp onOpenDevnet={() => setTab('devnet')} />
}

export default App
