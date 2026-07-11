import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from '@solana/web3.js'
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token'
import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import idl from '../idl/signal_markets.json'
import { PrivyAnchorWallet } from './privyAnchorWallet'

const SIDE_HOLD = 0

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

export interface DevnetProofResult {
  signature: string
  market: string
  usdcMint: string
}

/**
 * Proves the Privy embedded Solana wallet can sign and send a real transaction against the
 * deployed signal_markets program on devnet. One atomic transaction: create a fresh mock-USDC
 * mint, initialize it, and call the program's create_market instruction against it — all
 * signed by the Privy wallet (as fee payer + market authority) plus a locally-generated
 * throwaway keypair (as the new mint account, which must co-sign its own creation).
 */
export async function runDevnetProof(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  privySignTransaction: PrivySignTransaction,
): Promise<DevnetProofResult> {
  const userPublicKey = new PublicKey(wallet.address)

  const airdropSig = await connection.requestAirdrop(userPublicKey, 1_000_000_000) // 1 SOL
  const latestForAirdrop = await connection.getLatestBlockhash()
  await connection.confirmTransaction({ signature: airdropSig, ...latestForAirdrop }, 'confirmed')

  const anchorWallet = new PrivyAnchorWallet(wallet, privySignTransaction)
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' })
  const program = new Program(idl as Idl, provider)

  const mintKeypair = Keypair.generate()
  const mintLamports = await getMinimumBalanceForRentExemptMint(connection)

  const fixtureId = new BN(Date.now())
  const oddKey = new BN(0)
  const marketParams = new BN(0)
  const side = SIDE_HOLD
  const level = new BN(0)
  const now = Math.floor(Date.now() / 1000)
  const windowStart = new BN(now)
  const windowEnd = new BN(now + 3600)
  const feeBps = 0

  const [market] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('market'),
      fixtureId.toArrayLike(Buffer, 'le', 8),
      oddKey.toArrayLike(Buffer, 'le', 8),
      marketParams.toArrayLike(Buffer, 'le', 8),
      Buffer.from([side]),
      level.toArrayLike(Buffer, 'le', 8),
      windowStart.toArrayLike(Buffer, 'le', 8),
    ],
    program.programId,
  )
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()],
    program.programId,
  )

  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: userPublicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: MINT_SIZE,
    lamports: mintLamports,
    programId: TOKEN_PROGRAM_ID,
  })
  const initializeMintIx = createInitializeMint2Instruction(
    mintKeypair.publicKey,
    6,
    userPublicKey,
    null,
  )
  const createMarketIx = await program.methods
    // Self-contained proof: fee_recipient = the user itself (its own ephemeral mint), so no
    // separate fee-wallet ATA is needed. The live app routes fees to FEE_RECIPIENT (see funds.ts).
    .createMarket(fixtureId, oddKey, marketParams, side, level, windowStart, windowEnd, feeBps, userPublicKey)
    .accounts({
      authority: userPublicKey,
      market,
      usdcMint: mintKeypair.publicKey,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction()

  const tx = new Transaction().add(createMintAccountIx, initializeMintIx, createMarketIx)
  tx.feePayer = userPublicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash

  // The mint keypair co-signs locally (we generated it, no Privy round-trip needed for it);
  // the Privy wallet's signature is added by anchorWallet.signTransaction below.
  tx.partialSign(mintKeypair)

  const signedTx = await anchorWallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signedTx.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

  return { signature, market: market.toBase58(), usdcMint: mintKeypair.publicKey.toBase58() }
}
