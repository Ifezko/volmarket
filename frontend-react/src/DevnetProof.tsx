import { useEffect, useState } from 'react'
import { useSignTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import { runDevnetProof } from './lib/devnetProof'
import { fetchMarkets, type MarketView } from './lib/markets'
import { makeConnection } from './lib/onchainMarkets'

type ProofState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; signature: string; market: string; usdcMint: string }
  | { status: 'error'; message: string }

type MarketsState =
  | { status: 'loading' }
  | { status: 'done'; markets: MarketView[] }
  | { status: 'error'; message: string }

function MarketsList() {
  const [markets, setMarkets] = useState<MarketsState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchMarkets(makeConnection())
      .then((result) => {
        if (!cancelled) setMarkets({ status: 'done', markets: result })
      })
      .catch((err) => {
        if (!cancelled) {
          setMarkets({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (markets.status === 'loading') return <p>Loading devnet markets…</p>
  if (markets.status === 'error') return <p>Error loading markets: {markets.message}</p>
  if (markets.markets.length === 0) return <p>No markets found on devnet.</p>

  return (
    <ul>
      {markets.markets.map((m) => (
        <li key={m.address}>
          fixture {m.fixtureId} / odd {m.oddKey} / side {m.side} / level {m.level} — YES{' '}
          {m.totalYes} / NO {m.totalNo} USDC — {m.status} ({m.outcome})
        </li>
      ))}
    </ul>
  )
}

// Slice 3/4 real-devnet-signing proof, kept reachable behind the "Devnet" nav pill in
// the ported Volmarket UI rather than being the app's main screen.
export function DevnetProof({ userEmail }: { userEmail: string | undefined }) {
  const { wallets } = useSolanaWallets()
  const { signTransaction } = useSignTransaction()
  const [proof, setProof] = useState<ProofState>({ status: 'idle' })

  const solanaWallet = wallets[0]

  const runProof = async () => {
    if (!solanaWallet) return
    setProof({ status: 'running' })
    try {
      const connection = makeConnection()
      const result = await runDevnetProof(connection, solanaWallet, signTransaction)
      setProof({ status: 'done', ...result })
    } catch (err) {
      setProof({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <main style={{ padding: '20px', color: 'var(--text)' }}>
      <p>Email: {userEmail ?? 'no email on file'}</p>
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

      <h2>Devnet markets</h2>
      <MarketsList />
    </main>
  )
}
