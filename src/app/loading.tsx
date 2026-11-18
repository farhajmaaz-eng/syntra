import { WorkspaceSkeleton } from "@/components/ui/workspace-primitives";

export default function Loading() {
  return (
    <div className="route-loading-shell">
      <WorkspaceSkeleton page="home" />
    </div>
  );
}
