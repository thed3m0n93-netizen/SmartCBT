import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useAuth, type Role } from "../app/AuthContext";
import { useI18n } from "../i18n";
import { eraporPath, eraporSectionsForRole } from "../lib/eraporCatalog";

interface NavItem {
  path: string;
  label: string;
  icon: string;
  /**
   * Optional second level: a labelled cluster of related pages.
   * Used by the E-Rapor drawer, where the categories are the actual
   * destinations and are themselves the roadmap items (§12).
   */
  children?: NavItem[];
}

/**
 * A collapsible drawer in the sidebar.
 *
 * Menus are grouped by feature area (Exams / Learning / People / Settings) so
 * related pages stay together and long role menus stop becoming a flat wall of
 * links.
 */
interface NavGroup {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

/**
 * Sidebar groups per role.
 *
 * Order matters: the most frequent destinations come first. Groups are derived
 * from the same paths as `src/app/routes.tsx`, so every entry resolves.
 *
 * A role is absent here when its menu is short enough to show flat — see
 * `flatNavByRole`. `eraporItems()` is shared by both so the E-Rapor entries
 * are defined exactly once.
 */
const navByRole: Partial<Record<Role, NavGroup[]>> = {
  admin: [
    {
      id: "overview",
      label: "Overview",
      icon: "⊞",
      items: [
        { path: "/admin/dashboard", label: "Dashboard", icon: "⊞" },
        // Berita hidup di laci Ringkasan, bukan Pengaturan: berita adalah
        // konten yang dibaca siswa setiap hari, jadi perawatannya cukup di
        // sebelah dashboard, bukan tersembunyi di area setelan.
        { path: "/admin/news", label: "Berita", icon: "📰" },
      ],
    },
    {
      id: "exams",
      label: "Exams",
      icon: "📋",
      items: [
        { path: "/teacher/exams", label: "All Exams", icon: "📋" },
        { path: "/teacher/monitoring", label: "Live Monitor", icon: "📡" },
        { path: "/teacher/grading", label: "Grading", icon: "✔" },
        { path: "/teacher/seb", label: "SEB Config & Tokens", icon: "🔒" },
      ],
    },
    {
      id: "learning",
      label: "Learning",
      icon: "📖",
      items: [
        { path: "/teacher/modules", label: "Learning Modules", icon: "📖" },
        { path: "/teacher/assignments", label: "Tugas", icon: "📚" },
      ],
    },
    {
      id: "people",
      label: "People & Access",
      icon: "👥",
      items: [
        { path: "/admin/users", label: "Users & Access", icon: "👥" },
        { path: "/admin/master-data", label: "Classes & Subjects", icon: "🏫" },
        { path: "/teacher/students", label: "Data Siswa", icon: "🎓" },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: "⚙",
      items: [
        { path: "/admin/settings", label: "School Settings", icon: "⚙" },
        { path: "/admin/backup", label: "Backup & Restore", icon: "💾" },
        { path: "/storage", label: "File Storage", icon: "📁" },
      ],
    },
  ],
  teacher: [
    {
      id: "overview",
      label: "Overview",
      icon: "⊞",
      // Guru punya laci Ringkasan sendiri: dashboard admin hanya untuk admin,
      // sehingga Berita menjadi satu-satunya isinya dan tidak menggantung.
      items: [{ path: "/admin/news", label: "Berita", icon: "📰" }],
    },
    {
      id: "exams",
      label: "Exams",
      icon: "📋",
      items: [
        { path: "/teacher/questions", label: "Question Bank", icon: "📚" },
        { path: "/teacher/exams", label: "Exam Management", icon: "📋" },
        { path: "/teacher/monitoring", label: "Live Monitor", icon: "📡" },
        { path: "/teacher/grading", label: "Grading & Analysis", icon: "✔" },
        { path: "/teacher/seb", label: "SEB Config & Tokens", icon: "🔒" },
      ],
    },
    {
      id: "learning",
      label: "Learning",
      icon: "📖",
      items: [
        { path: "/teacher/modules", label: "Learning Modules", icon: "📖" },
        { path: "/teacher/assignments", label: "Tugas", icon: "📚" },
      ],
    },
    {
      id: "people",
      label: "People",
      icon: "🎓",
      items: [{ path: "/teacher/students", label: "Data Siswa", icon: "🎓" }],
    },
    {
      id: "settings",
      label: "Settings",
      icon: "⚙",
      items: [{ path: "/storage", label: "File Storage", icon: "📁" }],
    },
  ],
};

/**
 * Item E-Rapor untuk sebuah peran, dibangun dari `eraporCatalog` sehingga
 * daftar kategorinya hanya didefinisikan sekali di satu tempat.
 *
 * Setiap peran hanya melihat kategorinya sendiri (`roles` di katalog):
 * guru tidak melihat Integrasi Dapodik (khusus operator), dan siswa hanya
 * melihat Portal Rapor.
 */
function eraporItems(role: Role): NavItem[] {
  return eraporSectionsForRole(role).map((section) => ({
    path: eraporPath(section.id),
    label: section.label,
    icon: section.icon,
  }));
}

/** Laci E-Rapor, dipakai oleh peran yang menu-nya dikelompokkan. */
function eraporGroup(role: Role): NavGroup {
  return {
    id: "erapor",
    label: "E-Rapor",
    icon: "📑",
    items: eraporItems(role),
  };
}

/**
 * Menu yang ditampilkan datar, tanpa kategori yang bisa dilipat.
 *
 * Menu siswa pendek (total 5 tujuan), sehingga dibungkus tiga laci kategori
 * membuat dua di antaranya, yaitu E-Rapor dan Settings, menyembunyikan tepat
 * satu tautan. Siswa umumnya pengguna paling jarang membuka aplikasi, dan
 * mereka paling diuntungkan bila setiap tujuan langsung terlihat tanpa perlu
 * klik lagi.
 *
 * Peran dengan menu lebih panjang (admin 13 entri, guru 11) tetap memakai
 * `navByRole` beserta lacinya.
 */
const flatNavByRole: Partial<Record<Role, NavItem[]>> = {
  student: [
    { path: "/student/dashboard", label: "My Exams", icon: "📝" },
    { path: "/student/summary", label: "Ringkasan Nilai", icon: "📊" },
    { path: "/student/modules", label: "Modul Belajar", icon: "📖" },
    { path: "/student/assignments", label: "Tugas Saya", icon: "📝" },
    { path: "/storage", label: "File Storage", icon: "📁" },
  ],
};

/** localStorage key holding which drawers are collapsed, per role. */
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
    /* private mode / disabled storage — collapse state just will not persist */
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
  admin: "#f59e0b",
  teacher: "#10b981",
  student: "#60a5fa",
};

export default function Sidebar({
  isSidebarCollapsed = false,
  onToggleCollapse,
}: {
  isSidebarCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  if (!user) return null;

  const groups = navByRole[user.role] ?? [];
  /**
   * Menu datar untuk peran yang menunya pendek (lihat `flatNavByRole`).
   * Kalau peran ini punya menu datar, laci kategori tidak dipakai sama sekali.
   */
  const flatItems = flatNavByRole[user.role];
  const compactItems = flatItems ?? groups.flatMap((group) =>
    group.items.flatMap((item) => item.children?.length ? item.children : [item]),
  );

  /**
   * Which drawers are open. Defaults to every group open, minus the ids the
   * user previously collapsed for this role.
   */
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const saved = readOpenState()[user.role];
    return collapsedGroupsFor(groups, saved, location.pathname);
  });

  // Re-read when the signed-in role changes so one user's choice never leaks
  // into another's menu.
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

  /**
   * A drawer holding the current page is always shown expanded, even if the
   * user collapsed it — otherwise the active link could be hidden with no
   * obvious way back.
   */
  const activeGroups = useMemo(
    () =>
      groups.filter((g) =>
        g.items.some((item) => location.pathname.startsWith(item.path)),
      ),
    [groups, location.pathname],
  );
  const activeGroupIds = useMemo(
    () => new Set(activeGroups.map((g) => g.id)),
    [activeGroups],
  );

  const handleLogout = async () => {
    // Navigate away only after the server has revoked the session, so the user
    // does not linger in the admin "Active Sessions" list.
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className={`flex flex-col ${isSidebarCollapsed ? "w-16" : "w-64"} shrink-0 h-full overflow-hidden transition-[width] duration-200`}
      style={{ background: "#0D1B2A" }}
    >
      {/* Logo */}
      <div className={`${isSidebarCollapsed ? "px-3" : "px-6"} py-5 border-b`} style={{ borderColor: "#1a2e45" }}>
        <div className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-3" : "justify-between gap-2.5"}`}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "#1D4ED8", color: "#fff" }}
          >
            SE
          </div>
          {!isSidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-semibold tracking-wide"
                style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}
              >
                SmartCBT
              </div>
              <div className="text-xs" style={{ color: "#64748b" }}>
                {t("Digital Exam Platform")}
              </div>
            </div>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              style={{ color: "#94a3b8" }}
            >
              <span aria-hidden>{isSidebarCollapsed ? "▶" : "◀"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Role badge */}
      {!isSidebarCollapsed && <div className="px-4 py-3 border-b" style={{ borderColor: "#1a2e45" }}>
        <span
          className="text-xs font-medium px-2.5 py-1 rounded-full"
          style={{ background: roleBadgeColor[user.role] + "22", color: roleBadgeColor[user.role] }}
        >
          {t(roleLabel[user.role])}
        </span>
      </div>}

      {/* Nav */}
      <nav className={`flex-1 ${isSidebarCollapsed ? "px-2" : "px-3"} py-4 overflow-y-auto`}>
        {!isSidebarCollapsed && (
          <div className="text-xs font-semibold uppercase tracking-widest mb-3 px-3" style={{ color: "#475569" }}>
            {t("Navigation")}
          </div>
        )}
        {isSidebarCollapsed ? (
          <ul className="space-y-1.5">
            {compactItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  title={t(item.label)}
                  aria-label={t(item.label)}
                  className={({ isActive }) =>
                    `flex items-center justify-center w-12 h-10 rounded-lg text-sm transition-all ${
                      isActive ? "text-white font-medium" : "hover:bg-white/5"
                    }`}
                  style={({ isActive }) => ({
                    background: isActive ? "#1D4ED8" : undefined,
                    color: isActive ? "#fff" : "#94a3b8",
                  })}
                >
                  <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        ) : flatItems ? (
          /* Menu datar: setiap tujuan langsung terlihat, tanpa laci kategori. */
          <ul className="space-y-0.5">
            {flatItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                      isActive ? "text-white font-medium" : "hover:bg-white/5"
                    }`}
                  style={({ isActive }) => ({
                    background: isActive ? "#1D4ED8" : undefined,
                    color: isActive ? "#fff" : "#94a3b8",
                  })}
                >
                  <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
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
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-white/5"
                    style={{ color: holdsActive ? "#e2e8f0" : "#7c8ea3" }}
                  >
                    <span className="text-sm w-5 text-center shrink-0">{group.icon}</span>
                    <span className="flex-1 text-left truncate">{t(group.label)}</span>
                    <span
                      aria-hidden
                      className="text-[10px] transition-transform duration-200 shrink-0"
                      style={{
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        color: holdsActive ? "#94a3b8" : "#475569",
                      }}
                    >
                      ▶
                    </span>
                  </button>

                  {isOpen && (
                    <ul id={groupPanelId} className="mt-1 space-y-0.5">
                      {group.items.map((item) => (
                        <li key={item.path}>
                          <NavLink
                            to={item.path}
                            className={({ isActive }) =>
                              `flex items-center gap-3 py-2 pl-4 pr-3 rounded-lg text-sm transition-all ${
                                isActive
                                  ? "text-white font-medium"
                                  : "hover:bg-white/5"
                              }`
                            }
                            style={({ isActive }) => ({
                              background: isActive ? "#1D4ED8" : undefined,
                              color: isActive ? "#fff" : "#94a3b8",
                            })}
                          >
                            <span className="text-base w-5 text-center">{item.icon}</span>
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

      {/* User footer */}
      <div className={`${isSidebarCollapsed ? "px-2" : "px-4"} py-4 border-t`} style={{ borderColor: "#1a2e45" }}>
        <div className={`flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"} mb-3`}>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: "#1D4ED8", color: "#fff" }}
            title={user.name}
          >
            {user.name.charAt(0)}
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: "#e2e8f0" }}>
                {user.name}
              </div>
              <div className="text-xs truncate" style={{ color: "#64748b" }}>
                {user.email}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t("← Sign out")}
          title={isSidebarCollapsed ? t("← Sign out") : undefined}
          className={`w-full text-sm py-2 rounded-lg transition-all hover:bg-white/5 ${isSidebarCollapsed ? "text-center px-1" : "text-left px-3"}`}
          style={{ color: "#64748b" }}
        >
          {isSidebarCollapsed ? "↪" : t("← Sign out")}
        </button>
      </div>
    </aside>
  );
}
