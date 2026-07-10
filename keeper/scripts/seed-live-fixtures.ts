// Seed a few OPEN devnet markets from REAL TxLINE fixture IDs — the "bridge to live" step.
// Unlike seed-devnet.ts (synthetic 99xxx ids + a throwaway mock mint), this pulls real fixtures
// from the already-proven flow (guestStart -> subscribe -> activate -> GET /api/fixtures/snapshot)
// and calls create_market with those real FixtureIds, on the canonical app USDC mint so the
// markets are actually usable (users can predict real USDC on them).
//
// Backend only. No deposits/minting — markets render on the board at $0 volume until someone bets.
// NOTE: team names on the board are still derived from the numeric fixtureId (pseudoTeams in
// frontend-react/src/volmarket/liveFixtures.ts), so the real names below are logged here for
// reference but won't appear on the board without a separate frontend change.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CONFIG, log } from "../src/config.js";
import { ensureActivated, authHeaders } from "../src/auth.js";

const HOLD = 0, BREAK = 1;
// The canonical app USDC mint (frontend-react/src/lib/funds.ts USDC_MINT) — use it so these
// markets accept the same USDC users deposit. Overridable via APP_USDC_MINT.
const APP_USDC_MINT = new PublicKey(process.env.APP_USDC_MINT ?? "3aakQUJ6vvWphAr18ZoAJfoHs3w148tWJmKsgsnUj12q");
const MAX_MARKETS = Number(process.env.MAX_MARKETS ?? 5);

interface Fixture { FixtureId: number; Participant1: string; Participant2: string; Competition: string }

const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);

const now = Math.floor(Date.now() / 1000);
const windowStart = now - 60;
const windowEnd = now + 7 * 86400; // open for a week

function marketPda(fixture: number, oddKey: number, params: number, side: number, level: number): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("market"),
    new BN(fixture).toArrayLike(Buffer, "le", 8),
    new BN(oddKey).toArrayLike(Buffer, "le", 8),
    new BN(params).toArrayLike(Buffer, "le", 8),
    Buffer.from([side]),
    new BN(level).toArrayLike(Buffer, "le", 8),
    new BN(windowStart).toArrayLike(Buffer, "le", 8),
  ], program.programId)[0];
}

async function main() {
  log.info("seed-live-fixtures: activating TxLINE session (guestStart -> subscribe -> activate)…");
  await ensureActivated(keeper);

  const url = `${CONFIG.txlineBaseUrl}/api/fixtures/snapshot`;
  log.info("GET", url);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`fixtures/snapshot ${res.status}: ${await res.text()}`);
  const fixtures = (await res.json()) as Fixture[];
  log.info(`snapshot returned ${fixtures.length} fixtures`);

  // Distinct real fixtures with both participants named. Prefer World Cup, then take a handful.
  const seen = new Set<number>();
  const chosen: Fixture[] = [];
  for (const f of [...fixtures].sort((a, b) => (a.Competition === "World Cup" ? -1 : 1))) {
    if (!f.FixtureId || !f.Participant1 || !f.Participant2 || seen.has(f.FixtureId)) continue;
    seen.add(f.FixtureId);
    chosen.push(f);
    if (chosen.length >= 3) break; // 3 fixtures -> up to ~5 markets below
  }
  if (!chosen.length) throw new Error("no named fixtures in snapshot");

  console.log("\nReal fixtures selected:");
  chosen.forEach((f) => console.log(`  #${f.FixtureId}  ${f.Participant1} v ${f.Participant2}  (${f.Competition})`));

  // Two markets on the first fixture (home BREAK + away HOLD), one each on the next two — 4 total,
  // capped by MAX_MARKETS. odd_key: 0=1X2 home, 2=1X2 away, 3=Over, 4=Under.
  const specs: { fx: Fixture; oddKey: number; params: number; side: number; level: number; label: string }[] = [];
  chosen.forEach((f, i) => {
    specs.push({ fx: f, oddKey: 0, params: 0, side: BREAK, level: 52000, label: `${f.Participant1} (home) breaks 52%` });
    if (i === 0) specs.push({ fx: f, oddKey: 2, params: 0, side: HOLD, level: 41000, label: `${f.Participant2} (away) holds 41%` });
  });

  const created: { fixtureId: number; teams: string; label: string; market: string; sig: string }[] = [];
  for (const s of specs.slice(0, MAX_MARKETS)) {
    const market = marketPda(s.fx.FixtureId, s.oddKey, s.params, s.side, s.level);
    if (await connection.getAccountInfo(market)) {
      console.log(`  (exists, skipping) ${market.toBase58()}`);
      continue;
    }
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
    const sig: string = await (program.methods as any)
      .createMarket(new BN(s.fx.FixtureId), new BN(s.oddKey), new BN(s.params), s.side, new BN(s.level), new BN(windowStart), new BN(windowEnd), 500)
      .accounts({ authority: keeper.publicKey, market, usdcMint: APP_USDC_MINT, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .rpc();
    created.push({ fixtureId: s.fx.FixtureId, teams: `${s.fx.Participant1} v ${s.fx.Participant2}`, label: s.label, market: market.toBase58(), sig });
    console.log(`  created  #${s.fx.FixtureId}  ${s.label}  ->  ${market.toBase58()}`);
  }

  console.log(`\nDone. Created ${created.length} market(s) on real fixture ids using mint ${APP_USDC_MINT.toBase58()}.`);
  console.log(JSON.stringify(created, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
