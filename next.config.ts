import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [
    "better-sqlite3",
    "@langchain/langgraph-checkpoint-sqlite",
    "@modelcontextprotocol/sdk",
    "ws",
  ],
};
export default config;
