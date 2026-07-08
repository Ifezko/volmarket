// End-to-end proof that the keeper autonomously pays out winners on the *upgraded* devnet
// program: a separate `user` wallet deposits the winning side, the keeper resolves the market,
// then the keeper (a DIFFERENT signer) claims the payout FOR the user — the user never signs
// the claim. Verifies the permissionless payer/owner split and that funds land in the user's
// account, not the keeper's. Run: npx tsx scripts/verify-keeper-claim.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { CONFIG } from "../src/config.js";
import { resolveMarket } from "../src/resolver.js";
import { claimWinners } from "../src/claimer.js";

const SIDE_HOLD = 0; // HOLD → default (timeout) outcome is YES, so we can settle without a CPI proof
const YES = 1, NO = 2;
const TIMEOUT_PROOF = { value: 0, proofBytes: Buffer.alloc(0), accounts: [] };

const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);

const usdc = async (ata: PublicKey) => Number((await connection.getTokenAccountBalance(ata)).value.amount) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const user = Keypair.generate(); // the winner — will NOT sign the claim
  console.log("keeper (payer):", keeper.publicKey.toBase58());
  console.log("user   (owner):", user.publicKey.toBase58());

  // fund the user just enough to sign its own deposit + hold a position/ATA
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: user.publicKey, lamports: 60_000_000 }),
  );
  await provider.sendAndConfirm(fund, []);

  const usdcMint = await createMint(connection, keeper, keeper.publicKey, null, 6);
  const userAta = (await getOrCreateAssociatedTokenAccount(connection, keeper, usdcMint, user.publicKey)).address;
  const keeperAta = (await getOrCreateAssociatedTokenAccount(connection, keeper, usdcMint, keeper.publicKey)).address;
  await mintTo(connection, keeper, usdcMint, userAta, keeper, 100_000_000); // 100 USDC to user
  await mintTo(connection, keeper, usdcMint, keeperAta, keeper, 100_000_000); // 100 USDC to keeper (loser pool)

  // HOLD market, window already open and closing in ~9s so the timeout branch settles it YES
  const now = Math.floor(Date.now() / 1000);
  const fixtureId = new BN(90000 + (now % 9000));
  const oddKey = new BN(0), marketParams = new BN(0), level = new BN(50000);
  const windowStart = new BN(now - 30), windowEnd = new BN(now + 9), feeBps = 500;

  const [market] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      fixtureId.toArrayLike(Buffer, "le", 8),
      oddKey.toArrayLike(Buffer, "le", 8),
      marketParams.toArrayLike(Buffer, "le", 8),
      Buffer.from([SIDE_HOLD]),
      level.toArrayLike(Buffer, "le", 8),
      windowStart.toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  const [userPos] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer(), Buffer.from([YES])],
    program.programId,
  );
  const [keeperPos] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), keeper.publicKey.toBuffer(), Buffer.from([NO])],
    program.programId,
  );

  await program.methods
    .createMarket(fixtureId, oddKey, marketParams, SIDE_HOLD, level, windowStart, windowEnd, feeBps)
    .accounts({ authority: keeper.publicKey, market, usdcMint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any)
    .rpc();
  console.log("market created:", market.toBase58());

  // user deposits the winning YES side (user signs); keeper deposits NO (the losing pool)
  await program.methods
    .deposit(YES, new BN(40_000_000))
    .accounts({ user: user.publicKey, market, position: userPos, vault, userToken: userAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
    .signers([user])
    .rpc();
  await program.methods
    .deposit(NO, new BN(60_000_000))
    .accounts({ user: keeper.publicKey, market, position: keeperPos, vault, userToken: keeperAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
    .rpc();
  console.log("deposits: user YES 40, keeper NO 60");

  console.log("waiting for window to close…");
  await sleep(11_000);

  await resolveMarket(program, market, TIMEOUT_PROOF as any);
  const m: any = await (program.account as any).market.fetch(market);
  console.log("resolved outcome:", m.outcome, "(1=YES,2=NO)");
  if (m.outcome !== YES) throw new Error("market did not resolve YES — cannot verify claim");

  const userBefore = await usdc(userAta);
  const keeperBefore = await usdc(keeperAta);

  // THE TEST: keeper pays out the user's winning position. User never signs this.
  await claimWinners(program, market);

  const userAfter = await usdc(userAta);
  const keeperAfter = await usdc(keeperAta);
  const pos: any = await (program.account as any).position.fetch(userPos);

  console.log(`\nuser USDC:   ${userBefore} -> ${userAfter}  (+${(userAfter - userBefore).toFixed(6)})`);
  console.log(`keeper USDC: ${keeperBefore} -> ${keeperAfter}  (delta ${(keeperAfter - keeperBefore).toFixed(6)})`);
  console.log("user position.claimed:", pos.claimed);

  // stake 40 + winnings(pro-rata of losing 60, only YES staked so all 60) - 5% fee = 40 + 60 - 3 = 97
  const gained = userAfter - userBefore;
  const ok = pos.claimed === true && gained > 40 && Math.abs(keeperAfter - keeperBefore - 3) < 0.001;
  console.log(ok
    ? `\n✅ PASS — keeper autonomously paid the user ${gained.toFixed(2)} USDC (fee 3 USDC to authority); user never signed.`
    : `\n❌ FAIL — unexpected balances/flags.`);
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
