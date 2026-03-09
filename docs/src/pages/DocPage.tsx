import { useEffect, useRef, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPrevNext } from "@/lib/nav";
import { mdxComponents } from "@/components/mdx/components";
import Toc from "@/components/layout/Toc";

type MDXModule = {
  default: React.ComponentType<Record<string, unknown>>;
  frontmatter?: { title?: string; description?: string };
};

// Glob import all MDX files
const modules = import.meta.glob<MDXModule>("../content/**/*.mdx");

export default function DocPage() {
  const { "*": slug } = useParams();
  const [mod, setMod] = useState<MDXModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const href = `/${slug ?? ""}`;
  const { prev, next } = getPrevNext(href);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);

    const key = `../content/${slug}.mdx`;
    const loader = modules[key];

    if (!loader) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    loader()
      .then((m) => {
        setMod(m);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [slug]);

  // Update document title + meta tags for SEO
  useEffect(() => {
    const title = mod?.frontmatter?.title
      ? `${mod.frontmatter.title} — OpenMail Docs`
      : "OpenMail Docs";
    const description =
      mod?.frontmatter?.description ??
      "OpenMail documentation — open-source Customer.io alternative with full REST API and native MCP server for AI agents.";
    const canonical = `https://docs.openmail.win${href}`;

    document.title = title;

    const setMeta = (sel: string, attr: string, val: string) => {
      let el = document.querySelector<HTMLMetaElement>(sel);
      if (!el) {
        el = document.createElement("meta");
        document.head.appendChild(el);
      }
      el.setAttribute(attr, val);
    };

    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[name="description"]', "name", "description");

    // Open Graph
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:title"]', "property", "og:title");
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:description"]', "property", "og:description");
    setMeta('meta[property="og:url"]', "content", canonical);
    setMeta('meta[property="og:url"]', "property", "og:url");
    setMeta('meta[property="og:type"]', "content", "article");
    setMeta('meta[property="og:type"]', "property", "og:type");
    setMeta('meta[property="og:site_name"]', "content", "OpenMail Docs");
    setMeta('meta[property="og:site_name"]', "property", "og:site_name");
    setMeta('meta[property="og:image"]', "content", "https://docs.openmail.win/og-image.png");
    setMeta('meta[property="og:image"]', "property", "og:image");

    // Twitter Card
    setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
    setMeta('meta[name="twitter:card"]', "name", "twitter:card");
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title");
    setMeta('meta[name="twitter:description"]', "content", description);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description");

    // Canonical
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;
  }, [mod, href]);

  if (notFound) {
    return <Navigate to="/getting-started/introduction" replace />;
  }

  const Component = mod?.default;
  const fm = mod?.frontmatter;

  // Breadcrumb
  const parts = (slug ?? "").split("/");
  const section = parts[0]
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex gap-0 xl:gap-8 pt-14 min-h-screen">
      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-[760px] mx-auto px-6 lg:px-10 py-10 pb-20">
          {/* JSON-LD structured data */}
          {fm && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@graph": [
                    {
                      "@type": "TechArticle",
                      headline: fm.title,
                      description: fm.description ?? "",
                      url: `https://docs.openmail.win${href}`,
                      inLanguage: "en-US",
                      isPartOf: {
                        "@type": "WebSite",
                        name: "OpenMail Docs",
                        url: "https://docs.openmail.win",
                      },
                      publisher: {
                        "@type": "Organization",
                        name: "OpenMail",
                        url: "https://openmail.win",
                        logo: {
                          "@type": "ImageObject",
                          url: "https://docs.openmail.win/og-image.png",
                        },
                      },
                    },
                    {
                      "@type": "BreadcrumbList",
                      itemListElement: [
                        {
                          "@type": "ListItem",
                          position: 1,
                          name: "Docs",
                          item: "https://docs.openmail.win",
                        },
                        ...(section
                          ? [
                              {
                                "@type": "ListItem",
                                position: 2,
                                name: section,
                              },
                            ]
                          : []),
                        {
                          "@type": "ListItem",
                          position: section ? 3 : 2,
                          name: fm.title,
                          item: `https://docs.openmail.win${href}`,
                        },
                      ],
                    },
                  ],
                }),
              }}
            />
          )}

          {/* Breadcrumb */}
          {section && (
            <nav className="flex items-center gap-1.5 mb-6 text-[12.5px] text-neutral-600">
              <span>Docs</span>
              <span>›</span>
              <span className="text-neutral-500">{section}</span>
            </nav>
          )}

          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 bg-white/[0.04] rounded-lg w-2/3" />
              <div className="h-4 bg-white/[0.04] rounded w-full" />
              <div className="h-4 bg-white/[0.04] rounded w-5/6" />
              <div className="h-4 bg-white/[0.04] rounded w-4/5" />
            </div>
          ) : (
            <>
              <div
                ref={contentRef}
                className="prose prose-sm max-w-none
                  prose-headings:font-semibold prose-headings:tracking-tight
                  prose-h1:text-3xl prose-h1:font-bold prose-h1:mb-3 prose-h1:mt-0
                  prose-h2:text-xl prose-h3:text-[17px]
                  prose-p:text-neutral-300 prose-p:leading-relaxed
                  prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-neutral-100 prose-strong:font-semibold
                  prose-li:text-neutral-300
                  prose-table:text-sm
                  prose-th:bg-white/[0.04] prose-th:text-neutral-400 prose-th:font-semibold prose-th:text-xs prose-th:uppercase prose-th:tracking-wider
                  prose-td:text-neutral-300 prose-td:border-b prose-td:border-white/[0.04]
                  prose-blockquote:border-l-violet-500/60 prose-blockquote:text-neutral-400 prose-blockquote:not-italic
                  prose-hr:border-white/[0.06]"
              >
                {Component && (
                  <Component components={mdxComponents as Record<string, unknown>} />
                )}
              </div>

              {/* Prev / Next navigation */}
              {(prev || next) && (
                <div className="mt-12 pt-6 border-t border-white/[0.06] flex items-center justify-between gap-4">
                  {prev ? (
                    <Link
                      to={prev.href}
                      className="group flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-200 transition-colors"
                    >
                      <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
                      <span>
                        <span className="block text-[11px] text-neutral-600 mb-0.5">Previous</span>
                        {prev.title}
                      </span>
                    </Link>
                  ) : (
                    <div />
                  )}
                  {next ? (
                    <Link
                      to={next.href}
                      className="group flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-200 transition-colors text-right"
                    >
                      <span>
                        <span className="block text-[11px] text-neutral-600 mb-0.5">Next</span>
                        {next.title}
                      </span>
                      <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ) : (
                    <div />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Right TOC — visible only on xl screens */}
      <aside className="hidden xl:block w-56 shrink-0">
        <div className="sticky top-14 max-h-[calc(100vh-56px)] overflow-y-auto">
          <Toc contentRef={contentRef} />
        </div>
      </aside>
    </div>
  );
}
