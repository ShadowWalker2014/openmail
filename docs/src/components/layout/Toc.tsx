import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocProps {
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export default function Toc({ contentRef }: TocProps) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!contentRef.current) return;

    const headings = contentRef.current.querySelectorAll("h2, h3");
    const extracted: TocItem[] = [];
    headings.forEach((h) => {
      if (h.id) {
        extracted.push({
          id: h.id,
          text: h.textContent?.replace(/^#\s*/, "") || "",
          level: h.tagName === "H2" ? 2 : 3,
        });
      }
    });
    setItems(extracted);

    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-60px 0px -70% 0px", threshold: 0 }
    );

    headings.forEach((h) => observerRef.current?.observe(h));

    return () => observerRef.current?.disconnect();
  }, [contentRef]);

  if (items.length === 0) return null;

  return (
    <div className="py-8 px-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-3 px-2">
        On this page
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "block py-1 text-[12.5px] transition-all duration-150 rounded",
                item.level === 3 ? "pl-4" : "pl-2",
                activeId === item.id
                  ? "text-violet-400 font-medium"
                  : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
