import { existsSync, readFileSync } from "node:fs";
import { CONFIG, log } from "./config.js";
import type { TxEvent } from "./txline.js";

/**
 * Replay a capture of REAL TxLINE odds events (scripts/capture-odds.ts) as if it were live.
 *
 * The hackathon brief allows "live OR simulated TxLINE data feeds". When no match is in play, this
 * replays genuine recorded World Cup datapoints — real messageIds, real ts, real demargined Pct —
 * rather than inventing numbers. Nothing downstream changes: events are emitted through the SAME
 * `onEvent` handler `subscribeStream` feeds, so signal buffering, board seeding, the in-window
 * settlement backstop and the post-window sweeper all run exactly as they do live. Everything
 * on-chain (markets, deposits, resolve, claim, the validate_odds CPI) stays real — only the source
 * of the feed is replayed.
 *
 * Timing is RELATIVE: the gaps between captured events are preserved (scaled by REPLAY_SPEED) and
 * each event's `ts` is rebased to now, so windows/settlement behave as they would in a live match.
 * The capture loops so a demo can run indefinitely.
 *
 * FAN-OUT (replay/fanout.json): one capture can drive SEVERAL fixtures at once, so the board shows
 * a full slate instead of a single card. Lane 0 is the capture verbatim; every other lane enters the
 * capture at its own offset and carries its own level shift + slow drift, so the cards have
 * genuinely different levels and shapes rather than four copies of one chart. Derived lanes are
 * still replay, and the UI says so ("Replaying captured TxLINE data") for the whole feed.
 *
 * NOTE ON PROOFS: replayed events carry their original messageIds, so TxLINE's
 * `/api/odds/validation` will not have a *current* batch for them — the real-validator path can't be
 * exercised from a replay. The mock validator (the active demo path) is unaffected, and the genuine
 * proof CPI is verified separately (see TXLINE_VALIDATOR_ID in the program).
 */

export interface ReplayLane {
  fixtureId: number;
  a?: string;
  b?: string;
  comp?: string;
  offsetSec?: number;      // where in the capture this lane starts
  shiftPct?: number;       // constant % offset applied to the first outcome, mirrored onto the rest
  driftPct?: number;       // amplitude of a slow sine on top of the shift
  driftPeriodSec?: number; // its period
  kickoffAgoMin?: number;  // how long ago this fixture "kicked off" (board live/upcoming split)
}

/**
 * The lanes to drive. Reads replay/fanout.json when present; falls back to the single-fixture
 * behaviour (the capture as recorded, optionally remapped onto REPLAY_FIXTURE_ID) when it isn't.
 */
export function replayLanes(captureFixtureId: number): ReplayLane[] {
  const file = CONFIG.replayFanoutFile;
  if (file && existsSync(file)) {
    try {
      const lanes = (JSON.parse(readFileSync(file, "utf8")).lanes ?? []) as ReplayLane[];
      const valid = lanes.filter((l) => Number.isFinite(l.fixtureId) && l.fixtureId > 0);
      if (valid.length) return valid;
      log.warn(`replay: ${file} has no usable lanes — falling back to single-fixture replay`);
    } catch (e) {
      log.warn(`replay: cannot read ${file} (${(e as Error).message}) — falling back to single-fixture replay`);
    }
  }
  // Optional: re-map the captured fixture onto a different id. Use when a replay must not collide
  // with the same fixture still being driven live by another keeper (both watch the same chain, so
  // whichever sees the crossing first would settle the market).
  const remapTo = Number(process.env.REPLAY_FIXTURE_ID ?? 0) || 0;
  return [{ fixtureId: remapTo || captureFixtureId }];
}

/**
 * Shift one recorded odds record onto a lane. The demargined Pct[] entries of a record sum to ~100
 * across the outcomes, so a shift applied to the first outcome is mirrored across the others —
 * that keeps the record internally consistent (and keeps `resolveOutcomeValue` honest about which
 * side of a level the line sits on). Prices[] are re-derived from the shifted Pct so the decimal
 * odds in the record don't contradict it. A zero shift/drift returns the record untouched.
 */
function shiftRecord(raw: any, lane: ReplayLane, fixtureId: number, relMs: number): any {
  const out = { ...(raw as object), FixtureId: fixtureId } as any;
  const shift = Number(lane.shiftPct ?? 0);
  const amp = Number(lane.driftPct ?? 0);
  const period = Number(lane.driftPeriodSec ?? 0) * 1000;
  if (!shift && !amp) return out;
  const pct = Array.isArray(raw?.Pct) ? (raw.Pct as unknown[]) : null;
  if (!pct || pct.length < 2) return out;
  const delta = shift + (amp && period ? amp * Math.sin((2 * Math.PI * relMs) / period) : 0);
  const per = delta / (pct.length - 1); // mirrored onto the remaining outcomes so the sum is kept
  const shifted = pct.map((p, i) => {
    const v = parseFloat(String(p));
    if (!Number.isFinite(v)) return String(p);
    // Clamp well inside (0,100): a level at the rail would make one side of every market unlosable.
    return Math.min(94, Math.max(4, v + (i === 0 ? delta : -per))).toFixed(3);
  });
  out.Pct = shifted;
  if (Array.isArray(raw?.Prices)) {
    out.Prices = shifted.map((p) => Math.round(100_000 / Math.max(1e-6, parseFloat(p))));
  }
  return out;
}

export function startReplayFeed(file: string, onEvent: (e: TxEvent) => void): () => void {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { events: TxEvent[]; fixtures?: number[] };
  const events = (raw.events ?? []).filter((e) => e.kind === "odds" && e.ts != null);
  if (!events.length) {
    log.error(`replay: ${file} has no odds events — nothing to replay`);
    return () => {};
  }
  const speed = Math.max(0.1, Number(process.env.REPLAY_SPEED ?? 1));
  const base = Number(events[0].ts);
  const spanMs = Number(events[events.length - 1].ts) - base;
  const lanes = replayLanes(events[0].fixtureId);
  log.warn(
    `REPLAY MODE — ${events.length} recorded events over ${Math.round(spanMs / 1000)}s at ${speed}x, ` +
      `fanned across ${lanes.length} fixture(s): ${lanes.map((l) => l.fixtureId).join(", ")}. ` +
      `On-chain stays real; only the feed is replayed.`,
  );

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  // One independent pass per lane, each entering the capture at its own offset so the lanes are out
  // of phase with one another.
  const runLane = (lane: ReplayLane, offsetMs: number) => {
    if (stopped) return;
    const startedAt = Date.now();
    let i = 0;
    while (i < events.length && Number(events[i].ts) - base < offsetMs) i++;
    const step = () => {
      if (stopped) return;
      // Emit every event whose relative offset has elapsed, rebasing ts onto the replay clock so
      // downstream window/settlement math sees a "now"-anchored feed.
      const elapsed = (Date.now() - startedAt) * speed + offsetMs;
      while (i < events.length && Number(events[i].ts) - base <= elapsed) {
        const e = events[i++];
        const relMs = Number(e.ts) - base;
        const ts = startedAt + (relMs - offsetMs) / speed;
        onEvent({ ...e, ts, fixtureId: lane.fixtureId, raw: shiftRecord(e.raw, lane, lane.fixtureId, relMs) });
      }
      if (i >= events.length) {
        // Wrap to the top of the capture. Lanes keep their relative phase because every pass covers
        // the same span.
        later(() => runLane(lane, 0), 1000);
        return;
      }
      later(step, 250);
    };
    step();
  };
  for (const lane of lanes) runLane(lane, Math.max(0, Number(lane.offsetSec ?? 0)) * 1000);

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
