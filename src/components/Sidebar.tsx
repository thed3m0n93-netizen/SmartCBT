import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Award,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DatabaseBackup,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  Library,
  Lock,
  LogOut,
  Newspaper,
  Radio,
  School,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useAuth, type Role } from "../app/AuthContext";
import { useI18n } from "../i18n";

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  children?: NavItem[];
}

interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
}

const ICON_CLS = "w-4 h-4 shrink-0";

const navByRole: Partial<Record<Role, NavGroup[]>> = {
  admin: [
    {
      id: "overview",
      label: "Overview",
      icon: <LayoutDashboard className={ICON_CLS} />,
      items: [
        { path: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className={ICON_CLS} /> },
        { path: "/admin/news", label: "Berita", icon: <Newspaper className={ICON_CLS} /> },
      ],
    },
    {
      id: "exams",
      label: "Exams",
      icon: <ClipboardList className={ICON_CLS} />,
      items: [
        { path: "/teacher/exams", label: "All Exams", icon: <ClipboardList className={ICON_CLS} /> },
        { path: "/teacher/monitoring", label: "Live Monitor", icon: <Radio className={ICON_CLS} /> },
        { path: "/teacher/grading", label: "Grading", icon: <CheckCircle2 className={ICON_CLS} /> },
        { path: "/teacher/seb", label: "SEB Config & Tokens", icon: <Lock className={ICON_CLS} /> },
      ],
    },
    {
      id: "learning",
      label: "Learning",
      icon: <BookOpen className={ICON_CLS} />,
      items: [
        { path: "/teacher/modules", label: "Learning Modules", icon: <BookOpen className={ICON_CLS} /> },
        { path: "/teacher/assignments", label: "Tugas", icon: <FileText className={ICON_CLS} /> },
      ],
    },
    {
      id: "adm_guru",
      label: "Administrasi Guru",
      icon: <CalendarRange className={ICON_CLS} />,
      items: [
        { path: "/teacher/adm/overview", label: "Ringkasan & Kaldik", icon: <CalendarRange className={ICON_CLS} /> },
        { path: "/teacher/adm/planning", label: "Perencanaan (ATP & Modul)", icon: <BookOpen className={ICON_CLS} /> },
        { path: "/teacher/adm/execution", label: "Pelaksanaan (Jurnal & Presensi)", icon: <ClipboardList className={ICON_CLS} /> },
        { path: "/teacher/adm/assessment", label: "Penilaian (Kisi-Kisi & Nilai)", icon: <Award className={ICON_CLS} /> },
      ],
    },
    {
      id: "people",
      label: "People & Access",
      icon: <Users className={ICON_CLS} />,
      items: [
        { path: "/admin/users", label: "Users & Access", icon: <Users className={ICON_CLS} /> },
        { path: "/admin/master-data", label: "Classes & Subjects", icon: <School className={ICON_CLS} /> },
        { path: "/teacher/students", label: "Data Siswa", icon: <GraduationCap className={ICON_CLS} /> },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Settings className={ICON_CLS} />,
      items: [
        { path: "/admin/settings", label: "School Settings", icon: <Settings className={ICON_CLS} /> },
        { path: "/admin/backup", label: "Backup & Restore", icon: <DatabaseBackup className={ICON_CLS} /> },
        { path: "/storage", label: "File Storage", icon: <FolderOpen className={ICON_CLS} /> },
      ],
    },
  ],
  teacher: [
    {
      id: "overview",
      label: "Overview",
      icon: <Newspaper className={ICON_CLS} />,
      items: [{ path: "/admin/news", label: "Berita", icon: <Newspaper className={ICON_CLS} /> }],
    },
    {
      id: "exams",
      label: "Exams",
      icon: <ClipboardList className={ICON_CLS} />,
      items: [
        { path: "/teacher/questions", label: "Question Bank", icon: <Library className={ICON_CLS} /> },
        { path: "/teacher/exams", label: "Exam Management", icon: <ClipboardList className={ICON_CLS} /> },
        { path: "/teacher/monitoring", label: "Live Monitor", icon: <Radio className={ICON_CLS} /> },
        { path: "/teacher/grading", label: "Grading & Analysis", icon: <CheckCircle2 className={ICON_CLS} /> },
        { path: "/teacher/seb", label: "SEB Config & Tokens", icon: <Lock className={ICON_CLS} /> },
      ],
    },
    {
      id: "learning",
      label: "Learning",
      icon: <BookOpen className={ICON_CLS} />,
      items: [
        { path: "/teacher/modules", label: "Learning Modules", icon: <BookOpen className={ICON_CLS} /> },
        { path: "/teacher/assignments", label: "Tugas", icon: <FileText className={ICON_CLS} /> },
      ],
    },
    {
      id: "adm_guru",
      label: "Administrasi Guru",
      icon: <CalendarRange className={ICON_CLS} />,
      items: [
        { path: "/teacher/adm/overview", label: "Ringkasan & Kaldik", icon: <CalendarRange className={ICON_CLS} /> },
        { path: "/teacher/adm/planning", label: "Perencanaan (ATP & Modul)", icon: <BookOpen className={ICON_CLS} /> },
        { path: "/teacher/adm/execution", label: "Pelaksanaan (Jurnal & Presensi)", icon: <ClipboardList className={ICON_CLS} /> },
        { path: "/teacher/adm/assessment", label: "Penilaian (Kisi-Kisi & Nilai)", icon: <Award className={ICON_CLS} /> },
      ],
    },
    {
      id: "people",
      label: "People",
      icon: <GraduationCap className={ICON_CLS} />,
      items: [{ path: "/teacher/students", label: "Data Siswa", icon: <GraduationCap className={ICON_CLS} /> }],
    },
    {
      id: "settings",
      label: "Settings",
      icon: <FolderOpen className={ICON_CLS} />,
      items: [{ path: "/storage", label: "File Storage", icon: <FolderOpen className={ICON_CLS} /> }],
    },
  ],
};

const flatNavByRole: Partial<Record<Role, NavItem[]>> = {
  student: [
    { path: "/student/dashboard", label: "My Exams", icon: <ClipboardList className={ICON_CLS} /> },
    { path: "/student/summary", label: "Ringkasan Nilai", icon: <Award className={ICON_CLS} /> },
    { path: "/student/modules", label: "Modul Belajar", icon: <BookOpen className={ICON_CLS} /> },
    { path: "/student/assignments", label: "Tugas Saya", icon: <FileText className={ICON_CLS} /> },
    { path: "/storage", label: "File Storage", icon: <FolderOpen className={ICON_CLS} /> },
  ],
};

const OPEN_STATE_KEY = "smartcbt:sidebar-groups";
type OpenState = Partial<Record<Role, string[]>>;

function readOpenState(): OpenState {
  try {
    const raw = localStorage.getItem(OPEN_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeOpenState(state: OpenState) {
  try {
    localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function collapsedGroupsFor(
  groups: NavGroup[],
  saved: string[] | undefined,
  pathname: string,
): string[] {
  const groupIds = groups.map((group) => group.id);
  const openGroups = groups.filter((group) => !saved?.includes(group.id));
  const activeOpenGroup = openGroups.find((group) =>
    group.items.some((item) => pathname.startsWith(item.path)),
  );
  const openGroup = activeOpenGroup ?? openGroups[0] ?? (saved ? undefined : groups[0]);

  return groupIds.filter((id) => id !== openGroup?.id);
}

const roleLabel: Record<Role, string> = {
  admin: "Super Admin",
  teacher: "Teacher / Examiner",
  student: "Student",
};

const roleBadgeColor: Record<Role, string> = {
  admin: "#F59E0B",
  teacher: "#10B981",
  student: "#60A5FA",
};

export default function Sidebar({
  isSidebarCollapsed = false,
  onToggleCollapse,
  onCloseMobile,
}: {
  isSidebarCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onCloseMobile?: () => void;
}) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  if (!user) return null;

  const groups = navByRole[user.role] ?? [];
  const flatItems = flatNavByRole[user.role];
  const compactItems =
    flatItems ??
    groups.flatMap((group) =>
      group.items.flatMap((item) => (item.children?.length ? item.children : [item])),
    );

  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const saved = readOpenState()[user.role];
    return collapsedGroupsFor(groups, saved, location.pathname);
  });

  useEffect(() => {
    const saved = readOpenState()[user.role];
    setCollapsed(collapsedGroupsFor(groups, saved, location.pathname));
  }, [user.role]);

  const toggle = (groupId: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(groupId)
        ? groups.filter((group) => group.id !== groupId).map((group) => group.id)
        : groups.map((group) => group.id);
      writeOpenState({ ...readOpenState(), [user.role]: next });
      return next;
    });
  };

  const activeGroups = useMemo(
    () =>
      groups.filter((g) => g.items.some((item) => location.pathname.startsWith(item.path))),
    [groups, location.pathname],
  );
  const activeGroupIds = useMemo(
    () => new Set(activeGroups.map((g) => g.id)),
    [activeGroups],
  );

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const activeNavStyle = {
    background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
    color: "#FFFFFF",
    boxShadow: "0 4px 12px -2px rgba(37, 99, 235, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
  };

  return (
    <aside
      className={`flex flex-col ${isSidebarCollapsed ? "w-[72px]" : "w-64"} shrink-0 h-full overflow-hidden transition-[width] duration-200 border-r`}
      style={{
        background: "linear-gradient(180deg, #0D1B2A 0%, #09131F 100%)",
        borderColor: "#1B2A3E",
      }}
    >
      {/* Brand Header */}
      <div
        className={`${isSidebarCollapsed ? "px-3" : "px-5"} py-4 border-b`}
        style={{ borderColor: "rgba(148, 163, 184, 0.14)" }}
      >
        <div
          className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-3" : "justify-between gap-2.5"}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)",
                color: "#FFFFFF",
                boxShadow: "0 4px 10px rgba(37, 99, 235, 0.4), inset 0 1px 0 rgba(255,255,255,0.28)",
              }}
            >
              SE
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <div
                  className="text-sm font-semibold tracking-wide truncate"
                  style={{ color: "#F8FAFC", fontFamily: "var(--font-serif)" }}
                >
                  SmartCBT
                </div>
                <div className="text-[11px] truncate" style={{ color: "#7C8FA6" }}>
                  {t("Digital Exam Platform")}
                </div>
              </div>
            )}
          </div>

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              style={{ color: "#94A3B8" }}
            >
              {isSidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          )}

          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label={t("Close")}
              className="lg:hidden w-10 h-10 -mr-1.5 shrink-0 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors"
              style={{ color: "#CBD5E1" }}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Role tag */}
      {!isSidebarCollapsed && (
        <div
          className="px-4 py-2.5 border-b"
          style={{ borderColor: "rgba(148, 163, 184, 0.14)" }}
        >
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg inline-flex items-center tracking-wide"
            style={{
              background: roleBadgeColor[user.role] + "1F",
              color: roleBadgeColor[user.role],
              border: `1px solid ${roleBadgeColor[user.role]}38`,
            }}
          >
            {t(roleLabel[user.role])}
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav className={`flex-1 ${isSidebarCollapsed ? "px-2.5" : "px-3"} py-4 overflow-y-auto`}>
        {!isSidebarCollapsed && (
          <div
            className="text-[11px] font-semibold uppercase tracking-widest mb-2.5 px-3"
            style={{ color: "#64748B", fontFamily: "var(--font-display)" }}
          >
            {t("Navigation")}
          </div>
        )}

        {isSidebarCollapsed ? (
          <ul className="space-y-1.5 flex flex-col items-center">
            {compactItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  title={t(item.label)}
                  aria-label={t(item.label)}
                  className={({ isActive }) =>
                    `flex items-center justify-center w-11 h-11 rounded-xl text-sm transition-all ${
                      isActive ? "font-semibold" : "hover:bg-white/5"
                    }`
                  }
                  style={({ isActive }) =>
                    isActive ? activeNavStyle : { color: "#94A3B8" }
                  }
                >
                  {item.icon}
                </NavLink>
              </li>
            ))}
          </ul>
        ) : flatItems ? (
          <ul className="space-y-1">
            {flatItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all min-h-[42px] ${
                      isActive ? "font-semibold" : "hover:bg-white/5"
                    }`
                  }
                  style={({ isActive }) =>
                    isActive ? activeNavStyle : { color: "#94A3B8" }
                  }
                >
                  {item.icon}
                  <span className="truncate">{t(item.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((group) => {
              const holdsActive = activeGroupIds.has(group.id);
              const isOpen = !collapsed.includes(group.id);
              const groupPanelId = `sidebar-group-${user.role}-${group.id}`;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggle(group.id)}
                    aria-expanded={isOpen}
                    aria-controls={groupPanelId}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-white/5 min-h-[38px]"
                    style={{
                      color: holdsActive ? "#E2E8F0" : "#8FA2B8",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {group.icon}
                    <span className="flex-1 text-left truncate">{t(group.label)}</span>
                    <ChevronRight
                      aria-hidden
                      className="w-3.5 h-3.5 transition-transform duration-200 shrink-0"
                      style={{
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        color: holdsActive ? "#94A3B8" : "#475569",
                      }}
                    />
                  </button>

                  {isOpen && (
                    <ul id={groupPanelId} className="mt-1 space-y-0.5 pl-1">
                      {group.items.map((item) => (
                        <li key={item.path}>
                          <NavLink
                            to={item.path}
                            className={({ isActive }) =>
                              `flex items-center gap-3 py-2.5 pl-3.5 pr-3 rounded-xl text-sm transition-all min-h-[40px] ${
                                isActive ? "font-semibold" : "hover:bg-white/5"
                              }`
                            }
                            style={({ isActive }) =>
                              isActive ? activeNavStyle : { color: "#94A3B8" }
                            }
                          >
                            {item.icon}
                            <span className="truncate">{t(item.label)}</span>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* User Footer */}
      <div
        className={`${isSidebarCollapsed ? "px-2.5" : "px-4"} py-4 border-t`}
        style={{ borderColor: "rgba(148, 163, 184, 0.14)" }}
      >
        <div
          className={`flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"} mb-3`}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)",
              color: "#FFFFFF",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: "#E2E8F0" }}>
                {user.name}
              </div>
              <div className="text-xs truncate" style={{ color: "#7C8FA6" }}>
                {user.email}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t("Sign out")}
          title={isSidebarCollapsed ? t("Sign out") : undefined}
          className={`w-full text-sm py-2 rounded-xl transition-all hover:bg-white/10 inline-flex items-center min-h-[40px] ${
            isSidebarCollapsed ? "justify-center px-1" : "gap-2.5 px-3"
          }`}
          style={{ color: "#94A3B8" }}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isSidebarCollapsed && <span>{t("Sign out")}</span>}
        </button>
      </div>
    </aside>
  );
}
