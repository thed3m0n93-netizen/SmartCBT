/**
 * SmartCBT - HTML sanitizer for teacher-authored rich learning-module content.
 *
 * Module content is authored as HTML by the teacher (rich text editor) and is
 * rendered back to students, so it is a stored-XSS sink. Nothing may be trusted:
 * `sanitizeModuleHtml` is applied on BOTH the save path (so junk never reaches
 * the database) and the render path (defence in depth for rows written before
 * sanitization existed).
 *
 * Strategy — deliberately dependency-free:
 *   1. drop comments, doctypes, CDATA and processing instructions;
 *   2. drop dangerous tags **together with their content** (a `<script>` body
 *      would otherwise survive as text and re-execute on re-parse);
 *   3. keep only allow-listed tags, neutralising everything else;
 *   4. keep only allow-listed attributes, and force `href`/`src` through a URL
 *      scheme check so `javascript:` cannot smuggle script in;
 *   5. balance tags so truncated input cannot break the surrounding layout.
 *
 * Images stay allowed (`src` limited to `/uploads/...`, http(s) or a
 * base64 raster data URL) because the editor inserts uploaded images inline.
 */

/** Tags dropped together with everything inside them. */
const DROP_WITH_CONTENT =
  /<\s*(script|style|iframe|object|embed|template|noscript|svg|math|form|input|button|select|option|textarea|frame|frameset|applet|link|meta|base)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;

/** Comments, doctype, CDATA, processing instructions. */
const DROP_MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>/g;

const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "hr", "span", "div", "a", "img", "font",
  "sub", "sup", "mark", "small",
  // Tabel GFM — dipakai renderer Markdown untuk tabel bergaya README.
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  // Berita modern (build 133): penyisipan gambar & video di dalam artikel.
  // `figure`/`figcaption` memberi pembungkus bergaya portal berita;
  // `video`/`source` memutar berkas video yang sudah diunggah guru.
  "figure", "figcaption", "video", "source",
]);

/** Tags that never have a closing partner. */
const VOID_TAGS = new Set(["br", "hr", "img", "source"]);

/** Attribute allow list per tag. */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  font: new Set(["color", "face", "size"]),
  // Berita modern (build 133): video disisipkan guru lewat editor.
  // `controls`/`autoplay` are boolean attributes - keeping them is safe because
  // no URL can be smuggled through them (the only URL attribute is `src`).
  video: new Set(["src", "poster", "controls", "preload", "width", "height", "playsinline"]),
  source: new Set(["src", "type"]),
  figure: new Set(["class"]),
  figcaption: new Set(["class"]),
};

/** CSS declarations allowed inside an inline `style`. */
const ALLOWED_CSS = new Set([
  "color", "background-color", "font-family", "font-size", "text-align",
  "font-weight", "font-style", "text-decoration",
]);

function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape stray `<`/`>` from text while leaving valid entities alone. */
function escapeText(value: string): string {
  return value
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,30};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6};)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Decode the few entities used to disguise `javascript:` URLs. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&amp;/gi, "&");
}
/**
 * Normalize a URL and decide whether it is safe to keep.
 *
 * Blocks `javascript:`, `vbscript:` and any non-image `data:` URL. Inline SVG
 * is excluded even as a data URL because it can carry script.
 */
export function isSafeUrl(raw: string, kind: "link" | "image"): boolean {
  // Strip ASCII control chars + whitespace that browsers ignore inside URLs,
  // so "java\tscript:" cannot hide behind them. Character-code based on
  // purpose (a `[ -]` range would also delete real letters).
  const url = decodeEntities(String(raw ?? ""))
    .replace(/[\u0000-\u0020\u007f]/g, "")
    .trim();
  if (!url) return false;
  if (/^(https?:)?\/\//i.test(url)) return true;
  if (kind === "image" && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(url)) {
    return true;
  }
  if (/^data:/i.test(url)) return false;
  if (/^\//.test(url)) return true; // relative path on this app (/uploads/...)
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // any other scheme
  return true; // plain relative path
}

/**
 * Filter a tag's attribute string down to the allow list.
 *
 * Returns `null` when the element must be dropped entirely (an `<img>` with no
 * safe `src`, or an anchor whose href was rejected) and a (possibly empty)
 * string of attributes otherwise — an empty string means "keep, no attributes".
 */
function filterAttributes(
  tag: string,
  attrText: string,
  kind: "link" | "image" | "media" | "none",
): string | null {
  const allowed = TAG_ATTRS[tag];
  const kept: string[] = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrText))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";

    if (name.startsWith("on") || name === "srcdoc" || name === "formaction") continue;

    if (name === "style") {
      const css = value
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .filter((d) => ALLOWED_CSS.has((d.split(":")[0] ?? "").trim().toLowerCase()))
        .filter((d) => !/url\s*\(|expression\s*\(|javascript:/i.test(d))
        .join("; ");
      if (css) kept.push(`style="${escapeAttr(css)}"`);
      continue;
    }
    if (name === "class") {
      const cls = value.replace(/[^\w\s-]/g, "").trim().slice(0, 80);
      if (cls) kept.push(`class="${escapeAttr(cls)}"`);
      continue;
    }
    if (name === "href" && kind === "link") {
      if (isSafeUrl(value, "link")) {
        kept.push(`href="${escapeAttr(value.trim())}"`, 'rel="noopener noreferrer"', 'target="_blank"');
      }
      continue;
    }
    if (name === "src" && kind === "image") {
      if (isSafeUrl(value, "image")) kept.push(`src="${escapeAttr(value.trim())}"`);
      continue;
    }
    // Video memakai pemeriksaan URL "link": hanya http(s) atau path relatif
    // server ini. `data:` video ditolak di sini juga, karena bisa jadi payload
    // raksasa yang membekukan tab siswa.
    if (name === "src" && kind === "media") {
      if (isSafeUrl(value, "link")) kept.push(`src="${escapeAttr(value.trim())}"`);
      continue;
    }
    if (name === "poster" && kind === "media") {
      if (isSafeUrl(value, "image")) kept.push(`poster="${escapeAttr(value.trim())}"`);
      continue;
    }
    if (!allowed || !allowed.has(name)) continue;
    if (name === "width" || name === "height") {
      if (/^\d{1,4}$/.test(value)) kept.push(`${name}="${value}"`);
      continue;
    }
    if (name === "size" && tag === "font") {
      if (/^[1-7]$/.test(value)) kept.push(`size="${value}"`);
      continue;
    }
    kept.push(`${name}="${escapeAttr(value)}"`);
  }
  // An image without a usable src is useless; an anchor without href is a lie.
  if (tag === "img" && !kept.some((a) => a.startsWith("src="))) return null;
  if (tag === "a" && !kept.some((a) => a.startsWith("href="))) return null;
  // A <video> with neither `src` nor a <source> child would render as an empty
  // black box; keep the tag only when at least one usable URL survives.
  if (tag === "video" && !kept.some((a) => a.startsWith("src="))) return null;
  return kept.length ? ` ${kept.join(" ")}` : "";
}
/**
 * Sanitize teacher-authored module HTML down to a safe, balanced subset.
 * Returns "" for input that contains nothing renderable.
 */
export function sanitizeModuleHtml(input: unknown): string {
  let html = String(input ?? "");
  if (!html.trim()) return "";

  html = html.replace(/^﻿/, "");
  html = html.replace(DROP_WITH_CONTENT, "");
  html = html.replace(DROP_MARKUP, "");

  // Normalisasi `<video><source>` -> `<video src>` SEBELUM tag scan.
  //
  // `<source>` is only meaningful inside `<video>`, so deciding at the opening
  // `<video>` tag whether to keep it would be wrong: a valid `<source>` child
  // arrives *after* that decision. Promoting the first source to the video's
  // own `src` first keeps the main loop a single, simple pass, and the leftover
  // `<source>` tags (duplicate/extra formats) are then dropped because they no
  // longer carry a src.
  html = html.replace(
    /<\s*video\b([^>]*)>([\s\S]{0,400}?)<\s*\/\s*video\s*>/gi,
    (full, attrs: string, inner: string) => {
      const srcMatch = /<\s*source\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(inner);
      const src = srcMatch ? (srcMatch[2] ?? srcMatch[3] ?? srcMatch[4] ?? "") : "";
      // Keep only the fallback text; every `<source>` is redundant once the
      // video carries its own src.
      const text = inner.replace(/<\s*source\b[^>]*>/gi, "");
      const merged = /\bsrc\s*=/i.test(attrs) ? attrs : `${attrs} src="${src}"`;
      return `<video${merged}>${text}</video>`;
    },
  );

  // Single pass over every tag: keep allow-listed ones, neutralise the rest.
  const openStack: string[] = [];
  let out = "";
  let cursor = 0;
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html))) {
    out += escapeText(html.slice(cursor, m.index));
    cursor = m.index + m[0].length;

    const isClosing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrText = m[3] ?? "";

    // Not on the allow list: drop the tag but keep its (escaped) text content.
    if (!ALLOWED_TAGS.has(tag)) continue;

    const kind =
      tag === "img" ? "image"
      : tag === "a" ? "link"
      : tag === "video" || tag === "source" ? "media"
      : "none";
    const attrs = filterAttributes(tag, attrText, kind);
    // `null` = unsafe element, drop it. `""` = valid but attribute-less, keep it.
    if (attrs === null) continue;

    if (VOID_TAGS.has(tag)) {
      if (!isClosing) out += `<${tag}${attrs} />`;
      continue;
    }

    if (isClosing) {
      const idx = openStack.lastIndexOf(tag);
      if (idx === -1) continue; // stray close tag
      // Implicitly close anything left open inside (e.g. `<b><i>x</b>`).
      while (openStack.length > idx) out += `</${openStack.pop()}>`;
      continue;
    }

    openStack.push(tag);
    out += `<${tag}${attrs}>`;
  }

  out += escapeText(html.slice(cursor));
  while (openStack.length) out += `</${openStack.pop()}>`;
  return out.trim();
}

/** Plain-text form of module HTML (previews, validation, meta description). */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the content carries nothing renderable (used for validation). */
export function isEmptyModuleContent(html: string): boolean {
  const text = htmlToText(html);
  // Media counts as content on its own: a photo-only gallery or a clip-only
  // news post has no text but is definitely not empty. `video` was added for
  // the news composer (build 133); `img` already covered module screenshots.
  if (!text.trim()) return !/<(img|video)\b/i.test(String(html ?? ""));
  return false;
}