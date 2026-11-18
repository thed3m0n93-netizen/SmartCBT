/**
 * SmartCBT - Halaman detail berita (siswa & staff).
 *
 * dibuka dari slider headline di dashboard siswa. Router membaca `:newsId`,
 * jadi menambah halaman berita cukup menambah route-nya.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, Pin } from "lucide-react";
import { useI18n } from "../../i18n";
import { useAuth } from "../../app/AuthContext";
import { fetchNewsItem, resolveAssetUrl, type NewsRow } from "../../lib/api";
import { C, S } from "../../styles/tokens";
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
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div
        className="max-w-lg mx-auto rounded-2xl p-6 text-center"
        style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, boxShadow: S.card }}
      >
        <div className="inline-flex w-11 h-11 rounded-xl items-center justify-center mb-3" style={{ background: C.danger.bg, color: C.danger.text }}>
          <AlertTriangle size={20} />
        </div>
        <h2 className="font-bold mb-1" style={{ color: C.danger.text }}>
          {t("Berita tidak ditemukan")}
        </h2>
        <p className="text-sm" style={{ color: C.danger.deep }}>
          {error || t("Berita tidak ditemukan")}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px]"
          style={{ background: C.danger.main, color: "#FFFFFF" }}
        >
          {t("Kembali")}
        </button>
      </div>
    );
  }

  const cat = newsCategoryStyle(item.category);
  const body = rewriteMediaUrls(sanitizeModuleHtml(item.body));
  const isStaff = user?.role === "teacher" || user?.role === "admin";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl min-h-[40px]"
          style={{ background: C.base.surface, color: C.base.textBody, border: `1px solid ${C.base.border}`, boxShadow: S.control }}
        >
          <ArrowLeft size={14} />
          {t("Kembali")}
        </button>
        {isStaff && (
          <button
            onClick={() => navigate("/admin/news")}
            className="text-xs font-semibold px-3 py-2 rounded-xl min-h-[40px]"
            style={{ background: C.brand.bg, color: C.brand.dark, border: `1px solid ${C.brand.borderSoft}` }}
          >
            {t("Kelola Berita")}
          </button>
        )}
      </div>

      <article
        className="cbt-card rounded-2xl overflow-hidden"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        {item.image_url && (
          <img
            src={resolveAssetUrl(item.image_url)}
            alt=""
            className="w-full object-cover"
            style={{ maxHeight: 280, background: C.base.surfaceMuted }}
          />
        )}
        {item.video_url && (
          <video
            src={resolveAssetUrl(item.video_url)}
            controls
            preload="metadata"
            className="w-full"
            style={{ maxHeight: 340, background: "#09131F", display: "block" }}
          />
        )}

        <div className="p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-2.5 flex-wrap text-xs">
            <span className="font-semibold" style={{ color: cat.color }}>
              {cat.label}
            </span>
            {item.pinned && (
              <>
                <span style={{ color: C.base.textFaint }} aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: C.warn.dark }}>
                  <Pin size={12} /> {t("Disematkan")}
                </span>
              </>
            )}
            <span style={{ color: C.base.textFaint }} aria-hidden>·</span>
            <span style={{ color: C.base.textMuted }}>
              {formatNewsDate(item.published_at ?? item.created_at)}
            </span>
          </div>

          <h1
            className="font-bold text-lg sm:text-2xl leading-snug mb-2"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {item.title}
          </h1>

          {item.author_name && (
            <div className="text-xs mb-4" style={{ color: C.base.textFaint }}>
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