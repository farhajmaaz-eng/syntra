import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { cpus: 1 },
  serverExternalPackages: [
    "better-sqlite3",
    "@open-pencil/scene-graph",
    "@modelcontextprotocol/sdk",
    "@openai/codex",
    "ws",
  ],
};
export default config;
