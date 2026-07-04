/**
 * check-worldcup-coverage.ts
 *
 * Resolves the open question from README seam #2: is the World Cup actually
 * covered by TxLINE's free/guest tier, or does that "World Cup Free Tier" doc
 * page describe something not yet reflected in the guest snapshot endpoint?
 *
 * This does the fastest possible real test: guest-auth, then hit the odds
 * snapshot endpoint for a couple of plausible World Cup competition IDs and
 * see if real data comes back. One API round trip settles it — no more
 * doc archaeology needed.
 *
 * Usage:
 *   cd keeper
 *   npx tsx scripts/check-worldcup-coverage.ts
 *
 * If your base URL/network differs from the default, set env vars first:
 *   TXLINE_BASE_URL=https://oracle-dev.txodds.com npx tsx scripts/check-worldcup-coverage.ts
 */
import "dotenv/config";

const BASE = process.env.TXLINE_BASE_URL ?? "https://oracle.txodds.com";

// Best-guess competition IDs / names to try. TxLINE's guest endpoints are
// typically queried by competition ID; we don't have a confirmed ID for the
// World Cup finals, so we try a spread of things that might work and report
// exactly what each attempt returns. Adjust this list once support responds
// on Discord with the real competition ID.
const CANDIDATES: { label: string; params: Record<string, string> }[] = [
  { label: "competition name: 'World Cup'", params: { competition: "World Cup" } },
  { label: "competition name: 'FIFA World Cup'", params: { competition: "FIFA World Cup" } },
  { label: "sport=soccer, tournament=world-cup", params: { sport: "soccer", tournament: "world-cup" } },
];

async function guestStart(): Promise<string> {
  const res = await fetch(`${BASE}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new Error(`guest/start failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const jwt = json.jwt ?? json.token;
  if (!jwt) throw new Error("guest/start: no jwt in response body");
  return jwt;
}

async function trySnapshot(jwt: string, label: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/api/guest/odds/snapshot?${qs}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    const body = await res.text();
    const preview = body.length > 300 ? body.slice(0, 300) + "…" : body;
    console.log(`\n[${label}]`);
    console.log(`  GET ${url}`);
    console.log(`  status: ${res.status}`);
    console.log(`  body:   ${preview}`);
    if (res.ok && body && body !== "[]" && body !== "{}") {
      console.log(`  ✅ looks like real data came back`);
    } else {
      console.log(`  ❌ empty/error — not covered (or wrong param shape)`);
    }
  } catch (err) {
    console.log(`\n[${label}] request failed:`, err);
  }
}

async function main() {
  console.log(`Checking World Cup coverage against ${BASE} ...`);
  const jwt = await guestStart();
  console.log("Guest JWT acquired.");
  for (const c of CANDIDATES) {
    await trySnapshot(jwt, c.label, c.params);
  }
  console.log(
    "\nIf every attempt above is ❌, the free/guest snapshot endpoint likely doesn't yet serve\n" +
    "World Cup data under these param guesses. That doesn't necessarily mean it's uncovered —\n" +
    "the real competition ID/param shape may differ. Cross-check the exact query shape and any\n" +
    "confirmed competition ID once TxLINE support replies on Discord, then re-run this script."
  );
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
