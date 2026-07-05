import type { Program } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";
import { subscribeStream, getOddsProof, type TxEvent, type ProofResult } from "./txline.js";
import { loadMarkets, crossingResolves, inWindow, type WatchedMarket } from "./markets.js";
import { resolveMarket } from "./resolver.js";
import { startMockFeed, mockProof } from "./mockFeed.js";

// The program's post-window timeout branch settles the DEFAULT outcome (HOLD→YES, BREAK→NO)
// without validating a proof — no anchored update is required to finalize it — so a trivial
// placeholder is all resolve_market needs once now >= window_end.
const TIMEOUT_PROOF: ProofResult = { value: 0, proofBytes: Buffer.alloc(0), accounts: [] };

export async function runKeeper(program: Program) {
  let byFixture = await loadMarkets(program);
  const inFlight = new Set<string>(); // market pubkeys mid-resolution

  const handle = async (m: WatchedMarket, proof: ProofResult) => {
    const key = m.pubkey.toBase58();
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await resolveMarket(program, m.pubkey, proof);
    } finally {
      inFlight.delete(key);
    }
  };

  // Every settlement rides the anchored odds line — internal stake never decides an outcome.
  const onEvent = async (e: TxEvent) => {
    if (e.kind !== "odds" || e.value == null) return;
    const markets = byFixture.get(e.fixtureId);
    if (!markets?.length) return;
    const now = Math.floor(Date.now() / 1000);
    log.debug("odds", "fixture", e.fixtureId, "odd", e.oddKey, "value", e.value);

    for (const m of markets) {
      if (e.oddKey !== m.oddKey) continue;
      if (!inWindow(now, m)) continue;
      // BREAK: value>=level → YES; HOLD: value<level → NO. Submit the single deciding proof.
      // m.oddKey is the outcome index into the odds record's parallel Pct[] arrays.
      if (crossingResolves(m.side, e.value, m.level)) {
        const proof = CONFIG.mock ? await mockProof(e.value) : await getOddsProof(e.messageId!, e.ts!, m.oddKey);
        await handle(m, proof);
      }
    }
  };

  // Post-window sweeper: any still-open market whose window has closed settles to its default
  // outcome (BREAK never broke → NO; HOLD never defeated → YES) via the program's timeout branch.
  const sweeper = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const markets of byFixture.values()) {
      for (const m of markets) {
        if (now < m.windowEnd) continue;
        await handle(m, TIMEOUT_PROOF);
      }
    }
  }, CONFIG.deadlineSweepMs);

  // periodically refresh the market set (new markets created mid-tournament, resolved ones drop out)
  const refresher = setInterval(async () => {
    byFixture = await loadMarkets(program);
  }, 60_000);

  let stop: () => void;
  if (CONFIG.mock) {
    const fixtureId = [...byFixture.keys()][0] ?? 99001;
    log.warn(`MOCK mode — driving synthetic feed for fixture ${fixtureId}`);
    stop = startMockFeed(fixtureId, (e) => void onEvent(e));
  } else {
    stop = subscribeStream((e) => void onEvent(e));
  }

  const shutdown = () => {
    log.info("shutting down keeper");
    stop();
    clearInterval(sweeper);
    clearInterval(refresher);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
