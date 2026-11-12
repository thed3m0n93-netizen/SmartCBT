/**
 * Shared building blocks for the news surfaces: admin list, student slider and
 * the detail page.
 *
 * All three read the same `/api/news` data, and everything that decides how a
 * news item *looks* (category colours, relative dates, article typography,
 * media URL rewriting, teaser text) lives here, so the surfaces cannot drift
 * apart. `NewsListItem` is the compact management row; the reader itself is the
 * detail page reached from `/news/:id`.
 */
import { useMemo } from "react";
import { C } from "../styles/tokens";
import { sanitizeModuleHtml } from "../lib/sanitize";
import { resolveAssetUrl, type NewsCategory, type NewsRow } from "../lib/api";

/** Category presentation, kept in one place so both views colour-match. */
export const NEWS_CATEGORIES: Array<{
  key: NewsCategory;
  label: string;
  color: string;
  bg: string;
  border: string;
}> = [
  { key: "info", label: "Info", color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
  { key: "academic", label: "Akademik", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
  { key: "event", label: "Kegiatan", color: "#059669", bg: "#D1FAE5", border: "#A7F3D0" },
  { key: "exam", label: "Ujian", color: "#D97706", bg: "#FEF3C7", border: "#FDE68A" },
  { key: "urgent", label: "Penting", color: "#DC2626", bg: "#FEE2E2", border: "#FECACA" },
];

/**
 * Presentation for a category, always returning a known entry.
 *
 * Exported so the slider can colour its gradient banners identically to the
 * cards without duplicating the lookup.
 */
export function newsCategoryStyle(key: string) {
  return NEWS_CATEGORIES.find((c) => c.key === key) ?? NEWS_CATEGORIES[0];
}

/** Relative date for recent items, absolute date for older ones. */
export function formatNewsDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days} hari lalu`;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Reader styles for sanitized article HTML.
 *
 * Kept local to the news card (rather than reusing `MODULE_CONTENT_CSS`) so
 * the article typography can be tuned for reading - larger body text, wider
 * line height - without changing how learning modules look.
 */
export const ARTICLE_CSS = `
  .news-body { font-size: 0.95rem; line-height: 1.75; color: ${C.base.textBody}; }
  .news-body p { margin: 0.7em 0; }
  .news-body h1 { font-size: 1.4rem; font-weight: 700; margin: 1em 0 0.4em; }
  .news-body h2 { font-size: 1.2rem; font-weight: 700; margin: 0.9em 0 0.35em; }
  .news-body h3 { font-size: 1.05rem; font-weight: 600; margin: 0.8em 0 0.3em; }
  .news-body ul { list-style: disc; padding-left: 1.4em; margin: 0.6em 0; }
  .news-body ol { list-style: decimal; padding-left: 1.4em; margin: 0.6em 0; }
  .news-body blockquote {
    border-left: 3px solid ${C.brand.border}; padding: 0.2em 0 0.2em 0.9em;
    color: ${C.base.textMuted}; font-style: italic;
  }
  .news-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 0.7em 0; display: block; }
  .news-body video { max-width: 100%; border-radius: 8px; margin: 0.7em 0; display: block; background: #0f172a; }
  .news-body a { color: ${C.brand.main}; text-decoration: underline; }
  .news-body table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.9em; }
  .news-body th, .news-body td { border: 1px solid ${C.base.border}; padding: 0.4em 0.6em; text-align: left; }
  .news-body th { background: #f8fafc; font-weight: 600; }
`;

/**
 * Rewrite relative `/uploads/...` URLs inside article HTML to absolute ones.
 *
 * The same split-deployment trap documented in `resolveAssetUrl()` applies to
 * media *inside* an article: a stored `/uploads/x.png` is requested from the
 * frontend origin and 404s when the API lives on another host.
 */
export function rewriteMediaUrls(html: string): string {
  return html.replace(
    /(\s(?:src|poster)=")(\/uploads\/[^"]*)(")/gi,
    (_m, pre: string, path: string, post: string) =>
      `${pre}${resolveAssetUrl(path)}${post}`,
  );
}

/**
 * Render sanitized article HTML.
 *
 * Sanitizing again here (the server already did) is deliberate defence in
 * depth: this component renders with `dangerouslySetInnerHTML`, and rows
 * written before the server-side sanitization existed would otherwise still be
 * raw markup.
 */
function ArticleBody({ html, compact }: { html: string; compact: boolean }) {
  const safe = useMemo(() => rewriteMediaUrls(sanitizeModuleHtml(html)), [html]);
  if (!safe) return null;
  if (compact) {
    // Compact cards show the lead paragraph only - no media, no heavy markup.
    const text = safe
      .replace(/<(img|video|figure|table)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (
      <p className="text-xs leading-relaxed line-clamp-3" style={{ color: C.base.textMuted }}>
        {text.slice(0, 220)}
      </p>
    );
  }
  return (
    <>
      <div className="news-body" dangerouslySetInnerHTML={{ __html: safe }} />
      <style>{ARTICLE_CSS}</style>
    </>
  );
}
/**
 * Lead paragraph of an article, plain text.
 *
 * Shared by the slider banner and the admin list row so both truncate an
 * article the same way - media is stripped first, otherwise a photo-only
 * article would show an empty teaser.
 */
export function newsTeaser(item: NewsRow, max = 150): string {
  const text = String(item.body ?? "")
    .replace(/<(img|video|figure|table)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/**
 * One row in the news management list.
 *
 * The admin list is a management surface, not a reader: rendering every article
 * body inline made the page grow without bound and pushed the next story below
 * the fold. Rows therefore show only a thumbnail, headline, teaser and meta,
 * and open the shared detail page (`/news/:id`) on click - the same page a
 * student reaches from the dashboard slider, so what staff review is exactly
 * what students read.
 */
export function NewsListItem({
  item,
  onOpen,
  footer,
}: {
  item: NewsRow;
  /** Omit to render a non-interactive row. */
  onOpen?: () => void;
  /** Optional action row (admin edit/publish/delete buttons). */
  footer?: React.ReactNode;
}) {
  const cat = newsCategoryStyle(item.category);
  const clickable = typeof onOpen === "function";

  return (
    <article
      className="flex items-start gap-3 rounded-xl p-3"
      style={{
        background: C.base.surface,
        border: `1px solid ${item.pinned ? C.warn.border : C.base.border}`,
      }}
    >
      {/* Thumbnail. Rendered as a button rather than nesting one inside the
          title button - nested interactive elements are invalid HTML and make
          keyboard navigation unpredictable. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={!clickable}
        aria-label={clickable ? `Lihat detail: ${item.title}` : undefined}
        className="relative shrink-0 overflow-hidden rounded-lg disabled:cursor-default"
        style={{ width: 96, height: 68, background: C.base.surfaceSoft }}
      >
        {item.image_url ? (
          <img
            src={resolveAssetUrl(item.image_url)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span
            className="w-full h-full block"
            style={{ background: `linear-gradient(135deg, ${cat.color} 0%, #0f172a 100%)` }}
          />
        )}
        {item.video_url && (
          <span
            className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(15,23,42,0.75)", color: "#fff" }}
          >
            🎬
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}
          >
            {cat.label}
          </span>
          {item.pinned && (
            <span
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
            >
              📌
            </span>
          )}
          {!item.published && (
            <span
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: C.base.surfaceSoft,
                color: C.base.textMuted,
                border: `1px solid ${C.base.border}`,
              }}
            >
              Draft
            </span>
          )}
          <span className="text-[11px]" style={{ color: C.base.textFaint }}>
            {formatNewsDate(item.published_at ?? item.created_at)}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpen}
          disabled={!clickable}
          className="block text-left w-full disabled:cursor-default"
        >
          <h3
            className="font-semibold text-sm leading-snug line-clamp-1"
            style={{
              color: clickable ? C.brand.main : C.base.text,
              fontFamily: "var(--font-serif)",
            }}
          >
            {item.title}
          </h3>
        </button>

        <p className="text-xs mt-0.5 line-clamp-2 leading-relaxed" style={{ color: C.base.textMuted }}>
          {newsTeaser(item, 180)}
        </p>

        {item.author_name && (
          <div className="text-[11px] mt-1 truncate" style={{ color: C.base.textFaint }}>
            oleh {item.author_name}
          </div>
        )}
      </div>

      {footer && <div className="shrink-0 self-center">{footer}</div>}
    </article>
  );
}