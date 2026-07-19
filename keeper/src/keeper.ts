import type { Program } from "@coral-xyz/anchor";
import type { Connection, Keypair } from "@solana/web3.js";
import { CONFIG, log } from "./config.js";
import { subscribeStream, getOddsProof, resolveOutcomeValue, type TxEvent, type ProofResult } from "./txline.js";
import { loadMarkets, crossingResolves, inWindow, oddOutcome, ODD_OUTCOMES, type WatchedMarket } from "./markets.js";
import { resolveMarket } from "./resolver.js";
import { claimWinners } from "./claimer.js";
import { bootstrapOpenMarkets } from "./bootstrap.js";
import { startMockFeed, mockProof } from "./mockFeed.js";
import { recordSignal } from "./signalStore.js";
import { primeSeeded, ensureBoardMarket } from "./boardSeeder.js";
import { recordReceipt } from "./receiptStore.js";

// The program's post-window timeout branch settles the DEFAULT outcome (HOLD→YES, BREAK→NO)
// without validating a proof — no anchored update is required to finalize it — so a trivial
// placeholder is all resolve_market needs once now >= window_end.
const TIMEOUT_PROOF: ProofResult = { value: 0, proofBytes: Buffer.alloc(0), accounts: [] };

export async function runKeeper(program: Program, keeper: Keypair, connection: Connection) {
  let byFixture = await loadMarkets(program);
  // Prime the board-seeder's "already have a market" set from chain so a restart never duplicates.
  const seedView = () =>
    [...byFixture.values()].flat().map((m) => ({
      fixtureId: m.fixtureId,
      oddKey: m.oddKey,
      marketParams: m.marketParams,
      windowEnd: m.windowEnd,
    }));
  primeSeeded(seedView());
  // Seed any existing open market that has an empty pool before we start watching.
  await bootstrapOpenMarkets(program, keeper, connection);
  const inFlight = new Set<string>(); // market pubkeys mid-resolution

  // Latest odds event per (fixtureId:superOddsType:marketParams), so the in-window backstop can
  // re-check markets between sparse SSE updates. recvAt is wall-clock seconds at receipt.
  const lastEvent = new Map<string, { evt: TxEvent; recvAt: number }>();

  // Returns the resolve_market signature when THIS call resolved the market (null if it was already
  // resolved / a no-op), so the caller can record a settlement receipt tied to that transaction.
  const handle = async (m: WatchedMarket, proof: ProofResult): Promise<string | null> => {
    const key = m.pubkey.toBase58();
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    try {
      const sig = await resolveMarket(program, m.pubkey, proof);
      // Autonomous payout: once the outcome is on-chain, push every winner their USDC. Safe to
      // call even if the resolve was a no-op (already resolved) — claimWinners re-checks status
      // and only pays unclaimed winning positions, so it never double-pays.
      await claimWinners(program, m.pubkey);
      return sig;
    } finally {
      inFlight.delete(key);
    }
  };

  // Try to settle one watched market from a specific odds event — the keeper's half of the
  // deterministic resolution the program enforces (resolve_market in lib.rs).
  //
  // HOLD/BREAK ASYMMETRY (crossingResolves): while the window is OPEN we submit the ONE deciding
  // proof the instant the signal crosses — BREAK the moment value >= level ("broke through"), HOLD
  // the moment value < level ("defeated"). That is the only in-window action. A HOLD that is never
  // defeated and a BREAK that never crosses are left untouched here and settle to their on-chain
  // DEFAULT (HOLD → wins, BREAK → loses) via the post-window sweeper's timeout branch.
  //
  // FAIL-SAFE: resolveOutcomeValue returns null (→ we skip) rather than a guess when the event has
  // no PriceNames entry for this market's outcome, so a bad/missing mapping can never settle the
  // wrong side. Shared by the live event handler and the in-window backstop timer.
  const trySettleFromEvent = async (m: WatchedMarket, evt: TxEvent, now: number): Promise<void> => {
    // Keeper-authored markets are board display shells (created to make a live fixture appear, empty
    // pools, long match-length window). They must stay visible for the whole match - never settle
    // them mid-window; the post-window sweeper cleans them up harmlessly at their window end.
    if (m.authority.equals(keeper.publicKey)) return;
    const oc = oddOutcome(m.oddKey);
    if (!oc) return; // odd type we don't expose
    // A market is keyed by SuperOddsType AND MarketParameters — match both (e.g. O/U 1.5 vs 2.5).
    if (oc.superOddsType !== evt.superOddsType) return;
    if (m.marketParams !== (evt.marketParams ?? 0)) return;
    if (!inWindow(now, m)) return;
    // Resolve this market's outcome by matching its label in PriceNames[]. No match -> don't settle.
    const value = resolveOutcomeValue(evt.raw, m.oddKey);
    if (value == null) {
      log.error("no PriceNames match — skipping (won't settle)", m.pubkey.toBase58(), "oddKey", m.oddKey, "label", oc.label);
      return;
    }
    if (!crossingResolves(m.side, value, m.level)) return;
    let proof: ProofResult;
    try {
      // Mock validator (devnet) resolves on `value` alone and approves an empty proof, so settle with
      // the real signal value directly — no unreliable getOddsProof round-trip. getOddsProof is only
      // needed once the real TxLINE validator is on-chain (MOCK_VALIDATOR=false).
      proof =
        CONFIG.mock || CONFIG.mockValidator ? await mockProof(value) : await getOddsProof(evt.messageId!, evt.ts!, m.oddKey);
    } catch (err) {
      log.error("cannot build proof, skipping", m.pubkey.toBase58(), String(err));
      return;
    }
    const sig = await handle(m, proof);
    // Record a verifiable receipt: the exact TxLINE datapoint (messageId + ts) that met the
    // predicate and the on-chain resolve tx, for the frontend's settlement proof (see httpServer).
    if (sig && evt.messageId && evt.ts != null) {
      recordReceipt({ market: m.pubkey.toBase58(), messageId: evt.messageId, ts: evt.ts, value, resolveTx: sig, at: Date.now() / 1000 });
    }
  };

  // Every settlement rides the anchored odds line — internal stake never decides an outcome.
  const onEvent = async (e: TxEvent) => {
    if (e.kind !== "odds") return;

    // Buffer the live signal for every odd this record covers (the demargined % the keeper settles
    // on), so the frontend can draw the REAL feed. Done for all odds of the record regardless of
    // whether a market exists yet - independent of the watched-markets settlement loop below.
    let createdBoardMarket = false;
    for (const oddKey of Object.keys(ODD_OUTCOMES).map(Number)) {
      if (ODD_OUTCOMES[oddKey].superOddsType !== e.superOddsType) continue;
      const value = resolveOutcomeValue(e.raw, oddKey);
      if (value == null) continue;
      recordSignal(e.fixtureId, oddKey, e.marketParams ?? 0, value / 1000);
      // Auto-open a board market for this live odd if we don't have one yet, so the fixture shows on
      // the board with a real chart and settles on this same feed (no manual seeding). `value` is the
      // demargined % ×1000 — the on-chain level scale.
      if (await ensureBoardMarket(program, keeper, connection, e.fixtureId, oddKey, e.marketParams ?? 0, value)) {
        createdBoardMarket = true;
      }
    }
    // Pick up any market we just created so the settlement loop watches it too.
    if (createdBoardMarket) byFixture = await loadMarkets(program);

    // Buffer this event so the in-window backstop can re-check markets between sparse SSE updates.
    lastEvent.set(`${e.fixtureId}:${e.superOddsType}:${e.marketParams ?? 0}`, { evt: e, recvAt: Date.now() / 1000 });

    const markets = byFixture.get(e.fixtureId);
    if (!markets?.length) return;
    const now = Math.floor(Date.now() / 1000);
    log.debug("odds", "fixture", e.fixtureId, "superOddsType", e.superOddsType, "params", e.marketParams);
    for (const m of markets) await trySettleFromEvent(m, e, now);
  };

  // Post-window sweeper: any still-open market whose window has closed settles to its default
  // outcome (BREAK never broke → NO; HOLD never defeated → YES) via the program's timeout branch.
  //
  // WHY THE TWO SIDES SETTLE ON DIFFERENT CLOCKS. The predicate is deliberately asymmetric, and that
  // asymmetry decides how fast each side can finalise:
  //   • HOLD is OPTIMISTIC — it wins by default and can only be DISPROVEN, by a proof that the signal
  //     went below the level while the window was open. So if nothing defeats it, HOLD settles the
  //     instant the window closes, right here, with no proof required.
  //   • BREAK is the claim that must be PROVEN — it only wins on a verified datapoint at/above the
  //     level. Under the real validator that datapoint isn't provable until TxLINE publishes its
  //     wall-clock 5-minute batch (boundary + publication buffer, see fetchPublishedOddsProof), so a
  //     winning BREAK finalises LATER than a winning HOLD even though the stream knew the outcome
  //     immediately.
  // That gap is why the UI shows a provisional result at window close and upgrades it to "verified"
  // once the proof lands (ResultModal) — it is inherent to proof-anchored settlement, not lag we can
  // engineer away.
  const sweeper = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const markets of byFixture.values()) {
      for (const m of markets) {
        if (now < m.windowEnd) continue;
        await handle(m, TIMEOUT_PROOF);
      }
    }
  }, CONFIG.deadlineSweepMs);

  // In-window backstop. The program only lets a HOLD lose while now < window_end (a proof-verified
  // value < level); past window_end it defaults HOLD -> WIN with no value check. SSE odds events can
  // be sparser than a short prediction window, so a losing HOLD (signal already below level) may see
  // NO event during its window and get swept to a wrong WIN. This re-checks every watched open market
  // against the LATEST buffered signal every few seconds and submits the deciding proof before
  // window_end - so settlement follows the real signal, not event-arrival luck. Stale signals are
  // skipped so we never settle on outdated data.
  const STALE_SIGNAL_SECS = 120;
  const inWindowSettler = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const markets of byFixture.values()) {
      for (const m of markets) {
        if (!inWindow(now, m)) continue;
        const oc = oddOutcome(m.oddKey);
        if (!oc) continue;
        const buf = lastEvent.get(`${m.fixtureId}:${oc.superOddsType}:${m.marketParams}`);
        if (!buf || now - buf.recvAt > STALE_SIGNAL_SECS) continue;
        await trySettleFromEvent(m, buf.evt, now);
      }
    }
  }, CONFIG.inWindowSettleMs);

  // periodically refresh the market set (new markets created mid-tournament, resolved ones drop
  // out). Kept short (CONFIG.marketRefreshMs) so a user's just-placed prediction is watched
  // quickly enough to be verified in-window, not just swept to its default after the window.
  const refresher = setInterval(async () => {
    byFixture = await loadMarkets(program);
    // Re-prime the board-seeder from chain each refresh (not just at startup): loadMarkets returns
    // only OPEN markets, so a board market that has lapsed drops out here and stops counting as
    // "already seeded" - that's what lets a still-live fixture get a fresh market without a restart.
    primeSeeded(seedView());
    // Bootstrap liquidity for any newly-created market whose opposing pool is still empty.
    await bootstrapOpenMarkets(program, keeper, connection);
  }, CONFIG.marketRefreshMs);

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
    clearInterval(inWindowSettler);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
