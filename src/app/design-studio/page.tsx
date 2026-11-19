import type { Metadata } from "next";
import DesignStudioClient from "./studio-client";
import "./design-studio.css";

export const metadata: Metadata = { title: "Design Studio | Syntra Studio" };

export default function DesignStudioPage() {
  return <DesignStudioClient />;
}
