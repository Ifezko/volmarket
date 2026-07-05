import EventSource from "eventsource";
import { PublicKey } from "@solana/web3.js";
import { CONFIG, log } from "./config.js";
import { authHeaders } from "./auth.js";
import { oddOutcome } from "./markets.js";

/**
 * Normalised proof the on-chain `resolve_market` needs:
 *  - value: the attested datapoint as a scaled integer — for odds this is the demargined
 *           implied PROBABILITY × 1000 (see pctToValue), score as-is
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
  superOddsType?: string; // odds: the record's SuperOddsType (matched against a market's odd type)
  marketParams?: number;  // odds: parsed MarketParameters — Over/Under line × 100, 0 if none
  value?: number;         // score: the scaled datapoint. Odds values are resolved PER MARKET from
                          // `raw` (a record carries all outcomes' PriceNames[]/Pct[]), not stored here.
  messageId?: string;     // for odds updates — needed (with ts) to fetch their proof
  ts?: number;            // for odds updates — REQUIRED alongside messageId (see getOddsProof)
  status?: string;        // e.g. "in_play" | "ended"
  raw: unknown;           // odds: the record with PriceNames[]/Pct[] for per-market resolution
}

/**
 * TxLINE's confirmed odds format: a datapoint carries both `Prices[]` (decimal-odds × 1000,
 * e.g. 2536 = 2.536) and `Pct[]` (demargined implied probability as a 3-decimal percent STRING,
 * e.g. "39.432" = 39.432%). We settle on `Pct` — the true probability — NOT `Prices`.
 * Scale it to an integer by × 1000 ("39.432" -> 39432): probability × 1000, i.e. a percent
 * with 3 decimals as an int. Market level L is stored on the SAME scale so comparisons line up.
 */
function pctToValue(pct: unknown): number {
  return Math.round(parseFloat(String(pct)) * 1000);
}

/**
 * The odds record — the object carrying the parallel PriceNames[] / Prices[] / Pct[] arrays —
 * can arrive in two shapes: as the payload itself (the stream) or nested under `.odds` (the
 * validation response). Resolve whichever one actually holds the Pct so callers work with either.
 */
function oddsRecord(payload: any): any {
  if (payload && (payload.Pct != null || payload.pct != null)) return payload;
  if (payload?.odds && (payload.odds.Pct != null || payload.odds.pct != null)) return payload.odds;
  return payload?.odds ?? payload;
}

/** The Pct[] array from either payload shape, or null if absent / not an array. */
function pctArray(payload: any): unknown[] | null {
  const rec = oddsRecord(payload);
  const pct = rec?.Pct ?? rec?.pct;
  return Array.isArray(pct) ? pct : null;
}

/** The PriceNames[] array from either payload shape, or null if absent / not an array. */
function priceNamesArray(payload: any): unknown[] | null {
  const rec = oddsRecord(payload);
  const names = rec?.PriceNames ?? rec?.priceNames;
  return Array.isArray(names) ? names : null;
}

/** The record's SuperOddsType (e.g. "1X2_PARTICIPANT_RESULT"), or null. */
export function superOddsType(payload: any): string | null {
  const rec = oddsRecord(payload);
  const s = rec?.SuperOddsType ?? rec?.superOddsType;
  return s != null ? String(s) : null;
}

/**
 * Parse a TxLINE MarketParameters string into the integer the on-chain `market_params` uses:
 * Over/Under's goal line × 100 ("line=1.5" -> 150). 1X2 and other line-less types carry no
 * MarketParameters -> 0. So two Over/Under lines (1.5 vs 2.5) map to different markets — this is
 * the value the keeper compares against a market's marketParams to confirm it's the same line.
 */
export function parseMarketParams(marketParameters: unknown): number {
  if (marketParameters == null) return 0;
  const s = String(marketParameters);
  const m = s.match(/line\s*=\s*(-?\d+(?:\.\d+)?)/i) ?? s.match(/(-?\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : 0;
}

/** The record's MarketParameters, already parsed to the on-chain integer form. */
export function recordMarketParams(payload: any): number {
  const rec = oddsRecord(payload);
  return parseMarketParams(rec?.MarketParameters ?? rec?.marketParameters);
}

/**
 * Settlement value for a market's outcome, resolved BY LABEL against the CONFIRMED PriceNames
 * conventions (see ODD_OUTCOMES in markets.ts):
 *   oddKey -> outcome label (e.g. "part1"/"draw"/"part2", "over"/"under")
 *          -> its index in the record's PriceNames[] -> Pct[] at that index, × 1000.
 * Returns null — never a guessed value — if the oddKey is unknown or its label is absent from
 * PriceNames[], so a bad/missing mapping SKIPS settlement instead of resolving the wrong outcome.
 */
export function resolveOutcomeValue(payload: any, oddKey: number): number | null {
  const oc = oddOutcome(oddKey);
  if (!oc) return null;
  const names = priceNamesArray(payload);
  const pct = pctArray(payload);
  if (!names || !pct) return null;
  const idx = names.findIndex((n) => String(n) === oc.label);
  if (idx < 0 || idx >= pct.length) return null;
  const value = pctToValue(pct[idx]);
  return Number.isFinite(value) ? value : null;
}

/**
 * True only if an odds record carries a usable demargined percentage. Some TxLINE market types
 * have 'push' behaviour (shared outcomes — e.g. quarter Asian handicaps like 2.25, some
 * over/unders) and carry NO Pct[]; they can't be settled on a probability and must never become
 * a signal market. Requires Pct to be a non-empty array of parseable numbers (either payload shape).
 */
export function hasPct(payload: any): boolean {
  const pct = pctArray(payload);
  return (
    !!pct &&
    pct.length > 0 &&
    pct.every((p: unknown) => Number.isFinite(parseFloat(String(p))))
  );
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
  // The real payload uses PascalCase (FixtureId/MessageId/Ts/Pct); accept camelCase too.
  if (!raw) return null;
  const fixtureId = Number(raw.FixtureId ?? raw.fixtureId);
  if (!Number.isFinite(fixtureId)) return null;

  if (raw.type === "odds" || raw.odds || raw.Pct) {
    // Only expose signal markets on odds that carry a demargined percentage. Push-behaviour
    // markets (shared outcomes — quarter Asian handicaps like 2.25, some over/unders) carry NO
    // Pct[] and can't be settled on a probability, so skip them — never create a Pct-less market.
    if (!hasPct(raw)) {
      log.debug("skipping push/no-Pct market", "fixture", fixtureId, "superOddsType", superOddsType(raw));
      return null;
    }
    // A record covers ALL outcomes of one (SuperOddsType, MarketParameters) line. We carry it
    // whole; the keeper matches each market by SuperOddsType + MarketParameters and resolves that
    // market's outcome value from PriceNames[]/Pct[] (see resolveOutcomeValue).
    return {
      kind: "odds",
      fixtureId,
      superOddsType: superOddsType(raw) ?? undefined,
      marketParams: recordMarketParams(raw),
      messageId: String(raw.MessageId ?? raw.messageId ?? raw.id),
      ts: Number(raw.Ts ?? raw.ts ?? raw.timestamp ?? Date.now()),
      raw,
    };
  }
  if (raw.type === "score" || raw.score) {
    return {
      kind: "score",
      fixtureId,
      value: Number(raw.value ?? raw.score),
      raw,
    };
  }
  if (raw.type === "status" || raw.status) {
    return { kind: "status", fixtureId, status: String(raw.status), raw };
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
 * Odds-update Merkle proof. Confirmed shape (see docs/volmarket-technical-doc.md §6):
 *   GET /api/odds/validation?messageId={id}&ts={ts}
 *   -> OddsValidation { odds, summary, subTreeProof, mainTreeProof }
 * Requires BOTH messageId and ts — messageId alone is not sufficient.
 * Odds use a TWO-stage proof (subTree + mainTree); scores use three-stage.
 */
export async function getOddsProof(
  messageId: string,
  ts: number | string,
  oddKey: number
): Promise<ProofResult> {
  const url = `${CONFIG.txlineBaseUrl}/api/odds/validation?messageId=${encodeURIComponent(messageId)}&ts=${encodeURIComponent(String(ts))}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`odds proof ${res.status} for ${messageId}@${ts}`);
  return parseOddsValidation(await res.json(), oddKey);
}

/**
 * Parse an OddsValidation response into the ProofResult resolve_market expects.
 * Forwards BOTH subTreeProof and mainTreeProof (two-stage) — see README seam #2.
 *
 * Settlement value is the demargined implied PROBABILITY for the outcome this market tracks,
 * resolved BY LABEL: oddKey -> outcome label -> its index in PriceNames[] -> Pct[] there (a
 * 3-decimal percent string like "39.432") — NOT Prices[] (decimal-odds × 1000, e.g. 2536 = 2.536).
 * Scaled × 1000 ("39.432" -> 39432): probability × 1000, matching the market's level L.
 */
function parseOddsValidation(json: any, oddKey: number): ProofResult {
  const value = resolveOutcomeValue(json, oddKey);
  if (value == null) {
    // The market's outcome label didn't match any PriceNames[] entry (unknown oddKey, or a push
    // market). Refuse to settle rather than resolve on the wrong outcome — the keeper catches this
    // and skips. Never settle on a guessed index.
    const oc = oddOutcome(oddKey);
    throw new Error(`no PriceNames match for oddKey ${oddKey} (label ${oc?.label ?? "?"}); refusing to settle`);
  }
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
