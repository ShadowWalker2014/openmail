import { useLocation, Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { navGroups } from "@/lib/nav";

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const { pathname } = useLocation();

  return (
    <nav className="h-full px-4 py-6 overflow-y-auto">
      <div className="space-y-6">
        {navGroups.map((group) => (
          <div key={group.group}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              {group.group}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      onClick={onClose}
                      className={cn(
                        "block px-3 py-1.5 text-[13.5px] rounded-md transition-all duration-150",
                        "truncate",
                        isActive
                          ? "text-violet-400 bg-violet-500/[0.08] font-medium"
                          : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.04]"
                      )}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer links */}
      <div className="mt-10 px-3 pt-6 border-t border-white/[0.06]">
        <div className="space-y-1">
          {[
            { label: "GitHub", href: "https://github.com/ShadowWalker2014/openmail" },
            { label: "Enterprise", href: "mailto:kai@1flow.ai" },
            { label: "Contributing", href: "https://github.com/ShadowWalker2014/openmail/blob/main/CONTRIBUTING.md" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="block text-[12.5px] text-neutral-600 hover:text-neutral-400 transition-colors py-1"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
