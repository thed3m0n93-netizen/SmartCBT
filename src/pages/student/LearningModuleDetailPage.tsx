import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, FileText } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { MODULE_CONTENT_CSS } from "../../components/RichTextEditor";
import { fetchLearningModules, resolveAssetUrl, saveLearningProgress, type LearningModuleRow } from "../../lib/api";
import { isMarkdownFile, MARKDOWN_LOAD_ERROR, renderMarkdown } from "../../lib/markdown";
import { sanitizeModuleHtml } from "../../lib/sanitize";
import { C, S } from "../../styles/tokens";

const LEARNING_PROGRESS_EVENT = "smartcbt:learning-progress-updated";

function getScrollPercent(element: HTMLElement | null): number {
  if (element && element.scrollHeight > element.clientHeight) {
    const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 1);
    return Math.min(100, Math.round((element.scrollTop / maxScroll) * 100));
  }

  const total = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  const current = window.scrollY || document.documentElement.scrollTop || 0;
  return Math.min(100, Math.round((current / total) * 100));
}

function broadcastLearningProgress(moduleId: string, maxScrollPercent: number, completed: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LEARNING_PROGRESS_EVENT, {
      detail: { moduleId, maxScrollPercent, completed },
    }),
  );
}

export default function LearningModuleDetailPage() {
  const { moduleId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [module, setModule] = useState<LearningModuleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readingPercent, setReadingPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [markdownHtml, setMarkdownHtml] = useState<string | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownError, setMarkdownError] = useState<string | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastServerPercent = useRef(0);
  const saveTimer = useRef<number | null>(null);

  const isMarkdownModule = useMemo(
    () => !!module && isMarkdownFile(module.attachment_name, module.attachment_mime),
    [module?.id, module?.attachment_name, module?.attachment_mime],
  );

  useEffect(() => {
    let cancelled = false;

    fetchLearningModules()
      .then((modules) => {
        if (cancelled) return;
        const next = modules.find((item) => item.id === moduleId) ?? null;
        if (!next) {
          setError("Modul tidak ditemukan atau tidak tersedia untuk kelasmu.");
          setModule(null);
          return;
        }
        setModule(next);
        setError(null);
        lastServerPercent.current = Number(next.max_scroll_percent || 0);
        setReadingPercent(Number(next.max_scroll_percent || 0));
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Gagal memuat modul.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  useEffect(() => {
    if (!module || !isMarkdownModule || !module.attachment_url) {
      setMarkdownHtml(null);
      setMarkdownLoading(false);
      setMarkdownError(null);
      return;
    }

    let cancelled = false;
    const url = resolveAssetUrl(module.attachment_url);
    setMarkdownHtml(null);
    setMarkdownError(null);
    setMarkdownLoading(true);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setMarkdownHtml(sanitizeModuleHtml(renderMarkdown(text, { baseUrl: url })));
        }
      })
      .catch((err: any) => {
        if (!cancelled) setMarkdownError(err?.message || MARKDOWN_LOAD_ERROR);
      })
      .finally(() => {
        if (!cancelled) setMarkdownLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [module?.id, module?.attachment_url, isMarkdownModule]);

  useEffect(() => {
    if (!module || module.completed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Materi belum selesai dibaca.";
      return event.returnValue;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [module]);

  useEffect(() => {
    const handlePageScroll = () => {
      if (module?.completed) return;
      handleScroll();
    };

    window.addEventListener("scroll", handlePageScroll, { passive: true });
    const element = readerRef.current;
    element?.addEventListener("scroll", handlePageScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handlePageScroll);
      element?.removeEventListener("scroll", handlePageScroll);
    };
  }, [module?.id, module?.completed]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const safeContent = useMemo(
    () => sanitizeModuleHtml(module?.content ?? "").replace(/(src=")((?:\/)[^"]*)(")/g, (_match, prefix, url, suffix) => `${prefix}${resolveAssetUrl(url)}${suffix}`),
    [module?.content],
  );

  const applyServerProgress = (
    moduleId: string,
    result: { maxScrollPercent?: number; completed?: boolean },
  ) => {
    const serverPercent = Number(result?.maxScrollPercent ?? 0);
    const isCompleted = !!result?.completed || serverPercent >= 99;
    lastServerPercent.current = serverPercent;
    setReadingPercent((current) => Math.max(current, serverPercent));
    setModule((current) =>
      current && current.id === moduleId
        ? { ...current, max_scroll_percent: serverPercent, completed: isCompleted }
        : current,
    );
    broadcastLearningProgress(moduleId, serverPercent, isCompleted);
  };

  const persistProgress = (percent: number) => {
    if (!module || percent <= lastServerPercent.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        const result = await saveLearningProgress(module.id, percent);
        applyServerProgress(module.id, result);
        setError(null);
      } catch (err: any) {
        if (err?.status === 429 && err.payload) {
          applyServerProgress(module.id, err.payload);
          setError("Scroll terlalu cepat. Turunkan kecepatan membaca dan lanjutkan bertahap.");
        } else {
          setError(err?.message || "Progres belum tersimpan.");
        }
      } finally {
        setSaving(false);
      }
    }, 300);
  };

  const handleScroll = () => {
    const element = readerRef.current;
    if (!element || !module) return;

    if (module.completed) {
      setReadingPercent(100);
      return;
    }

    const rawPercent = getScrollPercent(element);
    const next = Math.max(lastServerPercent.current, rawPercent);
    setReadingPercent(next);

    if (next >= 99) {
      persistProgress(100);
      return;
    }

    persistProgress(next);
  };

  const completed = !!module?.completed || readingPercent >= 99;

  if (loading) {
    return <div className="py-16 text-center text-sm" style={{ color: C.base.textMuted }}>Memuat modul...</div>;
  }

  if (error || !module) {
    return (
      <div
        className="mx-auto max-w-lg rounded-2xl p-6 text-center"
        style={{ background: C.base.surface, border: `1px solid ${C.danger.border}`, boxShadow: S.card }}
      >
        <div className="inline-flex w-11 h-11 rounded-xl items-center justify-center mb-3" style={{ background: C.danger.bg, color: C.danger.text }}>
          <AlertTriangle size={20} />
        </div>
        <h1 className="text-lg font-bold" style={{ color: C.base.text }}>Modul tidak dapat dibuka</h1>
        <p className="mt-2 text-sm" style={{ color: C.danger.text }}>{error || "Modul tidak ditemukan."}</p>
        <button
          type="button"
          onClick={() => navigate("/student/modules")}
          className="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold min-h-[44px]"
          style={{ background: C.brand.main, color: "#FFFFFF" }}
        >
          Kembali ke daftar modul
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col" style={{ background: C.base.page }}>
      <header
        className="sticky top-0 z-10 border-b px-4 py-3 backdrop-blur-md sm:px-6"
        style={{ background: C.base.surface, borderColor: C.base.border }}
      >
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/student/modules")}
            aria-label="Kembali ke daftar modul"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
            style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceSoft, color: C.base.text }}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>Modul Belajar</p>
            <h1 className="truncate text-base font-bold sm:text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>{module.title}</h1>
          </div>
          <span
            className="text-xs font-semibold tabular-nums shrink-0"
            style={{ color: completed ? C.ok.dark : C.warn.dark }}
          >
            {completed ? "Selesai" : `${readingPercent}% terbaca`}
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col sm:p-4">
        <div
          className="mx-auto flex w-full max-w-4xl flex-1 flex-col sm:rounded-2xl overflow-hidden"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
        >
          <div className="border-b px-4 py-3.5 sm:px-6" style={{ borderColor: C.base.borderLight }}>
            <p className="text-sm" style={{ color: C.base.textMuted }}>{module.description || "Materi pembelajaran"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: C.base.textFaint }}>
              <span>Oleh {module.teacher_name || "Guru"}</span>
              <span aria-hidden>·</span>
              <span>{module.class_name ? `${module.grade_level} ${module.class_name}` : "Semua kelas"}</span>
              <span aria-hidden>·</span>
              <span>{module.estimated_minutes} menit</span>
            </div>
          </div>

          {error && (
            <div className="mx-4 mt-4 rounded-xl px-4 py-3 text-sm sm:mx-6" style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, color: C.danger.text }}>
              {error}
            </div>
          )}

          <div
            ref={readerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8"
            style={{ scrollBehavior: "auto", maxHeight: "calc(100dvh - 230px)" }}
          >
            <div className="mx-auto max-w-3xl text-[15px] leading-8 rich-editor-surface" style={{ color: C.base.textBody }}>
              {safeContent && <div dangerouslySetInnerHTML={{ __html: safeContent }} />}
              {!safeContent && !isMarkdownModule && <p className="text-center" style={{ color: C.base.textMuted }}>Tidak ada isi materi.</p>}

              {isMarkdownModule && markdownLoading && <div className="text-sm" style={{ color: C.base.textMuted }}>Memuat materi Markdown...</div>}
              {isMarkdownModule && markdownError && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: C.warn.bg, border: `1px solid ${C.warn.border}`, color: C.warn.deep }}>
                  Materi Markdown tidak dapat ditampilkan ({markdownError}). Gunakan tautan unduh di bawah.
                </div>
              )}
              {isMarkdownModule && markdownHtml && (
                <div dangerouslySetInnerHTML={{ __html: markdownHtml }} />
              )}

              {module.attachment_url && (
                <a
                  href={resolveAssetUrl(module.attachment_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-8 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
                  style={{ background: C.brand.bg, border: `1px solid ${C.brand.borderSoft}`, color: C.brand.dark }}
                >
                  <FileText size={16} />
                  <span>Buka lampiran: {module.attachment_name || "dokumen"}</span>
                </a>
              )}
            </div>
            <div className="h-12" />
          </div>

          <footer
            className="border-t px-4 py-3 text-xs sm:px-6"
            style={{ background: C.base.surfaceMuted, borderColor: C.base.borderLight, color: C.base.textMuted }}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{saving ? "Menyimpan progres..." : completed ? "Materi selesai dibaca." : "Scroll dibatasi agar materi dibaca bertahap."}</span>
              <span>{user?.name || "Siswa"}</span>
            </div>
          </footer>
        </div>
      </main>
      <style>{MODULE_CONTENT_CSS}</style>
    </div>
  );
}

