import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { log } from "./config.js";

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
export const SIDE_HOLD = 0, SIDE_BREAK = 1;              // Market.side
export const STATUS_OPEN = 0, STATUS_RESOLVED = 1;       // Market.status
export const OUTCOME_UNSET = 0, OUTCOME_YES = 1, OUTCOME_NO = 2; // Market.outcome

/**
 * The odd outcomes we expose as signal markets — the FEATURED list — keyed by the on-chain
 * market.odd_key. Confirmed against TxLINE live payloads: the keeper matches a market to a feed
 * odds record by SuperOddsType AND MarketParameters, then reads Pct[] at the index whose
 * PriceNames[] entry equals this outcome's `label`.
 *
 * Featured: 1X2 and Over/Under only. BTTS ("both teams score") is intentionally EXCLUDED — its
 * SuperOddsType is not served by the TxLINE feed right now. Re-add it here (and unhide it in the
 * frontend) once the feed carries it.
 */
export interface OddOutcome {
  superOddsType: string; // TxLINE SuperOddsType
  label: string;         // exact PriceNames[] string this outcome settles on
  group: string;         // UI grouping
}
export const ODD_OUTCOMES: Record<number, OddOutcome> = {
  0: { superOddsType: "1X2_PARTICIPANT_RESULT", label: "part1", group: "Match result" }, // home
  1: { superOddsType: "1X2_PARTICIPANT_RESULT", label: "draw", group: "Match result" }, // draw
  2: { superOddsType: "1X2_PARTICIPANT_RESULT", label: "part2", group: "Match result" }, // away
  3: { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", label: "over", group: "Over/Under" },
  4: { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", label: "under", group: "Over/Under" },
  // BTTS ("both teams score") intentionally omitted — not in the TxLINE feed at present.
};
export function oddOutcome(oddKey: number): OddOutcome | null {
  return ODD_OUTCOMES[oddKey] ?? null;
}

export interface WatchedMarket {
  pubkey: PublicKey;
  fixtureId: number;
  oddKey: number;      // selects SuperOddsType + outcome (see ODD_OUTCOMES)
  marketParams: number;// SuperOddsType params: Over/Under goal line × 100 (0 if none, e.g. 1X2).
                       // Part of the market identity — different lines are different markets.
  authority: PublicKey;// market creator; keeper-authored markets are board display shells, not bets
  side: number;        // SIDE_HOLD | SIDE_BREAK
  level: number;       // L: threshold in implied probability × 1000 (same scale as the settlement
                       // value — see pctToValue in txline.ts), snapped from StablePrice at open
  windowStart: number; // unix seconds
  windowEnd: number;   // unix seconds; also HOLD's challenge close
  status: number;
}

/**
 * One raw `market.all()` scan. Exposed separately because that call is a `getProgramAccounts` —
 * far and away the heaviest RPC request the keeper makes, and the first thing a provider throttles.
 * Callers that need both the watched-market view AND the raw accounts (the refresh loop, which also
 * bootstraps liquidity) should scan ONCE via this and pass the result into both, rather than each
 * doing its own scan.
 */
export async function loadMarketAccounts(program: Program): Promise<{ publicKey: PublicKey; account: any }[]> {
  return await (program.account as any).market.all();
}

/**
 * Pull every still-open market the keeper might need to settle, indexed by fixture. Pass `accts` to
 * reuse a scan already done this tick instead of paying for another getProgramAccounts.
 */
export async function loadMarkets(
  program: Program,
  accts?: { publicKey: PublicKey; account: any }[],
): Promise<Map<number, WatchedMarket[]>> {
  const all = accts ?? (await loadMarketAccounts(program));
  const byFixture = new Map<number, WatchedMarket[]>();
  let open = 0;
  for (const { publicKey, account } of all) {
    if (account.status === STATUS_RESOLVED) continue;
    const m: WatchedMarket = {
      pubkey: publicKey,
      fixtureId: Number(account.fixtureId),
      oddKey: Number(account.oddKey),
      marketParams: Number(account.marketParams),
      authority: account.authority,
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
