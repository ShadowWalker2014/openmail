import { useState, useRef } from "react";
import hljs from "highlight.js/lib/common";
import { cn } from "@/lib/cn";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

export default function CodeBlock({ code, language = "text", filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const highlighted =
    language !== "text" && hljs.getLanguage(language)
      ? hljs.highlight(code.trim(), { language }).value
      : hljs.highlightAuto(code.trim()).value;

  function copy() {
    navigator.clipboard.writeText(code.trim());
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group my-5 rounded-lg border border-white/[0.06] overflow-hidden bg-[#0f0f0f]">
      {filename && (
        <div className="flex items-center px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="text-[11.5px] font-mono text-neutral-500">{filename}</span>
        </div>
      )}
      <div className="relative">
        <pre
          className={cn(
            "overflow-x-auto px-5 py-4 text-[13px] leading-[1.75]",
            "font-mono",
          )}
        >
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
        <button
          onClick={copy}
          title="Copy code"
          className={cn(
            "absolute top-3 right-3",
            "flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium",
            "transition-all duration-150",
            "opacity-0 group-hover:opacity-100",
            copied
              ? "bg-green-500/[0.12] text-green-400 border border-green-500/20"
              : "bg-white/[0.06] text-neutral-400 hover:text-neutral-200 border border-white/[0.06]",
          )}
        >
          {copied ? (
            <>
              <Check size={11} />
              Copied
            </>
          ) : (
            <>
              <Copy size={11} />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}
