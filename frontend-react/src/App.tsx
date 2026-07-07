import { useState } from 'react'
import { Connection } from '@solana/web3.js'
import { usePrivy } from '@privy-io/react-auth'
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana'
import { runDevnetProof } from './lib/devnetProof'

const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'

type ProofState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; signature: string; market: string; usdcMint: string }
  | { status: 'error'; message: string }

function App() {
  const { ready, authenticated, user, login } = usePrivy()
  const { wallets } = useSolanaWallets()
  const { signTransaction } = useSignTransaction()
  const [proof, setProof] = useState<ProofState>({ status: 'idle' })

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

  const runProof = async () => {
    if (!solanaWallet) return
    setProof({ status: 'running' })
    try {
      const connection = new Connection(RPC_URL, 'confirmed')
      const result = await runDevnetProof(connection, solanaWallet, signTransaction)
      setProof({ status: 'done', ...result })
    } catch (err) {
      setProof({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <main>
      <p>Email: {user?.email?.address ?? 'no email on file'}</p>
      <p>Solana wallet: {solanaWallet?.address ?? 'creating embedded wallet…'}</p>

      {solanaWallet && (
        <>
          <button type="button" onClick={runProof} disabled={proof.status === 'running'}>
            {proof.status === 'running' ? 'Running devnet proof…' : 'Prove devnet tx'}
          </button>

          {proof.status === 'done' && (
            <div>
              <p>
                Signature:{' '}
                <a
                  href={`https://explorer.solana.com/tx/${proof.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {proof.signature}
                </a>
              </p>
              <p>Market: {proof.market}</p>
              <p>USDC mint: {proof.usdcMint}</p>
            </div>
          )}

          {proof.status === 'error' && <p>Error: {proof.message}</p>}
        </>
      )}
    </main>
  )
}

export default App
