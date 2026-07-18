// A small in-memory record of HOW each market was settled, so the frontend can show a verifiable
// "receipt": the exact TxLINE anchored datapoint (messageId + ts) that decided the outcome, the
// settlement value, and the on-chain resolve transaction. This lets a user trace an outcome without
// trusting us - the messageId/ts identify the genuine datapoint even while the mock validator is the
// active CPI (the value the keeper settled on is the real demargined signal).

export interface Receipt {
  market: string; // market pubkey (base58)
  messageId: string; // TxLINE record id of the deciding odds update
  ts: number; // that record's timestamp
  value: number; // settlement value (demargined % x1000) that met the predicate
  resolveTx: string; // the on-chain resolve_market signature
  at: number; // unix seconds we recorded it
}

const MAX = 500; // keep the most recent settlements; older ones age out
const store = new Map<string, Receipt>();

export function recordReceipt(r: Receipt): void {
  store.set(r.market, r);
  if (store.size > MAX) {
    // drop the oldest by insertion order (Map preserves it)
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

export function getReceipt(market: string): Receipt | undefined {
  return store.get(market);
}
