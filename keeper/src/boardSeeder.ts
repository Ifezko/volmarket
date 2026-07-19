// Auto-create board markets for fixtures the keeper is streaming a live signal for.
//
// The board shows a fixture only if an on-chain market exists for it (grouped by fixtureId, on the
// app USDC mint). Live fixtures rotate every couple of hours as matches go in-play and end, so the
// set that HAS a market and the set that's LIVE never overlap unless something creates markets for
// the live ones. That's this module: on the first live signal for an odd we don't yet have a market
// for, the keeper opens a single HOLD market at the current demargined level. The fixture then
// appears on the board with a real chart (the same feed) and settles on that same feed at window
// end - "only live fixtures, every chart real, every settlement honest" without manual seeding.
//
// Idempotent: we only ever create one market per (fixtureId, oddKey, marketParams). The seeded set
// is primed from chain at startup, so a restart won't duplicate, and an existing market (from a
// user's own prediction or a prior run) already counts as "on the board".
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, type Connection, type Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN, type Program } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";

const HOLD = 0;
const FEE_BPS = 500;
const REAL_FIXTURE_MIN = 18_000_000; // board only renders real TxLINE fixture ids (frontend liveFixtures.ts)
const OU_DEFAULT_LINE = 250; // 2.5 goals ×100 - the O/U line the board shows by default (liveFixtures.ts)
// How long a board market stays open. Env-overridable so the expiry/re-seed cycle can be exercised
// in seconds instead of hours (see scripts/verify-board-reseed.ts).
const MATCH_SECS = Number(process.env.BOARD_MARKET_SECS ?? 3 * 3600);
const GAS_FLOOR_LAMPORTS = 60_000_000; // 0.06 SOL - don't seed if the keeper wallet is this low
const AUTO = (process.env.AUTO_CREATE_MARKETS ?? "true") !== "false";

// (fixtureId:oddKey:marketParams) -> the windowEnd (unix secs) of the board market we have for it.
//
// Storing the EXPIRY, not just a flag, is what keeps the board alive: a board market only stays open
// for MATCH_SECS, and when it lapses the fixture would otherwise have no open market and silently
// drop off the live-only board until the keeper restarted (the old Set never forgot the key). By
// keying on expiry, a lapsed entry stops counting as "already seeded" and the next signal re-opens a
// fresh market for a fixture that is still streaming.
const seeded = new Map<string, number>();
const skey = (f: number, o: number, p: number) => `${f}:${o}:${p}`;

/** True if we hold a board market for this odd that is still open at `now`. */
function hasLiveSeed(k: string, now: number): boolean {
  const expiresAt = seeded.get(k);
  return expiresAt != null && expiresAt > now;
}

/**
 * Prime/refresh the seeded map from the markets currently loaded from chain. Safe to call on every
 * market refresh, not just at startup - entries are merged by latest expiry, so a freshly created
 * market is never forgotten, while lapsed ones age out on their own.
 */
export function primeSeeded(
  markets: { fixtureId: number; oddKey: number; marketParams: number; windowEnd: number }[],
): void {
  for (const m of markets) {
    const k = skey(m.fixtureId, m.oddKey, m.marketParams);
    seeded.set(k, Math.max(seeded.get(k) ?? 0, m.windowEnd));
  }
  // Drop entries whose market has lapsed so the map can't grow without bound across a long run.
  const now = Math.floor(Date.now() / 1000);
  let live = 0;
  for (const [k, exp] of seeded) (exp > now ? live++ : seeded.delete(k));
  log.info(`board-seed: ${live} live (fixture,odd,params) seeded from chain; auto-create ${AUTO ? "ON" : "OFF"}`);
}

/** Only the odds the board actually renders: 1X2 (params 0) and the default O/U line (2.5). */
function seedEligible(oddKey: number, marketParams: number): boolean {
  if (oddKey === 0 || oddKey === 1 || oddKey === 2) return marketParams === 0;
  if (oddKey === 3 || oddKey === 4) return marketParams === OU_DEFAULT_LINE;
  return false;
}

function marketPda(program: Program, fixtureId: number, oddKey: number, params: number, level: number, windowStart: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      new BN(fixtureId).toArrayLike(Buffer, "le", 8),
      new BN(oddKey).toArrayLike(Buffer, "le", 8),
      new BN(params).toArrayLike(Buffer, "le", 8),
      Buffer.from([HOLD]),
      new BN(level).toArrayLike(Buffer, "le", 8),
      new BN(windowStart).toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  )[0];
}

/**
 * Ensure a board market exists for this streaming odd. Returns true only when it CREATED a new
 * market (so the caller can refresh its watched-markets view). No-op (returns false) if auto-create
 * is off, the odd isn't board-rendered, the fixture isn't a real TxLINE id, we've already seeded it,
 * or the keeper is low on gas. `levelRaw` is the demargined % ×1000 (the on-chain level scale).
 */
export async function ensureBoardMarket(
  program: Program,
  keeper: Keypair,
  connection: Connection,
  fixtureId: number,
  oddKey: number,
  marketParams: number,
  levelRaw: number,
): Promise<boolean> {
  if (!AUTO) return false;
  if (fixtureId < REAL_FIXTURE_MIN) return false;
  if (!seedEligible(oddKey, marketParams)) return false;
  if (!Number.isFinite(levelRaw) || levelRaw <= 0 || levelRaw >= 100_000) return false;
  const k = skey(fixtureId, oddKey, marketParams);
  const now = Math.floor(Date.now() / 1000);
  // Only skip while we hold a market that is STILL OPEN. Once it lapses this goes false and the
  // fixture gets a fresh market, so a still-streaming match never falls off the board.
  if (hasLiveSeed(k, now)) return false;
  // Reserve SYNCHRONOUSLY, before any await, so two overlapping events for the same odd can't both
  // pass the check and double-create. Reserved for the window we're about to open; on any early-out
  // below we release it so a later signal retries.
  seeded.set(k, now + MATCH_SECS);

  let bal = 0;
  try {
    bal = await connection.getBalance(keeper.publicKey, "confirmed");
  } catch {
    seeded.delete(k);
    return false; // can't confirm gas - skip this tick, retry on the next signal
  }
  if (bal < GAS_FLOOR_LAMPORTS) {
    seeded.delete(k);
    log.warn(`board-seed: keeper low on SOL (${(bal / 1e9).toFixed(3)}), skipping fixture ${fixtureId} odd ${oddKey}`);
    return false;
  }

  const level = Math.round(levelRaw);
  const market = marketPda(program, fixtureId, oddKey, marketParams, level, now);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  try {
    if (await connection.getAccountInfo(market)) return false; // same-window market already there
    const sig: string = await (program.methods as any)
      .createMarket(new BN(fixtureId), new BN(oddKey), new BN(marketParams), HOLD, new BN(level), new BN(now), new BN(now + MATCH_SECS), FEE_BPS)
      .accounts({
        authority: keeper.publicKey,
        market,
        usdcMint: CONFIG.appUsdcMint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    log.info(`board-seed: opened fixture ${fixtureId} oddKey ${oddKey} params ${marketParams} level ${(level / 1000).toFixed(1)}% -> ${market.toBase58()} (${sig.slice(0, 8)})`);
    return true;
  } catch (e) {
    seeded.delete(k); // transient failure - let the next signal retry
    log.error(`board-seed: create failed fixture ${fixtureId} odd ${oddKey}:`, (e as Error).message);
    return false;
  }
}
