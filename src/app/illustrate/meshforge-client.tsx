"use client";

import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@/meshforge/client/App").then((module) => module.App), {
  ssr: false,
  loading: () => <main className="meshforge-loading" aria-busy="true">Loading Illustrate…</main>,
});

export default function MeshForgeClient() {
  return <Editor />;
}
