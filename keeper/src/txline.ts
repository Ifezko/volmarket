import EventSource from "eventsource";
import { PublicKey } from "@solana/web3.js";
import { CONFIG, log } from "./config.js";
import { authHeaders } from "./auth.js";

/**
 * Normalised proof the on-chain `resolve_market` needs:
 *  - value: the attested datapoint as a scaled integer
 *           (score as-is; odds as price*1000 to stay integer)
 *  - proofBytes: the bytes forwarded to TxLINE's validate instruction
 *  - accounts: extra accounts that validate instruction expects
 *              (e.g. the on-chain batch/commitment account), passed as remaining_accounts
 */
export interface ProofResult {
  value: number;
  proofBytes: Buffer;
  accounts: PublicKey[];
}

/** A normalised event coming off the TxLINE stream. */
export interface TxEvent {
  kind: "score" | "odds" | "status";
  fixtureId: number;
  statKey?: number;     // which stat/market the datapoint refers to
  value?: number;       // scaled integer value (score, or odds*1000)
  messageId?: string;   // for odds updates — needed (with ts) to fetch their proof
  ts?: number;          // for odds updates — REQUIRED alongside messageId (see getOddsProof)
  status?: string;      // e.g. "in_play" | "ended"
  raw: unknown;
}

// auth headers now come from ./auth.ts (real subscribe -> sign -> activate flow)
// call ensureActivated(keeperKeypair) once at keeper startup before using this module.

/**
 * Subscribe to the TxLINE SSE stream and forward normalised events.
 * Auto-reconnects (EventSource handles backoff); we log drops.
 *
 * NOTE: the exact event payload shape comes from the World Cup stream docs.
 * `normaliseStreamEvent` is the single place to adapt to their schema.
 */
export function subscribeStream(onEvent: (e: TxEvent) => void): () => void {
  const es = new EventSource(CONFIG.txlineStreamUrl, { headers: authHeaders() } as any); // GET /api/odds/stream (SSE)

  es.onopen = () => log.info("TxLINE stream connected", CONFIG.txlineStreamUrl);
  es.onerror = (err: unknown) => log.warn("TxLINE stream error (will retry)", err);
  es.onmessage = (msg: MessageEvent) => {
    try {
      const e = normaliseStreamEvent(JSON.parse(msg.data));
      if (e) onEvent(e);
    } catch (err) {
      log.warn("bad stream message", err);
    }
  };

  return () => es.close();
}

/** Adapt a raw stream payload to a TxEvent. TODO: map to the real World Cup schema. */
function normaliseStreamEvent(raw: any): TxEvent | null {
  if (!raw || raw.fixtureId == null) return null;
  if (raw.type === "odds" || raw.odds) {
    return {
      kind: "odds",
      fixtureId: Number(raw.fixtureId),
      statKey: Number(raw.marketKey ?? raw.statKey ?? 0),
      value: Math.round(Number(raw.price ?? raw.odds) * 1000),
      messageId: String(raw.messageId ?? raw.id),
      ts: Number(raw.ts ?? raw.timestamp ?? Date.now()),
      raw,
    };
  }
  if (raw.type === "score" || raw.score) {
    return {
      kind: "score",
      fixtureId: Number(raw.fixtureId),
      statKey: Number(raw.statKey ?? 0),
      value: Number(raw.value ?? raw.score),
      raw,
    };
  }
  if (raw.type === "status" || raw.status) {
    return { kind: "status", fixtureId: Number(raw.fixtureId), status: String(raw.status), raw };
  }
  return null;
}

/** Three-stage score Merkle proof for a single stat. */
export async function getScoreProof(fixtureId: number, statKey: number): Promise<ProofResult> {
  const url = `${CONFIG.txlineBaseUrl}/api/worldcup/scores/proof?fixtureId=${fixtureId}&statKey=${statKey}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`score proof ${res.status} for fixture ${fixtureId}/${statKey}`);
  return parseProof(await res.json());
}

/**
 * Odds-update Merkle proof. Confirmed shape (docs/signals-spec.md):
 *   GET /api/odds/validation?messageId={id}&ts={ts}
 *   -> OddsValidation { odds, summary, subTreeProof, mainTreeProof }
 * Requires BOTH messageId and ts — messageId alone is not sufficient.
 * Odds use a TWO-stage proof (subTree + mainTree); scores use three-stage.
 */
export async function getOddsProof(messageId: string, ts: number | string): Promise<ProofResult> {
  const url = `${CONFIG.txlineBaseUrl}/api/odds/validation?messageId=${encodeURIComponent(messageId)}&ts=${encodeURIComponent(String(ts))}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`odds proof ${res.status} for ${messageId}@${ts}`);
  return parseOddsValidation(await res.json());
}

/**
 * Parse an OddsValidation response into the ProofResult resolve_market expects.
 * Forwards BOTH subTreeProof and mainTreeProof (two-stage) — see README seam #2.
 * TODO: confirm the integer scale/units of odds.Prices[] (asked in Discord thread)
 * before treating it as price*1000; adjust the value scaling here once confirmed.
 */
function parseOddsValidation(json: any): ProofResult {
  const odds = json.odds ?? {};
  const priceIdx = 0; // TODO: index into odds.PriceNames[] for the outcome this market tracks
  const rawPrice = Number(odds.Prices?.[priceIdx] ?? odds.prices?.[priceIdx] ?? 0);
  const value = Math.round(rawPrice); // TODO: apply confirmed scale (bp vs prob*100) once known
  const subTree = json.subTreeProof ?? [];
  const mainTree = json.mainTreeProof ?? [];
  const proofBytes = encodeTwoStageProof(subTree, mainTree);
  const accounts: PublicKey[] = (json.accounts ?? json.summary?.commitmentAccounts ?? []).map(
    (a: string) => new PublicKey(a)
  );
  return { value, proofBytes, accounts };
}

/** Serialise the two ProofNode[] arrays ({hash, isRightSibling}) into the bytes the on-chain validate ix expects. */
function encodeTwoStageProof(subTree: any[], mainTree: any[]): Buffer {
  const encodeNodes = (nodes: any[]) =>
    Buffer.concat(
      nodes.map((n) => Buffer.concat([Buffer.from(n.hash.replace(/^0x/, ""), "hex"), Buffer.from([n.isRightSibling ? 1 : 0])]))
    );
  const sub = encodeNodes(subTree);
  const main = encodeNodes(mainTree);
  const lenPrefix = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  return Buffer.concat([lenPrefix(sub.length), sub, lenPrefix(main.length), main]);
}

/**
 * Turn a proof response into ProofResult.
 * TODO: match TxLINE's response fields. Expected to expose:
 *  - the attested value, the proof bytes (hex/base64), and the commitment/batch account pubkey(s).
 */
function parseProof(json: any): ProofResult {
  const value = Number(json.value ?? json.stat ?? Math.round(Number(json.price) * 1000));
  const hex: string = json.proof ?? json.proofHex ?? "";
  const proofBytes = Buffer.from(hex.replace(/^0x/, ""), hex.match(/[g-z]/i) ? "base64" : "hex");
  const accounts: PublicKey[] = (json.accounts ?? json.commitmentAccounts ?? []).map(
    (a: string) => new PublicKey(a)
  );
  return { value, proofBytes, accounts };
}
