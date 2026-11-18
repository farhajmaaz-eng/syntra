"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

export function DetailDrawer({
  title,
  subtitle,
  close,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`detail-drawer ${wide ? "v2-wide-drawer" : ""}`}
      aria-labelledby="drawer-title"
      onClose={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="drawer-content">
        <header className="drawer-heading">
          <div>
            <span className="section-kicker">Details</span>
            <h2 id="drawer-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-link"
            aria-label="Close details"
            onClick={() => ref.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pending,
  close,
  confirm,
  tone = "destructive",
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending: boolean;
  close: () => void;
  confirm: () => Promise<void>;
  tone?: "destructive" | "approval" | "neutral";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={close}
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{children}</p>
      <div className="actions">
        <Button variant="ghost" disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          variant={tone === "destructive" ? "destructive" : "outline"}
          className={tone === "approval" ? "approve-button" : ""}
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending ? "Recording…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export type ResourceSkeletonVariant =
  | "default"
  | "cards"
  | "table"
  | "detail"
  | "messages"
  | "charts";

export function ResourceSkeleton({
  variant = "default",
  label = "Loading content",
}: {
  variant?: ResourceSkeletonVariant;
  label?: string;
}) {
  return (
    <div className="skel-resource" role="status" aria-label={label}>
      {variant === "cards" && (
        <div className="skel-card-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="panel skel-card-item" key={i}>
              <span className="skeleton skel-media" />
              <span className="skeleton skel-line w-65" />
              <span className="skeleton skel-line w-45" />
              <div className="skel-row-end">
                <span className="skeleton skel-tag" />
                <span className="skeleton skel-line w-25" />
              </div>
            </div>
          ))}
        </div>
      )}
      {variant === "table" && (
        <div className="panel skel-table">
          <div className="skel-table-head">
            <span className="skeleton skel-line w-20" />
            <span className="skeleton skel-line w-15" />
            <span className="skeleton skel-line w-15" />
            <span className="skeleton skel-line w-15" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="skel-table-row" key={i}>
              <span className="skeleton skel-line w-55" />
              <span className="skeleton skel-line w-25" />
              <span className="skeleton skel-line w-20" />
              <span className="skeleton skel-tag" />
            </div>
          ))}
        </div>
      )}
      {variant === "detail" && (
        <div className="skel-detail-stack">
          <span className="skeleton skel-line w-45" />
          <span className="skeleton skel-line w-85" />
          <span className="skeleton skel-line w-70" />
          <span className="skeleton skel-code-block" />
        </div>
      )}
      {variant === "messages" && (
        <div className="skel-messages">
          {[0, 1, 2].map((i) => (
            <div className="skel-message-card" key={i}>
              <span className="skeleton skel-avatar" />
              <div className="skel-message-lines">
                <span className="skeleton skel-line w-30" />
                <span className="skeleton skel-line w-90" />
                <span className="skeleton skel-line w-65" />
              </div>
            </div>
          ))}
        </div>
      )}
      {variant === "charts" && (
        <div className="skel-charts-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="panel skel-chart-card" key={i}>
              <span className="skeleton skel-line w-40" />
              <span className="skeleton skel-line w-25" />
              <span className="skeleton skel-chart-area" />
            </div>
          ))}
        </div>
      )}
      {variant === "default" && (
        <div className="panel skel-list">
          {[0, 1, 2].map((i) => (
            <div className="skel-list-row" key={i}>
              <span className="skeleton skel-line w-65" />
              <span className="skeleton skel-tag" />
            </div>
          ))}
        </div>
      )}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function WorkspaceSkeleton({ page = "home" }: { page?: string }) {
  return (
    <div
      className="loading-layout"
      role="status"
      aria-label="Loading workspace"
    >
      {page === "home" && (
        <>
          <div className="stats overview-stats">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel-stat-card">
                <span className="skeleton skel-line w-35" />
                <span className="skeleton skel-kpi" />
                <span className="skeleton skel-line w-55" />
              </div>
            ))}
          </div>
          <div className="desktop-columns">
            <div className="desktop-primary">
              <div className="panel skel-panel-pad">
                <span className="skeleton skel-line w-30" />
                <span className="skeleton skel-textarea" />
                <div className="skel-row-end">
                  <span className="skeleton skel-line w-35" />
                  <span className="skeleton skel-btn" />
                </div>
              </div>
              <div className="panel skel-table">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div className="skel-table-row" key={i}>
                    <span className="skeleton skel-line w-55" />
                    <span className="skeleton skel-line w-20" />
                    <span className="skeleton skel-tag" />
                  </div>
                ))}
              </div>
            </div>
            <div className="desktop-secondary">
              <div className="panel skel-panel-pad">
                <span className="skeleton skel-line w-40" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <div className="skel-agent-item" key={i}>
                    <span className="skeleton skel-avatar" />
                    <div className="skel-agent-lines">
                      <span className="skeleton skel-line w-55" />
                      <span className="skeleton skel-line w-85" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel skel-panel-pad">
                <span className="skeleton skel-line w-55" />
                <span className="skeleton skel-line w-85" />
                <span className="skeleton skel-line w-70" />
              </div>
            </div>
          </div>
        </>
      )}

      {page === "chat" && (
        <div className="chat-layout">
          <div className="panel skel-panel-pad skel-chat-pane">
            <span className="skeleton skel-line w-35" />
            <ResourceSkeleton variant="messages" />
            <span className="skeleton skel-textarea" />
          </div>
          <div className="v2-stack">
            <div className="panel skel-panel-pad">
              <span className="skeleton skel-line w-55" />
              <span className="skeleton skel-line w-90" />
              <span className="skeleton skel-line w-70" />
              <span className="skeleton skel-btn" />
            </div>
          </div>
        </div>
      )}

      {page === "team" && (
        <div className="v2-agent-workspace">
          <div className="panel skel-panel-pad">
            <span className="skeleton skel-input" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div className="skel-agent-item" key={i}>
                <span className="skeleton skel-avatar" />
                <div className="skel-agent-lines">
                  <span className="skeleton skel-line w-45" />
                  <span className="skeleton skel-line w-85" />
                </div>
              </div>
            ))}
          </div>
          <div className="v2-stack">
            <div className="panel skel-panel-pad">
              <span className="skeleton skel-line w-35" />
              <ResourceSkeleton variant="messages" />
            </div>
            <div className="panel skel-panel-pad">
              <span className="skeleton skel-line w-40" />
              <span className="skeleton skel-textarea" />
            </div>
          </div>
        </div>
      )}

      {page === "tasks" && (
        <div className="v2-stack">
          <div className="panel skel-summary-bar">
            <span className="skeleton skel-line w-35" />
            <span className="skeleton skel-btn" />
          </div>
          <div className="panel skel-list">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div className="skel-task-item" key={i}>
                <span className="skeleton skel-avatar" />
                <div className="skel-agent-lines">
                  <span className="skeleton skel-line w-55" />
                  <span className="skeleton skel-line w-35" />
                </div>
                <span className="skeleton skel-tag" />
              </div>
            ))}
          </div>
        </div>
      )}

      {page === "reviews" && (
        <div className="v2-stack">
          <span className="skeleton skeleton-summary" />
          <div className="skeleton-grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="panel skel-card-item" key={i}>
                <span className="skeleton skel-media" />
                <span className="skeleton skel-line w-65" />
                <span className="skeleton skel-line w-40" />
              </div>
            ))}
          </div>
        </div>
      )}

      {(page === "market" || page === "logs") && (
        <div className="v2-stack">
          <div className="panel skel-summary-bar">
            <span className="skeleton skel-line w-45" />
            <span className="skeleton skel-btn" />
          </div>
          <ResourceSkeleton variant="table" />
        </div>
      )}

      {(page === "pitches" || page === "games" || page === "library") && (
        <div className="v2-stack">
          <div className="skel-toolbar">
            <span className="skeleton skel-input" />
            <span className="skeleton skel-btn" />
          </div>
          <ResourceSkeleton variant="cards" />
        </div>
      )}

      {page === "settings" && (
        <div className="settings-layout">
          <div className="panel skel-panel-pad">
            <span className="skeleton skel-line w-35" />
            <span className="skeleton skel-input" />
            <span className="skeleton skel-input" />
            <div className="skel-two-inputs">
              <span className="skeleton skel-input" />
              <span className="skeleton skel-input" />
            </div>
            <span className="skeleton skel-btn" />
          </div>
          <div className="v2-stack">
            <div className="panel skel-panel-pad">
              <span className="skeleton skel-line w-45" />
              <span className="skeleton skel-input" />
              <span className="skeleton skel-btn" />
            </div>
          </div>
        </div>
      )}

      {![
        "home",
        "chat",
        "team",
        "tasks",
        "reviews",
        "market",
        "logs",
        "pitches",
        "games",
        "library",
        "settings",
      ].includes(page) && <ResourceSkeleton variant="cards" />}

      <span className="sr-only">Connecting to your local worker…</span>
    </div>
  );
}

export function Skeleton({ page = "home" }: { page?: string }) {
  return <WorkspaceSkeleton page={page} />;
}
