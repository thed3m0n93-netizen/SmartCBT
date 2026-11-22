import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Flag,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  WifiOff,
  X,
} from "lucide-react";
import { useI18n } from "../../i18n";
import {
  fetchMonitoringAll,
  forceSubmitSession,
  addExtraTime,
  resetSession,
  flagSession,
  getAuthToken,
} from "../../lib/api";
import { C, S, alpha } from "../../styles/tokens";
import { Btn, Notice, Modal, controlStyle } from "../../components/ui";

type StudentStatus = "not_started" | "in_progress" | "completed" | "disconnected" | "flagged";
type ViewMode = "grid" | "table";

interface Student {
  id: string;
  name: string;
  nis: string;
  className: string;
  examId: string;
  examTitle: string;
  status: StudentStatus;
  progress: number;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  tabSwitches: number;
  extraMinutes: number;
  /** Timestamp (ms) saat ujian dimulai — dipakai ticker realtime untuk hitung countdown ulang. */
  startedAtMs?: number;
  /** Timestamp (ms) saat ujian selesai. */
  completedAtMs?: number;
  score?: number;
  ip: string;
  device: string;
  /** Alasan penandaan manual (build 147), terisi saat status flagged/disrupted. */
  flagReason?: string | null;
}

const statusConfig: Record<StudentStatus, { label: string; bg: string; text: string; border: string; dot: string; order: number }> = {
  // order = prioritas risiko (rendah → tinggi), dipakai sorting "risiko terbesar dulu".
  completed: { label: "Completed", bg: C.ok.bgLight, text: C.ok.dark, border: C.ok.border, dot: C.ok.main, order: 1 },
  not_started: { label: "Not Started", bg: C.base.surfaceMuted, text: C.base.textMuted, border: C.base.border, dot: C.base.textFaint, order: 2 },
  in_progress: { label: "In Progress", bg: C.brand.bg, text: C.brand.dark, border: C.brand.border, dot: C.brand.main, order: 3 },
  disconnected: { label: "Disconnected", bg: C.warn.bg, text: C.warn.dark, border: C.warn.border, dot: C.warn.main, order: 4 },
  flagged: { label: "Flagged", bg: C.danger.bg, text: C.danger.deep, border: C.danger.border, dot: C.danger.main, order: 5 },
};

/** Urutan status yang dipakai filter tombol-atas & stat card. */
const STATUS_ORDER: StudentStatus[] = ["in_progress", "flagged", "disconnected", "not_started", "completed"];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Map a monitoring DB row to the UI Student model. */
function mapDbStudent(row: any): Student {
  const total = Number(row.total_questions) || 1;
  const answered = Number(row.answered_count) || 0;
  const rawStatus: string = row.status ?? "not_started";
  const status: StudentStatus =
    rawStatus === "disrupted" ? "disconnected" : (rawStatus as StudentStatus);

  let timeLeft = 0;
  let startedAtMs: number | undefined;
  if (row.status === "in_progress" && row.exam_duration_minutes && row.started_at) {
    const start = new Date(row.started_at).getTime();
    const examDuration = Number(row.exam_duration_minutes) * 60;
    const extraTime = Number(row.extra_time_minutes) * 60;
    timeLeft = Math.max(0, examDuration + extraTime - Math.floor((Date.now() - start) / 1000));
    startedAtMs = start;
  } else if (row.started_at) {
    startedAtMs = new Date(row.started_at).getTime();
  }

  let completedAtMs: number | undefined;
  if (row.submitted_at) completedAtMs = new Date(row.submitted_at).getTime();

  return {
    id: row.id,
    name: row.full_name,
    nis: row.student_number ?? "—",
    className: row.class_name ?? "—",
    examId: row.exam_id,
    examTitle: row.exam_title ?? "—",
    status,
    progress: Math.round((answered / total) * 100),
    currentQuestion: Math.min(answered + 1, total),
    totalQuestions: total,
    timeLeft,
    tabSwitches: Number(row.focus_loss_count) || 0,
    extraMinutes: Number(row.extra_time_minutes) || 0,
    startedAtMs,
    completedAtMs,
    score: row.score != null ? Number(row.score) : undefined,
    ip: row.ip_address ?? "—",
    flagReason: row.flag_reason ?? null,
    device:
      row.device_id
        ? `SEB (device: ${row.device_id})`
        : row.user_agent
          ? "Standard browser"
          : "—",
  };
}

export default function MonitoringPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const initialExamId = searchParams.get("examId") || "all";
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [statusFilter, setStatusFilter] = useState<StudentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [examOptions, setExamOptions] = useState<{ id: string; title: string }[]>([]);
  const [selectedExam, setSelectedExam] = useState(initialExamId);
  const [visibleLimit, setVisibleLimit] = useState(24);
  const [extraTimeStudent, setExtraTimeStudent] = useState<string | null>(null);
  const [extraMinutes, setExtraMinutes] = useState("10");
  /** Build 147 — dialog konfirmasi penandaan sesi manual. */
  const [flagDialog, setFlagDialog] = useState<{ student: Student; next: "flagged" | "disrupted" | "in_progress" } | null>(null);
  const [flagReason, setFlagReason] = useState("");
  /** Build 147 — dialog konfirmasi aksi destruktif (Reset / Force Submit). */
  const [confirmDialog, setConfirmDialog] = useState<{ student: Student; action: "reset" | "force-submit" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sseState, setSseState] = useState<"disconnected" | "reconnecting" | "live">("disconnected");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  /** Kick realtime snapshot-backed re-applies (used to bump a regeneration counter). */
  const [, setNowTick] = useState(0);

  // Apply an incoming snapshot: extract fresh exam options, keep selection, sync selection.
  const applySnapshot = useCallback((rows: any[], useNextTick = false) => {
    const mapped = rows.map(mapDbStudent);
    setStudents(mapped);
    setExamOptions((prev) => {
      if (rows.length === 0) return prev;
      const next = Array.from(
        new Map(
          rows.map((r: any) => [r.exam_id, { id: r.exam_id, title: String(r.exam_title || "") }])
        ).values()
      );
      // Preserve current selection (especially deep-linked ?examId=) when possible.
      setSelectedExam((prevSel) => {
        if (prevSel === "all") return "all";
        if (initialExamId !== "all" && prevSel === initialExamId) return prevSel;
        return next.some((o) => o.id === prevSel) ? prevSel : (next[0]?.id ?? "all");
      });
      return next;
    });
    setSelectedStudent((prev) => {
      if (prev) {
        const fresh = mapped.find((m) => m.id === prev.id);
        return fresh ?? null;
      }
      return mapped[0] ?? null;
    });
    setLastUpdated(Date.now());
    if (useNextTick) setNowTick((n) => n + 1);
  }, [initialExamId]);

  // Reusable loader — called on mount and after teacher actions.
  const loadRows = useCallback(async () => {
    const rows = await fetchMonitoringAll();
    applySnapshot(rows);
    return rows;
  }, [applySnapshot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRows();
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || t("Failed to load monitoring data"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadRows, t]);

  // Live countdown ticker — recomputes remaining time every second for active
  // sessions so the timer never freezes between SSE snapshots.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // SSE-based realtime push (replaces manual polling).
  // Use the shared accessor: the previous hardcoded "smartcbt:session-token"
  // key was never written by `api.ts`, so `token` was always null and the SSE
  // stream never connected at all.
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const sseReadRef = useRef<{ stream: ReadableStream; reader: ReadableStreamDefaultReader<Uint8Array> } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let attempt = 0;

    const connect = async () => {
      while (!cancelled) {
        attempt++;
        setSseState(attempt === 1 ? "disconnected" : "reconnecting");
        try {
          const response = await fetch("/api/sse/monitoring", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) {
            await sleep(Math.min(1500 * attempt, 8000));
            continue;
          }
          const stream = response.body;
          if (!stream) {
            await sleep(1500);
            continue;
          }
          const reader = stream.getReader();
          sseReadRef.current = { stream, reader };
          attempt = 0;
          setSseState("live");
          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx = buffer.indexOf("\n\n");
            while (idx !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const lines = chunk.split("\n");
              const eventLine = lines.find((l) => l.startsWith("event: "));
              const dataLine = lines.find((l) => l.startsWith("data: "));
              if (eventLine && dataLine) {
                const eventName = eventLine.slice(7).trim();
                const payload = JSON.parse(dataLine.slice(6).trim());
                if (eventName === "snapshot") {
                  applySnapshot(payload);
                } else if (eventName === "ping") {
                  // Heartbeat — stream still alive.
                }
              }
              idx = buffer.indexOf("\n\n");
            }
          }
        } catch (err) {
          if (!cancelled) {
            console.warn("[sse] stream error, reconnecting:", err);
            setSseState("reconnecting");
            await sleep(Math.min(1500 * attempt, 8000));
          }
        } finally {
          if (!cancelled) setSseState("reconnecting");
          if (sseReadRef.current) {
            try { sseReadRef.current.reader.cancel(); } catch {}
            sseReadRef.current = null;
          }
        }
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (sseReadRef.current) {
        try { sseReadRef.current.reader.cancel(); } catch {}
        sseReadRef.current = null;
      }
    };
  }, [token, applySnapshot]);
  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      reconnectTimer.current = setTimeout(resolve, ms);
    });
  }

  // ── Derived data: filtering, search, sort ──────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = students
    .filter((s) => (statusFilter === "all" ? true : s.status === statusFilter))
    .filter((s) => (selectedExam === "all" ? true : s.examId === selectedExam))
    .filter((s) =>
      q
        ? s.name.toLowerCase().includes(q) ||
          s.nis.startsWith(q) ||
          s.className.toLowerCase().includes(q)
        : true
    )
    .sort((a, b) => {
      // Risiko terbesar tampil lebih dulu agar guru cepat melihat masalah.
      const scoreDiff = statusConfig[b.status].order - statusConfig[a.status].order;
      if (scoreDiff !== 0) return scoreDiff;
      if (a.status === "in_progress" && b.status === "in_progress") {
        return b.tabSwitches - a.tabSwitches; // tab switch terbanyak dulu
      }
      return a.name.localeCompare(b.name);
    });

  const visible = filtered.slice(0, visibleLimit);

  const counts = {
    total: students.length,
    not_started: students.filter((s) => s.status === "not_started").length,
    in_progress: students.filter((s) => s.status === "in_progress").length,
    completed: students.filter((s) => s.status === "completed").length,
    flagged: students.filter((s) => s.status === "flagged").length,
    disconnected: students.filter((s) => s.status === "disconnected").length,
  };

  const activeCount = students.filter((s) => s.status === "in_progress" || s.status === "completed").length;
  const avgProgress = Math.round(students.reduce((a, s) => a + (s.status === "in_progress" || s.status === "completed" ? s.progress : 0), 0) / Math.max(1, activeCount));

  const selectedExamTitle =
    selectedExam === "all"
      ? t("All exams")
      : examOptions.find((o) => o.id === selectedExam)?.title ?? t("All exams");

  /** Reset a disconnected/flagged session back to in_progress via the server. */
  const runResetSession = async (s: Student): Promise<boolean> => {
    setActionError(null);
    setNotice(null);
    setBusyId(s.id);
    try {
      await resetSession(s.id);
      setNotice(t("Sesi \"{name}\" berhasil di-reset.", { name: s.name }));
      await loadRows();
      return true;
    } catch (err: any) {
      setActionError(err?.message || t("Gagal me-reset sesi."));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  /** Teacher-forced submission via the server. */
  const runForceSubmit = async (s: Student): Promise<boolean> => {
    setActionError(null);
    setNotice(null);
    setBusyId(s.id);
    try {
      await forceSubmitSession(s.id);
      setNotice(t("Ujian \"{name}\" berhasil di-force submit.", { name: s.name }));
      await loadRows();
      return true;
    } catch (err: any) {
      setActionError(err?.message || t("Gagal melakukan force submit."));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Build 147 — dialog konfirmasi in-app (komponen `Modal`) untuk aksi destruktif
   * Reset Session & Force Submit, menggantikan `window.confirm` agar konsisten
   * dengan dialog penandaan sesi. Tombol Cancel menutup, Konfirmasi menjalankan.
   */
  const openConfirmDialog = (s: Student, action: "reset" | "force-submit") => {
    setActionError(null);
    setConfirmDialog({ student: s, action });
  };

  const closeConfirmDialog = () => {
    if (busyId) return;
    setConfirmDialog(null);
  };

  const runConfirmAction = async () => {
    if (!confirmDialog) return;
    const { student, action } = confirmDialog;
    const ok = action === "reset" ? await runResetSession(student) : await runForceSubmit(student);
    if (ok) setConfirmDialog(null);
  };

  /**
   * Build 147 — manual flagging. Buka dialog konfirmasi (komponen `Modal`,
   * bukan `window.prompt`/`confirm`) untuk menandai sesi 'flagged'
   * (mencurigakan) / 'disrupted' (terganggu/terputus) beserta alasan yang
   * tersimpan ke DB, atau membersihkan tanda ('in_progress').
   */
  const openFlagDialog = (
    s: Student,
    next: "flagged" | "disrupted" | "in_progress",
  ) => {
    setFlagReason("");
    setActionError(null);
    setFlagDialog({ student: s, next });
  };

  const closeFlagDialog = () => {
    if (busyId) return;
    setFlagDialog(null);
    setFlagReason("");
  };

  const confirmFlag = async () => {
    if (!flagDialog) return;
    const { student: s, next } = flagDialog;
    const reason =
      next === "flagged" || next === "disrupted"
        ? flagReason.trim() || undefined
        : undefined;
    setActionError(null);
    setNotice(null);
    setBusyId(s.id);
    try {
      await flagSession(s.id, next, reason);
      setNotice(
        next === "in_progress"
          ? t("Tanda pada sesi \"{name}\" dibersihkan.", { name: s.name })
          : t("Sesi \"{name}\" berhasil ditandai.", { name: s.name })
      );
      setFlagDialog(null);
      setFlagReason("");
      await loadRows();
    } catch (err: any) {
      setActionError(err?.message || t("Gagal menandai sesi."));
    } finally {
      setBusyId(null);
    }
  };

  /** Grant extra exam time via the server. */
  const handleApplyExtraTime = async () => {
    if (!extraTimeStudent) return;
    const minutes = Number(extraMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setActionError(t("Pilih durasi waktu tambahan."));
      return;
    }
    setActionError(null);
    setNotice(null);
    setBusyId(extraTimeStudent);
    try {
      const res = await addExtraTime(extraTimeStudent, minutes);
      const name = students.find((s) => s.id === extraTimeStudent)?.name ?? "siswa";
      setNotice(
        t("+{n} menit diberikan ke {name} (total {total} menit).", { n: res.addedMinutes, name, total: res.extraTimeMinutes })
      );
      setExtraTimeStudent(null);
      await loadRows();
    } catch (err: any) {
      setActionError(err?.message || t("Gagal menambahkan waktu."));
    } finally {
      setBusyId(null);
    }
  };

  const statCards: { key: StudentStatus | "total" | "all"; label: string; value: number; color: string; countKey?: StudentStatus }[] = [
    { key: "all", label: t("Total"), value: counts.total, color: C.base.textMuted },
    { key: "in_progress", label: t("In Progress"), value: counts.in_progress, color: C.brand.main },
    { key: "flagged", label: t("Flagged"), value: counts.flagged, color: C.danger.main },
    { key: "disconnected", label: t("Disconnected"), value: counts.disconnected, color: C.warn.main },
    { key: "not_started", label: t("Not Started"), value: counts.not_started, color: C.base.textFaint },
    { key: "completed", label: t("Completed"), value: counts.completed, color: C.ok.main },
  ];
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Live Monitor")}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span
              className="inline-flex items-center gap-1.5 text-sm font-medium"
              style={{
                color: sseState === "live" ? C.ok.dark : sseState === "reconnecting" ? C.warn.dark : C.danger.main,
              }}
            >
              {sseState === "live" ? (
                <Radio className="w-3.5 h-3.5" />
              ) : sseState === "reconnecting" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              {sseState === "live"
                ? t("Real-time terhubung")
                : sseState === "reconnecting"
                  ? t("Menyambungkan ulang…")
                  : t("Koneksi realtime terputus")}
            </span>
            {sseState === "live" && lastUpdated && (
              <span className="text-xs tabular-nums" style={{ color: C.base.textFaint }}>
                · {t("Update terakhir {n}s lalu", { n: Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedExam}
            onChange={(e) => { setSelectedExam(e.target.value); setVisibleLimit(24); }}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={controlStyle}
          >
            <option value="all">{t("All exams")}</option>
            {examOptions.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title}</option>
            ))}
          </select>
          {/* Toggle Kartu / Tabel — membantu menangani jumlah peserta yang banyak */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${C.base.border}`, boxShadow: S.control }}>
            {(["grid", "table"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className="px-3.5 py-2 text-sm font-medium transition-all min-h-[42px]"
                style={{
                  background: viewMode === m ? C.base.dark : C.base.surface,
                  color: viewMode === m ? "#FFFFFF" : C.base.textMuted,
                }}
              >
                {m === "grid" ? t("Kartu") : t("Tabel")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {notice && <Notice type="ok">{notice}</Notice>}
      {actionError && <Notice type="error">{actionError}</Notice>}

      {/* Stats bar — klik kartu untuk memfilter status */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((stat) => (
          <button
            key={stat.key}
            onClick={() => setStatusFilter(stat.key === "all" ? "all" : (stat.key as StudentStatus))}
            className="cbt-card cbt-card-hover rounded-2xl p-4 text-center transition-all"
            style={{
              background: C.base.surface,
              border: `1px solid ${statusFilter === stat.key ? stat.color : C.base.border}`,
              boxShadow: statusFilter === stat.key ? `0 0 0 2px ${alpha(stat.color, 20)}, ${S.card}` : S.card,
            }}
          >
            <div className="text-2xl font-bold tabular-nums" style={{ color: stat.color, fontFamily: "var(--font-serif)" }}>{stat.value}</div>
            <div className="text-xs mt-0.5" style={{ color: C.base.textFaint }}>{stat.label}</div>
          </button>
        ))}
      </div>

      {/* Overall progress bar */}
      <div className="cbt-card rounded-2xl p-4" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
        <div className="flex justify-between gap-2 text-xs mb-2" style={{ color: C.base.textMuted }}>
          <span className="truncate">{t("Overall Class Progress — {exam}", { exam: selectedExamTitle })}</span>
          <span className="shrink-0 tabular-nums font-medium">{t("{n}% average", { n: avgProgress })}</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex" style={{ background: C.base.border }}>
          <div style={{ width: `${(counts.completed / counts.total) * (counts.total ? 100 : 0)}%`, background: C.ok.main }} />
          <div style={{ width: `${(counts.in_progress / counts.total) * (counts.total ? 100 : 0)}%`, background: C.brand.main }} />
          <div style={{ width: `${(counts.flagged / counts.total) * (counts.total ? 100 : 0)}%`, background: C.danger.main }} />
          <div style={{ width: `${(counts.disconnected / counts.total) * (counts.total ? 100 : 0)}%`, background: C.warn.main }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
          {[
            { label: t("Completed"), color: C.ok.main },
            { label: t("In Progress"), color: C.brand.main },
            { label: t("Flagged"), color: C.danger.main },
            { label: t("Disconnected"), color: C.warn.main },
            { label: t("Not Started"), color: C.base.textFaint },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs" style={{ color: C.base.textMuted }}>
              <span className="w-2.5 h-1 rounded-full shrink-0" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Filter & pencarian */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...STATUS_ORDER] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 min-h-[38px]"
            style={{
              background: statusFilter === s ? C.base.dark : C.base.surface,
              color: statusFilter === s ? "#FFFFFF" : C.base.textMuted,
              border: `1px solid ${statusFilter === s ? C.base.dark : C.base.border}`,
              boxShadow: S.control,
            }}
          >
            {s === "all" ? t("All Students") : t(statusConfig[s].label)}
          </button>
        ))}
        <div className="flex-1 min-w-[180px]">
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleLimit(24); }}
            placeholder={t("Cari nama, NIS, atau kelas…")}
            className="px-3 py-2 rounded-lg text-sm outline-none w-full"
            style={controlStyle}
          />
        </div>
      </div>

      <div className="flex lg:flex-row flex-col gap-5">
        {/* Student list */}
        <div className="flex-1 min-w-0">
          {filtered.length === 0 ? (
            <div className="cbt-card rounded-2xl p-10 text-center" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
              <Search className="w-8 h-8 mx-auto mb-2.5" style={{ color: C.base.textFaint }} />
              <div className="text-sm" style={{ color: C.base.textMuted }}>{t("Tidak ada sesi yang cocok dengan filter.")}</div>
            </div>
          ) : viewMode === "table" ? (
            /* ── Mode Tabel (padat, cocok untuk peserta banyak) ── */
            <div className="cbt-card rounded-2xl overflow-hidden" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.base.surfaceSoft }}>
                      {[t("Siswa"), t("Kelas"), t("Status"), t("Progres"), t("Sisa Waktu"), t("Tab"), ""].map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: C.base.textMuted }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((student) => (
                      <tr
                        key={student.id}
                        onClick={() => setSelectedStudent(student)}
                        className="cursor-pointer cbt-row-hover transition-colors"
                        style={{
                          borderTop: `1px solid ${C.base.borderLight}`,
                          background: selectedStudent?.id === student.id ? statusConfig[student.status].bg : C.base.surface,
                        }}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: statusConfig[student.status].dot, color: "#FFFFFF" }}>
                              {student.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium leading-tight truncate" style={{ color: C.base.text }}>{student.name}</div>
                              <div className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>{student.nis}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: C.base.textMuted }}>{student.className}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: statusConfig[student.status].bg, color: statusConfig[student.status].text }}>
                            {t(statusConfig[student.status].label)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums" style={{ color: C.base.text }}>
                          {student.status === "in_progress"
                            ? `${student.progress}% · Q${student.currentQuestion}/${student.totalQuestions}`
                            : student.status === "completed"
                              ? `${student.score}/100`
                              : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular-nums" style={{ fontFamily: "var(--font-mono)", color: student.status === "in_progress" ? (student.tabSwitches > 0 ? C.danger.main : C.base.text) : C.base.textMuted }}>
                          {student.status === "in_progress" ? formatTime(student.timeLeft) : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums" style={{ color: student.tabSwitches > 0 ? C.danger.main : C.base.textFaint, fontWeight: student.tabSwitches > 0 ? 600 : 400 }}>
                          {student.tabSwitches > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Flag className="w-3 h-3" />
                              {student.tabSwitches}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs" style={{ color: C.base.textFaint }}>
                          <ChevronRight className="w-4 h-4 inline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
              /* ── Mode Kartu ── */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {visible.map((student) => (
                <button
                  key={student.id}
                  onClick={() => setSelectedStudent(student)}
                  className="cbt-card cbt-card-hover text-left rounded-2xl p-3.5 transition-all"
                  style={{
                    background: statusConfig[student.status].bg,
                    border: `1.5px solid ${selectedStudent?.id === student.id ? statusConfig[student.status].dot : statusConfig[student.status].border}`,
                    boxShadow: selectedStudent?.id === student.id ? `0 0 0 2px ${alpha(statusConfig[student.status].dot, 25)}, ${S.card}` : S.card,
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: statusConfig[student.status].dot, color: "#FFFFFF" }}>
                      {student.name.charAt(0)}
                    </div>
                    {student.status === "flagged" && student.tabSwitches > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 tabular-nums" style={{ background: C.danger.bg, color: C.danger.main }}>
                        <Flag className="w-3 h-3" />
                        {student.tabSwitches}
                      </span>
                    )}
                    {student.status === "disconnected" && (
                      <WifiOff className="w-3.5 h-3.5" style={{ color: C.warn.main }} />
                    )}
                  </div>

                  <div className="text-xs font-semibold leading-tight mb-0.5 truncate" style={{ color: C.base.text }}>{student.name}</div>
                  <div className="text-xs mb-1.5 flex items-center gap-1">
                    <span style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>{student.nis}</span>
                    <span style={{ color: C.base.textFaint }}>·</span>
                    <span style={{ color: C.base.textFaint }}>{student.className}</span>
                  </div>

                  {student.status === "in_progress" && (
                    <>
                      <div className="h-1.5 rounded-full mb-1" style={{ background: C.base.border }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${student.progress}%`, background: student.tabSwitches > 0 ? C.danger.main : C.brand.main }}
                        />
                      </div>
                      <div className="flex justify-between text-xs" style={{ color: C.base.textMuted }}>
                        <span>Q{student.currentQuestion}/{student.totalQuestions}</span>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{formatTime(student.timeLeft)}</span>
                      </div>
                    </>
                  )}

                  {student.status === "completed" && (
                    <div className="text-sm font-bold" style={{ color: C.ok.main }}>{student.score}/100</div>
                  )}

                  {student.status === "not_started" && (
                    <div className="text-xs" style={{ color: C.base.textFaint }}>{t("Waiting…")}</div>
                  )}

                  {student.status === "disconnected" && (
                    <div className="text-xs" style={{ color: C.warn.main }}>{t("Connection lost")}</div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Pagination ringkas untuk peserta dalam jumlah banyak */}
          {filtered.length > visible.length && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs" style={{ color: C.base.textMuted }}>
                {t("Menampilkan {shown} dari {total}", { shown: visible.length, total: filtered.length })}
              </span>
              <Btn
                onClick={() => setVisibleLimit((n) => n + 24)}
                className="px-3 py-2 text-sm font-medium"
                style={{ border: `1px solid ${C.base.border}`, color: C.base.textBody }}
              >
                {t("Tampilkan lebih banyak")}
              </Btn>
            </div>
          )}
        </div>
        {/* Detail panel */}
        {selectedStudent && (
          <div
            className="cbt-card w-full lg:w-72 shrink-0 rounded-2xl p-5 space-y-4 self-start lg:sticky lg:top-0"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm" style={{ color: C.base.text }}>{t("Student Detail")}</h3>
              <button
                onClick={() => setSelectedStudent(null)}
                aria-label={t("Tutup")}
                className="w-8 h-8 rounded-lg flex items-center justify-center cbt-row-hover"
                style={{ color: C.base.textFaint }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: statusConfig[selectedStudent.status].dot, color: "#FFFFFF" }}>
                {selectedStudent.name.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: C.base.text }}>{selectedStudent.name}</div>
                <div className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>NIS: {selectedStudent.nis}</div>
              </div>
            </div>

            <span
              className="text-xs px-2.5 py-1 rounded-full font-medium inline-block"
              style={{ background: statusConfig[selectedStudent.status].bg, color: statusConfig[selectedStudent.status].text }}
            >
              {t(statusConfig[selectedStudent.status].label)}
            </span>

            <div className="space-y-2.5 text-xs">
              {[
                { label: t("Progress"), value: `${selectedStudent.progress}% (Q${selectedStudent.currentQuestion}/${selectedStudent.totalQuestions})` },
                { label: t("Time Left"), value: selectedStudent.timeLeft > 0 ? formatTime(selectedStudent.timeLeft) : "—", mono: true },
                { label: t("Extra Time"), value: selectedStudent.extraMinutes > 0 ? `+${selectedStudent.extraMinutes} ${t("min")}` : "—", mono: true },
                { label: t("Tab Switches"), value: selectedStudent.tabSwitches.toString(), warn: selectedStudent.tabSwitches > 0 },
                { label: t("Started At"), value: selectedStudent.startedAtMs ? new Date(selectedStudent.startedAtMs).toLocaleTimeString("id-ID") : "—", mono: true },
                { label: t("Finished At"), value: selectedStudent.completedAtMs ? new Date(selectedStudent.completedAtMs).toLocaleTimeString("id-ID") : "—", mono: true },
                { label: t("IP Address"), value: selectedStudent.ip, mono: true },
                { label: t("Device / SEB"), value: selectedStudent.device },
              ].map((row) => (
                <div key={row.label} className="flex justify-between gap-2">
                  <span style={{ color: C.base.textFaint }}>{row.label}</span>
                  <span className="tabular-nums text-right" style={{ color: row.warn ? C.danger.main : C.base.text, fontWeight: row.warn ? 600 : 400, fontFamily: row.mono ? "var(--font-mono)" : "inherit" }}>{row.value}</span>
                </div>
              ))}
            </div>

            {selectedStudent.status === "completed" && selectedStudent.score && (
              <div className="rounded-xl p-3 text-center" style={{ background: C.ok.bgLight, border: `1px solid ${C.ok.border}` }}>
                <div className="text-xs mb-0.5" style={{ color: C.ok.main }}>{t("Final Score")}</div>
                <div className="text-3xl font-bold tabular-nums" style={{ color: C.ok.main, fontFamily: "var(--font-serif)" }}>{selectedStudent.score}</div>
                <div className="text-xs" style={{ color: C.ok.main }}>/ 100</div>
              </div>
            )}

            {/* Admin actions */}
            <div className="space-y-2 pt-2" style={{ borderTop: `1px solid ${C.base.border}` }}>
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textFaint }}>
                {t("Admin Actions")}
              </div>

              {selectedStudent.flagReason && (
                <div className="text-xs px-2.5 py-2 rounded-lg" style={{ background: C.danger.bg, color: C.danger.deep }}>
                  {t("Alasan tanda")}: {selectedStudent.flagReason}
                </div>
              )}

              {selectedStudent.status !== "completed" && (
                <>
                  <Btn
                    onClick={() => openFlagDialog(selectedStudent, "flagged")}
                    disabled={busyId === selectedStudent.id}
                    className="w-full"
                    variant="danger"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>{busyId === selectedStudent.id ? t("Memproses…") : t("Tandai Mencurigakan")}</span>
                  </Btn>
                  <Btn
                    onClick={() => openFlagDialog(selectedStudent, "disrupted")}
                    disabled={busyId === selectedStudent.id}
                    className="w-full"
                    variant="amber"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{busyId === selectedStudent.id ? t("Memproses…") : t("Tandai Terputus")}</span>
                  </Btn>
                  {(selectedStudent.status === "flagged" || selectedStudent.status === "disconnected") && (
                    <Btn
                      onClick={() => openFlagDialog(selectedStudent, "in_progress")}
                      disabled={busyId === selectedStudent.id}
                      className="w-full"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{busyId === selectedStudent.id ? t("Memproses…") : t("Bersihkan Tanda")}</span>
                    </Btn>
                  )}
                </>
              )}

              {selectedStudent.status === "disconnected" && (
                <Btn
                  onClick={() => openConfirmDialog(selectedStudent, "reset")}
                  disabled={busyId === selectedStudent.id}
                  style={{ background: C.ok.main, color: "#FFFFFF" }}
                  className="w-full"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{busyId === selectedStudent.id ? t("Memproses…") : t("Reset Session")}</span>
                </Btn>
              )}

              <Btn
                onClick={() => setExtraTimeStudent(selectedStudent.id)}
                className="w-full"
                style={{ color: C.warn.deep, borderColor: C.warn.border }}
                variant="amber"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t("Add Extra Time")}</span>
              </Btn>

              {selectedStudent.status !== "completed" && (
                <Btn
                  onClick={() => openConfirmDialog(selectedStudent, "force-submit")}
                  disabled={busyId === selectedStudent.id}
                  className="w-full"
                  style={{ color: C.danger.main, borderColor: C.danger.border }}
                  variant="danger"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{busyId === selectedStudent.id ? t("Memproses…") : t("Force Submit")}</span>
                </Btn>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Extra time modal */}
      {extraTimeStudent && (
        <Modal
          title={t("Add Extra Time")}
          onClose={() => setExtraTimeStudent(null)}
        >
          <p className="text-sm mb-4" style={{ color: C.base.textMuted }}>
            {t("Add additional exam time for {name}", { name: students.find((s) => s.id === extraTimeStudent)?.name ?? "" })}
          </p>
          <select
            value={extraMinutes}
            onChange={(e) => setExtraMinutes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-4"
            style={controlStyle}
          >
            <option value="5">{t("5 minutes")}</option>
            <option value="10">{t("10 minutes")}</option>
            <option value="15">{t("15 minutes")}</option>
            <option value="30">{t("30 minutes")}</option>
            <option value="60">{t("60 minutes")}</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => setExtraTimeStudent(null)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium min-h-[44px]"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textMuted }}
            >
              {t("Cancel")}
            </button>
            <button
              onClick={handleApplyExtraTime}
              disabled={busyId === extraTimeStudent}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 min-h-[44px]"
              style={{ background: C.warn.main, color: "#FFFFFF" }}
            >
              {busyId === extraTimeStudent ? t("Menyimpan…") : t("Apply")}
            </button>
          </div>
        </Modal>
      )}

      {/* Manual session flag confirmation dialog (build 147) */}
      {flagDialog && (
        <Modal
          title={
            flagDialog.next === "flagged"
              ? t("Tandai Mencurigakan")
              : flagDialog.next === "disrupted"
                ? t("Tandai Terputus")
                : t("Bersihkan Tanda")
          }
          onClose={closeFlagDialog}
          dismissable={!busyId}
        >
          <p className="text-sm mb-4" style={{ color: C.base.textMuted }}>
            {flagDialog.next === "in_progress"
              ? t("Bersihkan tanda pada sesi \"{name}\"? Status kembali ke \"In Progress\".", { name: flagDialog.student.name })
              : t("Anda akan menandai sesi \"{name}\" sebagai {label}. Tindakan ini tersimpan ke database.", {
                  name: flagDialog.student.name,
                  label: flagDialog.next === "flagged" ? t("mencurigakan") : t("terganggu/terputus"),
                })}
          </p>

          {flagDialog.next !== "in_progress" && (
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("Alasan (opsional)…")}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none mb-4 resize-none"
              style={controlStyle}
            />
          )}

          {actionError && (
            <div className="text-xs mb-3" style={{ color: C.danger.main }}>{actionError}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={closeFlagDialog}
              disabled={!!busyId}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 min-h-[44px]"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textMuted }}
            >
              {t("Cancel")}
            </button>
            <button
              onClick={confirmFlag}
              disabled={busyId === flagDialog.student.id}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 min-h-[44px]"
              style={{
                background:
                  flagDialog.next === "flagged" ? C.danger.main
                  : flagDialog.next === "disrupted" ? C.warn.main
                  : C.brand.main,
                color: "#FFFFFF",
              }}
            >
              {busyId === flagDialog.student.id ? t("Memproses…") : t("Konfirmasi")}
            </button>
          </div>
        </Modal>
      )}

      {/* Reset / Force Submit confirmation dialog (build 147) */}
      {confirmDialog && (
        <Modal
          title={confirmDialog.action === "reset" ? t("Reset Session") : t("Force Submit")}
          onClose={closeConfirmDialog}
          dismissable={!busyId}
        >
          <p className="text-sm mb-4" style={{ color: C.base.textMuted }}>
            {confirmDialog.action === "reset"
              ? t("Reset sesi \"{name}\"? Status akan dikembalikan ke \"In Progress\" dan sesi dapat diakses ulang.", { name: confirmDialog.student.name })
              : t("Force submit ujian for \"{name}\"? Sesi akan ditandai selesai dan dinilai dari jawaban yang sudah tersimpan.", { name: confirmDialog.student.name })}
          </p>

          {actionError && (
            <div className="text-xs mb-3" style={{ color: C.danger.main }}>{actionError}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={closeConfirmDialog}
              disabled={!!busyId}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 min-h-[44px]"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textMuted }}
            >
              {t("Cancel")}
            </button>
            <button
              onClick={runConfirmAction}
              disabled={busyId === confirmDialog.student.id}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 min-h-[44px]"
              style={{
                background: confirmDialog.action === "reset" ? C.ok.main : C.danger.main,
                color: "#FFFFFF",
              }}
            >
              {busyId === confirmDialog.student.id ? t("Memproses…") : t("Konfirmasi")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
