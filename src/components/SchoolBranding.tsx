import { useEffect } from "react";
import { useAuth } from "../app/AuthContext";
import { resolveAssetUrl } from "../lib/api";

/**
 * Applies the school's custom favicon (configured in School Settings) to the
 * live document `<head>`.
 *
 * Mounted once inside the router layout so every page — including the login
 * screen — picks up the branding as soon as `AuthContext` has settings. The
 * default `index.html` icon stays in place until a custom one exists, and the
 * previous `<link>` elements are restored when the setting is cleared.
 */
export default function SchoolBranding() {
  const { settings } = useAuth();
  const favicon = settings?.school_favicon || "";

  useEffect(() => {
    // `rel` values a browser may use to render the tab/shortcut icon.
    const RELS = ["icon", "apple-touch-icon", "shortcut icon", "mask-icon"];

    const links = RELS.map((rel) => {
      const existing = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      return {
        el: existing,
        // Remember the original href so clearing the setting restores defaults.
        original: existing?.getAttribute("href") ?? null,
        created: !existing,
      };
    });

    const applied: HTMLLinkElement[] = [];

    if (favicon) {
      // `resolveAssetUrl` points at the origin that serves /uploads/*, so the
      // favicon loads even when the frontend is hosted separately from the API.
      const href = resolveAssetUrl(favicon);
      // Cache-bust so a re-upload with the same name is picked up immediately.
      const versioned = href + (href.includes("?") ? "&" : "?") + "v=" + Date.now();
      // `rel` values a fresh <link> should advertise (the originals may differ,
      // e.g. index.html ships `icon` + `apple-touch-icon`).
      const FRESH_RELS = ["icon", "apple-touch-icon", "shortcut icon", "mask-icon"];
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        let el = link.el;
        if (!el) {
          el = document.createElement("link");
          el.rel = FRESH_RELS[i];
          document.head.appendChild(el);
        }
        el.href = versioned;
        applied.push(el);
      }
    }

    return () => {
      // Restore previous state on unmount / when the favicon is cleared.
      for (const link of links) {
        if (!link.el) continue;
        if (link.original) {
          link.el.setAttribute("href", link.original);
        } else if (favicon) {
          link.el.removeAttribute("href");
        }
      }
      // Remove any <link> we created ourselves.
      for (const el of applied) {
        if (!links.some((l) => l.el === el)) el.remove();
      }
    };
  }, [favicon]);

  return null;
}
