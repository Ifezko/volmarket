import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import { DevnetProof } from './DevnetProof'
import { VolmarketApp } from './volmarket/VolmarketApp'

function App() {
  const { ready, authenticated, user, login } = usePrivy()
  const { wallets } = useSolanaWallets()
  const [tab, setTab] = useState<'product' | 'devnet'>('product')

  if (!ready) {
    return null
  }

  if (!authenticated) {
    return (
      <main>
        <button type="button" onClick={login}>
          Log in
        </button>
      </main>
    )
  }

  const solanaWallet = wallets[0]

  if (tab === 'devnet') {
    return (
      <>
        <button type="button" onClick={() => setTab('product')} style={{ margin: 12 }}>
          ← Back to Volmarket
        </button>
        <DevnetProof userEmail={user?.email?.address} />
      </>
    )
  }

  return <VolmarketApp walletAddress={solanaWallet?.address} onOpenDevnet={() => setTab('devnet')} />
}

export default App
