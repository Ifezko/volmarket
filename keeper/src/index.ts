import { setDefaultResultOrder } from "node:dns";
// Railway (and some container hosts) have broken IPv6 egress, and Node 24 defaults DNS resolution
// to "verbatim" (frequently IPv6-first), so fetch() to the Solana RPC fails with a bare
// "TypeError: fetch failed" and the keeper crash-loops on startup. Force IPv4 first so on-chain
// calls resolve reliably. Belt-and-suspenders with the NODE_OPTIONS=--dns-result-order=ipv4first
// env var; keeping it in code means the fix can't be lost by an env change. Nothing imported below
// does network I/O at load time, so setting it here (before main runs) is early enough.
setDefaultResultOrder("ipv4first");

import { readFileSync } from "node:fs";
import { CONFIG, log } from "./config.js";
import { buildProgram } from "./resolver.js";
import { runKeeper } from "./keeper.js";
import { ensureActivated } from "./auth.js";
import { startHttpServer } from "./httpServer.js";
import { startNamesRefresh, seedNames } from "./namesStore.js";
import { replayLanes } from "./replayFeed.js";

// Retry with exponential backoff so a transient RPC/network hiccup during startup doesn't hard-exit
// into a tight container restart-loop.
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 6, baseMs = 3000): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      const wait = baseMs * 2 ** i;
      log.warn(`${label} failed (attempt ${i + 1}/${tries}); retrying in ${Math.round(wait / 1000)}s`, (e as Error).message);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  log.info("Volmarket keeper starting");
  // Serve the live signal feed to the frontend (also gives Railway a health endpoint on $PORT).
  startHttpServer();
  const { program, wallet, connection } = buildProgram();
  if (CONFIG.replayFile) {
    // Replay is deliberately self-contained: it needs no TxLINE session (that's the point - it runs
    // when the live feed is unavailable). Fixture names ride along in the capture.
    const cap = JSON.parse(readFileSync(CONFIG.replayFile, "utf8"));
    // Rebase kickoff onto the replay clock, exactly as the events are rebased: the recorded match
    // is being replayed as if in play NOW, so the board classifies it live rather than upcoming.
    const now = Math.floor(Date.now() / 1000);
    if (cap.names) {
      seedNames(Object.fromEntries(Object.entries(cap.names).map(([id, n]: [string, any]) => [id, { ...n, startTime: now - 30 * 60 }])));
    }
    // Name every fan-out lane too, each with its own kickoff so the cards show different clocks.
    const lanes = replayLanes(Number(cap.fixtures?.[0] ?? 0)).filter((l) => l.a && l.b);
    if (lanes.length) {
      seedNames(
        Object.fromEntries(
          lanes.map((l) => [l.fixtureId, { a: l.a!, b: l.b!, comp: l.comp ?? "World Cup", startTime: now - (l.kickoffAgoMin ?? 30) * 60 }]),
        ),
      );
    }
  } else if (!CONFIG.mock) {
    // real feed needs a live TxLINE session (guest JWT -> on-chain subscribe -> signed activate)
    await withRetry("TxLINE activation", () => ensureActivated(wallet.payer));
    // Cache real fixture names so the board labels auto-created cards with the true match.
    startNamesRefresh(wallet.payer);
  }
  await runKeeper(program, wallet.payer, connection);
  log.info("keeper running — watching for settling events");
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
