// One-time: create a dedicated devnet TREASURY keypair (separate from the program upgrade
// authority) and a canonical devnet USDC mint it controls. The treasury both (a) holds SOL to
// top up embedded wallets for gas and (b) is the mint authority for the app's USDC, so the
// /api/fund endpoint can mint stake tokens to users. Funded from the deployer wallet (id.json).
//
// Writes keeper/.treasury.json (gitignored) and prints the values to wire into Vercel env.
// Run once: npx tsx scripts/setup-treasury.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const OUT = new URL("../.treasury.json", import.meta.url);

async function main() {
  if (existsSync(OUT)) {
    const cur = JSON.parse(readFileSync(OUT, "utf8"));
    console.log("treasury already exists — reusing:\n", { treasury: cur.treasuryPubkey, usdcMint: cur.usdcMint });
    return;
  }

  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const treasury = Keypair.generate();
  console.log("funder:  ", funder.publicKey.toBase58());
  console.log("treasury:", treasury.publicKey.toBase58());

  // fund the treasury with SOL: mint rent + a float to disburse as gas to users
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: treasury.publicKey, lamports: 2_000_000_000 }),
  );
  await sendAndConfirmTransaction(connection, fund, [funder], { commitment: "confirmed" });
  console.log("funded treasury with 2 SOL");

  // canonical app USDC (6 decimals), mint authority = treasury, no freeze authority
  const usdcMint = await createMint(connection, treasury, treasury.publicKey, null, 6);
  console.log("USDC mint:", usdcMint.toBase58());

  const secretArray = Array.from(treasury.secretKey);
  writeFileSync(
    OUT,
    JSON.stringify({ treasuryPubkey: treasury.publicKey.toBase58(), usdcMint: usdcMint.toBase58(), treasurySecretKey: secretArray }, null, 2),
  );

  console.log("\n=== wrote keeper/.treasury.json (gitignored) ===");
  console.log("\n--- Vercel env vars ---");
  console.log("USDC_MINT =", usdcMint.toBase58());
  console.log("SOLANA_RPC_URL =", CONFIG.rpcUrl);
  console.log("TREASURY_SECRET_KEY =", JSON.stringify(secretArray));
}

main().catch((e) => { console.error(e); process.exit(1); });
