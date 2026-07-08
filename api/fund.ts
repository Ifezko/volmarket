import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from '@solana/spl-token'

// Devnet funding faucet: the treasury tops up a little SOL for gas and mints the requested
// USDC to the caller's wallet, so a fresh embedded wallet can actually deposit + place. The
// treasury key never leaves the server; funds only ever move OUT to the requested address.
//
// Required env (Vercel): TREASURY_SECRET_KEY (JSON byte array), USDC_MINT (base58),
// optional SOLANA_RPC_URL (defaults to devnet).

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const USDC_DECIMALS = 6
const MAX_USDC_PER_REQUEST = 1000
// keep every funded wallet above a gas floor so it can pay fees + account rent when placing
const GAS_FLOOR_LAMPORTS = 50_000_000 // 0.05 SOL
const GAS_TOPUP_TO_LAMPORTS = 250_000_000 // top up to 0.25 SOL when below the floor

function loadTreasury(): Keypair {
  const raw = process.env.TREASURY_SECRET_KEY
  if (!raw) throw new Error('TREASURY_SECRET_KEY not configured')
  const bytes = JSON.parse(raw)
  if (!Array.isArray(bytes)) throw new Error('TREASURY_SECRET_KEY must be a JSON byte array')
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // same-origin in prod; permissive CORS so local dev can call it too
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
    const address = String(body.address ?? '')
    const amount = Number(body.amount ?? 0)

    let owner: PublicKey
    try {
      owner = new PublicKey(address)
    } catch {
      return res.status(400).json({ error: 'invalid wallet address' })
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_USDC_PER_REQUEST) {
      return res.status(400).json({ error: `amount must be between 0 and ${MAX_USDC_PER_REQUEST}` })
    }

    const treasury = loadTreasury()
    const mint = new PublicKey(process.env.USDC_MINT ?? '')
    const connection = new Connection(RPC_URL, 'confirmed')

    const tx = new Transaction()

    // 1) gas top-up if the wallet is below the floor
    const balance = await connection.getBalance(owner, 'confirmed')
    let solToppedUp = 0
    if (balance < GAS_FLOOR_LAMPORTS) {
      solToppedUp = GAS_TOPUP_TO_LAMPORTS - balance
      tx.add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: owner,
          lamports: solToppedUp,
        }),
      )
    }

    // 2) mint the requested USDC to the wallet's ATA (created idempotently, treasury pays rent)
    const ownerAta = getAssociatedTokenAddressSync(mint, owner)
    if (amount > 0) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ownerAta, owner, mint),
        createMintToInstruction(
          mint,
          ownerAta,
          treasury.publicKey,
          Math.round(amount * 10 ** USDC_DECIMALS),
        ),
      )
    }

    if (tx.instructions.length === 0) {
      return res.status(200).json({ signature: null, note: 'nothing to fund (wallet already has gas and amount was 0)' })
    }

    tx.feePayer = treasury.publicKey
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.sign(treasury)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

    return res.status(200).json({
      signature,
      usdcMinted: amount,
      solToppedUp: solToppedUp / 1e9,
      usdcMint: mint.toBase58(),
    })
  } catch (err) {
    console.error('fund error', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
