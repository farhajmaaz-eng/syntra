import { build } from "esbuild";

process.env.GOMAXPROCS ??= "1";

await build({
  entryPoints: ["src/design-studio/canvas.ts"],
  outdir: "public/design-runtime",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  external: ["fs", "path", "node:*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
