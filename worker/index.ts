import "./instance-lock";
import "dotenv/config";
import http from "node:http";
import { WebSocketServer } from "ws";
import { db, set, event, secret } from "./store";
import { studio } from "./mcp";
import { codex } from "./codex";
import {
  active,
  recover,
  tick,
  interruptStopped,
  abortAll,
  redact,
  publicData,
  isConnecting,
  isMaintaining,
  action,
  handleWorkerGet,
} from "./service";

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.writeHead(401).end('{"error":"Unauthorized"}');
    return;
  }
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname.slice(1);
    if (req.method === "GET") {
      const result = handleWorkerGet(path, url.searchParams);
      if (result.kind === "binary") {
        res.setHeader("Content-Type", result.mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
          "Content-Disposition",
          `${result.inline ? "inline" : "attachment"}; filename="${result.filename}"`,
        );
        res.end(result.bytes);
        return;
      }
      if (result.kind === "json") {
        res.end(JSON.stringify(result.data));
        return;
      }
      res.writeHead(404).end("{}");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(404).end("{}");
      return;
    }
    req.setEncoding("utf8");
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (
        raw.length >
        (path === "assets/save"
          ? 3000000
          : ["market/import", "telemetry/import"].includes(path)
            ? 1000000
            : 128000)
      )
        throw new Error("Request too large");
    }
    const result = await action(path, JSON.parse(raw || "{}"));
    res.end(JSON.stringify(publicData(result)));
  } catch (e) {
    res.writeHead(400).end(JSON.stringify({ error: redact(e) }));
  }
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  // Browser WebSocket is an invalidation signal only; it exposes no data or authority.
  const origin = req.headers.origin;
  if (!origin || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
const port = Number(process.env.WORKER_PORT || 4318);
set("workerPort", port);
server.on("error", (e) => {
  event(`Worker server failed: ${redact(e)}`, "System", "error");
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Syntra worker listening",
      host: "127.0.0.1",
      port,
    }),
  );
  recover();
  void studio.connect();
});
let ticking = false;
const timer = setInterval(() => {
  for (const c of wss.clients)
    if (c.readyState === 1) c.send('{"type":"refresh"}');
  interruptStopped();
  if (!studio.client && !isConnecting() && !isMaintaining())
    void studio.maintain().catch((e) => event(redact(e), "System", "error"));
  if (
    !ticking &&
    !isConnecting() &&
    !isMaintaining()
  ) {
    ticking = true;
    void tick()
      .catch((e) => event(String(e), "System", "error"))
      .finally(() => (ticking = false));
  }
}, 1200);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  abortAll();
  const deadline = Date.now() + 15_000;
  while (active.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  codex.shutdown();
  await studio.close();
  wss.close();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
