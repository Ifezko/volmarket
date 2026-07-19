import { readFileSync } from "node:fs";
import { log } from "./config.js";
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
 * NOTE ON PROOFS: replayed events carry their original messageIds, so TxLINE's
 * `/api/odds/validation` will not have a *current* batch for them — the real-validator path can't be
 * exercised from a replay. The mock validator (the active demo path) is unaffected, and the genuine
 * proof CPI is verified separately (see TXLINE_VALIDATOR_ID in the program).
 */
export function startReplayFeed(file: string, onEvent: (e: TxEvent) => void): () => void {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { events: TxEvent[]; fixtures?: number[] };
  const events = (raw.events ?? []).filter((e) => e.kind === "odds" && e.ts != null);
  if (!events.length) {
    log.error(`replay: ${file} has no odds events — nothing to replay`);
    return () => {};
  }
  const speed = Math.max(0.1, Number(process.env.REPLAY_SPEED ?? 1));
  // Optional: re-map the captured fixture onto a different id. Use when a replay must not collide
  // with the same fixture still being driven live by another keeper (both watch the same chain, so
  // whichever sees the crossing first would settle the market). Events are otherwise untouched.
  const remapTo = Number(process.env.REPLAY_FIXTURE_ID ?? 0) || 0;
  const base = Number(events[0].ts);
  const spanMs = Number(events[events.length - 1].ts) - base;
  log.warn(
    `REPLAY MODE — ${events.length} recorded events over ${Math.round(spanMs / 1000)}s ` +
      `(fixtures ${(raw.fixtures ?? []).join(", ")}) at ${speed}x. On-chain stays real; only the feed is replayed.`,
  );

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runPass = () => {
    if (stopped) return;
    const startedAt = Date.now();
    let i = 0;
    const step = () => {
      if (stopped) return;
      // Emit every event whose relative offset has elapsed, rebasing ts onto the replay clock so
      // downstream window/settlement math sees a "now"-anchored feed.
      const elapsed = (Date.now() - startedAt) * speed;
      while (i < events.length && Number(events[i].ts) - base <= elapsed) {
        const e = events[i++];
        const ts = startedAt + (Number(e.ts) - base) / speed;
        onEvent(
          remapTo
            ? { ...e, ts, fixtureId: remapTo, raw: { ...(e.raw as object), FixtureId: remapTo } }
            : { ...e, ts },
        );
      }
      if (i >= events.length) {
        log.info("replay: capture exhausted — looping");
        timer = setTimeout(runPass, 1000);
        return;
      }
      timer = setTimeout(step, 250);
    };
    step();
  };
  runPass();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
