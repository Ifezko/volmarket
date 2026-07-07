import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import { DevnetProof } from './DevnetProof'
import { VolmarketApp } from './volmarket/VolmarketApp'

// The real product (frontend/index.html) has no login wall at all — it's fully open.
// Privy auth is only needed for the "Devnet" screen (real on-chain signing), so it's
// prompted there, not as a gate in front of the whole app.
function App() {
  const { ready, authenticated, user, login } = usePrivy()
  const { wallets } = useSolanaWallets()
  const [tab, setTab] = useState<'product' | 'devnet'>('product')

  if (!ready) {
    return null
  }

  const solanaWallet = wallets[0]

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

  return <VolmarketApp walletAddress={solanaWallet?.address} onOpenDevnet={() => setTab('devnet')} />
}

export default App
