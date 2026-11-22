import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, Flag, Info, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
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
  fetchAuditLogs,
  type DashboardStats,
  type ActiveExamRow,
  type ActivityItem,
  type ActiveSessionInfo,
  type ActiveSessionsResponse,
  type SystemHealthData,
  type AuditLogRow,
} from "../../lib/api";
import { C, R, S } from "../../styles/tokens";
import { getAiProvider } from "../../lib/ai-providers";
import { SectionCard, PageHeader, Btn, Modal, Notice, controlStyle } from "../../components/ui";
import { DashboardStats as DashboardStatsComponent } from "../../components/dashboard";
import AiProviderPanel from "../../components/AiProviderWidget";

const SESSION_PAGE_SIZES = [10, 20, 50, 0] as const;

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

function HealthRow(props: {
  name: string;
  ok: boolean;
  state?: "ok" | "warn" | "down";
  detail: string;
  okLabel: string;
  downLabel: string;
  warnLabel?: string;
}) {
  const state: "ok" | "warn" | "down" = props.state ?? (props.ok ? "ok" : "warn");
  const color = state === "ok" ? C.ok.dark : state === "down" ? C.danger.text : C.warn.dark;
  const bg = state === "ok" ? C.ok.bg : state === "down" ? C.danger.bg : C.warn.bg;
  const label =
    state === "ok" ? props.okLabel : state === "down" ? props.downLabel : props.warnLabel ?? props.downLabel;
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-sm font-medium truncate" style={{ color: C.base.text }}>
        {props.name}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="text-xs tabular-nums hidden sm:inline"
          style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
        >
          {props.detail}
        </span>
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
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

  const [sessionsData, setSessionsData] = useState<ActiveSessionsResponse | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState<number>(SESSION_PAGE_SIZES[0]);
  const [revokedSessionIds, setRevokedSessionIds] = useState<string[]>([]);

  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [healthUpdatedAt, setHealthUpdatedAt] = useState<Date | null>(null);
  const [sessionsUpdatedAt, setSessionsUpdatedAt] = useState<Date | null>(null);
  const [revokeConfirmTarget, setRevokeConfirmTarget] = useState<ActiveSessionInfo | null>(null);

  // Audit Log state
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditCategory, setAuditCategory] = useState("all");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(15);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetchAuditLogs({
        category: auditCategory === "all" ? undefined : auditCategory,
        search: auditQuery.trim() || undefined,
        page: auditPage,
        pageSize: auditPageSize,
      });
      setAuditRows(res.rows);
      setAuditTotal(res.total);
    } catch (err: any) {
      setAuditError(err?.message || t("Gagal memuat log audit."));
    } finally {
      setAuditLoading(false);
    }
  }, [auditCategory, auditQuery, auditPage, auditPageSize, t]);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

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

  const loadSessions = async (opts?: { silent?: boolean }) => {
    try {
      const sessionsRes = await fetchActiveSessions();
      setSessionsData(sessionsRes);
      setSessionsUpdatedAt(new Date());
      const liveKeys = new Set(sessionsRes.sessions.map(sessionKey));
      setRevokedSessionIds((prev) => prev.filter((key) => liveKeys.has(key)));
    } catch (err: any) {
      console.error("[dashboard] fetch sessions error:", err);
      if (!opts?.silent) setRevokeMsg({ type: "error", text: err?.message || t("Gagal memuat daftar sesi.") });
    }
  };

  const handleRevokeUser = (session: ActiveSessionInfo) => {
    setRevokeConfirmTarget(session);
  };

  const confirmRevokeUser = async () => {
    if (!revokeConfirmTarget) return;
    const session = revokeConfirmTarget;
    setRevokeBusy(sessionKey(session));
    setRevokeMsg(null);
    try {
      await revokeUserSessions(session.userId);
      setRevokedSessionIds((prev) =>
        prev.includes(sessionKey(session)) ? prev : [...prev, sessionKey(session)],
      );
      setRevokeMsg({ type: "ok", text: t("Sesi \"{name}\" telah dicabut.", { name: session.username }) });
      setRevokeConfirmTarget(null);
      await loadSessions();
    } catch (err: any) {
      setRevokeMsg({ type: "error", text: err?.message || t("Gagal mencabut session.") });
      setRevokeConfirmTarget(null);
    } finally {
      setRevokeBusy(null);
    }
  };

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
          icon: <Users className="w-5 h-5" />,
          color: C.brand.main,
        },
        {
          label: t("Active Exams"),
          value: statsData.activeExams,
          icon: <ClipboardList className="w-5 h-5" />,
          color: C.ok.main,
        },
        {
          label: t("Submissions Today"),
          value: statsData.submissionsToday,
          icon: <CheckCircle2 className="w-5 h-5" />,
          color: C.purple.main,
        },
        {
          label: t("Flagged Events"),
          value: statsData.flaggedEvents,
          icon: <Flag className="w-5 h-5" />,
          color: C.danger.main,
        },
      ]
    : [];

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title={t("System Dashboard")}
        subtitle={`Selasa, 1 September 2026 · ${user?.institution ?? "SMK TEKNOLOGI"}`}
        actions={
          <>
            <Btn variant="primary" onClick={openExportModal}>
              <Download className="w-4 h-4" />
              {t("Export Exam Results")}
            </Btn>
            <div
              className="flex gap-1 rounded-xl p-1"
              style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}`, boxShadow: S.inset }}
            >
              {(["today", "week", "month"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPeriod(p)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all min-h-[34px]"
                  style={{
                    background: selectedPeriod === p ? C.base.surface : "transparent",
                    color: selectedPeriod === p ? C.base.text : C.base.textMuted,
                    boxShadow: selectedPeriod === p ? S.control : "none",
                  }}
                >
                  {t(p)}
                </button>
              ))}
            </div>
          </>
        }
      />

      {loading && statCards.length === 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[0, 1, 2, 3].map((k) => (
            <div
              key={k}
              className="h-24 rounded-2xl animate-pulse"
              style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}` }}
            />
          ))}
        </div>
      ) : (
        statCards.length > 0 && <DashboardStatsComponent cards={statCards} cols={4} />
      )}

      <AiProviderPanel />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        {/* Activity feed */}
        <div className="lg:col-span-2">
          <SectionCard
            title={t("Recent Activity")}
            right={
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: C.ok.bg, color: C.ok.dark }}
              >
                {t("Live")}
              </span>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div className="divide-y" style={{ borderColor: C.base.borderLight }}>
              {activityData.map((a, i) => (
                <div
                  key={i}
                  className="px-4 sm:px-5 py-3.5 flex items-start gap-3.5 cbt-row-hover transition-colors"
                  style={{ borderColor: C.base.borderLight }}
                >
                  <div
                    className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background:
                        a.type === "warning" ? C.warn.bg : a.type === "success" ? C.ok.bg : C.brand.bg,
                      color:
                        a.type === "warning" ? C.warn.dark : a.type === "success" ? C.ok.dark : C.brand.dark,
                    }}
                  >
                    {a.type === "warning" ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : a.type === "success" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <Info className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: C.base.text }}>
                        {a.event}
                      </span>
                      <span
                        className="text-xs shrink-0 tabular-nums"
                        style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                      >
                        {a.time}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                      {a.detail}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textFaint }}>
                      by {a.user_name}
                    </div>
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
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                  >
                    {healthUpdatedAt.toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => loadHealth()}
                  disabled={healthLoading}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1.5 min-h-[30px]"
                  style={{
                    background: C.base.surfaceSoft,
                    color: C.base.textBody,
                    border: `1px solid ${C.base.border}`,
                    cursor: healthLoading ? "wait" : "pointer",
                    opacity: healthLoading ? 0.6 : 1,
                  }}
                >
                  <RefreshCw className={`w-3 h-3 ${healthLoading ? "animate-spin" : ""}`} />
                  {t("Refresh")}
                </button>
              </div>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div className="px-4 sm:px-5 py-3.5 space-y-2.5">
              {healthLoading && (
                <div className="text-xs" style={{ color: C.base.textMuted }}>
                  {t("Loading…")}
                </div>
              )}
              {healthError && !healthData && (
                <div className="text-xs" style={{ color: C.warn.dark }}>
                  {healthError}
                </div>
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
                    name={`AI (${getAiProvider(healthData.ai.provider).label.split(" (")[0]})`}
                    ok={healthData.ai.ok}
                    state={
                      healthData.ai.checked
                        ? healthData.ai.ok && healthData.ai.modelAvailable
                          ? "ok"
                          : healthData.ai.ok
                            ? "warn"
                            : "down"
                        : healthData.ai.ok && getAiProvider(healthData.ai.provider).hasBuiltInApiKey
                          ? "ok"
                          : "warn"
                    }
                    detail={
                      !healthData.ai.checked
                        ? `${healthData.ai.provider} · ${healthData.ai.model}`
                        : healthData.ai.ok
                          ? `${healthData.ai.model} · ${healthData.ai.models} ${t("models")} · ${healthData.ai.latencyMs}ms`
                          : `${healthData.ai.baseUrl} · ${healthData.ai.error ?? t("Unreachable")}`
                    }
                    okLabel={t("Ready")}
                    warnLabel={
                      healthData.ai.checked && healthData.ai.ok ? t("Model missing") : t("Not verified")
                    }
                    downLabel={t("Offline")}
                  />
                  {healthData.ai.availableModels &&
                    healthData.ai.availableModels.length > 0 &&
                    !healthData.ai.modelAvailable && (
                      <div className="pt-1 text-xs leading-relaxed" style={{ color: C.warn.dark }}>
                        {t("Available models")}: {healthData.ai.availableModels.slice(0, 6).join(", ")}
                        {healthData.ai.availableModels.length > 6
                          ? ` +${healthData.ai.availableModels.length - 6}`
                          : ""}
                      </div>
                    )}
                  {healthData.ai.note && (
                    <div className="text-xs" style={{ color: C.base.textFaint }}>
                      {healthData.ai.note}
                    </div>
                  )}
                  {healthData.storage.diskFree != null && (
                    <div className="pt-1 text-xs tabular-nums" style={{ color: C.base.textFaint }}>
                      {t("Disk free")}: {formatBytes(healthData.storage.diskFree)} /{" "}
                      {formatBytes(healthData.storage.diskTotal ?? 0)}
                    </div>
                  )}
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title={t("Active Sessions")}
            right={
              <div className="flex items-center gap-2">
                {sessionsUpdatedAt && (
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                  >
                    {sessionsUpdatedAt.toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => loadSessions()}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1.5 min-h-[30px]"
                  style={{
                    background: C.base.surfaceSoft,
                    color: C.base.textBody,
                    border: `1px solid ${C.base.border}`,
                  }}
                >
                  <RefreshCw className="w-3 h-3" />
                  {t("Refresh")}
                </button>
              </div>
            }
            bodyStyle={{ padding: 0 }}
          >
            {sessionsData ? (
              <>
                <div
                  className="px-4 sm:px-5 py-3 flex items-center justify-between border-b"
                  style={{ borderColor: C.base.borderLight }}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold tabular-nums" style={{ color: C.brand.dark }}>
                      {sessionsData.stats.activeUsers}
                    </div>
                    <div className="text-xs" style={{ color: C.base.textMuted }}>
                      {t("users online")}
                    </div>
                  </div>
                  <div className="text-xs tabular-nums" style={{ color: C.base.textFaint }}>
                    {sessionsData.stats.activeSessions} {t("sessions")}
                  </div>
                </div>

                {sessionTotal > 0 ? (
                  <>
                    <div className="divide-y" style={{ borderColor: C.base.borderLight }}>
                      {visibleSessions.map((s) => {
                        const key = sessionKey(s);
                        const busy = revokeBusy === key;
                        return (
                          <div
                            key={key}
                            className="px-4 sm:px-5 py-3 flex items-center justify-between gap-2 cbt-row-hover transition-colors"
                            style={{ borderColor: C.base.borderLight }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                style={{
                                  background:
                                    s.role === "super_admin"
                                      ? C.danger.bg
                                      : s.role === "teacher"
                                        ? C.brand.bg
                                        : C.ok.bg,
                                  color:
                                    s.role === "super_admin"
                                      ? C.danger.text
                                      : s.role === "teacher"
                                        ? C.brand.dark
                                        : C.ok.dark,
                                }}
                              >
                                {s.fullName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate" style={{ color: C.base.text }}>
                                  {s.fullName}
                                </div>
                                <div className="text-xs truncate" style={{ color: C.base.textMuted }}>
                                  {s.username} · {t(s.role)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className="text-xs tabular-nums"
                                style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                              >
                                {new Date(s.createdAt).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {s.role !== "super_admin" && (
                                <button
                                  type="button"
                                  onClick={() => handleRevokeUser(s)}
                                  disabled={busy}
                                  className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors min-h-[30px]"
                                  style={{
                                    background: busy ? C.base.borderLight : C.danger.bgLight,
                                    color: busy ? C.base.textFaint : C.danger.text,
                                    border: `1px solid ${busy ? C.base.border : C.danger.border}`,
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

                    <div
                      className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl"
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
                          className="rounded-lg px-2 py-1 text-xs outline-none"
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
                        <span className="tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
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
                        <span
                          className="text-xs tabular-nums"
                          style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}
                        >
                          {t("Page {page} / {total}", {
                            page: sessionCurrentPage,
                            total: sessionTotalPages,
                          })}
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
                    <Notice type={revokeMsg.type}>{revokeMsg.text}</Notice>
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
            <div className="px-4 sm:px-5 py-3.5 space-y-4">
              {activeExamsData.map((e, i) => (
                <div key={e.id ?? i}>
                  <div className="text-xs font-semibold mb-1" style={{ color: C.base.text }}>
                    {e.title}
                  </div>
                  <div
                    className="text-xs mb-1.5 flex items-center justify-between gap-2"
                    style={{ color: C.base.textFaint }}
                  >
                    <span className="truncate">
                      {e.teacher} ·{" "}
                      {new Date(e.start_time).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      –
                      {new Date(e.end_time).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {(e.flagged ?? 0) > 0 && (
                      <span
                        className="text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: C.danger.bg, color: C.danger.text }}
                      >
                        {t("{n} flagged", { n: e.flagged ?? 0 }).replace("{n}", String(e.flagged ?? 0))}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: C.base.surfaceSoft }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${((e.completed ?? 0) / (e.student_count || 1)) * 100}%`,
                          background: (e.completed ?? 0) === e.student_count ? C.ok.main : C.brand.main,
                        }}
                      />
                    </div>
                    <span className="text-xs shrink-0 tabular-nums" style={{ color: C.base.textMuted }}>
                      {e.completed ?? 0}/{e.student_count ?? 0}
                    </span>
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
          actions={
            <>
              <Btn onClick={() => setExportOpen(false)} disabled={exportBusy} style={{ flex: 1 }}>
                {t("Tutup")}
              </Btn>
              <Btn
                variant="primary"
                onClick={runExport}
                disabled={exportBusy || exportExams.length === 0}
                style={{ flex: 1 }}
              >
                <Download className="w-4 h-4" />
                {exportBusy ? t("Menyiapkan file…") : t("Unduh")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t(
              "Unduh hasil ujian sebagai tabel Excel (.xlsx) atau CSV yang tersusun rapi: data siswa, skor, nilai 0–100, predikat, dan statistik per ujian.",
            )}
          </p>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
              {t("Pilih ujian")}
            </label>
            <select
              value={exportExamId}
              onChange={(e) => setExportExamId(e.target.value)}
              className="mt-1.5 w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[42px]"
              style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceMuted, color: C.base.text }}
            >
              <option value="all">{t("Semua ujian (rekap gabungan)")}</option>
              {exportExams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
            {exportExams.length === 0 && (
              <p className="text-xs mt-1.5" style={{ color: C.warn.dark }}>
                {t("Belum ada ujian yang dapat diekspor.")}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
              {t("Format file")}
            </label>
            <div className="mt-1.5 flex gap-1 rounded-xl p-1 w-fit" style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}` }}>
              {([["excel", "Excel (.xlsx)"], ["csv", "CSV (.csv)"]] as const).map(([fmt, label]) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: exportFormat === fmt ? C.base.surface : "transparent",
                    color: exportFormat === fmt ? C.base.text : C.base.textMuted,
                    boxShadow: exportFormat === fmt ? S.control : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {exportMsg && <Notice type={exportMsg.type}>{exportMsg.text}</Notice>}
        </Modal>
      )}

      {/* System Audit Log Panel */}
      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: C.brand.main }} />
            {t("Log Audit Sistem")}
          </span>
        }
        subtitle={t("Jejak aktivitas sensitif admin dan guru (perubahan nilai, ujian, monitoring, token, pengaturan, backup)")}
        right={
          <button
            type="button"
            onClick={() => void loadAuditLogs()}
            disabled={auditLoading}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 min-h-[34px]"
            style={{
              background: C.base.surfaceSoft,
              color: C.base.textBody,
              border: `1px solid ${C.base.border}`,
              opacity: auditLoading ? 0.6 : 1,
            }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </button>
        }
        bodyStyle={{ padding: 0 }}
      >
        <div
          className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2.5 border-b"
          style={{ borderColor: C.base.borderLight, background: C.base.surfaceMuted }}
        >
          <select
            value={auditCategory}
            onChange={(e) => {
              setAuditCategory(e.target.value);
              setAuditPage(1);
            }}
            className="px-3 py-2 rounded-xl text-xs sm:text-sm outline-none min-h-[38px]"
            style={{ ...controlStyle, width: "auto", minHeight: 38 }}
            aria-label={t("Filter kategori audit")}
          >
            <option value="all">{t("Semua Kategori")}</option>
            <option value="auth">{t("Autentikasi (auth)")}</option>
            <option value="user">{t("Pengguna & Master (user)")}</option>
            <option value="exam">{t("Ujian (exam)")}</option>
            <option value="grading">{t("Penilaian & Rilis (grading)")}</option>
            <option value="monitoring">{t("Monitoring & Pengawas")}</option>
            <option value="token">{t("Token Ujian")}</option>
            <option value="seb">{t("Safe Exam Browser (seb)")}</option>
            <option value="question">{t("Bank & Soal (question)")}</option>
            <option value="ai">{t("AI Agent (ai)")}</option>
            <option value="settings">{t("Pengaturan & Branding")}</option>
            <option value="backup">{t("Backup & Restore")}</option>
            <option value="session">{t("Sesi Login")}</option>
          </select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.base.textFaint }} />
            <input
              type="text"
              value={auditQuery}
              onChange={(e) => {
                setAuditQuery(e.target.value);
                setAuditPage(1);
              }}
              placeholder={t("Cari aktor, aksi, atau ringkasan…")}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs sm:text-sm outline-none"
              style={{ ...controlStyle, minHeight: 38, paddingLeft: 32 }}
            />
          </div>

          <span className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
            {t("{n} entri", { n: auditTotal })}
          </span>
        </div>

        {auditError && (
          <div className="px-4 sm:px-5 py-3">
            <Notice type="error">{auditError}</Notice>
          </div>
        )}

        {auditLoading && auditRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: C.base.textMuted }}>
            {t("Memuat log audit…")}
          </div>
        ) : auditRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: C.base.textMuted }}>
            {t("Belum ada catatan log audit yang cocok.")}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: C.base.borderLight }}>
            {auditRows.map((entry) => {
              const roleBg =
                entry.actor_role === "super_admin" || entry.actor_role === "admin"
                  ? C.danger.bg
                  : entry.actor_role === "teacher"
                    ? C.brand.bg
                    : C.base.surfaceSoft;
              const roleColor =
                entry.actor_role === "super_admin" || entry.actor_role === "admin"
                  ? C.danger.text
                  : entry.actor_role === "teacher"
                    ? C.brand.dark
                    : C.base.textMuted;
              return (
                <div
                  key={entry.id}
                  className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cbt-row-hover"
                  style={{ borderColor: C.base.borderLight }}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md"
                        style={{ background: C.base.surfaceSoft, color: C.base.text, fontFamily: "var(--font-mono)" }}
                      >
                        {entry.action}
                      </span>
                      <span className="text-xs font-semibold truncate" style={{ color: C.base.text }}>
                        {entry.actor_name || "System"}
                      </span>
                      {entry.actor_role && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: roleBg, color: roleColor }}
                        >
                          {t(entry.actor_role)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs break-words" style={{ color: C.base.textBody }}>
                      {entry.summary}
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                    >
                      {new Date(entry.created_at).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    {entry.ip_address && (
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}
                      >
                        {entry.ip_address}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {auditTotal > 0 && (
          <div
            className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl"
            style={{ borderTop: `1px solid ${C.base.borderLight}`, background: C.base.surfaceMuted }}
          >
            <label className="flex items-center gap-2 text-xs" style={{ color: C.base.textMuted }}>
              {t("Show")}
              <select
                value={auditPageSize}
                onChange={(e) => {
                  setAuditPageSize(Number(e.target.value));
                  setAuditPage(1);
                }}
                aria-label={t("Show")}
                className="rounded-lg px-2 py-1 text-xs outline-none"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.text,
                  borderRadius: R.control,
                }}
              >
                {[15, 30, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span className="tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {(auditPage - 1) * auditPageSize + 1}–{Math.min(auditPage * auditPageSize, auditTotal)} {t("of")} {auditTotal}
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                disabled={auditPage <= 1}
                className="text-xs font-medium px-2.5 py-1.5 transition-colors disabled:opacity-40"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.textBody,
                  cursor: auditPage <= 1 ? "not-allowed" : "pointer",
                  borderRadius: R.control,
                }}
              >
                ‹ {t("Prev")}
              </button>
              <span
                className="text-xs tabular-nums"
                style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}
              >
                {t("Page {page} / {total}", {
                  page: auditPage,
                  total: Math.max(1, Math.ceil(auditTotal / auditPageSize)),
                })}
              </span>
              <button
                type="button"
                onClick={() => setAuditPage((p) => Math.min(Math.max(1, Math.ceil(auditTotal / auditPageSize)), p + 1))}
                disabled={auditPage >= Math.max(1, Math.ceil(auditTotal / auditPageSize))}
                className="text-xs font-medium px-2.5 py-1.5 transition-colors disabled:opacity-40"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.textBody,
                  cursor: auditPage >= Math.max(1, Math.ceil(auditTotal / auditPageSize)) ? "not-allowed" : "pointer",
                  borderRadius: R.control,
                }}
              >
                {t("Next")} ›
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {revokeConfirmTarget && (
        <Modal
          title={t("Cabut Sesi Pengguna")}
          onClose={() => !revokeBusy && setRevokeConfirmTarget(null)}
          actions={
            <>
              <Btn onClick={() => setRevokeConfirmTarget(null)} disabled={!!revokeBusy} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn
                variant="danger"
                onClick={confirmRevokeUser}
                disabled={!!revokeBusy}
                style={{ flex: 1 }}
              >
                {revokeBusy ? t("Memproses…") : t("Cabut Sesi")}
              </Btn>
            </>
          }
        >
          <p className="text-sm leading-relaxed" style={{ color: C.base.textBody }}>
            {t("Paksa logout \"{name}\" dari perangkat ini?", { name: revokeConfirmTarget.username })}
          </p>
        </Modal>
      )}
    </div>
  );
}
