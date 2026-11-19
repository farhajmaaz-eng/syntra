import type { Metadata } from "next";
import GraphicsWorkspace from "./workspace";
import "./graphics.css";

export const metadata: Metadata = { title: "Syntra Graphics | Syntra Studio" };

export default function GraphicsPage() {
  return <GraphicsWorkspace />;
}
