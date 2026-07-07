import { usePrivy } from '@privy-io/react-auth'
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'

function App() {
  const { ready, authenticated, user, login } = usePrivy()
  const { wallets } = useSolanaWallets()

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

  return (
    <main>
      <p>Email: {user?.email?.address ?? 'no email on file'}</p>
      <p>Solana wallet: {solanaWallet?.address ?? 'creating embedded wallet…'}</p>
    </main>
  )
}

export default App
