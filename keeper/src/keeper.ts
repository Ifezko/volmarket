import type { Program } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";
import {
  subscribeStream, getScoreProof, getOddsProof, type TxEvent, type ProofResult,
} from "./txline.js";
import {
  loadMarkets, evaluatePredicate, inWindow,
  MARKET_SCORE, RES_OPTIMISTIC, type WatchedMarket,
} from "./markets.js";
import { resolveMarket } from "./resolver.js";
import { startMockFeed, mockProof } from "./mockFeed.js";

export async function runKeeper(program: Program) {
  let byFixture = await loadMarkets(program);
  const inFlight = new Set<string>(); // market pubkeys mid-resolution
  // remember the last odds update per fixture so we can settle optimistic NO at the deadline
  const lastOdds = new Map<number, { value: number; messageId: string; ts: number; minute: number }>();

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

  const onEvent = async (e: TxEvent) => {
    const markets = byFixture.get(e.fixtureId);
    if (!markets?.length) return;
    log.debug("event", e.kind, "fixture", e.fixtureId, "value", e.value);

    if (e.kind === "odds" && e.value != null) {
      const minute = (e.raw as any)?.minute ?? 0;
      lastOdds.set(e.fixtureId, { value: e.value, messageId: e.messageId!, ts: e.ts!, minute });

      for (const m of markets) {
        if (m.marketType === MARKET_SCORE) continue;
        if (e.statKey !== m.predicate.statKey) continue;
        if (!inWindow(minute, m.predicate)) continue;
        // a crossing that satisfies the predicate settles YES immediately
        if (evaluatePredicate(e.value, m.predicate)) {
          const proof = CONFIG.mock ? await mockProof(e.value) : await getOddsProof(e.messageId!, e.ts!);
          await handle(m, proof);
        }
      }
    }

    if (e.kind === "score" && e.value != null) {
      for (const m of markets) {
        if (m.marketType !== MARKET_SCORE) continue;
        if (e.statKey !== m.predicate.statKey) continue;
        const proof = CONFIG.mock ? await mockProof(e.value) : await getScoreProof(e.fixtureId, m.predicate.statKey);
        await handle(m, proof);
      }
    }

    if (e.kind === "status" && e.status === "ended") {
      // settle deterministic score markets, and optimistic odds markets that never crossed (-> NO)
      for (const m of markets) {
        if (m.marketType === MARKET_SCORE) {
          const proof = CONFIG.mock
            ? await mockProof(m.predicate.value) // mock: trivially satisfy
            : await getScoreProof(e.fixtureId, m.predicate.statKey);
          await handle(m, proof);
        } else if (m.resolutionMode === RES_OPTIMISTIC) {
          const last = lastOdds.get(e.fixtureId);
          if (!last) continue;
          // submit the last odds update's proof; predicate fails -> NO
          if (!evaluatePredicate(last.value, m.predicate)) {
            const proof = CONFIG.mock ? await mockProof(last.value) : await getOddsProof(last.messageId, last.ts);
            await handle(m, proof);
          }
        }
      }
    }
  };

  // deadline sweeper: optimistic markets past deadline with no crossing -> settle NO
  const sweeper = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [fixtureId, markets] of byFixture) {
      for (const m of markets) {
        if (m.resolutionMode !== RES_OPTIMISTIC) continue;
        if (now < m.deadline) continue;
        const last = lastOdds.get(fixtureId);
        if (!last || evaluatePredicate(last.value, m.predicate)) continue;
        const proof = CONFIG.mock ? await mockProof(last.value) : await getOddsProof(last.messageId, last.ts);
        await handle(m, proof);
      }
    }
  }, CONFIG.deadlineSweepMs);

  // periodically refresh the market set (new markets created mid-tournament)
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
