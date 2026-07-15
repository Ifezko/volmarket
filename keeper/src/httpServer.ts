import http from "node:http";
import { getSignal } from "./signalStore.js";
import { log } from "./config.js";

// Tiny read-only HTTP surface so the frontend can draw the real signal feed:
//   GET /signal?fixtureId=&oddKey=&marketParams=  -> { points: [{t, v}] }
//   GET /health                                    -> "ok"
// CORS-open (public, non-sensitive market data). Railway sets PORT; default for local runs.
export function startHttpServer(): http.Server {
  const port = Number(process.env.PORT ?? 8080);
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (url.pathname === "/signal") {
      const fixtureId = Number(url.searchParams.get("fixtureId"));
      const oddKey = Number(url.searchParams.get("oddKey"));
      const marketParams = Number(url.searchParams.get("marketParams") ?? 0);
      const points =
        Number.isFinite(fixtureId) && Number.isFinite(oddKey) ? getSignal(fixtureId, oddKey, marketParams) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ points }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => log.info(`signal HTTP server listening on :${port}`));
  return server;
}
