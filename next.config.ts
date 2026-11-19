import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { cpus: 1 },
  outputFileTracingIncludes: {
    "/api/design-assets/*": [
      "./node_modules/canvaskit-wasm/bin/canvaskit.wasm",
      "./node_modules/@open-pencil/core/assets/*.ttf",
    ],
  },
  serverExternalPackages: [
    "better-sqlite3",
    "@open-pencil/scene-graph",
    "@modelcontextprotocol/sdk",
    "@openai/codex",
    "ws",
  ],
};
export default config;
