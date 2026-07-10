# Deploying Volmarket

Four pieces, four homes. They deploy independently — nothing here is a monolith.

| Piece | Where it goes | Why |
|---|---|---|
| `frontend/` | **Vercel** (static) | Single self-contained `index.html`, no server needed. |
| everything (this repo) | **GitHub** | Source of truth; Vercel + your keeper host pull from it. |
| `keeper/` | **An always-on host** (Railway, Fly.io, a VPS, systemd) — **NOT Vercel** | It's a long-lived process that watches an SSE stream and polls the chain. Vercel functions are request-scoped and will not keep it alive. |
| `signal_markets/` + `mock_validator/` | **Solana devnet** | Real-time World Cup data (Level 12) is devnet-only; the programs live where the data is. |

---

## 1. Code → GitHub

```bash
git remote add origin git@github.com:<you>/volmarket.git
git push -u origin main
```

Before the first push, confirm no secrets are staged — see the [pre-push check](#pre-push-secret-check) below. `.gitignore` already excludes `.env`, `*id.json`, and `keeper/signal_markets.idl.json`, but the check is your backstop.

## 2. Programs → Solana devnet

```bash
cd signal_markets
anchor build
anchor deploy --provider.cluster devnet
# Deploy mock_validator too (devnet demo), then point TXLINE_PROGRAM_ID at it — see its README.
```

`anchor build` produces `signal_markets/target/idl/signal_markets.json`. The keeper needs a **copy** of that IDL (see next step) — the `target/` dir is git-ignored and won't exist on your keeper host.

Note the deployed program id and set it as `PROGRAM_ID` for the keeper.

## 3. Frontend → Vercel

The frontend is a static `index.html`. Point a Vercel project at the repo with:

- **Root directory:** `frontend`
- **Framework preset:** Other (no build step)
- **Output directory:** `.` (serve the directory as-is)

No secrets go to Vercel — the frontend holds no keys and talks only to public RPC + read-only chain state. If you later add a public RPC URL or program id to the frontend, those are non-secret and fine to expose.

## 4. Keeper → always-on host

The keeper is a persistent Node process (`npm run build && npm start`). Deploy it to something that keeps a process running — **not** Vercel/Netlify/Cloudflare Pages.

```bash
cd keeper
npm ci
# Copy the IDL in from the anchor build (git-ignored, so it isn't in the repo):
cp ../signal_markets/target/idl/signal_markets.json ./signal_markets.idl.json
npm run build
npm start
```

On a host where you don't have the `signal_markets/` workspace checked out next to the keeper, commit-free options are: bake `signal_markets.idl.json` into the deploy artifact (CI copies it in), or fetch it from your build. `IDL_PATH` defaults to `./signal_markets.idl.json` for exactly this reason.

### Keeper env — what goes where

Set these on the keeper host (via its secret manager / dashboard env, **not** a committed file). Start from `keeper/.env.example`:

| Var | Value | Secret? |
|---|---|---|
| `TXLINE_NETWORK` | `devnet` | no |
| `SOLANA_RPC_URL` | your RPC (blank → public devnet) | no |
| `PROGRAM_ID` | your deployed `signal_markets` id | no |
| `IDL_PATH` | `./signal_markets.idl.json` (default) | no |
| `KEEPER_SECRET_KEY` | keeper keypair as a JSON byte array | **YES** |
| `KEEPER_KEYPAIR` | keypair file path (local dev only) | path is not secret; the **file** is |
| `TXLINE_*` | oracle host / program / token / service level | no (API token, if any, is) |
| `BOOTSTRAP_LIQUIDITY_USDC` | opposing-pool seed per new market (default `10`; `0` disables) | no |
| `APP_USDC_MINT` | canonical app USDC mint (default matches the frontend) | no |

### Two-sided markets need the keeper running AND funded

Markets are two-sided (Holds/Breaks pools). For the losing side to never be zero — so winners get
real payouts and the slip's "To win" is truthful — the keeper **bootstraps the empty pool of every
new market** from its own **canonical USDC** balance (`src/bootstrap.ts`, run at startup and each
refresh). So the keeper must be:

- **Running** — on an always-on host (above). If it isn't, new user markets stay one-sided and the
  UI's payout multiplier (which assumes bootstrap liquidity) won't materialize.
- **Funded with canonical USDC** — it *spends* `BOOTSTRAP_LIQUIDITY_USDC` per empty pool. Top it up:
  `KEEPER_USDC_TARGET=500 npx tsx scripts/fund-keeper.ts` (devnet: mints via the treasury mint
  authority in `.treasury.json`). One-shot seed of existing markets: `npx tsx scripts/bootstrap-all.ts`.
  It also needs SOL for tx fees. Monitor the balance; low USDC just makes bootstrap a no-op (logged).

### Container deploy (Docker / Fly.io / Railway)

Ready-made artifacts live in `keeper/`: **`Dockerfile`** (`node:20-slim`, `npm ci` → `npm run build`
→ `node dist/index.js`), **`.dockerignore`** (keeps `.env`/keypairs/`.treasury.json` out of the
image), and **`fly.toml`** (single always-on worker, no HTTP port). Both IDLs
(`signal_markets.idl.json`, `txoracle.idl.json`) are committed, so a git-based build needs no anchor
workspace.

- **Fly.io:** `cd keeper && fly launch --no-deploy --copy-config` → `fly secrets set …` (see the
  header of `fly.toml`) → `fly deploy`.
- **Railway:** new service → set **Root Directory** to `keeper/` (it auto-detects the Dockerfile) →
  add the env vars in the service settings → deploy.
- **Bare Docker / VPS:** `docker build -t volmarket-keeper keeper/ && docker run -d --restart=always
  --env-file keeper/.env volmarket-keeper` (or pass env individually).

`KEEPER_SECRET_KEY` (the keeper keypair as a JSON byte array — the contents of an `id.json`) must be
set as a **host secret / env var only**, never committed and never baked into the image. Get the
value with `cat ~/.config/solana/id.json`. The image and repo carry no key material.

## Keeper key: two load modes

`resolver.ts` loads the signing key in priority order:

1. **`KEEPER_SECRET_KEY`** — if set and non-empty, parsed as a JSON byte array (the same
   format as a Solana `id.json`, e.g. `[12,34,...]`). **Use this on deployed hosts** — inject
   it through the host's secret manager so no key file ever touches the deploy artifact or git.
2. **`KEEPER_KEYPAIR`** — otherwise, read the keypair from this file path. Convenient for local
   dev where you already have `~/.config/solana/id.json`.

The key material is **never logged** — the keeper logs only *which mode* was used. If neither is
set, startup fails with a clear error rather than running keyless.

To get the byte-array form for `KEEPER_SECRET_KEY`, just read your keypair file — it already is
one: `cat ~/.config/solana/id.json`. Paste that array into the host's secret manager.

## Never commit

- **`.env`** — real config/secrets. Only `.env.example` (placeholders) is committed.
- **`*id.json`** — any Solana keypair file. `.gitignore` matches `id.json` and `keeper-id.json` etc.
- **`KEEPER_SECRET_KEY`** — keep it blank in `.env.example`; the real value lives only in your
  host's secret manager.

A leaked keeper key lets anyone submit resolutions as you (grief / wasted fees), and a leaked
wallet key can drain funds. Rotate immediately if either is exposed: generate a new keypair,
update the host secret, and (for a market authority) migrate.

## Pre-push secret check

Run this before every push (or wire it into a pre-push hook). It greps **staged** content for
the two things that must never land in git and aborts if it finds them:

```bash
# Fails (non-zero) if a .env or *id.json file is staged, or if staged content
# looks like a bare secret-key byte array.
git diff --cached --name-only | grep -E '(^|/)\.env$|id\.json$' && {
  echo "✋ Refusing: a .env or id.json file is staged. Unstage it before pushing."; exit 1; }
git diff --cached -U0 | grep -E '^\+.*\[([0-9]{1,3},){31,}[0-9]{1,3}\]' && {
  echo "✋ Refusing: staged diff contains what looks like a secret-key byte array."; exit 1; }
echo "✓ No .env / id.json / inline secret key staged."
```

To install it as a hook:

```bash
cat > .git/hooks/pre-push <<'SH'
#!/usr/bin/env bash
git diff --cached --name-only | grep -E '(^|/)\.env$|id\.json$' && {
  echo "✋ pre-push: a .env or id.json file is staged."; exit 1; }
git diff --cached -U0 | grep -E '^\+.*\[([0-9]{1,3},){31,}[0-9]{1,3}\]' && {
  echo "✋ pre-push: staged diff contains a suspected secret-key byte array."; exit 1; }
exit 0
SH
chmod +x .git/hooks/pre-push
```

> The hook inspects the **staged index**, so stage your changes (`git add`) before relying on it.
