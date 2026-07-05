// Validate the hand-generated IDL by building a real Anchor Program from it and
// exercising the exact coders the keeper relies on. Run: node scripts/validate-idl.mjs
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";

const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url)));
const provider = new AnchorProvider(
  new Connection("http://localhost:8899", "confirmed"),
  new Wallet(Keypair.generate()),
  { commitment: "confirmed" }
);

// 1) Constructing the Program validates the whole IDL and builds instruction/account coders.
const program = new Program(idl, provider);
console.log("✓ Program constructed from IDL; programId =", program.programId.toBase58());

// 2) The account coder must know Market (keeper does program.account.market.fetch/.all).
const marketSize = program.account.market.size;
console.log("✓ Market account coder present; on-chain size =", marketSize, "bytes");
// Sanity: 8 disc + (8+8+1+8+8+8) + 32*3 + 2 + 1 + 1 + 8 + 8 + 1 + 1 = 167 (= 8 + Market::INIT_SPACE)
if (marketSize !== 167) throw new Error(`unexpected Market size ${marketSize}, expected 167`);

// 3) Round-trip a Market account through the coder (encode → decode) to prove the layout.
const sample = {
  fixtureId: new BN(99001), oddKey: new BN(1), side: 1, level: new BN(6000),
  windowStart: new BN(1000), windowEnd: new BN(2000),
  usdcMint: PublicKey.default, vault: PublicKey.default, authority: PublicKey.default,
  feeBps: 500, status: 0, outcome: 0, totalYes: new BN(0), totalNo: new BN(0),
  bump: 255, vaultBump: 254,
};
const encoded = await program.coder.accounts.encode("market", sample);
const decoded = program.coder.accounts.decode("market", encoded);
for (const k of ["fixtureId", "oddKey", "side", "level", "windowStart", "windowEnd", "status", "totalYes", "totalNo"]) {
  const a = decoded[k]?.toString?.() ?? String(decoded[k]);
  const b = sample[k]?.toString?.() ?? String(sample[k]);
  if (a !== b) throw new Error(`Market field ${k} round-trip mismatch: ${a} !== ${b}`);
}
console.log("✓ Market encode/decode round-trip matches on all keeper-read fields");

// 4) Build the resolve_market instruction the keeper submits (proves ix discriminator + args + accounts).
const ix = await program.methods
  .resolveMarket(new BN(6000), Buffer.from([1, 2, 3]))
  .accounts({
    resolver: provider.wallet.publicKey,
    market: PublicKey.default,
    txlineProgram: new PublicKey("11111111111111111111111111111111"),
  })
  .instruction();
console.log("✓ resolve_market instruction built; data disc =", [...ix.data.slice(0, 8)].join(","), "len =", ix.data.length);

console.log("\nALL IDL CHECKS PASSED");
