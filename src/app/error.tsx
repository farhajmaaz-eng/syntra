"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="route-error-shell">
      <section className="panel route-error-card" role="alert">
        <span className="section-icon">
          <TriangleAlert size={16} />
        </span>
        <h1>Workspace view encountered an error</h1>
        <p>{error?.message || "An unexpected interface error occurred."}</p>
        <div className="actions">
          <Button variant="outline" onClick={reset}>
            <RotateCcw size={14} /> Retry view
          </Button>
          <Button asChild>
            <Link href="/">Return home</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
