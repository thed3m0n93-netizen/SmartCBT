import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "../../app/AuthContext";
import { MODULE_CONTENT_CSS } from "../../components/RichTextEditor";
import { fetchLearningModules, resolveAssetUrl, saveLearningProgress, type LearningModuleRow } from "../../lib/api";
import { isMarkdownFile, MARKDOWN_LOAD_ERROR, renderMarkdown } from "../../lib/markdown";
import { sanitizeModuleHtml } from "../../lib/sanitize";

const MAX_STEP_PERCENT = 25;
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
    return <div className="py-16 text-center text-sm text-slate-500">Memuat modul...</div>;
  }

  if (error || !module) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center" style={{ borderColor: "#fecaca" }}>
        <div className="mb-2 text-3xl">⚠</div>
        <h1 className="text-lg font-bold text-slate-900">Modul tidak dapat dibuka</h1>
        <p className="mt-2 text-sm text-red-700">{error || "Modul tidak ditemukan."}</p>
        <button
          type="button"
          onClick={() => navigate("/student/modules")}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Kembali ke daftar modul
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/student/modules")}
            aria-label="Kembali ke daftar modul"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg text-slate-700"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Modul Belajar</p>
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">{module.title}</h1>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {completed ? "Selesai" : `${readingPercent}%`}
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col bg-white sm:shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
            <p className="text-sm text-slate-500">{module.description || "Materi pembelajaran"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Oleh {module.teacher_name || "Guru"}</span>
              <span>•</span>
              <span>{module.class_name ? `${module.grade_level} ${module.class_name}` : "Semua kelas"}</span>
              <span>•</span>
              <span>{module.estimated_minutes} menit</span>
            </div>
          </div>

          {error && <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">{error}</div>}

          <div
            ref={readerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8"
            style={{ scrollBehavior: "auto", maxHeight: "calc(100vh - 220px)" }}
          >
            <div className="mx-auto max-w-3xl text-[15px] leading-8 text-slate-700 rich-editor-surface">
              {safeContent && <div dangerouslySetInnerHTML={{ __html: safeContent }} />}
              {!safeContent && !isMarkdownModule && <p className="text-center text-slate-500">Tidak ada isi materi.</p>}

              {isMarkdownModule && markdownLoading && <div className="text-sm text-slate-500">Memuat materi Markdown...</div>}
              {isMarkdownModule && markdownError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
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
                  className="mt-8 block rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
                >
                  Buka lampiran: {module.attachment_name || "dokumen"}
                </a>
              )}
            </div>
            <div className="h-12" />
          </div>

          <footer className="border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 sm:px-6">
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
