// Demo/test for Step 3 (keeper bootstrap liquidity). Funds the keeper with canonical USDC (via the
// local treasury mint authority), creates a fresh two-sided HOLD test market with both pools empty,
// then runs the keeper's bootstrapMarket on it — showing each pool go 0 -> BOOTSTRAP_LIQUIDITY_USDC.
// Backend only; does not touch the running keeper. Run: npx tsx scripts/bootstrap-liquidity.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { CONFIG, log } from "../src/config.js";
import { bootstrapMarket } from "../src/bootstrap.js";

const SIDE_HOLD = 0;

const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);

async function fundKeeperUsdc(): Promise<void> {
  const t = JSON.parse(readFileSync(new URL("../.treasury.json", import.meta.url), "utf8"));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(t.treasurySecretKey));
  const ata = await getOrCreateAssociatedTokenAccount(connection, keeper, CONFIG.appUsdcMint, keeper.publicKey);
  const bal = Number((await connection.getTokenAccountBalance(ata.address)).value.amount) / 1e6;
  log.info(`keeper canonical USDC balance: ${bal}`);
  if (bal < CONFIG.bootstrapLiquidityUsdc * 4) {
    await mintTo(connection, keeper, CONFIG.appUsdcMint, ata.address, treasury, 100 * 1e6);
    log.info("minted 100 USDC to keeper (via treasury mint authority)");
  }
}

async function main() {
  log.info(`Step 3 demo — bootstrap ${CONFIG.bootstrapLiquidityUsdc} USDC/pool, keeper ${keeper.publicKey.toBase58()}`);
  await fundKeeperUsdc();

  // Fresh two-sided HOLD market on a real fixture (Argentina v Switzerland), a unique level so the
  // PDA doesn't collide with earlier runs. Created with NO deposits, so both pools start empty.
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 60;
  const windowEnd = now + 7 * 86400;
  const fixtureId = new BN(18222446);
  const oddKey = new BN(1); // draw
  const params = new BN(0);
  const level = new BN(30000 + (now % 1000)); // unique-ish

  const [market] = PublicKey.findProgramAddressSync([
    Buffer.from("market"),
    fixtureId.toArrayLike(Buffer, "le", 8), oddKey.toArrayLike(Buffer, "le", 8), params.toArrayLike(Buffer, "le", 8),
    Buffer.from([SIDE_HOLD]), level.toArrayLike(Buffer, "le", 8), new BN(windowStart).toArrayLike(Buffer, "le", 8),
  ], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);

  log.info("creating fresh HOLD test market", market.toBase58());
  await (program.methods as any)
    .createMarket(fixtureId, oddKey, params, SIDE_HOLD, level, new BN(windowStart), new BN(windowEnd), 500)
    .accounts({ authority: keeper.publicKey, market, usdcMint: CONFIG.appUsdcMint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
    .rpc();

  const before: any = await (program.account as any).market.fetch(market);
  console.log(`\nBEFORE bootstrap — Holds pool (total_yes)=${Number(before.totalYes) / 1e6}  Breaks pool (total_no)=${Number(before.totalNo) / 1e6}`);

  const sigs = await bootstrapMarket(program, keeper, market, before);

  const after: any = await (program.account as any).market.fetch(market);
  console.log(`AFTER  bootstrap — Holds pool (total_yes)=${Number(after.totalYes) / 1e6}  Breaks pool (total_no)=${Number(after.totalNo) / 1e6}`);
  console.log("\nmarket:", market.toBase58());
  console.log("bootstrap deposit signatures:", JSON.stringify(sigs, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
