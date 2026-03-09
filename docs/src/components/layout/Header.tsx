import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X, Github, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

interface HeaderProps {
  onMenuClick: () => void;
  menuOpen: boolean;
}

export default function Header({ onMenuClick, menuOpen }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 h-14 flex items-center",
        "border-b transition-all duration-150",
        scrolled
          ? "bg-[#0a0a0a]/95 backdrop-blur-sm border-white/[0.06]"
          : "bg-[#0a0a0a] border-white/[0.06]"
      )}
    >
      <div className="w-full flex items-center px-4 lg:px-6 gap-4">
        {/* Logo */}
        <Link
          to="/getting-started/introduction"
          className="flex items-center gap-2.5 shrink-0 group"
        >
          <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <span className="text-violet-400 font-bold text-xs font-mono">OM</span>
          </div>
          <span className="font-semibold text-sm text-neutral-100 group-hover:text-white transition-colors">
            OpenMail
          </span>
          <span className="text-neutral-600 text-sm font-medium hidden sm:inline">
            Docs
          </span>
        </Link>

        {/* Nav (desktop) */}
        <nav className="hidden md:flex items-center gap-1 ml-2">
          {[
            { label: "Getting Started", href: "/getting-started/introduction" },
            { label: "API Reference", href: "/api/authentication" },
            { label: "MCP Server", href: "/mcp/overview" },
            { label: "Self-Hosting", href: "/self-hosting/overview" },
          ].map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="px-3 py-1.5 text-[13px] font-medium text-neutral-400 hover:text-neutral-100 rounded-md hover:bg-white/[0.04] transition-all duration-150"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <a
            href="https://openmail.win"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            openmail.win
            <ExternalLink size={12} className="text-neutral-600" />
          </a>
          <a
            href="https://github.com/ShadowWalker2014/openmail"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-neutral-400 hover:text-neutral-100 rounded-md hover:bg-white/[0.04] transition-all duration-150"
          >
            <Github size={14} />
            <span className="hidden sm:inline">GitHub</span>
          </a>

          {/* Mobile menu button */}
          <button
            onClick={onMenuClick}
            className="lg:hidden flex items-center justify-center w-8 h-8 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.04] transition-all duration-150"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
