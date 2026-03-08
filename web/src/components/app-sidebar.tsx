import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard, Users, Mail, Zap, FileText, Settings,
  ChevronDown, Check, LogOut, Filter,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useSession, signOut } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";

const NAV_ITEMS = [
  { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard"  },
  { to: "/contacts",   icon: Users,            label: "Contacts"   },
  { to: "/segments",   icon: Filter,           label: "Segments"   },
  { to: "/broadcasts", icon: Mail,             label: "Broadcasts" },
  { to: "/campaigns",  icon: Zap,              label: "Campaigns"  },
  { to: "/templates",  icon: FileText,         label: "Templates"  },
] as const;

function WorkspaceSwitcher() {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { workspaces } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeWs = workspaces?.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!workspaces?.length) return null;

  return (
    <div ref={ref} className="relative px-2 py-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-100 hover:bg-white/5 active:bg-white/[0.08] cursor-pointer"
      >
        {/* Workspace avatar */}
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-violet-500/20 text-[10px] font-bold text-violet-300 uppercase">
          {(activeWs?.name ?? "W")[0]}
        </div>
        <span className="min-w-0 flex-1 truncate text-left text-foreground/90">
          {activeWs?.name ?? "Select workspace"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      <div
        className={cn(
          "absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-xl shadow-black/40",
          "transition-[opacity,transform] duration-150 origin-top",
          open
            ? "opacity-100 scale-y-100 pointer-events-auto"
            : "opacity-0 scale-y-95 pointer-events-none"
        )}
      >
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => { setActiveWorkspaceId(ws.id); setOpen(false); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors duration-100 hover:bg-accent cursor-pointer"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-violet-500/20 text-[10px] font-bold text-violet-300 uppercase">
              {ws.name[0]}
            </div>
            <span className="flex-1 truncate text-left text-foreground/90">{ws.name}</span>
            {ws.id === activeWorkspaceId && (
              <Check className="h-3 w-3 shrink-0 text-foreground/60" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-[5px] text-[13px] transition-colors duration-100 cursor-pointer mb-px",
        active
          ? "bg-white/8 text-foreground font-medium"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground/90"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-violet-400" />
      )}
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors duration-100",
          active ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground/80"
        )}
      />
      <span className="truncate leading-none">{label}</span>
    </Link>
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
      <aside
        className="flex h-screen w-[216px] shrink-0 flex-col sticky top-0"
        style={{ background: "hsl(var(--sidebar-bg))", borderRight: "1px solid hsl(var(--sidebar-border))" }}
      >
        {/* ── Logo ── */}
        <div
          className="flex h-11 shrink-0 items-center gap-2 px-4"
          style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground">
            <Mail className="h-3 w-3 text-background" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">OpenMail</span>
        </div>

        {/* ── Workspace switcher ── */}
        <div style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}>
          <WorkspaceSwitcher />
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-px">
          {NAV_ITEMS.map(({ to, icon, label }) => {
            const active =
              location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <NavItem key={to} to={to} icon={icon} label={label} active={active} />
            );
          })}

          {/* Divider */}
          <div className="my-1 h-px" style={{ background: "hsl(var(--sidebar-border))" }} />

          <NavItem
            to="/settings"
            icon={Settings}
            label="Settings"
            active={location.pathname.startsWith("/settings")}
          />
        </nav>

        {/* ── User footer ── */}
        {session?.user && (
          <div
            className="p-2"
            style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
          >
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 group">
              {/* Avatar */}
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground/80 uppercase">
                {(session.user.name?.[0] ?? session.user.email[0]).toUpperCase()}
              </div>
              {/* User info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium leading-none text-foreground/90">
                  {session.user.name ?? session.user.email}
                </p>
                {session.user.name && (
                  <p className="mt-0.5 truncate text-[11px] leading-none text-muted-foreground">
                    {session.user.email}
                  </p>
                )}
              </div>
              {/* Sign out */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() =>
                      signOut()
                        .then(() => {
                          queryClient.clear();
                          setActiveWorkspaceId(null);
                          router.navigate({ to: "/login" });
                        })
                        .catch(() => toast.error("Sign out failed"))
                    }
                    className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors duration-100 hover:bg-white/5 hover:text-foreground/80 cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <LogOut className="h-3 w-3" />
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
