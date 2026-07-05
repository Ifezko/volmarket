// Fund a wallet on devnet so it can trade from the browser: airdrop SOL + mint the demo USDC
// (the mint used by the open markets — the deployer is its mint authority). Usage:
//   npx tsx scripts/fund-wallet.ts <WALLET_ADDRESS>
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const target = process.argv[2];
if (!target) { console.error("usage: tsx scripts/fund-wallet.ts <WALLET_ADDRESS>"); process.exit(1); }
const targetPk = new PublicKey(target);

const secret = JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"));
const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
const conn = new Connection(CONFIG.rpcUrl, "confirmed");

// Market account layout: usdc_mint is at offset 57 (8 disc + 8+8+8+1+8+8+8).
function usdcMintOf(data: Buffer): PublicKey { return new PublicKey(data.subarray(57, 57 + 32)); }

async function main() {
  console.log("funding", targetPk.toBase58(), "from authority", authority.publicKey.toBase58());

  // airdrop SOL for fees
  try {
    const sig = await conn.requestAirdrop(targetPk, 1_000_000_000);
    await conn.confirmTransaction(sig, "confirmed");
    console.log("airdropped 1 SOL:", sig);
  } catch (e) { console.log("SOL airdrop skipped (rate-limited?) —", String((e as any)?.message ?? e).slice(0, 80)); }

  // discover the demo mint from the on-chain open markets
  const accts = await conn.getProgramAccounts(CONFIG.programId, { filters: [{ dataSize: 175 }] });
  if (!accts.length) { console.error("no markets on-chain — seed some first (scripts/seed-devnet.ts)"); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  const open = accts.find(({ account }) => {
    const dv = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
    const ws = Number(dv.getBigInt64(41, true)), we = Number(dv.getBigInt64(49, true)), status = dv.getUint8(155);
    return status === 0 && ws <= now && now < we;
  }) ?? accts[0];
  const mint = usdcMintOf(open.account.data as Buffer);
  console.log("demo USDC mint:", mint.toBase58());

  const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, targetPk);
  await mintTo(conn, authority, mint, ata.address, authority.publicKey, 1_000_000_000); // 1000 USDC
  console.log(`minted 1000 test USDC to ${ata.address.toBase58()}`);
  console.log("done — connect this wallet in the browser and deposit/claim");
}

main().catch((e) => { console.error(e); process.exit(1); });
