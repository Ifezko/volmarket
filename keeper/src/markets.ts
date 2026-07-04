import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { log } from "./config.js";

// mirror the on-chain u8 constants
export const CMP_LTE = 0, CMP_GTE = 1, CMP_EQ = 2;
export const STATUS_OPEN = 0, STATUS_LOCKED = 1, STATUS_RESOLVED = 2;
export const MARKET_SCORE = 0, MARKET_ODDS_THRESHOLD = 1, MARKET_ODDS_MOVEMENT = 2;
export const RES_DETERMINISTIC = 0, RES_OPTIMISTIC = 1;

export interface Predicate {
  statKey: number;
  comparator: number;
  value: number;
  windowStart: number;
  windowEnd: number;
}

export interface WatchedMarket {
  pubkey: PublicKey;
  fixtureId: number;
  marketType: number;
  resolutionMode: number;
  status: number;
  deadline: number;
  predicate: Predicate;
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
      marketType: account.marketType,
      resolutionMode: account.resolutionMode,
      status: account.status,
      deadline: Number(account.deadline),
      predicate: {
        statKey: account.predicate.statKey,
        comparator: account.predicate.comparator,
        value: Number(account.predicate.value),
        windowStart: Number(account.predicate.windowStart),
        windowEnd: Number(account.predicate.windowEnd),
      },
    };
    const arr = byFixture.get(m.fixtureId) ?? [];
    arr.push(m);
    byFixture.set(m.fixtureId, arr);
    open++;
  }
  log.info(`loaded ${open} open markets across ${byFixture.size} fixtures`);
  return byFixture;
}

/** Same predicate check the program runs — lets the keeper only act when it would change state. */
export function evaluatePredicate(value: number, p: Predicate): boolean {
  switch (p.comparator) {
    case CMP_LTE: return value <= p.value;
    case CMP_GTE: return value >= p.value;
    case CMP_EQ: return value === p.value;
    default: return false;
  }
}

export function inWindow(nowMinuteOrTs: number, p: Predicate): boolean {
  if (p.windowStart === 0 && p.windowEnd === 0) return true;
  return nowMinuteOrTs >= p.windowStart && nowMinuteOrTs <= p.windowEnd;
}
