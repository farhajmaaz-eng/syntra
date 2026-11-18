import "./globals.css";
import "./features.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Syntra Studio — AI Roblox Development Workspace",
  description: "Your independent AI development team. Local by design.",
  openGraph: {
    title: "Syntra Studio — AI Roblox Development Workspace",
    description: "Your independent AI development team. Local by design.",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
