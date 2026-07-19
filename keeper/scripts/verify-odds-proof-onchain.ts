/**
 * Verify a GENUINE TxLINE odds Merkle proof on-chain, end to end.
 *
 * Flow: take a published OddsValidation payload (odds + summary + subTreeProof + mainTreeProof),
 * borsh-encode it as the program's `OddsProofPayload`, and call resolve_market with the REAL
 * txoracle validator (TXLINE_VALIDATOR_ID) plus its `daily_odds_merkle_roots` account. The program
 * CPIs into txoracle `validate_odds`; if the Merkle proof verifies against the committed roots the
 * instruction succeeds and the market resolves — so a successful tx IS the proof of verification.
 *
 * Borsh layout mirrors signal_markets/src/lib.rs exactly (field ORDER is what matters):
 *   OddsProofPayload { ts i64, odds Odds, summary OddsBatchSummary, sub_tree Vec<ProofNode>, main_tree Vec<ProofNode> }
 *   Odds { fixture_id i64, message_id String, ts i64, bookmaker String, bookmaker_id i32,
 *          super_odds_type String, game_state Option<String>, in_running bool,
 *          market_parameters Option<String>, market_period Option<String>,
 *          price_names Vec<String>, prices Vec<i32> }
 *   OddsBatchSummary { fixture_id i64, update_stats { update_count u32, min_ts i64, max_ts i64 }, root [u8;32] }
 *   ProofNode { hash [u8;32], is_right_sibling bool }
 */
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { buildProgram } from "../src/resolver.js";
import { CONFIG } from "../src/config.js";

const REAL_VALIDATOR = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
// txoracle's committed odds batch roots — the account TxLINE's insert_batch_root writes every 5 min.
const ODDS_ROOTS = new PublicKey(process.env.ODDS_ROOTS ?? "HFYD3hVqavHeRUkBdo7vDHA8HTGhMLY2TsXvL536kGoV");
const HOLD = 0;

// ---- minimal borsh writers ----
const i64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const bool = (v: boolean) => Buffer.from([v ? 1 : 0]);
const str = (s: string) => { const u = Buffer.from(s, "utf8"); return Buffer.concat([u32(u.length), u]); };
const optStr = (s: string | null | undefined) => (s == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(s)]));
const arr32 = (a: number[]) => { if (a.length !== 32) throw new Error(`expected 32 bytes, got ${a.length}`); return Buffer.from(a); };
const vec = (items: Buffer[]) => Buffer.concat([u32(items.length), ...items]);
const proofNode = (n: any) => Buffer.concat([arr32(n.hash), bool(!!n.isRightSibling)]);

function encodeOdds(o: any): Buffer {
  return Buffer.concat([
    i64(o.FixtureId), str(o.MessageId), i64(o.Ts), str(o.Bookmaker), i32(o.BookmakerId),
    str(o.SuperOddsType), optStr(o.GameState), bool(!!o.InRunning),
    optStr(o.MarketParameters), optStr(o.MarketPeriod),
    vec((o.PriceNames ?? []).map((s: string) => str(s))),
    vec((o.Prices ?? []).map((n: number) => i32(n))),
  ]);
}
function encodeSummary(s: any): Buffer {
  const us = s.updateStats;
  return Buffer.concat([i64(s.fixtureId), u32(us.updateCount), i64(us.minTimestamp), i64(us.maxTimestamp), arr32(s.oddsSubTreeRoot)]);
}
export function encodeOddsProofPayload(p: any, tsOverride?: number): Buffer {
  return Buffer.concat([
    i64(tsOverride ?? p.odds.Ts),
    encodeOdds(p.odds),
    encodeSummary(p.summary),
    vec((p.subTreeProof ?? []).map(proofNode)),
    vec((p.mainTreeProof ?? []).map(proofNode)),
  ]);
}

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: verify-odds-proof-onchain.ts <published-proof.json>");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const payload = raw.fullPayload ?? raw;
  const encoded = encodeOddsProofPayload(payload);
  console.log(`encoded OddsProofPayload: ${encoded.length} bytes (subTree ${payload.subTreeProof.length}, mainTree ${payload.mainTreeProof.length})`);

  const { program, wallet } = buildProgram();
  const now = Math.floor(Date.now() / 1000);
  // A HOLD market whose predicate the submitted value resolves (value < level -> NO), with an OPEN
  // window so resolve_market takes the in-window (proof-verifying) branch, not the timeout branch.
  const fx = new BN(24000000 + Math.floor(Math.random() * 1e5));
  const ok = new BN(0), pr = new BN(0), lvl = new BN(50000);
  const ws = new BN(now - 5), we = new BN(now + 900);
  const market = PublicKey.findProgramAddressSync([
    Buffer.from("market"), fx.toArrayLike(Buffer, "le", 8), ok.toArrayLike(Buffer, "le", 8),
    pr.toArrayLike(Buffer, "le", 8), Buffer.from([HOLD]), lvl.toArrayLike(Buffer, "le", 8), ws.toArrayLike(Buffer, "le", 8),
  ], program.programId)[0];
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  await (program.methods as any).createMarket(fx, ok, pr, HOLD, lvl, ws, we, 500)
    .accounts({ authority: wallet.publicKey, market, usdcMint: CONFIG.appUsdcMint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY }).rpc();
  console.log("market:", market.toBase58());

  // Two-stage Merkle verification is CU-hungry (stage 1 alone burned ~184k), so raise the limit —
  // the 200k default is not enough for a real proof.
  const sig = await (program.methods as any).resolveMarket(new BN(40000), encoded)
    .accounts({ resolver: wallet.publicKey, market, txlineProgram: REAL_VALIDATOR })
    .remainingAccounts([{ pubkey: ODDS_ROOTS, isSigner: false, isWritable: false }])
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc({ commitment: "confirmed" });
  console.log("\n✅ resolve_market VERIFIED A GENUINE TxLINE MERKLE PROOF ON-CHAIN");
  console.log("   tx:", sig);
  const acc: any = await program.account.market.fetch(market);
  console.log("   market status:", acc.status, "outcome:", acc.outcome, "(2 = NO / HOLD defeated)");
})().catch((e) => {
  const logs = (e as any)?.logs ?? (e as any)?.simulationResponse?.logs ?? [];
  console.error("FAILED:", (e.message || String(e)).split("\n")[0]);
  if (logs.length) console.error(logs.slice(-12).join("\n"));
  process.exit(1);
});
