import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { useSession } from "@/lib/auth-client";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useEffect } from "react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function SidebarSkeleton() {
  return (
    <div
      className="flex h-screen w-[216px] shrink-0 flex-col sticky top-0"
      style={{
        background: "hsl(var(--sidebar-bg))",
        borderRight: "1px solid hsl(var(--sidebar-border))",
      }}
    >
      {/* Logo */}
      <div
        className="flex h-11 shrink-0 items-center gap-2 px-4"
        style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
      >
        <div className="h-5 w-5 rounded-[5px] shimmer" />
        <div className="h-3.5 w-20 rounded shimmer" />
      </div>
      {/* Workspace */}
      <div
        className="px-2 py-1.5"
        style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
      >
        <div className="h-7 w-full rounded-md shimmer" />
      </div>
      {/* Nav */}
      <div className="flex-1 p-2 space-y-px">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[27px] w-full rounded-md shimmer opacity-60" />
        ))}
      </div>
    </div>
  );
}

function AppLayout() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();

  const {
    workspaces,
    isLoading: workspacesLoading,
    isError: workspacesError,
  } = useWorkspaces({ enabled: !sessionPending && !!session });

  useEffect(() => {
    if (!sessionPending && !session) router.navigate({ to: "/login" });
  }, [session, sessionPending, router]);

  if (
    sessionPending ||
    (!workspacesError && workspacesLoading && workspaces === undefined)
  ) {
    return (
      <div className="flex h-screen" style={{ background: "hsl(var(--app-bg))" }}>
        <SidebarSkeleton />
        <div className="flex-1" style={{ background: "hsl(var(--app-bg))" }} />
      </div>
    );
  }

  if (!session) return null;

  if (workspacesError) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: "hsl(var(--app-bg))" }}
      >
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground">
            Failed to load workspaces
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Check your connection and{" "}
            <button
              onClick={() => window.location.reload()}
              className="text-foreground/70 hover:text-foreground underline cursor-pointer"
            >
              refresh
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen"
      style={{ background: "hsl(var(--app-bg))" }}
    >
      <AppSidebar />
      <main className="flex-1 overflow-auto animate-in fade-in duration-150">
        <Outlet />
      </main>
    </div>
  );
}
