/**
 * SmartCBT — Learning Hub in-game (build 142).
 *
 * Panel "Modul & Tugas" di dalam Nusantara High. TIDAK menduplikasi logika:
 * datanya dipanggil lewat fungsi API yang sama dengan halaman siswa
 * (`fetchLearningModules` / `fetchAssignments`) sehingga filter per-kelas
 * sudah ditegakkan server (GET /api/learning-modules & /api/assignments
 * mengembalikan baris milik kelas siswa yang login). Membuka item bernavigasi
 * ke halaman aplikasi yang sebenarnya — progres baca, pengumpulan, dan
 * penilaian tetap satu sumber.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, ClipboardList, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import {
  fetchAssignments,
  fetchLearningModules,
  type AssignmentRow,
  type LearningModuleRow,
} from '../../lib/api';

interface LearningHubProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'modules' | 'assignments';

function formatDue(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const LearningHub: React.FC<LearningHubProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('modules');
  const [modules, setModules] = useState<LearningModuleRow[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mods, asgs] = await Promise.all([fetchLearningModules(), fetchAssignments()]);
      setModules(mods);
      setAssignments(asgs);
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat data pembelajaran.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const visibleModules = (modules ?? []).filter((m) => m.published !== false);
  const visibleAssignments = assignments ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Modul belajar dan tugas"
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-50">📚 Modul &amp; Tugas Saya</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Data kelas kamu — buka untuk lanjut ke halaman aslinya.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              title="Muat ulang"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Tutup (Esc)"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {(
            [
              { key: 'modules', label: `Modul Belajar${modules ? ` (${visibleModules.length})` : ''}`, icon: BookOpen },
              { key: 'assignments', label: `Tugas${assignments ? ` (${visibleAssignments.length})` : ''}`, icon: ClipboardList },
            ] as const
          ).map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'text-sky-300 border-sky-400 bg-slate-800/60'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!error && loading && !modules && (
            <div className="py-10 text-center text-sm text-slate-400">Memuat data…</div>
          )}

          {tab === 'modules' && modules && visibleModules.length === 0 && !loading && (
            <div className="py-10 text-center text-sm text-slate-500">
              Belum ada modul untuk kelasmu. Cek lagi nanti ya.
            </div>
          )}

          {tab === 'modules' &&
            visibleModules.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100 truncate">{m.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    {m.subject_name ?? 'Umum'}
                    {m.estimated_minutes ? ` · ±${m.estimated_minutes} menit` : ''}
                    {m.attachment_name ? ' · 📎 lampiran' : ''}
                  </div>
                  {typeof m.max_scroll_percent === 'number' && m.max_scroll_percent > 0 && (
                    <div className="mt-1.5 w-40 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.min(100, Math.round(m.max_scroll_percent))}%` }}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => go(`/student/modules/${encodeURIComponent(m.id)}`)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Baca
                </button>
              </div>
            ))}

          {tab === 'assignments' && assignments && visibleAssignments.length === 0 && !loading && (
            <div className="py-10 text-center text-sm text-slate-500">
              Belum ada tugas untuk kelasmu.
            </div>
          )}

          {tab === 'assignments' &&
            visibleAssignments.map((a) => {
              const submitted = Boolean(a.submission_id);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{a.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {a.subject_name ?? 'Umum'} · deadline {formatDue(a.due_at)} · maks {a.max_score}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                        submitted
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {submitted ? 'Terkumpul' : 'Belum'}
                    </span>
                    <button
                      type="button"
                      onClick={() => go('/student/assignments')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Kerjakan
                    </button>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 text-[11px] text-slate-500">
          Tekan <span className="text-slate-300 font-semibold">Esc</span> atau klik latar untuk kembali ke game.
        </div>
      </div>
    </div>
  );
};
