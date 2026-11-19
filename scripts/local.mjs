import { spawn } from "node:child_process";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// The combined launcher runs a real external worker. Tell Next to proxy to it
// instead of starting its embedded worker against the same data directory.
const env = { ...process.env, WORKER_EXTERNAL: "1" };
const processes = ["worker", "dev"].map((name) =>
  spawn(npm, ["run", name], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  }),
);
process.on("SIGINT", () => processes.forEach((p) => p.kill("SIGINT")));
process.on("SIGTERM", () => processes.forEach((p) => p.kill("SIGTERM")));
