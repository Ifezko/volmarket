/**
 * Capture REAL TxLINE odds events off the live stream into a replay fixture.
 *
 * The hackathon allows "live OR simulated TxLINE data feeds". When no match is in play we replay
 * these captures instead of inventing data: every event here is a genuine World Cup datapoint —
 * real messageId, real ts, real demargined Pct — recorded exactly as `subscribeStream` normalised
 * it, so replaying it drives the keeper's normal pipeline unchanged.
 *
 *   CAPTURE_SECS=240 npx tsx scripts/capture-odds.ts [outfile]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { ensureActivated } from "../src/auth.js";
import { subscribeStream, type TxEvent } from "../src/txline.js";
import { CONFIG, log } from "../src/config.js";

const SECS = Number(process.env.CAPTURE_SECS ?? 240);
const OUT = process.argv[2] ?? "replay/odds-capture.json";

(async () => {
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"))));
  await ensureActivated(keeper);

  const events: TxEvent[] = [];
  const stop = subscribeStream((e) => {
    if (e.kind !== "odds") return;
    events.push(e);
    if (events.length % 25 === 0) log.info(`captured ${events.length} odds events…`);
  });

  log.info(`capturing real odds events for ${SECS}s -> ${OUT}`);
  await new Promise((r) => setTimeout(r, SECS * 1000));
  stop();

  const fixtures = [...new Set(events.map((e) => e.fixtureId))];
  const spanMs = events.length ? Number(events[events.length - 1].ts) - Number(events[0].ts) : 0;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), source: CONFIG.txlineStreamUrl, count: events.length, fixtures, spanMs, events },
      null,
      2,
    ),
  );
  log.info(`wrote ${events.length} events across fixtures ${fixtures.join(", ")} spanning ${Math.round(spanMs / 1000)}s`);
})().catch((e) => {
  console.error("ERR", e.message ?? e);
  process.exit(1);
});
