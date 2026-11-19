import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [
    "better-sqlite3",
    "@modelcontextprotocol/sdk",
    "@openai/codex",
    "ws",
  ],
};
export default config;
