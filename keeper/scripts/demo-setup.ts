// Demo setup on devnet: create a fresh USDC mint, open a BREAK market on the 1X2 home outcome,
// and deposit on both YES and NO. Writes .demo-state.json for demo-claim.ts and prints tx sigs.
// The market is tuned so the keeper's mock feed (npm run mock) crosses the level and resolves YES.
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const SIDE_HOLD = 0, SIDE_BREAK = 1;   // Market.side
const YES = 1, NO = 2;                 // Position.side

const secret = JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);

// Market params — a BREAK market on 1X2 home (oddKey 0). level 45000 = 45.000% implied prob;
// the mock feed's home prob starts ~52% and immediately crosses -> resolves YES.
const fixtureId = new BN(99001);
const oddKey = new BN(0);           // 1X2 home (part1)
const marketParams = new BN(0);     // no line for 1X2
const side = SIDE_BREAK;
const level = new BN(45000);
const now = Math.floor(Date.now() / 1000);
const windowStart = new BN(now - 60);
const windowEnd = new BN(now + 3600);
const feeBps = 500;                 // 5%

function marketPda(): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("market"),
    fixtureId.toArrayLike(Buffer, "le", 8),
    oddKey.toArrayLike(Buffer, "le", 8),
    marketParams.toArrayLike(Buffer, "le", 8),
    Buffer.from([side]),
    level.toArrayLike(Buffer, "le", 8),
    windowStart.toArrayLike(Buffer, "le", 8),
  ], program.programId)[0];
}

async function main() {
  console.log("deployer / keeper wallet:", wallet.publicKey.toBase58());
  console.log("program:", program.programId.toBase58());

  // 1) fresh mock-USDC mint (6 decimals), deployer is mint authority
  const usdcMint = await createMint(connection, wallet, wallet.publicKey, null, 6);
  console.log("USDC mint:", usdcMint.toBase58());

  const market = marketPda();
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);

  // 2) create the market
  const createSig = await program.methods
    .createMarket(fixtureId, oddKey, marketParams, side, level, windowStart, windowEnd, feeBps)
    .accounts({
      authority: wallet.publicKey,
      market,
      usdcMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("create_market tx:", createSig);
  console.log("market:", market.toBase58());

  // 3) fund the deployer with mock USDC, then deposit on both sides
  const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, usdcMint, wallet.publicKey);
  await mintTo(connection, wallet, usdcMint, ata.address, wallet.publicKey, 100_000_000); // 100 USDC

  const depositSigs: Record<string, string> = {};
  for (const [sideName, sideVal, amount] of [["YES", YES, 10_000_000], ["NO", NO, 4_000_000]] as const) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), wallet.publicKey.toBuffer(), Buffer.from([sideVal])],
      program.programId
    );
    const sig = await program.methods
      .deposit(sideVal, new BN(amount))
      .accounts({
        user: wallet.publicKey,
        market,
        position,
        vault,
        userToken: ata.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    depositSigs[sideName] = sig;
    console.log(`deposit ${sideName} (${amount / 1e6} USDC) tx:`, sig);
  }

  const m: any = await (program.account as any).market.fetch(market);
  console.log("market totals — YES:", Number(m.totalYes) / 1e6, "USDC, NO:", Number(m.totalNo) / 1e6, "USDC");

  const state = {
    programId: program.programId.toBase58(),
    market: market.toBase58(),
    vault: vault.toBase58(),
    usdcMint: usdcMint.toBase58(),
    ata: ata.address.toBase58(),
    fixtureId: fixtureId.toNumber(),
    oddKey: oddKey.toNumber(),
    marketParams: marketParams.toNumber(),
    side,
    level: level.toNumber(),
    winningPositionSide: YES, // BREAK crosses -> YES wins
    sigs: { create: createSig, deposits: depositSigs },
  };
  writeFileSync(new URL("../.demo-state.json", import.meta.url), JSON.stringify(state, null, 2));
  console.log("\nwrote .demo-state.json — now run `npm run mock` to resolve, then demo-claim.ts");
}

main().catch((e) => { console.error(e); process.exit(1); });
