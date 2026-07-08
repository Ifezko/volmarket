import type { Program } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";
import { subscribeStream, getOddsProof, resolveOutcomeValue, type TxEvent, type ProofResult } from "./txline.js";
import { loadMarkets, crossingResolves, inWindow, oddOutcome, type WatchedMarket } from "./markets.js";
import { resolveMarket } from "./resolver.js";
import { claimWinners } from "./claimer.js";
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
      // Autonomous payout: once the outcome is on-chain, push every winner their USDC. Safe to
      // call even if the resolve was a no-op (already resolved) — claimWinners re-checks status
      // and only pays unclaimed winning positions, so it never double-pays.
      await claimWinners(program, m.pubkey);
    } finally {
      inFlight.delete(key);
    }
  };

  // Every settlement rides the anchored odds line — internal stake never decides an outcome.
  const onEvent = async (e: TxEvent) => {
    if (e.kind !== "odds") return;
    const markets = byFixture.get(e.fixtureId);
    if (!markets?.length) return;
    const now = Math.floor(Date.now() / 1000);
    log.debug("odds", "fixture", e.fixtureId, "superOddsType", e.superOddsType, "params", e.marketParams);

    for (const m of markets) {
      // A market is keyed by SuperOddsType AND MarketParameters — match both, so e.g. Over/Under
      // 1.5 and 2.5 are distinct and never cross-settle.
      const oc = oddOutcome(m.oddKey);
      if (!oc) continue;                             // odd type we don't expose
      if (oc.superOddsType !== e.superOddsType) continue;
      if (m.marketParams !== e.marketParams) continue;

      // Safety rule: resolve this market's outcome by matching its label in PriceNames[]. No match
      // -> do NOT settle: log and skip, so a bad/missing mapping can never resolve a market wrongly.
      const value = resolveOutcomeValue(e.raw, m.oddKey);
      if (value == null) {
        log.error("no PriceNames match — skipping (won't settle)", m.pubkey.toBase58(), "oddKey", m.oddKey, "label", oc.label);
        continue;
      }
      if (!inWindow(now, m)) continue;

      // BREAK: value>=level → YES; HOLD: value<level → NO. Submit the single deciding proof.
      if (crossingResolves(m.side, value, m.level)) {
        let proof: ProofResult;
        try {
          proof = CONFIG.mock ? await mockProof(value) : await getOddsProof(e.messageId!, e.ts!, m.oddKey);
        } catch (err) {
          log.error("cannot build proof, skipping", m.pubkey.toBase58(), String(err));
          continue;
        }
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
