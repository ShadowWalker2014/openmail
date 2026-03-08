import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard, Users, Mail, Zap, FileText, Settings,
  ChevronDown, Check, LogOut, Filter, Search,
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
  { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard",  shortcut: "G D" },
  { to: "/contacts",   icon: Users,            label: "Contacts",   shortcut: "G C" },
  { to: "/segments",   icon: Filter,           label: "Segments",   shortcut: "G S" },
  { to: "/broadcasts", icon: Mail,             label: "Broadcasts", shortcut: "G B" },
  { to: "/campaigns",  icon: Zap,              label: "Campaigns",  shortcut: "G A" },
  { to: "/templates",  icon: FileText,         label: "Templates",  shortcut: "G T" },
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
    <div ref={ref} className="relative px-2 py-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5",
          "text-[12px] font-medium transition-colors duration-100 cursor-pointer",
          "hover:bg-white/[0.06] active:bg-white/[0.08]",
          open && "bg-white/[0.06]"
        )}
      >
        {/* Workspace avatar — tiny rounded square */}
        <div className="flex h-4.5 w-[18px] h-[18px] shrink-0 items-center justify-center rounded-[3px] bg-violet-500/25 text-[9px] font-bold text-violet-300 uppercase select-none">
          {(activeWs?.name ?? "W")[0]}
        </div>
        <span className="min-w-0 flex-1 truncate text-left text-foreground/80">
          {activeWs?.name ?? "Select workspace"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown — spring animation */}
      <div
        className={cn(
          "absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-lg",
          "border border-border/70 bg-popover shadow-2xl shadow-black/50",
          "transition-all duration-150 origin-top",
          open
            ? "opacity-100 scale-y-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-y-95 -translate-y-1 pointer-events-none"
        )}
      >
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => { setActiveWorkspaceId(ws.id); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[12px] transition-colors duration-75 hover:bg-accent cursor-pointer first:rounded-t-lg last:rounded-b-lg"
          >
            <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] bg-violet-500/25 text-[9px] font-bold text-violet-300 uppercase">
              {ws.name[0]}
            </div>
            <span className="flex-1 min-w-0 truncate text-left text-foreground/85">{ws.name}</span>
            {ws.id === activeWorkspaceId && (
              <Check className="h-3 w-3 shrink-0 text-foreground/50" />
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
  shortcut,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          className={cn(
            "group relative flex items-center gap-2 rounded-md px-2 py-[6px]",
            "text-[12px] leading-none transition-all duration-100 cursor-pointer",
            active
              ? "bg-white/[0.08] text-foreground font-medium"
              : "text-muted-foreground/80 hover:bg-white/[0.05] hover:text-foreground/90"
          )}
        >
          {/* Active indicator bar */}
          {active && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-violet-400"
              style={{ width: 2, height: 14 }}
            />
          )}
          <Icon
            className={cn(
              "h-[14px] w-[14px] shrink-0 transition-colors duration-100",
              active
                ? "text-foreground"
                : "text-muted-foreground/50 group-hover:text-foreground/70"
            )}
          />
          <span className="truncate min-w-0 flex-1">{label}</span>
        </Link>
      </TooltipTrigger>
      {shortcut && (
        <TooltipContent side="right" className="flex items-center gap-2">
          <span>{label}</span>
          <kbd className="text-[10px] text-muted-foreground/60 font-mono tracking-wider">
            {shortcut}
          </kbd>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const router = useRouter();
  const { data: session } = useSession();
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const queryClient = useQueryClient();

  return (
    <TooltipProvider delayDuration={600}>
      <aside
        className="flex h-screen w-[216px] shrink-0 flex-col sticky top-0 z-40"
        style={{
          background: "hsl(var(--sidebar-bg))",
          borderRight: "1px solid hsl(var(--sidebar-border))",
        }}
      >
        {/* ── Logo ── */}
        <div
          className="flex h-11 shrink-0 items-center gap-2.5 px-4"
          style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground">
            <Mail className="h-3 w-3 text-background" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            OpenMail
          </span>
        </div>

        {/* ── Workspace switcher ── */}
        <div style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}>
          <WorkspaceSwitcher />
        </div>

        {/* ── Search / Command palette trigger ── */}
        <div className="px-2 py-1.5" style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  // Dispatch a synthetic Cmd+K event to open the command palette
                  const e = new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: true,
                    bubbles: true,
                  });
                  document.dispatchEvent(e);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5",
                  "text-[12px] text-muted-foreground/60 cursor-pointer",
                  "border border-border/50 bg-white/[0.03]",
                  "transition-all duration-100 hover:bg-white/[0.06] hover:text-muted-foreground/90 hover:border-border",
                  "group"
                )}
              >
                <Search className="h-3 w-3 shrink-0" />
                <span className="flex-1 text-left">Search…</span>
                <kbd className="hidden sm:flex items-center gap-0.5 rounded bg-muted/60 px-1 py-0.5 font-mono text-[9px] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
                  ⌘K
                </kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Command Palette
              <kbd className="ml-2 font-mono text-[10px] text-muted-foreground/60">⌘K</kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-px">
          {NAV_ITEMS.map(({ to, icon, label, shortcut }) => {
            const active =
              location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <NavItem
                key={to}
                to={to}
                icon={icon}
                label={label}
                active={active}
                shortcut={shortcut}
              />
            );
          })}

          {/* Separator */}
          <div
            className="my-1 h-px"
            style={{ background: "hsl(var(--sidebar-border))" }}
          />

          <NavItem
            to="/settings"
            icon={Settings}
            label="Settings"
            active={location.pathname.startsWith("/settings")}
            shortcut="G ,"
          />
        </nav>

        {/* ── User footer ── */}
        {session?.user && (
          <div
            className="p-2"
            style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
          >
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              {/* Avatar */}
              <div className="flex h-5.5 h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/70 uppercase select-none">
                {(session.user.name?.[0] ?? session.user.email[0]).toUpperCase()}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium leading-none text-foreground/85">
                  {session.user.name ?? session.user.email}
                </p>
                {session.user.name && (
                  <p className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground/60">
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
                    className="shrink-0 rounded p-1 text-muted-foreground/40 transition-colors duration-100 hover:bg-white/[0.06] hover:text-foreground/70 cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
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
