// Process-level guards against transient RPC faults killing the keeper.
//
// WHY THIS EXISTS (and why the try/catch already on every interval tick wasn't enough): when the
// Solana RPC rate-limits us, @solana/web3.js surfaces the failure from inside its jayson client
// callback, not through the promise the keeper awaits:
//
//   Error: 429 Too Many Requests: {"code": 429, "message":"Too many requests for a specific RPC call"}
//       at ClientBrowser.callServer (@solana/web3.js/src/connection.ts:1703:18)
//       at process.processTicksAndRejections
//
// Note the total absence of application frames — there is no keeper stack for a `catch` to sit on,
// so the error escapes as an uncaught exception and Node exits. On Railway that means a restart,
// and each restart replays the whole startup burst (market scan, board-seed, bootstrap deposits,
// resolve/claim) against the same rate-limited RPC — which triggers the next 429. That feedback
// loop is what turns one throttled request into an unrecoverable crash-loop.
//
// So: swallow the transient network faults and keep running (the keeper's own retry/refresh timers
// will pick the work back up on the next tick), but still die on anything we don't recognise — a
// real bug should crash loudly rather than be papered over.
import { log } from "./config.js";

// Substrings that mark a fault as "the network/RPC misbehaved", not "the keeper is broken".
const TRANSIENT = [
  "429",
  "too many requests",
  "502",
  "503",
  "504",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "fetch failed",
  "socket hang up",
  "etimedout",
  "econnreset",
  "econnrefused",
  "enotfound",
  "eai_again",
  "request timed out",
];

function isTransient(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return TRANSIENT.some((p) => msg.includes(p));
}

// Circuit breaker: if transient faults are arriving in a sustained flood rather than as a blip,
// the RPC is comprehensively unhappy and a fresh process (new sockets, new backoff state) is the
// better move. Exiting here is deliberate — Railway restarts us — but it takes a real storm.
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_LIMIT = 40;
let recent: number[] = [];

function noteTransient(): boolean {
  const now = Date.now();
  recent.push(now);
  recent = recent.filter((t) => now - t < FLOOD_WINDOW_MS);
  return recent.length >= FLOOD_LIMIT;
}

function onFault(kind: string, err: unknown): void {
  if (!isTransient(err)) {
    log.error(`${kind} (fatal, not a transient RPC fault) —`, err);
    process.exit(1);
  }
  const msg = String((err as Error)?.message ?? err).slice(0, 160);
  if (noteTransient()) {
    log.error(`${kind}: ${FLOOD_LIMIT}+ transient RPC faults in ${FLOOD_WINDOW_MS / 1000}s — restarting for a clean connection. Last: ${msg}`);
    process.exit(1);
  }
  log.warn(`${kind} (transient RPC fault, continuing): ${msg}`);
}

export function installCrashGuards(): void {
  process.on("uncaughtException", (err) => onFault("uncaughtException", err));
  process.on("unhandledRejection", (reason) => onFault("unhandledRejection", reason));
  log.info("crash guards installed — transient RPC faults will not exit the process");
}
