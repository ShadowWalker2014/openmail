import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  Mail,
  Zap,
  FileText,
  Settings,
  ChevronDown,
  Check,
  LogOut,
  Filter,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useSession, signOut } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";

const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/segments", icon: Filter, label: "Segments" },
  { to: "/broadcasts", icon: Mail, label: "Broadcasts" },
  { to: "/campaigns", icon: Zap, label: "Campaigns" },
  { to: "/templates", icon: FileText, label: "Templates" },
] as const;

function WorkspaceSwitcher() {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { workspaces } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeWs = workspaces?.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!workspaces?.length) return null;

  return (
    <div ref={ref} className="relative px-3 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-accent active:bg-accent/70 cursor-pointer"
      >
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground text-xs font-bold text-background">
          {(activeWs?.name ?? "W")[0].toUpperCase()}
        </div>
        <span className="flex-1 truncate text-left">{activeWs?.name ?? "Select workspace"}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Animated dropdown */}
      <div
        className={cn(
          "absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-background shadow-lg",
          "transition-[opacity,transform] duration-150 origin-top",
          open ? "opacity-100 scale-y-100 pointer-events-auto" : "opacity-0 scale-y-95 pointer-events-none"
        )}
      >
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => {
              setActiveWorkspaceId(ws.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-100 hover:bg-accent active:bg-accent/70 cursor-pointer"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground text-xs font-bold text-background">
              {ws.name[0].toUpperCase()}
            </div>
            <span className="flex-1 truncate text-left">{ws.name}</span>
            {ws.id === activeWorkspaceId && (
              <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const router = useRouter();
  const { data: session } = useSession();
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const queryClient = useQueryClient();

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r bg-[hsl(var(--sidebar-bg))] sticky top-0">
        {/* Logo */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 border-b border-[hsl(var(--sidebar-border))]">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
            <Mail className="h-3.5 w-3.5 text-background" />
          </div>
          <span className="text-sm font-semibold tracking-tight">OpenMail</span>
        </div>

        {/* Workspace switcher */}
        <div className="border-b border-[hsl(var(--sidebar-border))]">
          <WorkspaceSwitcher />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive =
              location.pathname === to || location.pathname.startsWith(to + "/");
            return (
            <Link
              key={to}
              to={to}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-100 mb-px cursor-pointer",
                isActive
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/70"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors duration-100",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span className="truncate">{label}</span>
            </Link>
            );
          })}

          <div className="my-1 h-px bg-[hsl(var(--sidebar-border))]" />

          <Link
            to="/settings"
            className={cn(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-100 cursor-pointer",
              location.pathname.startsWith("/settings")
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/70"
            )}
          >
            {location.pathname.startsWith("/settings") && (
              <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
            )}
            <Settings
              className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-100",
                location.pathname.startsWith("/settings")
                  ? "text-foreground"
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            <span className="truncate">Settings</span>
          </Link>
        </nav>

        {/* User */}
        {session?.user && (
          <div className="border-t border-[hsl(var(--sidebar-border))] p-2">
            <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                {session.user.name?.[0]?.toUpperCase() ??
                  session.user.email[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium leading-none">
                  {session.user.name ?? session.user.email}
                </p>
                {session.user.name && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground leading-none">
                  {session.user.email}
                </p>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() =>
                      signOut()
                        .then(() => {
                          // Clear ALL cached data to prevent cross-user data leakage
                          queryClient.clear();
                          setActiveWorkspaceId(null);
                          router.navigate({ to: "/login" });
                        })
                        .catch(() => toast.error("Sign out failed"))
                    }
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground active:bg-accent/70 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}
