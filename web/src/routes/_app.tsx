import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { useSession } from "@/lib/auth-client";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useEffect } from "react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();

  // Only fetch workspaces once the session is confirmed — avoids a guaranteed
  // 401 on every page load while Better Auth is still hydrating the session.
  const { workspaces, isLoading: workspacesLoading, isError: workspacesError } = useWorkspaces({
    enabled: !sessionPending && !!session,
  });

  // Redirect unauthenticated users — must be in useEffect to avoid render-time side effects
  useEffect(() => {
    if (!sessionPending && !session) {
      router.navigate({ to: "/login" });
    }
  }, [session, sessionPending, router]);

  // No automatic onboarding redirect — default workspace is auto-created on signup.

  // Show skeleton while the session or workspace list is loading
  if (sessionPending || (!workspacesError && workspacesLoading && workspaces === undefined)) {
    return (
      <div className="flex h-screen">
        <div className="flex h-screen w-[220px] shrink-0 flex-col border-r bg-[hsl(var(--sidebar-bg))]">
          <div className="flex h-12 items-center gap-2 px-4 border-b border-[hsl(var(--sidebar-border))]">
            <div className="h-6 w-6 rounded-md bg-muted shimmer" />
            <div className="h-4 w-20 rounded bg-muted shimmer" />
          </div>
          <div className="p-3 border-b border-[hsl(var(--sidebar-border))]">
            <div className="h-8 w-full rounded-md bg-muted shimmer" />
          </div>
          <div className="flex-1 p-2 space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 w-full rounded-md bg-muted shimmer" />
            ))}
          </div>
        </div>
        <div className="flex-1 bg-[hsl(var(--app-bg))]" />
      </div>
    );
  }

  if (!session) return null;

  // Workspace fetch failed — show a minimal error so the user can refresh
  if (workspacesError) {
    return (
      <div className="flex h-screen items-center justify-center bg-[hsl(var(--app-bg))]">
        <div className="text-center">
          <p className="text-sm font-medium">Failed to load workspaces</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Check your connection and{" "}
            <button
              onClick={() => window.location.reload()}
              className="underline hover:no-underline cursor-pointer"
            >
              refresh
            </button>
          </p>
        </div>
      </div>
    );
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
