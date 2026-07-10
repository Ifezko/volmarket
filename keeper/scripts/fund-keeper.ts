// Top up the keeper's canonical-USDC balance so it can keep bootstrapping new markets' empty pools
// (see src/bootstrap.ts). Mints canonical app USDC to the keeper up to KEEPER_USDC_TARGET via the
// treasury mint authority (keeper/.treasury.json). Devnet operational helper — run whenever the
// keeper is low. Run: KEEPER_USDC_TARGET=500 npx tsx scripts/fund-keeper.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { CONFIG, log } from "../src/config.js";

const TARGET = Number(process.env.KEEPER_USDC_TARGET ?? 500);

async function main() {
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
  const t = JSON.parse(readFileSync(new URL("../.treasury.json", import.meta.url), "utf8"));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(t.treasurySecretKey));
  if (t.usdcMint !== CONFIG.appUsdcMint.toBase58()) throw new Error("treasury mint != CONFIG.appUsdcMint");

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const ata = await getOrCreateAssociatedTokenAccount(connection, keeper, CONFIG.appUsdcMint, keeper.publicKey);
  const have = Number((await connection.getTokenAccountBalance(ata.address)).value.amount) / 1e6;
  log.info(`keeper ${keeper.publicKey.toBase58()} has ${have} canonical USDC (target ${TARGET})`);

  if (have >= TARGET) {
    log.info("already at/above target — nothing to mint");
    return;
  }
  const topUp = Math.round((TARGET - have) * 1e6);
  await mintTo(connection, keeper, CONFIG.appUsdcMint, ata.address, treasury, topUp);
  const now = Number((await connection.getTokenAccountBalance(ata.address)).value.amount) / 1e6;
  log.info(`minted ${(topUp / 1e6).toFixed(2)} USDC — keeper now holds ${now}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
