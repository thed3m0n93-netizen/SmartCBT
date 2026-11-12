import { useState, useEffect } from "react";
import { useI18n } from "../../i18n";
import { useAuth } from "../../app/AuthContext";
import {
  fetchDashboardStats,
  fetchActiveExams,
  fetchActivity,
  fetchGradingExams,
  exportExamResults,
  downloadFromBase64,
  fetchActiveSessions,
  fetchSystemHealth,
  revokeUserSessions,
  type DashboardStats,
  type ActiveExamRow,
  type ActivityItem,
  type ActiveSessionInfo,
  type ActiveSessionsResponse,
  type SystemHealthData,
} from "../../lib/api";
import { C, R, alpha } from "../../styles/tokens";
import { Card, SectionCard, PageHeader, Btn, Modal, Notice } from "../../components/ui";
import { DashboardStats as DashboardStatsComponent } from "../../components/dashboard";

/** Rows-per-page choices for the Active Sessions list (`0` = show all). */
const SESSION_PAGE_SIZES = [10, 20, 50, 0] as const;

/** Stable identity of a session row (one token per logged-in device). */
function sessionKey(s: ActiveSessionInfo): string {
  return `${s.userId}:${s.createdAt}`;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * One row in the System Health card.
 * `state` has three levels: "ok" (green), "warn" (amber — reachable but not
 * fully usable, e.g. AI server up but the configured model is missing) and
 * "down" (red — hard failure such as unreachable/timeout).
 */
function HealthRow(props: {
  name: string;
  ok: boolean;
  state?: "ok" | "warn" | "down";
  detail: string;
  okLabel: string;
  downLabel: string;
  warnLabel?: string;
}) {
  const state: "ok" | "warn" | "down" =
    props.state ?? (props.ok ? "ok" : "warn");
  const color =
    state === "ok" ? C.ok.main : state === "down" ? C.danger.main : C.warn.main;
  const bg = state === "ok" ? C.ok.bg : state === "down" ? C.danger.bg : C.warn.bg;
  const label =
    state === "ok"
      ? props.okLabel
      : state === "down"
      ? props.downLabel
      : props.warnLabel ?? props.downLabel;
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-sm" style={{ color: C.base.text }}>{props.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>
          {props.detail}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: bg, color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<"today" | "week" | "month">("today");
  const [statsData, setStatsData] = useState<DashboardStats | null>(null);
  const [activityData, setActivityData] = useState<ActivityItem[]>([]);
  const [activeExamsData, setActiveExamsData] = useState<ActiveExamRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Active Sessions Monitoring ──
  const [sessionsData, setSessionsData] = useState<ActiveSessionsResponse | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  // Paging for the session list: many devices signed in at once would otherwise
  // stretch the card indefinitely. `0` rows-per-page means "show all".
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState<number>(SESSION_PAGE_SIZES[0]);
  // Session ids hidden locally right after a revoke, so the card reacts
  // instantly instead of waiting for the next 15s auto-refresh.
  const [revokedSessionIds, setRevokedSessionIds] = useState<string[]>([]);

  // ── Real System Health ──
  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // ── Auto-refresh state ──
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<Date | null>(null);
  const [sessionsUpdatedAt, setSessionsUpdatedAt] = useState<Date | null>(null);

  // `silent` = background auto-refresh: keep showing old data, no loading flicker.
  const loadHealth = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setHealthLoading(true);
    setHealthError(null);
    try {
      setHealthData(await fetchSystemHealth());
      setHealthUpdatedAt(new Date());
    } catch (err: any) {
      setHealthError(err?.message || t("Failed to load system health."));
    } finally {
      if (!silent) setHealthLoading(false);
    }
  };

  // `opts.silent` is accepted for API symmetry with loadHealth (sessions list
  // already renders the previous data while refreshing, so no flicker occurs).
  const loadSessions = async (opts?: { silent?: boolean }) => {
    try {
      const sessionsRes = await fetchActiveSessions();
      setSessionsData(sessionsRes);
      setSessionsUpdatedAt(new Date());
      // Prune the locally-hidden rows that the server no longer reports.
      const liveKeys = new Set(sessionsRes.sessions.map(sessionKey));
      setRevokedSessionIds((prev) => prev.filter((key) => liveKeys.has(key)));
    } catch (err: any) {
      console.error("[dashboard] fetch sessions error:", err);
      if (!opts?.silent) setRevokeMsg({ type: "error", text: err?.message || t("Gagal memuat daftar sesi.") });
    }
  };

  const handleRevokeUser = async (session: ActiveSessionInfo) => {
    if (!window.confirm(`Paksa logout "${session.username}" dari perangkat ini?`)) return;
    setRevokeBusy(sessionKey(session));
    setRevokeMsg(null);
    try {
      await revokeUserSessions(session.userId);
      // Hide the row locally so the list reacts immediately (the server-side
      // revoke is reflected for real on the next auto-refresh).
      setRevokedSessionIds((prev) =>
        prev.includes(sessionKey(session)) ? prev : [...prev, sessionKey(session)],
      );
      setRevokeMsg({ type: "ok", text: t("Sesi \"{name}\" telah dicabut.", { name: session.username }) });
      // Refresh sessions list after revoke
      await loadSessions();
    } catch (err: any) {
      setRevokeMsg({ type: "error", text: err?.message || t("Gagal mencabut session.") });
    } finally {
      setRevokeBusy(null);
    }
  };

  // ── Export exam results (Excel/CSV) ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportExams, setExportExams] = useState<{ id: string; title: string }[]>([]);
  const [exportExamId, setExportExamId] = useState<string>("all");
  const [exportFormat, setExportFormat] = useState<"excel" | "csv">("excel");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const openExportModal = async () => {
    setExportOpen(true);
    setExportMsg(null);
    try {
      const exams = await fetchGradingExams();
      setExportExams(exams.map((e: any) => ({ id: e.id, title: e.title })));
      setExportExamId((prev) => (prev === "all" ? "all" : prev));
    } catch (err: any) {
      setExportMsg({ type: "error", text: err?.message || t("Gagal memuat daftar ujian.") });
    }
  };

  const runExport = async () => {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const result = await exportExamResults({
        all: exportExamId === "all",
        examId: exportExamId === "all" ? undefined : exportExamId,
        format: exportFormat,
      });
      downloadFromBase64(result);
      setExportMsg({ type: "ok", text: t("File hasil ujian diunduh: {file}", { file: result.fileName }) });
    } catch (err: any) {
      setExportMsg({ type: "error", text: err?.message || t("Gagal mengekspor hasil ujian.") });
    } finally {
      setExportBusy(false);
    }
  };

  // ── Active sessions paging (derived) ──
  // Sessions revoked in this browser are hidden immediately; the list shrinks
  // again for real on the next auto-refresh.
  const sessions = sessionsData
    ? sessionsData.sessions.filter((s) => !revokedSessionIds.includes(sessionKey(s)))
    : [];
  const sessionTotal = sessions.length;
  const sessionTotalPages =
    sessionPageSize > 0 ? Math.max(1, Math.ceil(sessionTotal / sessionPageSize)) : 1;
  const sessionCurrentPage = Math.min(sessionPage, sessionTotalPages);
  const sessionFrom = sessionTotal === 0 ? 0 : (sessionCurrentPage - 1) * (sessionPageSize || sessionTotal) + 1;
  const sessionTo =
    sessionPageSize > 0 ? Math.min(sessionCurrentPage * sessionPageSize, sessionTotal) : sessionTotal;
  const visibleSessions =
    sessionPageSize > 0
      ? sessions.slice((sessionCurrentPage - 1) * sessionPageSize, sessionCurrentPage * sessionPageSize)
      : sessions;

  useEffect(() => {
    loadHealth();
    loadSessions();
    // Auto-refresh: health every 30s, active sessions every 15s (silent = no flicker).
    const healthTimer = window.setInterval(() => loadHealth({ silent: true }), 30000);
    const sessionsTimer = window.setInterval(() => loadSessions({ silent: true }), 15000);

    async function loadDashboard() {
      try {
        const [stats, activity, exams] = await Promise.all([
          fetchDashboardStats(),
          fetchActivity(),
          fetchActiveExams(),
        ]);
        setStatsData(stats);
        setActivityData(activity);
        setActiveExamsData(exams);
      } catch (err) {
        console.error("[dashboard] fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();

    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(sessionsTimer);
    };
  }, []);

  const statCards = statsData
    ? [
        {
          label: t("Total Users"),
          value: statsData.totalUsers,
          icon: "👥",
          color: C.brand.main,
        },
        {
          label: t("Active Exams"),
          value: statsData.activeExams,
          icon: "📋",
          color: C.ok.main,
        },
        {
          label: t("Submissions Today"),
          value: statsData.submissionsToday,
          icon: "✔",
          color: C.purple.main,
        },
        {
          label: t("Flagged Events"),
          value: statsData.flaggedEvents,
          icon: "⚑",
          color: C.danger.main,
        },
      ]
    : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("System Dashboard")}
        subtitle={`Selasa, 1 September 2026 · ${user?.institution ?? "SMK TEKNOLOGI"}`}
        actions={
          <>
            <Btn variant="primary" onClick={openExportModal}>⬇ {t("Export Exam Results")}</Btn>
            <div className="flex gap-1 rounded-lg p-1" style={{ background: C.base.surfaceSoft }}>
              {(["today", "week", "month"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedPeriod(p)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all"
                  style={{
                    background: selectedPeriod === p ? C.base.surface : "transparent",
                    color: selectedPeriod === p ? C.base.text : C.base.textMuted,
                    boxShadow: selectedPeriod === p ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {t(p)}
                </button>
              ))}
            </div>
          </>
        }
      />

      {statCards.length > 0 && <DashboardStatsComponent cards={statCards} cols={4} />}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity feed */}
        <div className="lg:col-span-2">
          <SectionCard
            title={t("Recent Activity")}
            right={
              <span className="text-xs" style={{ color: C.base.textFaint }}>
                {t("Live")}
                <span className="inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle" style={{ background: C.ok.main }} />
              </span>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div className="divide-y">
              {activityData.map((a, i) => (
                <div key={i} className="px-5 py-3 flex items-start gap-4 hover:bg-slate-50 transition-colors" style={{ borderColor: C.base.borderLight }}>
                  <div
                    className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                    style={{
                      background: a.type === "warning" ? C.warn.bg : a.type === "success" ? C.ok.bg : C.brand.bg,
                      color: a.type === "warning" ? C.warn.main : a.type === "success" ? C.ok.main : C.brand.main,
                    }}
                  >
                    {a.type === "warning" ? "!" : a.type === "success" ? "✓" : "i"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: C.base.text }}>{a.event}</span>
                      <span className="text-xs shrink-0" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>{a.time}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>{a.detail}</div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textFaint }}>by {a.user_name}</div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <SectionCard
            title={t("System Health")}
            right={
              <div className="flex items-center gap-2">
                {healthUpdatedAt && (
                  <span className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>
                    {healthUpdatedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
                <span className="text-xs" style={{ color: C.base.textFaint }}>
                  {t("Auto")}
                  <span className="inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle" style={{ background: C.ok.main }} />
                </span>
                <button
                  onClick={() => loadHealth()}
                  disabled={healthLoading}
                  className="text-xs font-medium px-2 py-1 rounded transition-colors"
                  style={{
                    background: C.base.borderLight,
                    color: C.base.textMuted,
                    cursor: healthLoading ? "wait" : "pointer",
                    opacity: healthLoading ? 0.6 : 1,
                  }}
                >
                  ⟳ {t("Refresh")}
                </button>
              </div>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div className="px-5 py-3 space-y-2.5">
              {healthLoading && (
                <div className="text-xs" style={{ color: C.base.textMuted }}>{t("Loading…")}</div>
              )}
              {healthError && !healthData && (
                <div className="text-xs" style={{ color: C.warn.main }}>{healthError}</div>
              )}
              {healthData && (
                <>
                  <HealthRow
                    name={t("Database")}
                    ok={healthData.database.ok}
                    detail={`${healthData.database.version ?? ""} ${healthData.database.latencyMs}ms`}
                    okLabel={t("Operational")}
                    downLabel={t("Down")}
                  />
                  <HealthRow
                    name={t("File Storage")}
                    ok={healthData.storage.ok}
                    detail={`${healthData.storage.files} files · ${formatBytes(healthData.storage.bytes)}`}
                    okLabel={t("Operational")}
                    downLabel={t("Degraded")}
                  />
                  <HealthRow
                    name={t("API Server")}
                    ok
                    detail={`Node ${healthData.api.nodeVersion} · ${formatUptime(healthData.api.uptimeSec)} · ${healthData.api.memoryRssMb}MB`}
                    okLabel={t("Operational")}
                    downLabel={t("Down")}
                  />
                  <HealthRow
                    name={t("Session Store")}
                    ok={healthData.sessions.activeSessions > 0}
                    detail={`${healthData.sessions.activeUsers} users · ${healthData.sessions.activeSessions} sessions`}
                    okLabel={t("Operational")}
                    downLabel={t("Idle")}
                  />
                  <HealthRow
                    name={t("Realtime (SSE)")}
                    ok={(healthData.realtime.sseClients ?? 0) > 0}
                    detail={`${healthData.realtime.sseClients ?? 0} ${t("clients")}`}
                    okLabel={t("Operational")}
                    downLabel={t("Idle")}
                  />
                  <HealthRow
                    name={t("AI (Ollama)")}
                    ok={healthData.ai.ok}
                    state={
                      !healthData.ai.checked
                        ? "warn"
                        : healthData.ai.ok && healthData.ai.modelAvailable
                        ? "ok"
                        : healthData.ai.ok
                        ? "warn"
                        : "down"
                    }
                    detail={
                      !healthData.ai.checked
                        ? `${healthData.ai.provider} · ${healthData.ai.model}`
                        : healthData.ai.ok
                        ? `${healthData.ai.model} · ${healthData.ai.models} ${t("models")} · ${healthData.ai.latencyMs}ms`
                        : `${healthData.ai.baseUrl} · ${healthData.ai.error ?? t("Unreachable")}`
                    }
                    okLabel={t("Ready")}
                    warnLabel={healthData.ai.checked && healthData.ai.ok ? t("Model missing") : t("Not verified")}
                    downLabel={t("Offline")}
                  />
                  {healthData.ai.availableModels && healthData.ai.availableModels.length > 0 && !healthData.ai.modelAvailable && (
                    <div className="pt-1 text-xs leading-relaxed" style={{ color: C.warn.main }}>
                      {t("Available models")}: {healthData.ai.availableModels.slice(0, 6).join(", ")}
                      {healthData.ai.availableModels.length > 6 ? ` +${healthData.ai.availableModels.length - 6}` : ""}
                    </div>
                  )}
                  {healthData.ai.note && (
                    <div className="text-xs" style={{ color: C.base.textFaint }}>
                      {healthData.ai.note}
                    </div>
                  )}
                  {healthData.storage.diskFree != null && (
                    <div className="pt-1 text-xs" style={{ color: C.base.textFaint }}>
                      {t("Disk free")}: {formatBytes(healthData.storage.diskFree)} / {formatBytes(healthData.storage.diskTotal ?? 0)}
                    </div>
                  )}
                </>
              )}
            </div>
          </SectionCard>
          {/* Active Sessions Monitoring */}
          <SectionCard
            title={t("Active Sessions")}
            right={
              <div className="flex items-center gap-2">
                {sessionsUpdatedAt && (
                  <span className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>
                    {sessionsUpdatedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
                <span className="text-xs" style={{ color: C.base.textFaint }}>
                  {t("Auto")}
                  <span className="inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle" style={{ background: C.ok.main }} />
                </span>
                <button
                  onClick={() => loadSessions()}
                  className="text-xs font-medium px-2 py-1 rounded transition-colors"
                  style={{
                    background: C.base.borderLight,
                    color: C.base.textMuted,
                  }}
                >
                  ⟳ {t("Refresh")}
                </button>
              </div>
            }
            bodyStyle={{ padding: 0 }}
          >
            {sessionsData ? (
              <>
                {/* Summary stats */}
                <div className="px-5 py-3 flex items-center justify-between border-b" style={{ borderColor: C.base.borderLight }}>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold" style={{ color: C.brand.main }}>
                      {sessionsData.stats.activeUsers}
                    </div>
                    <div className="text-xs" style={{ color: C.base.textMuted }}>
                      {t("users online")}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: C.base.textFaint }}>
                    {sessionsData.stats.activeSessions} {t("sessions")}
                  </div>
                </div>

                {/* Session list */}
                {sessionTotal > 0 ? (
                  <>
                    <div className="divide-y">
                      {visibleSessions.map((s) => {
                        const key = sessionKey(s);
                        const busy = revokeBusy === key;
                        return (
                          <div key={key} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors" style={{ borderColor: C.base.borderLight }}>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                style={{
                                  background: s.role === "super_admin" ? C.danger.bg : s.role === "teacher" ? C.brand.bg : C.ok.bg,
                                  color: s.role === "super_admin" ? C.danger.main : s.role === "teacher" ? C.brand.main : C.ok.main,
                                }}
                              >
                                {s.fullName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate" style={{ color: C.base.text }}>
                                  {s.fullName}
                                </div>
                                <div className="text-xs" style={{ color: C.base.textMuted }}>
                                  {s.username} · {t(s.role)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>
                                {new Date(s.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {s.role !== "super_admin" && (
                                <button
                                  onClick={() => handleRevokeUser(s)}
                                  disabled={busy}
                                  className="text-xs px-2 py-1 rounded transition-colors"
                                  style={{
                                    background: busy ? C.base.borderLight : "transparent",
                                    color: busy ? C.base.textFaint : C.danger.main,
                                    border: `1px solid ${busy ? C.base.border : C.danger.bg}`,
                                    cursor: busy ? "wait" : "pointer",
                                  }}
                                >
                                  {busy ? t("…") : t("Logout")}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Paging controls — keeps the card short no matter how many
                        devices are signed in at once. */}
                    <div
                      className="px-5 py-3 flex flex-wrap items-center justify-between gap-3"
                      style={{ borderTop: `1px solid ${C.base.borderLight}`, background: C.base.surfaceMuted }}
                    >
                      <label className="flex items-center gap-2 text-xs" style={{ color: C.base.textMuted }}>
                        {t("Show")}
                        <select
                          value={sessionPageSize}
                          onChange={(e) => {
                            setSessionPageSize(Number(e.target.value));
                            setSessionPage(1);
                          }}
                          aria-label={t("Show")}
                          className="rounded-md px-2 py-1 text-xs outline-none"
                          style={{
                            background: C.base.surface,
                            border: `1px solid ${C.base.border}`,
                            color: C.base.text,
                            borderRadius: R.control,
                          }}
                        >
                          {SESSION_PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {size === 0 ? t("Show all") : size}
                            </option>
                          ))}
                        </select>
                        <span style={{ fontFamily: "var(--font-mono)" }}>
                          {sessionFrom}–{sessionTo} {t("of")} {sessionTotal}
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSessionPage(Math.max(1, sessionCurrentPage - 1))}
                          disabled={sessionCurrentPage <= 1}
                          className="text-xs font-medium px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          style={{
                            background: C.base.surface,
                            border: `1px solid ${C.base.border}`,
                            color: C.base.textBody,
                            cursor: sessionCurrentPage <= 1 ? "not-allowed" : "pointer",
                            borderRadius: R.control,
                          }}
                        >
                          ‹ {t("Prev")}
                        </button>
                        <span className="text-xs" style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}>
                          {t("Page {page} / {total}", { page: sessionCurrentPage, total: sessionTotalPages })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSessionPage(Math.min(sessionTotalPages, sessionCurrentPage + 1))}
                          disabled={sessionCurrentPage >= sessionTotalPages}
                          className="text-xs font-medium px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          style={{
                            background: C.base.surface,
                            border: `1px solid ${C.base.border}`,
                            color: C.base.textBody,
                            cursor: sessionCurrentPage >= sessionTotalPages ? "not-allowed" : "pointer",
                            borderRadius: R.control,
                          }}
                        >
                          {t("Next")} ›
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="px-5 py-8 text-center text-sm" style={{ color: C.base.textMuted }}>
                    {t("No active sessions")}
                  </div>
                )}

                {revokeMsg && (
                  <div className="px-5 py-3" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                    <Notice type={revokeMsg.type} icon={revokeMsg.type === "ok" ? "✓" : "⚠"}>{revokeMsg.text}</Notice>
                  </div>
                )}
              </>
            ) : (
              <div className="px-5 py-8 text-center text-sm" style={{ color: C.base.textMuted }}>
                {t("Loading…")}
              </div>
            )}
          </SectionCard>

          <SectionCard title={t("Active Exams")} bodyStyle={{ padding: 0 }}>
            <div className="px-5 py-3 space-y-4">
              {activeExamsData.map((e, i) => (
                <div key={e.id ?? i}>
                  <div className="text-xs font-medium mb-1" style={{ color: C.base.text }}>{e.title}</div>
                  <div className="text-xs mb-1.5 flex items-center justify-between" style={{ color: C.base.textFaint }}>
                    <span>{e.teacher} · {new Date(e.start_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}–{new Date(e.end_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                    {(e.flagged ?? 0) > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.danger.bg, color: C.danger.main }}>
                        {t("{n} flagged", { n: e.flagged ?? 0 }).replace("{n}", String(e.flagged ?? 0))}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: C.base.border }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${((e.completed ?? 0) / (e.student_count || 1)) * 100}%`,
                          background: (e.completed ?? 0) === e.student_count ? C.ok.main : C.brand.main,
                        }}
                      />
                    </div>
                    <span className="text-xs shrink-0" style={{ color: C.base.textMuted }}>{e.completed ?? 0}/{e.student_count ?? 0}</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
      {exportOpen && (
        <Modal
          title={t("Export Exam Results")}
          onClose={() => setExportOpen(false)}
          width={560}
          overlay="rgba(15,23,42,0.5)"
          actions={
            <>
              <Btn onClick={() => setExportOpen(false)} disabled={exportBusy} style={{ flex: 1 }}>{t("Tutup")}</Btn>
              <Btn variant="primary" onClick={runExport} disabled={exportBusy || exportExams.length === 0} style={{ flex: 1 }}>
                {exportBusy ? t("Menyiapkan file…") : `⬇ ${t("Unduh")}`}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("Unduh hasil ujian sebagai tabel Excel (.xlsx) atau CSV yang tersusun rapi: data siswa, skor, nilai 0–100, predikat, dan statistik per ujian.")}
          </p>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: C.base.textMuted }}>{t("Pilih ujian")}</label>
            <select
              value={exportExamId}
              onChange={(e) => setExportExamId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceMuted, color: C.base.text }}
            >
              <option value="all">{t("Semua ujian (rekap gabungan)")}</option>
              {exportExams.map((exam) => (
                <option key={exam.id} value={exam.id}>{exam.title}</option>
              ))}
            </select>
            {exportExams.length === 0 && (
              <p className="text-xs mt-1" style={{ color: C.warn.main }}>{t("Belum ada ujian yang dapat diekspor.")}</p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: C.base.textMuted }}>{t("Format file")}</label>
            <div className="mt-1 flex gap-1 rounded-lg p-1 w-fit" style={{ background: C.base.borderLight }}>
              {([["excel", "Excel (.xlsx)"], ["csv", "CSV (.csv)"]] as const).map(([fmt, label]) => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{
                    background: exportFormat === fmt ? C.base.surface : "transparent",
                    color: exportFormat === fmt ? C.base.text : C.base.textMuted,
                    boxShadow: exportFormat === fmt ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {exportMsg && (
            <Notice type={exportMsg.type} icon={exportMsg.type === "ok" ? "✓" : "⚠"}>{exportMsg.text}</Notice>
          )}
        </Modal>
      )}
    </div>
  );
}
