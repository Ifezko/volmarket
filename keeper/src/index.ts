import { setDefaultResultOrder } from "node:dns";
// Railway (and some container hosts) have broken IPv6 egress, and Node 24 defaults DNS resolution
// to "verbatim" (frequently IPv6-first), so fetch() to the Solana RPC fails with a bare
// "TypeError: fetch failed" and the keeper crash-loops on startup. Force IPv4 first so on-chain
// calls resolve reliably. Belt-and-suspenders with the NODE_OPTIONS=--dns-result-order=ipv4first
// env var; keeping it in code means the fix can't be lost by an env change. Nothing imported below
// does network I/O at load time, so setting it here (before main runs) is early enough.
setDefaultResultOrder("ipv4first");

import { CONFIG, log } from "./config.js";
import { buildProgram } from "./resolver.js";
import { runKeeper } from "./keeper.js";
import { ensureActivated } from "./auth.js";

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
  const { program, wallet, connection } = buildProgram();
  if (!CONFIG.mock) {
    // real feed needs a live TxLINE session (guest JWT -> on-chain subscribe -> signed activate)
    await withRetry("TxLINE activation", () => ensureActivated(wallet.payer));
  }
  await runKeeper(program, wallet.payer, connection);
  log.info("keeper running — watching for settling events");
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
