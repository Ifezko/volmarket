import { PublicKey } from "@solana/web3.js";
import { log } from "./config.js";
import type { ProofResult, TxEvent } from "./txline.js";

/**
 * Synthetic feed for demos: drives one fixture's home-win odds on a random walk and
 * emits odds updates, then an "ended" status. Lets the keeper visibly resolve a market
 * on devnet without waiting for a real match. Pair with a mock validator program that
 * approves any proof (see README) so the CPI succeeds.
 */
export function startMockFeed(fixtureId: number, onEvent: (e: TxEvent) => void): () => void {
  let price = 1.9; // decimal odds for home win
  let minute = 55;
  let seq = 0;
  const id = setInterval(() => {
    minute += 1;
    price = Math.max(1.4, Math.min(3.2, price + (Math.random() - 0.5) * 0.12));
    const messageId = `mock-${fixtureId}-${seq++}`;
    onEvent({
      kind: "odds",
      fixtureId,
      statKey: 0,
      value: Math.round(price * 1000),
      messageId,
      raw: { minute, price },
    });
    if (minute >= 90) {
      clearInterval(id);
      onEvent({ kind: "status", fixtureId, status: "ended", raw: { minute } });
      log.info("mock feed: match ended");
    }
  }, 1500);
  log.info(`mock feed started for fixture ${fixtureId}`);
  return () => clearInterval(id);
}

/** Mock proof: echoes the value, empty proof bytes, no extra accounts. */
export async function mockProof(value: number): Promise<ProofResult> {
  return { value, proofBytes: Buffer.alloc(0), accounts: [] as PublicKey[] };
}
