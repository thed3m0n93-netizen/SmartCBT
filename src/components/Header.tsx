import { useLocation } from "react-router";
import { useAuth } from "../app/AuthContext";
import { useI18n } from "../i18n";
import LanguageSwitcher from "./LanguageSwitcher";

const breadcrumbs: Record<string, string> = {
  "/admin/dashboard": "Dashboard",
  "/admin/users": "Users & Access",
  "/teacher/questions": "Question Bank",
  "/teacher/exams": "Exam Management",
  "/teacher/monitoring": "Live Monitor",
  "/teacher/grading": "Grading & Analysis",
  "/teacher/assignments": "Tugas",
  "/teacher/seb": "SEB Config & Tokens",
  "/student/dashboard": "My Exams",
  "/student/assignments": "My Assignments",
};

const sectionLabel: Record<string, string> = {
  "/admin": "Administration",
  "/teacher": "Teaching",
  "/student": "Student Portal",
};

export default function Header({ onMenu }: { onMenu?: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  const page = t(breadcrumbs[location.pathname] ?? "Page");
  const section = t(Object.entries(sectionLabel).find(([k]) =>
    location.pathname.startsWith(k)
  )?.[1] ?? "");

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-6 border-b shrink-0 safe-area-top"
      style={{ background: "#fff", borderColor: "#e2e8f0" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile only, opens the sidebar drawer. */}
        <button
          onClick={onMenu}
          className="lg:hidden w-9 h-9 -ml-1 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors shrink-0"
          aria-label={t("Menu")}
        >
          <span className="flex flex-col gap-1">
            <span className="block w-4.5 h-0.5 rounded" style={{ width: 18, background: "#374151" }} />
            <span className="block w-4.5 h-0.5 rounded" style={{ width: 18, background: "#374151" }} />
            <span className="block w-4.5 h-0.5 rounded" style={{ width: 18, background: "#374151" }} />
          </span>
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline" style={{ color: "#94a3b8" }}>{section}</span>
          {section && <span className="hidden sm:inline" style={{ color: "#cbd5e1" }}>/</span>}
          <span className="font-semibold truncate" style={{ color: "#0f172a" }}>
            {page}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <LanguageSwitcher />
        <div className="relative">
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors relative text-slate-500"
            aria-label={t("Notifications")}
          >
            🔔
            <span
              className="absolute top-1 right-1 w-2 h-2 rounded-full"
              style={{ background: "#DC2626" }}
            />
          </button>
        </div>
        <div
          className="hidden sm:block text-xs px-3 py-1.5 rounded-full font-medium max-w-[160px] truncate"
          style={{ background: "#EFF6FF", color: "#1D4ED8" }}
        >
          {user?.institution}
        </div>
      </div>
    </header>
  );
}
