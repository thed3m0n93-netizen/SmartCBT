/**
 * SmartCBT — Student results summary page (ringkasan hasil).
 *
 * A persistent, revisitable overview of a student's outcomes: completed exam
 * results, learning-module progress, and assignment submission status.
 * Previously this file existed but was (a) never registered in the router and
 * (b) rendered its exam rows as a raw template string (so the markup showed as
 * escaped text) with hardcoded fake module data. Build 147 wires it to real,
 * role-scoped endpoints and registers the `/student/summary` route.
 */
import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { C, S } from "../../styles/tokens";
import {
  fetchStudentDashboard,
  fetchLearningModules,
  fetchAssignments,
  type ExamResultsRow,
  type LearningModuleRow,
  type AssignmentRow,
} from "../../lib/api";
import { Btn, Card, Notice } from "../../components/ui";

const GRADE_COLORS: Record<string, string> = {
  A: "#059669",
  B: "#2563EB",
  C: "#D97706",
  D: "#DC2626",
  E: "#6B7280",
};

function gradeFromScore(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "E";
}

function examScore(row: ExamResultsRow): number {
  return Math.round(Number(row.total_score) || 0);
}

export default function StudentSummaryPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const studentId = user?.id ?? "";

  const [exams, setExams] = useState<ExamResultsRow[]>([]);
  const [modules, setModules] = useState<LearningModuleRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, mods, asg] = await Promise.all([
        fetchStudentDashboard(studentId),
        fetchLearningModules(),
        fetchAssignments(),
      ]);
      setExams(dash.completed ?? []);
      setModules(mods ?? []);
      setAssignments(asg ?? []);
    } catch (err: any) {
      setError(err?.message || t("Gagal memuat"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
          ))}
        </div>
        <div className="h-48 rounded-2xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
      </div>
    );
  }
  if (error) {
    return <Notice type="error">{t("Gagal: {e}", { e: error })}</Notice>;
  }

  const publishedExams = exams.filter((r) => r.results_published !== false);
  const scores = publishedExams.map(examScore);
  const average = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const best = scores.length ? Math.max(...scores) : 0;
  const hasPublished = scores.length > 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
          {t("Ringkasan Nilai")}
        </h1>
        <Btn onClick={() => void loadData()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={14} />
          {t("Muat ulang")}
        </Btn>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label={t("Jumlah Ujian Selesai")} value={String(exams.length)} />
        <Stat
          label={t("Rata-rata Nilai")}
          value={hasPublished ? String(average) : "—"}
          accent={hasPublished ? GRADE_COLORS[gradeFromScore(average)] : undefined}
        />
        <div className="col-span-2 sm:col-span-1">
          <Stat
            label={t("Nilai Tertinggi")}
            value={hasPublished ? String(best) : "—"}
            accent={hasPublished ? GRADE_COLORS[gradeFromScore(best)] : undefined}
          />
        </div>
      </div>

      <Card pad={false}>
        <SectionHeader title={t("Hasil Ujian")} />
        <div className="p-4 space-y-2.5">
          {exams.length === 0 ? (
            <Empty>{t("Belum ada hasil ujian")}</Empty>
          ) : (
            exams.map((r) => {
              const published = r.results_published !== false;
              const score = examScore(r);
              const grade = gradeFromScore(score);
              const color = GRADE_COLORS[grade];
              const correct = Number(r.correct_count) || 0;
              const wrong = Number(r.wrong_count) || 0;
              const dateStr = new Date(
                r.submitted_at ?? r.generated_at ?? r.start_time
              ).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl"
                  style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, boxShadow: S.inset }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: C.base.text }}>{r.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>{r.subject_name ?? "Umum"} · {dateStr}</div>
                    {published && (correct || wrong) ? (
                      <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: C.base.textFaint }}>
                        {t("Benar")}: {correct} · {t("Salah")}: {wrong}
                      </div>
                    ) : !published ? (
                      <div className="text-[11px] mt-0.5" style={{ color: C.base.textFaint }}>
                        {t("Nilai sedang ditahan oleh guru atau admin")}
                      </div>
                    ) : null}
                  </div>
                  {published ? (
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-bold tabular-nums" style={{ color, fontFamily: "var(--font-serif)" }}>{score}</div>
                      <div className="text-[11px] font-semibold" style={{ color }}>{t("Grade")} {grade}</div>
                    </div>
                  ) : (
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={{ background: C.warn.bg, color: C.warn.dark }}
                    >
                      {t("Menunggu Rilis Nilai")}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card pad={false}>
        <SectionHeader title={t("Progress Modul")} />
        <div className="p-4 space-y-3">
          {modules.length === 0 ? (
            <Empty>{t("Belum ada modul")}</Empty>
          ) : (
            modules.map((m) => {
              const pct = Math.max(0, Math.min(100, Math.round(Number(m.max_scroll_percent) || 0)));
              const done = !!m.completed;
              const color = done ? C.ok.main : C.brand.main;
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-medium truncate" style={{ color: C.base.text }}>{m.title}</div>
                    <div className="text-xs font-semibold shrink-0 tabular-nums" style={{ color: done ? C.ok.dark : C.base.textMuted }}>
                      {done ? t("Selesai") : `${pct}%`}
                    </div>
                  </div>
                  <div className="text-[11px] mb-1.5" style={{ color: C.base.textFaint }}>{m.subject_name ?? "Umum"}</div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: C.base.surfaceSoft }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card pad={false}>
        <SectionHeader title={t("Status Tugas")} />
        <div className="p-4 space-y-2.5">
          {assignments.length === 0 ? (
            <Empty>{t("Belum ada data tugas")}</Empty>
          ) : (
            assignments.map((a) => {
              const status = a.submission_status ?? null;
              const label =
                status === "graded" ? t("Sudah Dinilai") :
                status === "submitted" ? t("Terkumpul") :
                status === "returned" ? t("Perlu Revisi") :
                t("Belum Dikumpulkan");
              const fg =
                status === "graded" ? C.ok.dark :
                status === "submitted" ? C.brand.dark :
                status === "returned" ? C.warn.dark : C.base.textMuted;
              const score = a.score != null ? Math.round(Number(a.score)) : null;
              const max = Number(a.max_score) || 100;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl"
                  style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, boxShadow: S.inset }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: C.base.text }}>{a.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>{a.subject_name ?? "Umum"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold" style={{ color: fg }}>
                      {label}
                    </div>
                    {status === "graded" && score != null ? (
                      <div className="text-xs mt-0.5 tabular-nums font-medium" style={{ color: C.base.text }}>{score}/{max}</div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <div className="text-xs" style={{ color: C.base.textMuted }}>{label}</div>
      <div className="text-3xl font-bold mt-1 tabular-nums" style={{ color: accent ?? C.base.text, fontFamily: "var(--font-serif)" }}>
        {value}
      </div>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-3.5 border-b" style={{ borderColor: C.base.borderLight }}>
      <h2 className="font-bold text-base sm:text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>{title}</h2>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-sm py-6" style={{ color: C.base.textMuted }}>{children}</div>;
}

