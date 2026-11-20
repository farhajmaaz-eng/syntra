"use strict";
const { createServer } = require("node:http");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { createInterface } = require("node:readline");

const host = "127.0.0.1";
const cookieName = "syntra_desktop";
const token = randomBytes(32).toString("hex");
const data = process.env.SYNTRA_DATA_DIR;
let server;
let nextServer;
let releaseWorkerLock;
let stopping = false;

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function protectedHandler(req, res, authority, handle) {
  const path = req.url?.split("?")[0];
  if (req.headers.host !== authority ||
      (req.headers.origin && req.headers.origin !== `http://${authority}`) ||
      ![undefined, "same-origin", "none"].includes(req.headers["sec-fetch-site"]) ||
      !path?.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (req.method === "GET" && equal(path, `/__syntra_desktop/${token}`)) {
    res.writeHead(303, {
      "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      Location: "/",
    }).end();
    return;
  }
  const cookie = req.headers.cookie?.split(";").map(part => part.trim())
    .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  // The existing external Illustrate endpoint already has its own bearer key.
  const mcpKey = process.env.SYNTRA_ILLUSTRATE_MCP_KEY || process.env.SYNTRA_MESHFORGE_MCP_KEY;
  const illustrate = req.method === "POST" &&
    ["/api/illustrate/mcp", "/api/meshforge/mcp"].includes(path) &&
    mcpKey && equal(req.headers.authorization, `Bearer ${mcpKey}`);
  if (!equal(cookie, token) && !illustrate) {
    res.writeHead(403, { "Cache-Control": "no-store" }).end("Open Syntra Desktop to access this workspace.");
    return;
  }
  res.setHeader("Referrer-Policy", "no-referrer");
  void handle(req, res).catch(error => {
    console.error("Desktop HTTP error:", error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const fail = error => reject(error);
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      resolve(server.address().port);
    });
  });
}

async function start() {
  if (!data) throw new Error("Missing desktop data directory.");
  process.chdir(__dirname);
  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.env.WORKER_EXTERNAL = "0";
  process.env.SYNTRA_DESKTOP = "1";
  process.env.CODEX_PROJECT_ROOT ||= join(data, "workspace");
  mkdirSync(process.env.CODEX_PROJECT_ROOT, { recursive: true });
  ({ releaseWorkerLock } = require("./desktop-lock.cjs"));

  const manifest = require("./.next/required-server-files.json");
  const config = { ...manifest.config, distDir: "./.next" };
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const { getRequestHandlers } = require("next/dist/server/lib/start-server");
  if (typeof getRequestHandlers !== "function") throw new Error("Incompatible Next.js standalone runtime.");
  const preferredFile = join(data, "desktop-port");
  let preferred = 0;
  try {
    const previous = Number(readFileSync(preferredFile, "utf8"));
    if (Number.isInteger(previous) && previous >= 1024 && previous <= 65535) preferred = previous;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let handlers;
  let authority;
  server = createServer((request, response) => {
    if (!handlers || stopping) {
      response.writeHead(503).end("Syntra Desktop is starting or stopping.");
      return;
    }
    protectedHandler(request, response, authority, handlers.requestHandler);
  });

  let port;
  try {
    port = await listen(preferred);
  } catch (error) {
    if (!preferred || error.code !== "EADDRINUSE") throw error;
    port = await listen(0);
  }
  authority = `${host}:${port}`;
  process.env.PORT = String(port);
  process.env.__NEXT_PRIVATE_ORIGIN = `http://${authority}`;
  handlers = await getRequestHandlers({
    dir: __dirname, port, hostname: host, isDev: false, server, quiet: true,
  });
  nextServer = handlers.server;
  writeFileSync(preferredFile, String(port), { mode: 0o600 });
  const health = await fetch(`http://${authority}/api/health`, {
    headers: { Cookie: `${cookieName}=${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!health.ok || !(await health.json()).ok) throw new Error("Syntra's embedded worker did not start.");
  process.stdout.write(`SYNTRA_READY ${port} ${token}\n`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 17_000);
  deadline.unref();
  try {
    server?.close();
    server?.closeAllConnections();
    await globalThis.__syntraDesktopShutdown?.();
    await nextServer?.close();
    releaseWorkerLock?.();
    process.exitCode = 0;
  } catch (error) {
    console.error("Desktop shutdown failed:", error);
    process.exitCode = 1;
  }
  process.exit(process.exitCode);
}

const commands = createInterface({ input: process.stdin });
commands.once("line", line => {
  if (line !== "start") {
    process.exit(1);
    return;
  }
  start().catch(error => {
    console.error("Desktop startup failed:", error);
    process.exit(1);
  });
});
commands.once("close", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
