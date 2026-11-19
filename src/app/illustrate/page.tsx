import type { Metadata } from "next";
import MeshForgeClient from "./meshforge-client";
import "./meshforge.css";

export const metadata: Metadata = { title: "Illustrate | Syntra Studio" };

export default function MeshForgePage() {
  return <MeshForgeClient />;
}
