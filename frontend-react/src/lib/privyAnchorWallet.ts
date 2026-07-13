import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'

type PrivySignTransaction = (input: {
  transaction: Uint8Array
  wallet: ConnectedStandardSolanaWallet
  chain?: 'solana:devnet' | 'solana:mainnet' | 'solana:testnet'
}) => Promise<{ signedTransaction: Uint8Array }>

/**
 * Bridges Privy's Solana signer to Anchor's `Wallet` interface.
 *
 * The peer-dependency seam: this app's wallet/RPC plumbing (@privy-io/react-auth,
 * @solana/kit, @solana-program/*) is all "kit"-based, but @coral-xyz/anchor's Program/
 * AnchorProvider only understand classic @solana/web3.js Transaction/VersionedTransaction
 * objects. There's no real npm conflict between @solana/kit and @solana/web3.js - they're
 * separate packages and coexist fine in node_modules - the actual seam is at the signing
 * boundary. It closes cleanly because Privy's signTransaction() hook doesn't care which
 * library built the transaction: it takes and returns raw serialized bytes. So Anchor
 * builds a classic web3.js Transaction, we serialize it to bytes, hand those bytes to
 * Privy for signing, and deserialize the signed bytes back into a web3.js Transaction
 * for Anchor to send. @solana/kit is never involved in this path.
 */
// Structurally matches @coral-xyz/anchor's `Wallet` interface (publicKey +
// signTransaction + signAllTransactions) - that interface isn't re-exported from the
// package root, only its concrete NodeWallet implementation is, so we match it by shape.
export class PrivyAnchorWallet {
  publicKey: PublicKey
  private wallet: ConnectedStandardSolanaWallet
  private privySignTransaction: PrivySignTransaction

  constructor(wallet: ConnectedStandardSolanaWallet, privySignTransaction: PrivySignTransaction) {
    this.publicKey = new PublicKey(wallet.address)
    this.wallet = wallet
    this.privySignTransaction = privySignTransaction
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)))
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const isVersioned = tx instanceof VersionedTransaction
    const bytes = isVersioned
      ? (tx as VersionedTransaction).serialize()
      : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false })

    const { signedTransaction } = await this.privySignTransaction({
      transaction: bytes,
      wallet: this.wallet,
      chain: 'solana:devnet',
    })

    return (isVersioned
      ? VersionedTransaction.deserialize(signedTransaction)
      : Transaction.from(signedTransaction)) as T
  }
}
