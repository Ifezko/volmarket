// Final integration test for the two-sided restructure. On devnet:
//  1. create a fresh HOLD market (both pools empty),
//  2. keeper bootstraps it (Holds/Breaks pools -> 10/10),
//  3. a funded USER deposits into the Holds pool,
//  4. compute the UI's previewMultiplier from the pre-deposit pools + the user's stake,
//  5. resolve the market (Holds wins) and have the user claim,
//  6. show the real claimed payout == what the UI displayed.
// Backend only. Run: npx tsx scripts/two-sided-integration.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { CONFIG, log } from "../src/config.js";
import { bootstrapMarket } from "../src/bootstrap.js";

const SIDE_HOLD = 0, SIDE_YES = 1;
const TXLINE_PROGRAM = new PublicKey("FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse");
const USER_STAKE = 25;

// Identical to previewMultiplier() in frontend-react/src/lib/claimMarkets.ts.
function previewMultiplier(sameSide: number, opposing: number, stake: number, feeBps: number): number {
  if (stake <= 0) return 1;
  const winTotal = sameSide + stake;
  const winnings = winTotal > 0 ? (stake * opposing) / winTotal : 0;
  const fee = (winnings * feeBps) / 10000;
  return (stake + winnings - fee) / stake;
}

const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL("../.treasury.json", import.meta.url), "utf8")).treasurySecretKey));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);
const mint = CONFIG.appUsdcMint;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Ensure the keeper can bootstrap.
  const kAta = await getOrCreateAssociatedTokenAccount(connection, keeper, mint, keeper.publicKey);
  if (Number((await connection.getTokenAccountBalance(kAta.address)).value.amount) / 1e6 < 40)
    await mintTo(connection, keeper, mint, kAta.address, treasury, 100 * 1e6);

  // 1) fresh HOLD market with a short window so we can resolve via the timeout branch.
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 60, windowEnd = now + 6;
  const fixtureId = new BN(18222446), oddKey = new BN(2), params = new BN(0), level = new BN(41000 + (now % 500));
  const [market] = PublicKey.findProgramAddressSync([
    Buffer.from("market"), fixtureId.toArrayLike(Buffer, "le", 8), oddKey.toArrayLike(Buffer, "le", 8), params.toArrayLike(Buffer, "le", 8),
    Buffer.from([SIDE_HOLD]), level.toArrayLike(Buffer, "le", 8), new BN(windowStart).toArrayLike(Buffer, "le", 8),
  ], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  await (program.methods as any).createMarket(fixtureId, oddKey, params, SIDE_HOLD, level, new BN(windowStart), new BN(windowEnd), 500)
    .accounts({ authority: keeper.publicKey, market, usdcMint: mint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY }).rpc();
  log.info("created market", market.toBase58());

  // 2) keeper bootstrap -> both pools 10.
  await bootstrapMarket(program, keeper, market, await (program.account as any).market.fetch(market));
  let m: any = await (program.account as any).market.fetch(market);
  const holdsBefore = Number(m.totalYes) / 1e6, breaksBefore = Number(m.totalNo) / 1e6;
  console.log(`\nafter bootstrap: Holds=${holdsBefore}  Breaks=${breaksBefore}`);

  // 3) fund a fresh USER and deposit into the Holds pool.
  const user = Keypair.generate();
  await (async () => { const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: user.publicKey, lamports: 50_000_000 })); await provider.sendAndConfirm(t, []); })();
  const uAta = await getOrCreateAssociatedTokenAccount(connection, keeper, mint, user.publicKey);
  await mintTo(connection, keeper, mint, uAta.address, treasury, 50 * 1e6);

  // 4) the number the UI would show BEFORE the user deposits (pre-deposit pools + their stake).
  const uiMult = previewMultiplier(holdsBefore, breaksBefore, USER_STAKE, m.feeBps);
  console.log(`\nUI previewMultiplier(sameSide=${holdsBefore}, opposing=${breaksBefore}, stake=${USER_STAKE}, fee=${m.feeBps}bps) = ${uiMult.toFixed(4)}x`);
  console.log(`UI "To win" = ${(USER_STAKE * uiMult).toFixed(2)} USDC on a ${USER_STAKE} stake`);

  const [uPos] = PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer(), Buffer.from([SIDE_YES])], program.programId);
  await (program.methods as any).deposit(SIDE_YES, new BN(USER_STAKE * 1e6))
    .accounts({ user: user.publicKey, market, position: uPos, vault, userToken: uAta.address, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([user]).rpc();
  m = await (program.account as any).market.fetch(market);
  console.log(`\nafter user deposit ${USER_STAKE} into Holds: Holds=${Number(m.totalYes) / 1e6}  Breaks=${Number(m.totalNo) / 1e6}`);

  // 5) wait out the window, resolve via timeout (HOLD default -> YES = Holds wins), user claims.
  while (Math.floor(Date.now() / 1000) < windowEnd + 1) await sleep(1000);
  await (program.methods as any).resolveMarket(new BN(0), Buffer.from([]))
    .accounts({ resolver: keeper.publicKey, market, txlineProgram: TXLINE_PROGRAM }).rpc();
  m = await (program.account as any).market.fetch(market);
  console.log(`\nresolved: outcome=${m.outcome === 1 ? "YES (Holds win)" : m.outcome === 2 ? "NO (Breaks win)" : "unset"}`);

  const feeAta = getAssociatedTokenAddressSync(mint, keeper.publicKey); // market.authority == keeper
  const balBefore = Number((await getAccount(connection, uAta.address)).amount) / 1e6;
  await (program.methods as any).claim()
    .accounts({ payer: keeper.publicKey, owner: user.publicKey, market, position: uPos, vault, userToken: uAta.address, feeToken: feeAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  const balAfter = Number((await getAccount(connection, uAta.address)).amount) / 1e6;
  const claimed = +(balAfter - balBefore).toFixed(6);

  console.log(`\n=== RESULT ===`);
  console.log(`user claimed on-chain:      ${claimed.toFixed(2)} USDC`);
  console.log(`UI displayed (stake*mult):  ${(USER_STAKE * uiMult).toFixed(2)} USDC`);
  console.log(`match: ${Math.abs(claimed - USER_STAKE * uiMult) < 0.01 ? "YES ✓" : "NO ✗"}`);
  console.log(`market: ${market.toBase58()}  user: ${user.publicKey.toBase58()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
