// Caches real fixture names (Participant1 v Participant2, Competition) from the TxLINE snapshot so
// the frontend can label auto-created board cards with the true match instead of a pseudo name.
// The keeper is the only place with an authenticated TxLINE session, so it fetches the snapshot on
// a slow loop and serves the map over HTTP (see httpServer.ts /fixtures -> { series, names }).
import type { Keypair } from "@solana/web3.js";
import { CONFIG, log } from "./config.js";
import { ensureActivated, authHeaders } from "./auth.js";

export interface FixtureName {
  a: string;
  b: string;
  comp: string;
  startTime?: number; // kickoff, unix SECONDS - lets the frontend classify pre-match (upcoming) vs in-play (live)
}

const names = new Map<number, FixtureName>();

/**
 * Inject names directly, bypassing the TxLINE snapshot. Used by replay mode: a capture carries the
 * fixture names recorded alongside its events, so a replayed demo shows the real match ("Spain v
 * Argentina") without needing a live TxLINE session at all.
 */
export function seedNames(map: Record<string | number, FixtureName>): void {
  for (const [id, n] of Object.entries(map)) {
    const fid = Number(id);
    if (Number.isFinite(fid) && n?.a && n?.b) names.set(fid, n);
  }
  log.info(`names: seeded ${names.size} fixture names from replay capture`);
}

export function getNames(): Record<number, FixtureName> {
  return Object.fromEntries(names);
}

async function refresh(keeper: Keypair): Promise<void> {
  let res = await fetch(`${CONFIG.txlineBaseUrl}/api/fixtures/snapshot`, { headers: authHeaders() });
  if (res.status === 401 || res.status === 403) {
    await ensureActivated(keeper); // session expired - re-activate and retry once
    res = await fetch(`${CONFIG.txlineBaseUrl}/api/fixtures/snapshot`, { headers: authHeaders() });
  }
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const fixtures = (await res.json()) as any[];
  for (const f of fixtures) {
    const id = Number(f.FixtureId ?? f.fixtureId);
    if (!Number.isFinite(id) || !f.Participant1 || !f.Participant2) continue;
    const startMs = Number(f.StartTime ?? f.startTime);
    const startTime = Number.isFinite(startMs) && startMs > 0 ? Math.round(startMs / 1000) : undefined;
    names.set(id, { a: String(f.Participant1), b: String(f.Participant2), comp: String(f.Competition ?? ""), startTime });
  }
  log.info(`names: cached ${names.size} fixture names from snapshot`);
}

// Fetch now (best-effort) and then on a slow loop. Snapshot fixture ids and names change slowly.
export function startNamesRefresh(keeper: Keypair, everyMs = 5 * 60_000): void {
  const tick = () => refresh(keeper).catch((e) => log.warn("names refresh failed:", (e as Error).message));
  void tick();
  const t = setInterval(tick, everyMs);
  t.unref?.();
}
