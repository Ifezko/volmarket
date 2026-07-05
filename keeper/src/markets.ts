import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { log } from "./config.js";

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
export const SIDE_HOLD = 0, SIDE_BREAK = 1;              // Market.side
export const STATUS_OPEN = 0, STATUS_RESOLVED = 1;       // Market.status
export const OUTCOME_UNSET = 0, OUTCOME_YES = 1, OUTCOME_NO = 2; // Market.outcome

export interface WatchedMarket {
  pubkey: PublicKey;
  fixtureId: number;
  oddKey: number;      // which odd (SuperOddsType + PriceName) this market tracks
  side: number;        // SIDE_HOLD | SIDE_BREAK
  level: number;       // L: threshold in implied probability × 1000 (same scale as the settlement
                       // value — see pctToValue in txline.ts), snapped from StablePrice at open
  windowStart: number; // unix seconds
  windowEnd: number;   // unix seconds; also HOLD's challenge close
  status: number;
}

/** Pull every still-open market the keeper might need to settle, indexed by fixture. */
export async function loadMarkets(program: Program): Promise<Map<number, WatchedMarket[]>> {
  const all = await (program.account as any).market.all();
  const byFixture = new Map<number, WatchedMarket[]>();
  let open = 0;
  for (const { publicKey, account } of all) {
    if (account.status === STATUS_RESOLVED) continue;
    const m: WatchedMarket = {
      pubkey: publicKey,
      fixtureId: Number(account.fixtureId),
      oddKey: Number(account.oddKey),
      side: account.side,
      level: Number(account.level),
      windowStart: Number(account.windowStart),
      windowEnd: Number(account.windowEnd),
      status: account.status,
    };
    const arr = byFixture.get(m.fixtureId) ?? [];
    arr.push(m);
    byFixture.set(m.fixtureId, arr);
    open++;
  }
  log.info(`loaded ${open} open markets across ${byFixture.size} fixtures`);
  return byFixture;
}

/**
 * Does a single anchored update at `value` resolve this market *right now* (inside the window)?
 * Both `value` and `level` are implied probability × 1000 (see pctToValue in txline.ts), so the
 * comparison is apples-to-apples. Mirrors the program's in-window predicate exactly:
 *   BREAK → wins (YES) the moment value >= level (the line broke through).
 *   HOLD  → loses (NO) the moment value <  level (the line was defeated).
 * A `true` means "submitting this update's proof changes on-chain state", so the keeper only
 * spends a transaction when it would actually settle something. Post-window defaults
 * (BREAK→NO, HOLD→YES) are handled by the program's timeout branch, not here.
 */
export function crossingResolves(side: number, value: number, level: number): boolean {
  return side === SIDE_BREAK ? value >= level : value < level;
}

/** Wall-clock window test in unix seconds; matches the program's [windowStart, windowEnd) proof gate. */
export function inWindow(nowTs: number, m: WatchedMarket): boolean {
  return nowTs >= m.windowStart && nowTs < m.windowEnd;
}
