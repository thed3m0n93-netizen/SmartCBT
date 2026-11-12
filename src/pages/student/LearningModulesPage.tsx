import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { fetchLearningModules, type LearningModuleRow } from "../../lib/api";

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
    <div className="space-y-5">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Learning Management</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900" style={{ fontFamily: "var(--font-serif)" }}>Modul Belajar</h1>
        <p className="mt-1 text-sm text-slate-500">Pilih modul untuk membuka materi secara penuh.</p>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Memuat modul...</div>
      ) : modules.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">
          Belum ada modul belajar untuk kelasmu.
        </div>
      ) : (
        <div className="space-y-2">
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => navigate(`/student/modules/${module.id}`)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50 active:bg-blue-100"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{module.title}</span>
                <span className="mt-1 block text-xs text-slate-400">
                  {module.completed ? "Selesai dibaca" : `${module.max_scroll_percent || 0}% terbaca`} · {module.estimated_minutes} menit
                </span>
              </span>
              <span className="shrink-0 text-lg text-blue-600" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
