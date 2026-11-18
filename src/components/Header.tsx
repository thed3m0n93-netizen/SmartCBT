import { Menu } from "lucide-react";
import { useLocation } from "react-router";
import { useAuth } from "../app/AuthContext";
import { useI18n } from "../i18n";
import { C, S, alpha } from "../styles/tokens";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { AiProviderHeaderSwitcher } from "./AiProviderWidget";

const breadcrumbs: Record<string, string> = {
  "/admin/dashboard": "Dashboard",
  "/admin/news": "Berita",
  "/admin/users": "Users & Access",
  "/admin/master-data": "Classes & Subjects",
  "/admin/settings": "School Settings",
  "/admin/backup": "Backup & Restore",
  "/teacher/questions": "Question Bank",
  "/teacher/exams": "Exam Management",
  "/teacher/monitoring": "Live Monitor",
  "/teacher/grading": "Grading & Analysis",
  "/teacher/modules": "Learning Modules",
  "/teacher/assignments": "Tugas",
  "/teacher/students": "Data Siswa",
  "/teacher/seb": "SEB Config & Tokens",
  "/student/dashboard": "My Exams",
  "/student/summary": "Ringkasan Nilai",
  "/student/modules": "Modul Belajar",
  "/student/assignments": "My Assignments",
  "/storage": "File Storage",
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

  const page = t(
    breadcrumbs[location.pathname] ??
      (location.pathname.startsWith("/student/modules/")
        ? "Modul Belajar"
        : location.pathname.startsWith("/news/")
          ? "Berita"
          : "Page"),
  );
  const section = t(
    Object.entries(sectionLabel).find(([k]) => location.pathname.startsWith(k))?.[1] ?? "",
  );

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-6 border-b shrink-0 safe-area-top backdrop-blur-md z-20"
      style={{
        background: alpha(C.base.surface, 92),
        borderColor: C.base.border,
        boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onMenu}
          className="lg:hidden w-10 h-10 -ml-1 rounded-xl flex items-center justify-center transition-colors cbt-row-hover active:scale-95 shrink-0"
          style={{
            color: C.base.textBody,
            border: `1px solid ${C.base.borderLight}`,
            background: C.base.surfaceMuted,
          }}
          aria-label={t("Menu")}
        >
          <Menu className="w-5 h-5" strokeWidth={2} />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          {section && (
            <>
              <span className="hidden sm:inline font-medium" style={{ color: C.base.textMuted }}>
                {section}
              </span>
              <span className="hidden sm:inline" style={{ color: C.base.dashed }}>
                /
              </span>
            </>
          )}
          <span
            className="font-semibold truncate tracking-tight"
            style={{ color: C.base.text, fontFamily: "var(--font-display)" }}
          >
            {page}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {(user?.role === "admin" || user?.role === "teacher") && (
          <AiProviderHeaderSwitcher />
        )}
        <ThemeToggle />
        <LanguageSwitcher />
        {user?.institution && (
          <div
            className="hidden md:flex items-center text-xs px-3 py-1.5 rounded-xl font-semibold max-w-[180px] truncate"
            style={{
              background: C.brand.bg,
              color: C.brand.dark,
              border: `1px solid ${C.brand.borderSoft}`,
              boxShadow: S.control,
            }}
            title={user.institution}
          >
            {user.institution}
          </div>
        )}
      </div>
    </header>
  );
}
