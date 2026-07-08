// Verifies the /api/fund core logic (SOL top-up + USDC mint) against devnet using the
// treasury from keeper/.treasury.json. Also handy to fund a wallet manually.
// Usage: npx tsx scripts/fund-test.ts <walletAddress> <usdcAmount>
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const GAS_FLOOR = 50_000_000, GAS_TOPUP_TO = 250_000_000;

async function main() {
  const [address, amountStr] = process.argv.slice(2);
  if (!address) throw new Error("usage: fund-test.ts <walletAddress> <usdcAmount>");
  const amount = Number(amountStr ?? "0");

  const t = JSON.parse(readFileSync(new URL("../.treasury.json", import.meta.url), "utf8"));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(t.treasurySecretKey));
  const mint = new PublicKey(t.usdcMint);
  const owner = new PublicKey(address);
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const tx = new Transaction();
  const bal = await connection.getBalance(owner, "confirmed");
  if (bal < GAS_FLOOR) {
    tx.add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: owner, lamports: GAS_TOPUP_TO - bal }));
  }
  const ata = getAssociatedTokenAddressSync(mint, owner);
  if (amount > 0) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ata, owner, mint),
      createMintToInstruction(mint, ata, treasury.publicKey, Math.round(amount * 1e6)),
    );
  }
  if (!tx.instructions.length) { console.log("nothing to do"); return; }

  const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
  const usdc = Number((await connection.getTokenAccountBalance(ata)).value.amount) / 1e6;
  const sol = (await connection.getBalance(owner, "confirmed")) / 1e9;
  console.log("tx:", sig);
  console.log(`wallet ${owner.toBase58()} -> ${usdc} USDC, ${sol} SOL`);
}

main().catch((e) => { console.error(e); process.exit(1); });
