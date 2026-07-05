// Seed a few OPEN markets on devnet so the frontend's live panel has real, testable data.
// Creates a mock USDC mint, then several markets (varied 1X2 / Over-Under, HOLD/BREAK) with a
// week-long window and small YES/NO stake. Idempotent-ish: windowStart varies per run, so re-runs
// create fresh markets rather than colliding. Prints each market pubkey.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const HOLD = 0, BREAK = 1, YES = 1, NO = 2;

const secret = JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);

const now = Math.floor(Date.now() / 1000);
const windowStart = now - 60;
const windowEnd = now + 7 * 86400; // open for a week

// odd_key: 0=1X2 home, 1=1X2 draw, 2=1X2 away, 3=OU over, 4=OU under
const SPECS = [
  { fixture: 99101, oddKey: 0, params: 0,   side: BREAK, level: 55000, yes: 8_000_000, no: 5_000_000 },
  { fixture: 99101, oddKey: 2, params: 0,   side: HOLD,  level: 40000, yes: 3_000_000, no: 6_000_000 },
  { fixture: 99102, oddKey: 3, params: 250, side: BREAK, level: 50000, yes: 7_000_000, no: 2_000_000 }, // Over 2.5
  { fixture: 99102, oddKey: 4, params: 250, side: HOLD,  level: 50000, yes: 4_000_000, no: 4_000_000 }, // Under 2.5
];

function marketPda(s: typeof SPECS[number]): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("market"),
    new BN(s.fixture).toArrayLike(Buffer, "le", 8),
    new BN(s.oddKey).toArrayLike(Buffer, "le", 8),
    new BN(s.params).toArrayLike(Buffer, "le", 8),
    Buffer.from([s.side]),
    new BN(s.level).toArrayLike(Buffer, "le", 8),
    new BN(windowStart).toArrayLike(Buffer, "le", 8),
  ], program.programId)[0];
}

async function main() {
  console.log("wallet:", wallet.publicKey.toBase58(), "program:", program.programId.toBase58());
  const usdcMint = await createMint(connection, wallet, wallet.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, usdcMint, wallet.publicKey);
  await mintTo(connection, wallet, usdcMint, ata.address, wallet.publicKey, 1_000_000_000);
  console.log("mock USDC mint:", usdcMint.toBase58());

  for (const s of SPECS) {
    const market = marketPda(s);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
    await program.methods
      .createMarket(new BN(s.fixture), new BN(s.oddKey), new BN(s.params), s.side, new BN(s.level), new BN(windowStart), new BN(windowEnd), 500)
      .accounts({ authority: wallet.publicKey, market, usdcMint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .rpc();
    for (const [side, amount] of [[YES, s.yes], [NO, s.no]] as const) {
      const [position] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), market.toBuffer(), wallet.publicKey.toBuffer(), Buffer.from([side])], program.programId);
      await program.methods.deposit(side, new BN(amount))
        .accounts({ user: wallet.publicKey, market, position, vault, userToken: ata.address, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .rpc();
    }
    const lbl = ["1X2 home", "1X2 draw", "1X2 away", "Over", "Under"][s.oddKey];
    console.log(`  fixture #${s.fixture} · ${lbl}${s.params ? " " + (s.params / 100).toFixed(1) : ""} · ${s.side === BREAK ? "BREAK" : "HOLD"} @ ${(s.level / 1000).toFixed(1)}%  ->  ${market.toBase58()}`);
  }
  console.log("done — refresh the frontend's 'Live on devnet' panel");
}

main().catch((e) => { console.error(e); process.exit(1); });
