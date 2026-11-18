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
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
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
  B: "#1D4ED8",
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

/** `total_score` is normalised to a 0–100 value server-side (matches dashboard). */
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
      <div className="py-16 text-center text-sm" style={{ color: "#64748b" }}>
        {t("Memuat ringkasan…")}
      </div>
    );
  }
  if (error) {
    return <Notice type="error">{t("Gagal: {e}", { e: error })}</Notice>;
  }

  const scores = exams.map(examScore);
  const average = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const best = scores.length ? Math.max(...scores) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "#0f172a" }}>
          {t("Ringkasan Nilai")}
        </h1>
        <Btn onClick={() => void loadData()}>{t("Muat ulang")}</Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label={t("Jumlah Ujian Selesai")} value={String(exams.length)} />
        <Stat label={t("Rata-rata Nilai")} value={String(average)} accent={GRADE_COLORS[gradeFromScore(average)]} />
        <Stat label={t("Nilai Tertinggi")} value={String(best)} accent={GRADE_COLORS[gradeFromScore(best)]} />
      </div>

      <Card>
        <SectionHeader title={t("Hasil Ujian")} />
        <div className="px-4 py-4 space-y-2">
          {exams.length === 0 ? (
            <Empty>{t("Belum ada hasil ujian")}</Empty>
          ) : (
            exams.map((r) => {
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
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                  style={{ background: "#FAFAFA", border: "1px solid #e2e8f0" }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate" style={{ color: "#0f172a" }}>{r.title}</div>
                    <div className="text-xs" style={{ color: "#64748b" }}>{r.subject_name ?? "Umum"} · {dateStr}</div>
                    {(correct || wrong) ? (
                      <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
                        {t("Benar")}: {correct} · {t("Salah")}: {wrong}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold" style={{ color, fontFamily: "var(--font-serif)" }}>{score}</div>
                    <div className="text-[10px] font-semibold" style={{ color }}>{t("Grade")}: {grade}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <SectionHeader title={t("Progress Modul")} />
        <div className="px-4 py-4 space-y-3">
          {modules.length === 0 ? (
            <Empty>{t("Belum ada modul")}</Empty>
          ) : (
            modules.map((m) => {
              const pct = Math.max(0, Math.min(100, Math.round(Number(m.max_scroll_percent) || 0)));
              const done = !!m.completed;
              const color = done ? "#059669" : "#1D4ED8";
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-medium truncate" style={{ color: "#0f172a" }}>{m.title}</div>
                    <div className="text-xs shrink-0" style={{ color: done ? "#059669" : "#64748b" }}>
                      {done ? t("Selesai") : `${pct}%`}
                    </div>
                  </div>
                  <div className="text-[11px] mb-1" style={{ color: "#94a3b8" }}>{m.subject_name ?? "Umum"}</div>
                  <div className="h-1.5 rounded-full" style={{ background: "#e2e8f0" }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <SectionHeader title={t("Status Tugas")} />
        <div className="px-4 py-4 space-y-2">
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
              const bg =
                status === "graded" ? "#ECFDF5" :
                status === "submitted" ? "#EFF6FF" :
                status === "returned" ? "#FEF3C7" : "#F1F5F9";
              const fg =
                status === "graded" ? "#059669" :
                status === "submitted" ? "#1D4ED8" :
                status === "returned" ? "#D97706" : "#64748b";
              const score = a.score != null ? Math.round(Number(a.score)) : null;
              const max = Number(a.max_score) || 100;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                  style={{ background: "#FAFAFA", border: "1px solid #e2e8f0" }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate" style={{ color: "#0f172a" }}>{a.title}</div>
                    <div className="text-xs" style={{ color: "#64748b" }}>{a.subject_name ?? "Umum"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>
                      {label}
                    </span>
                    {status === "graded" && score != null ? (
                      <div className="text-xs mt-1" style={{ color: "#0f172a" }}>{score}/{max}</div>
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
      <div className="px-4 py-4">
        <div className="text-xs" style={{ color: "#64748b" }}>{label}</div>
        <div className="text-3xl font-bold mt-1" style={{ color: accent ?? "#0f172a", fontFamily: "var(--font-serif)" }}>
          {value}
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "#e2e8f0" }}>
      <h2 className="font-bold text-base sm:text-lg" style={{ color: "#0f172a" }}>{title}</h2>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-sm py-6" style={{ color: "#64748b" }}>{children}</div>;
}
