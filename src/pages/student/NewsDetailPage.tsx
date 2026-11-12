/**
 * SmartCBT - Halaman detail berita (siswa & staff).
 *
 * dibuka dari slider headline di dashboard siswa. Router membaca `:newsId`,
 * jadi menambah halaman berita cukup menambah route-nya.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useI18n } from "../../i18n";
import { useAuth } from "../../app/AuthContext";
import { fetchNewsItem, resolveAssetUrl, type NewsRow } from "../../lib/api";
import {
  ARTICLE_CSS,
  formatNewsDate,
  newsCategoryStyle,
  rewriteMediaUrls,
} from "../../components/NewsCard";
import { sanitizeModuleHtml } from "../../lib/sanitize";

export default function NewsDetailPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { newsId = "" } = useParams();
  const [item, setItem] = useState<NewsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchNewsItem(newsId);
        if (cancelled) return;
        setItem(data);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || t("Gagal memuat berita."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [newsId, t]);

  if (loading) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "#94a3b8" }}>
        {t("Memuat berita...")}
      </div>
    );
  }

  if (error || !item) {
    return (
      <div
        className="rounded-xl p-6 text-center"
        style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}
      >
        <div className="text-3xl mb-2">⚠</div>
        <h2 className="font-bold mb-1" style={{ color: "#991B1B" }}>
          {t("Berita tidak ditemukan")}
        </h2>
        <p className="text-sm" style={{ color: "#B91C1C" }}>
          {error || t("Berita tidak ditemukan")}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#DC2626", color: "#fff" }}
        >
          {t("Kembali")}
        </button>
      </div>
    );
  }

  const cat = newsCategoryStyle(item.category);
  // Sanitized on render (defence in depth) and relative upload URLs are made
  // absolute so inline media still loads when the API is on another host.
  const body = rewriteMediaUrls(sanitizeModuleHtml(item.body));
  // Staff arrive here from the news manager; give them a way back that does not
  // depend on browser history (a draft opened in a fresh tab has no history).
  // The client `Role` type is admin/teacher/student only — `super_admin` is
  // normalized to `admin` by `mapRole()` at login, so it needs no extra check.
  const isStaff = user?.role === "teacher" || user?.role === "admin";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => navigate(-1)}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
          style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
        >
          ← {t("Kembali")}
        </button>
        {isStaff && (
          <button
            onClick={() => navigate("/admin/news")}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
            style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #DBEAFE" }}
          >
            {t("Kelola Berita")}
          </button>
        )}
      </div>

      <article
        className="rounded-xl overflow-hidden"
        style={{ background: "#fff", border: "1px solid #E2E8F0" }}
      >
        {item.image_url && (
          <img
            src={resolveAssetUrl(item.image_url)}
            alt=""
            className="w-full object-cover"
            style={{ maxHeight: 260, background: "#F1F5F9" }}
          />
        )}
        {item.video_url && (
          <video
            src={resolveAssetUrl(item.video_url)}
            controls
            preload="metadata"
            className="w-full"
            style={{ maxHeight: 340, background: "#0F172A", display: "block" }}
          />
        )}

        <div className="p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}
            >
              {cat.label}
            </span>
            {item.pinned && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
              >
                📌 {t("Disematkan")}
              </span>
            )}
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              {formatNewsDate(item.published_at ?? item.created_at)}
            </span>
          </div>

          <h1
            className="font-bold text-lg sm:text-2xl leading-snug mb-2"
            style={{ color: "#0F172A", fontFamily: "var(--font-serif)" }}
          >
            {item.title}
          </h1>

          {item.author_name && (
            <div className="text-xs mb-4" style={{ color: "#94a3b8" }}>
              {t("oleh")} {item.author_name}
            </div>
          )}

          <div className="news-body" dangerouslySetInnerHTML={{ __html: body }} />
          <style>{ARTICLE_CSS}</style>
        </div>
      </article>
    </div>
  );
}