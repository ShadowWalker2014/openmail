import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { useSession } from "@/lib/auth-client";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useEffect, useState } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const SIDEBAR_KEY = "sidebar_state";

function SidebarSkeleton() {
  return (
    <div
      className="flex h-svh w-[216px] shrink-0 flex-col"
      style={{
        background: "hsl(var(--sidebar))",
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
        className="px-2 py-2"
        style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
      >
        <div className="h-10 w-full rounded-md shimmer" />
      </div>
      {/* Nav */}
      <div className="flex-1 p-2 space-y-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-8 w-full rounded-md shimmer opacity-60" />
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

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(SIDEBAR_KEY);
    return stored === null ? true : stored === "true";
  });

  const handleSidebarOpenChange = (value: boolean) => {
    setSidebarOpen(value);
    localStorage.setItem(SIDEBAR_KEY, String(value));
  };

  useEffect(() => {
    if (!sessionPending && !session) router.navigate({ to: "/login" });
  }, [session, sessionPending, router]);

  if (
    sessionPending ||
    (!workspacesError && workspacesLoading && workspaces === undefined)
  ) {
    return (
      <div className="flex h-svh" style={{ background: "hsl(var(--background))" }}>
        <SidebarSkeleton />
        <div className="flex-1" />
      </div>
    );
  }

  if (!session) return null;

  if (workspacesError) {
    return (
      <div className="flex h-svh items-center justify-center" style={{ background: "hsl(var(--background))" }}>
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground">Failed to load workspaces</p>
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
    <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
      <AppSidebar />
      <SidebarInset className="overflow-y-auto h-dvh">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});
