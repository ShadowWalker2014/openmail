import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return (
      <div className="flex h-screen">
        {/* Sidebar skeleton */}
        <div className="flex h-screen w-[220px] shrink-0 flex-col border-r bg-[hsl(var(--sidebar-bg))]">
          <div className="flex h-12 items-center gap-2 px-4 border-b">
            <div className="h-6 w-6 rounded-md bg-muted shimmer" />
            <div className="h-4 w-20 rounded bg-muted shimmer" />
          </div>
          <div className="p-3 border-b">
            <div className="h-8 w-full rounded-md bg-muted shimmer" />
          </div>
          <div className="flex-1 p-2 space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 w-full rounded-md bg-muted shimmer" />
            ))}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex-1 bg-[hsl(var(--app-bg))]" />
      </div>
    );
  }

  if (!session) {
    router.navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="flex h-screen bg-[hsl(var(--app-bg))]">
      <AppSidebar />
      <main className="flex-1 overflow-auto animate-in fade-in duration-200">
        <Outlet />
      </main>
    </div>
  );
}
