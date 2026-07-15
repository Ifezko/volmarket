// A small in-memory ring buffer of recent live signal points per (fixtureId, oddKey, marketParams),
// fed from the TxLINE odds stream. The frontend polls these over HTTP (see httpServer.ts) so the
// signal chart draws the REAL feed - the same values the keeper settles on - instead of a sim.

export interface SignalPoint {
  t: number; // unix seconds
  v: number; // demargined implied probability, as a percent (e.g. 39.432)
}

const MAX_POINTS = 300; // ~ enough for the widest window at the feed cadence
const TTL_SECS = 45 * 60; // drop a series untouched for this long (freed on the cleanup tick)

const store = new Map<string, { points: SignalPoint[]; last: number }>();
const key = (fixtureId: number, oddKey: number, marketParams: number) => `${fixtureId}:${oddKey}:${marketParams}`;

export function recordSignal(fixtureId: number, oddKey: number, marketParams: number, pct: number): void {
  if (!Number.isFinite(pct)) return;
  const now = Date.now() / 1000;
  const k = key(fixtureId, oddKey, marketParams);
  let s = store.get(k);
  if (!s) {
    s = { points: [], last: now };
    store.set(k, s);
  }
  s.points.push({ t: now, v: pct });
  if (s.points.length > MAX_POINTS) s.points.splice(0, s.points.length - MAX_POINTS);
  s.last = now;
}

export function getSignal(fixtureId: number, oddKey: number, marketParams: number): SignalPoint[] {
  return store.get(key(fixtureId, oddKey, marketParams))?.points ?? [];
}

// Evict stale series so the map doesn't grow unbounded over a long run.
const cleanup = setInterval(() => {
  const cutoff = Date.now() / 1000 - TTL_SECS;
  for (const [k, s] of store) if (s.last < cutoff) store.delete(k);
}, 60_000);
cleanup.unref?.();
