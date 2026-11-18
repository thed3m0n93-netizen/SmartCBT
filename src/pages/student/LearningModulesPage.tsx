import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { fetchLearningModules, type LearningModuleRow } from "../../lib/api";
import { C, S } from "../../styles/tokens";

const LEARNING_PROGRESS_EVENT = "smartcbt:learning-progress-updated";

export default function StudentLearningModulesPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState<LearningModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshModules = async () => {
    try {
      const rows = await fetchLearningModules();
      setModules(rows);
    } catch (err: any) {
      setError(err.message || "Gagal memuat modul.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshModules();

    const handleProgressUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId?: string; maxScrollPercent?: number; completed?: boolean }>).detail;
      if (!detail?.moduleId) return;

      setModules((current) => {
        const matched = current.some((module) => module.id === detail.moduleId);
        if (!matched) {
          void refreshModules();
          return current;
        }

        return current.map((module) =>
          module.id === detail.moduleId
            ? {
                ...module,
                max_scroll_percent: detail.maxScrollPercent ?? module.max_scroll_percent,
                completed: detail.completed ?? module.completed ?? false,
              }
            : module,
        );
      });
    };

    window.addEventListener(LEARNING_PROGRESS_EVENT, handleProgressUpdate);
    return () => {
      window.removeEventListener(LEARNING_PROGRESS_EVENT, handleProgressUpdate);
    };
  }, []);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>Learning Management</div>
        <h1 className="mt-1 text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>Modul Belajar</h1>
        <p className="mt-1 text-sm" style={{ color: C.base.textMuted }}>Pilih modul untuk membuka materi secara penuh.</p>
      </header>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, color: C.danger.text }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <div className="rounded-2xl p-8 text-center text-sm" style={{ background: C.base.surface, border: `1px dashed ${C.base.dashed}`, color: C.base.textMuted }}>
          Belum ada modul belajar untuk kelasmu.
        </div>
      ) : (
        <div className="space-y-2.5">
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => navigate(`/student/modules/${module.id}`)}
              className="cbt-card cbt-card-hover flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.99] min-h-[64px]"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold" style={{ color: C.base.text }}>{module.title}</span>
                <span className="mt-1 block text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                  {module.completed ? "Selesai dibaca" : `${module.max_scroll_percent || 0}% terbaca`} · {module.estimated_minutes} menit
                </span>
              </span>
              <ChevronRight size={18} style={{ color: C.brand.main }} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

