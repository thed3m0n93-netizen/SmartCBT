/** SmartCBT — Student Summary page. */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { fetchStudentDashboard } from "../../lib/api";
import { C } from "../../styles/tokens";
import { Btn, Card, Notice } from "../../components/ui";

interface ExamResult {
  id: string;
  title: string;
  subject: string;
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  grade: string;
  correct: number;
  wrong: number;
  duration: string;
}

interface AssignmentSummary {
  id: string;
  title: string;
  subject: string;
  status: string;
}

interface ModuleProgress {
  id: string;
  title: string;
  subject: string;
  completed: boolean;
  progressPercent: number;
}

export default function StudentSummaryPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const studentId = user?.id ?? "";
  const navigate = useNavigate();
  const [examResults, setExamResults] = useState<ExamResult[]>([]);
  const [assignmentSummaries, setAssignmentSummaries] = useState<AssignmentSummary[]>([]);
  const [moduleProgress, setModuleProgress] = useState<ModuleProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getGrade = (p: number) => (p >= 90 ? "A" : p >= 80 ? "B" : p >= 70 ? "C" : p >= 60 ? "D" : "E");
  const getGradeColor = (g: string) => ({ A: "#059669", B: "#1D4ED8", C: "#D97706", D: "#DC2626", E: "#6B7280" }[g] || "#6B7280");

  const loadData = async () => {
    setLoading(true); setError(null);
    try {
      const d = await fetchStudentDashboard(studentId);
      const results: ExamResult[] = (d.completed ?? []).map((e: any) => ({
        id: e.id, title: e.title, subject: e.subject_name ?? "Umum",
        date: new Date(e.submitted_at ?? e.generated_at ?? e.start_time).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
        score: Math.round(Number(e.total_score) || 0),
        maxScore: Number(e.max_score) || 100,
        percentage: Math.round((Math.round(Number(e.total_score) || 0) / Number(e.max_score) || 100) * 100),
        grade: getGrade(Math.round((Math.round(Number(e.total_score) || 0) / Number(e.max_score) || 100) * 100)),
        correct: Number(e.correct_count) || 0,
        wrong: Number(e.wrong_count) || 0,
        duration: "",
      }));
      setExamResults(results);
      setAssignmentSummaries([]);
      setModuleProgress([
        { id: "m1", title: "Matematika Dasar", subject: "Matematika", completed: false, progressPercent: 75 },
        { id: "m2", title: "Fisika Atom", subject: "Fisika", completed: true, progressPercent: 100 },
      ]);
    } catch (err: any) { setError(err?.message || t("Gagal memuat")); } finally { setLoading(false); }
  };

  useEffect(() => { void loadData(); }, [loadData]);

  if (loading) return <div className="py-16 text-center">{t("Memuat ringkasan…")}</div>;
  if (error) return (<div className="rounded-xl p-6">{t("Gagal: {e}", { e: error })}</div>);

  return (
    <div className="space-y-4">
      <Card><div className="px-4 py-3 border-b"><h2 className="font-bold text-base sm:text-lg">{t("Hasil Ujian")}</h2></div><div className="px-4 py-4">{examResults.length === 0 ? <div className="text-center text-sm text-slate-500">{t("Belum ada hasil ujian")}</div> : examResults.map((r) => `<div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{background:"#FAFAFA",border:"1px solid #e2e8f0"}}><div className="flex items-center gap-3"><span className="w-2 h-2 rounded-full shrink-0" style={{background:${getGradeColor(r.grade)+"30"}}}/><div><div className="font-medium" style={{color:"#0f172a"}}>{r.title}</div><div className="text-xs" style={{color:"#64748b"}}>{r.subject} · {r.date}</div></div></div><div className="text-right"><div className="text-2xl font-bold" style={{color:${getGradeColor(r.grade)},fontFamily:"var(--font-serif)"}}>{r.score}/{r.maxScore}</div><div className="text-xs" style={{color:"#64748b"}}>({r.percentage}%) {t("Nilai")}</div><div className="text-[10px]">{t("Grade: {g}", {g: r.grade})}</div></div></div>`).join("")}</div></Card>
      <Card><div className="px-4 py-3 border-b"><h2 className="font-bold text-base sm:text-lg">{t("Status Tugas")}</h2></div><div className="px-4 py-4">{assignmentSummaries.length === 0 ? <div className="text-center text-sm text-slate-500">{t("Belum ada data tugas")}</div> : "Assignments placeholder"}</div></Card>
      <Card><div className="px-4 py-3 border-b"><h2 className="font-bold text-base sm:text-lg">{t("Progress Modul")}</h2></div><div className="px-4 py-4">{moduleProgress.length === 0 ? <div className="text-center text-sm text-slate-500">{t("Belum ada modul")}</div> : "Modules placeholder"}</div></Card>
    </div>
  );
}