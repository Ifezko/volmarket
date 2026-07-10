// One-shot: run the keeper's bootstrap pass over every currently-open market (exactly what the
// keeper does at startup and on each refresh) — seeds the empty pool of any canonical-mint market
// so the board's markets are two-sided. Useful to bootstrap existing markets without leaving the
// full keeper loop running. Run: npx tsx scripts/bootstrap-all.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { CONFIG, log } from "../src/config.js";
import { bootstrapOpenMarkets } from "../src/bootstrap.js";

async function main() {
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
  const program = new Program(idl, provider);
  log.info(`bootstrap-all: seeding empty pools at ${CONFIG.bootstrapLiquidityUsdc} USDC/pool (keeper ${keeper.publicKey.toBase58()})`);
  await bootstrapOpenMarkets(program, keeper, connection);
  log.info("bootstrap-all: done");
}

main().catch((e) => { console.error(e); process.exit(1); });
