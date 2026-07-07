import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram, type RealMarket } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'

const SIDE_YES = 1
const SIDE_NO = 2

export interface DepositPick {
  market: RealMarket
  side: 'yes' | 'no'
  /** stake for this pick, in whole USDC (6-decimal mint assumed, matches every seeded market) */
  amountUsdc: number
}

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

/**
 * Places one or more real deposits in a single signed transaction — the on-chain equivalent
 * of the original mock combo slip's "place prediction" (see docs/volmarket-technical-doc.md
 * §5: `deposit(side, amount)` stakes USDC into a market's vault and records a Position).
 * Each pick becomes a `deposit` instruction against its own market; a distinct mint's ATA is
 * created idempotently at most once even if several picks share it.
 */
export async function placeRealDeposits(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
  picks: DepositPick[],
): Promise<{ signature: string }> {
  if (!picks.length) throw new Error('no picks to place')

  const userPublicKey = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)

  const tx = new Transaction()
  const ataCreated = new Set<string>()

  for (const pick of picks) {
    const mint = pick.market.usdcMint
    const userToken = getAssociatedTokenAddressSync(mint, userPublicKey)
    if (!ataCreated.has(mint.toBase58())) {
      tx.add(createAssociatedTokenAccountIdempotentInstruction(userPublicKey, userToken, userPublicKey, mint))
      ataCreated.add(mint.toBase58())
    }

    const sideVal = pick.side === 'yes' ? SIDE_YES : SIDE_NO
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), pick.market.address.toBuffer(), userPublicKey.toBuffer(), Buffer.from([sideVal])],
      program.programId,
    )
    const amount = new BN(Math.round(pick.amountUsdc * 1e6))

    const ix = await program.methods
      .deposit(sideVal, amount)
      .accounts({
        user: userPublicKey,
        market: pick.market.address,
        position,
        vault: pick.market.vault,
        userToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
    tx.add(ix)
  }

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  tx.feePayer = userPublicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  const signedTx = await anchorWallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signedTx.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return { signature }
}
