import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Library,
  Menu,
  Newspaper,
  Radio,
  Users,
} from "lucide-react";
import { useAuth, type Role } from "../app/AuthContext";
import { useI18n } from "../i18n";
import { C, alpha } from "../styles/tokens";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";

interface MobileTab {
  path?: string;
  label: string;
  icon: ReactNode;
  isMenu?: boolean;
}

const MOBILE_TABS: Record<Role, MobileTab[]> = {
  admin: [
    { path: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
    { path: "/teacher/exams", label: "Exams", icon: <ClipboardList className="w-4 h-4" /> },
    { path: "/admin/users", label: "Users", icon: <Users className="w-4 h-4" /> },
    { path: "/admin/news", label: "Berita", icon: <Newspaper className="w-4 h-4" /> },
    { label: "Menu", icon: <Menu className="w-4 h-4" />, isMenu: true },
  ],
  teacher: [
    { path: "/teacher/questions", label: "Bank Soal", icon: <Library className="w-4 h-4" /> },
    { path: "/teacher/exams", label: "Ujian", icon: <ClipboardList className="w-4 h-4" /> },
    { path: "/teacher/monitoring", label: "Monitor", icon: <Radio className="w-4 h-4" /> },
    { path: "/teacher/grading", label: "Nilai", icon: <CheckCircle2 className="w-4 h-4" /> },
    { label: "Menu", icon: <Menu className="w-4 h-4" />, isMenu: true },
  ],
  student: [
    { path: "/student/dashboard", label: "Ujian", icon: <ClipboardList className="w-4 h-4" /> },
    { path: "/student/summary", label: "Nilai", icon: <Award className="w-4 h-4" /> },
    { path: "/student/modules", label: "Modul", icon: <BookOpen className="w-4 h-4" /> },
    { path: "/student/assignments", label: "Tugas", icon: <FileText className="w-4 h-4" /> },
    { path: "/storage", label: "Berkas", icon: <FolderOpen className="w-4 h-4" /> },
  ],
};

export default function AppLayout() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("smartcbt:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!user) navigate("/login", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem("smartcbt:sidebar-collapsed", String(sidebarCollapsed));
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  if (!user) return null;

  const isExamTaking = location.pathname.startsWith("/student/exam/");
  const tabs = MOBILE_TABS[user.role] ?? MOBILE_TABS.student;

  return (
    <div className="flex h-full" style={{ background: C.base.page }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full shrink-0">
        <Sidebar
          isSidebarCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        />
      </div>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 backdrop-blur-xs transition-opacity"
            style={{ background: "rgba(2, 6, 23, 0.58)" }}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 safe-area-top safe-area-bottom overflow-y-auto"
            style={{ boxShadow: "12px 0 32px rgba(0, 0, 0, 0.35)" }}
          >
            <Sidebar onCloseMobile={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!isExamTaking && <Header onMenu={() => setDrawerOpen((v) => !v)} />}

        <main
          className={`flex-1 overflow-auto ${
            isExamTaking ? "p-0" : "p-3 sm:p-4 md:p-6 pb-20 lg:pb-6"
          }`}
        >
          <Outlet />
        </main>

        {/* Compact Android & iPhone bottom tab bar (hidden on desktop and during live exam taking) */}
        {!isExamTaking && (
          <nav
            aria-label={t("Mobile navigation")}
            className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t backdrop-blur-lg safe-area-bottom"
            style={{
              background: alpha(C.base.surface, 94),
              borderColor: C.base.border,
              boxShadow: "0 -4px 18px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div className="grid grid-cols-5 h-14 max-w-lg mx-auto px-1">
              {tabs.map((tab) =>
                tab.isMenu ? (
                  <button
                    key="mobile-menu"
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:scale-95"
                    style={{ color: C.base.textMuted }}
                  >
                    {tab.icon}
                    <span className="truncate max-w-full px-1">{t(tab.label)}</span>
                  </button>
                ) : (
                  <NavLink
                    key={tab.path}
                    to={tab.path!}
                    className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:scale-95"
                    style={({ isActive }) => ({
                      color: isActive ? C.brand.main : C.base.textMuted,
                      fontWeight: isActive ? 700 : 500,
                    })}
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className="px-2.5 py-0.5 rounded-full transition-colors"
                          style={{
                            background: isActive ? C.brand.bg : "transparent",
                            color: isActive ? C.brand.main : C.base.textMuted,
                          }}
                        >
                          {tab.icon}
                        </span>
                        <span className="truncate max-w-full px-1">{t(tab.label)}</span>
                      </>
                    )}
                  </NavLink>
                ),
              )}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
