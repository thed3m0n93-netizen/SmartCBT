import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import {
  fetchCurrentUser,
  fetchSettings,
  login as apiLogin,
  logout as apiLogout,
  getAuthToken,
  setAuthToken,
  type LoginResponse,
  type SchoolSettings,
} from "../lib/api";
import { logoutSetupSession, setSetupToken } from "../lib/setupAuth";
import { mapRole, type AcademicRole, type DBRole } from "../lib/types";

export type Role = "admin" | "teacher" | "student";

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  academicRole?: AcademicRole;
  nip?: string | null;
  email: string;
  institution: string;
  avatar?: string;
}

const SETTINGS_STORAGE_KEY = "smartcbt:settings";

const FALLBACK_SETTINGS: SchoolSettings = {
  school_name: "SMK TEKNOLOGI",
  school_address: "",
  school_phone: "",
  school_email: "",
  school_website: "",
  school_logo: "",
  school_background: "",
  school_favicon: "",
  school_city: "",
  active_academic_year: "2026/2027",
  active_semester: "ganjil",
  principal_name: "",
  principal_nip: "",
  curriculum_vice_name: "",
  curriculum_vice_nip: "",
  ai_provider: "gemini",
  ai_model: "gemini-4-hydrogen",
  ai_api_key: "",
  ai_base_url: "https://generativelanguage.googleapis.com/v1beta",
};

/** Fetch school settings (cached in localStorage, refreshed in background). */
function getCachedSettings(): SchoolSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return { ...FALLBACK_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...FALLBACK_SETTINGS };
}

/** Pull the latest settings from the server and update the cache. */
async function refreshSettingsCache(): Promise<SchoolSettings> {
  try {
    const settings = await fetchSettings();
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return settings;
  } catch {
    return getCachedSettings();
  }
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  loginWithCredentials: (username: string, password: string) => Promise<void>;
  /** Revokes the session server-side before clearing local state. */
  logout: () => Promise<void>;
  loading: boolean;
  settings: SchoolSettings;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = "smartcbt:user";
// The session token is owned by `src/lib/api.ts` (`getAuthToken`/`setAuthToken`),
// which keeps the storage key in one place. `AuthContext` used to read/write a
// differently-named key of its own, so the two sides disagreed about where the
// token lived — causing logout to leave the server-side session alive and the
// AI/SSE endpoints to send no `Authorization` header.

export function AuthProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SchoolSettings>(() => getCachedSettings());
  const [user, setUser] = useState<AuthUser | null>(() => {
    // Restore from localStorage on first render
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as AuthUser;
      // Merge with current cached institution
      parsed.institution = getCachedSettings().school_name || parsed.institution;
      return parsed;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [loading, setLoading] = useState(true);

  /** Refresh settings from the server and update cache + state. */
  const refreshSettings = async () => {
    const fresh = await refreshSettingsCache();
    setSettings(fresh);
    // Update the current user's institution if logged in
    setUser((prev) =>
      prev ? { ...prev, institution: fresh.school_name || prev.institution } : prev
    );
  };

  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener("smartcbt:auth-expired", handleExpired);

    // Refresh settings from server on mount (background, non-blocking)
    refreshSettings();

    const token = getAuthToken();
    if (!token) {
      localStorage.removeItem(STORAGE_KEY);
      setUser(null);
      setToken(null);
      setLoading(false);
    } else {
      fetchCurrentUser()
        .then((dbUser) => {
          if (!dbUser || !dbUser.id) {
            throw new Error("Invalid session");
          }
          setUser({
            id: dbUser.id,
            name: dbUser.full_name,
            role: mapRole(dbUser.role as DBRole),
            academicRole: (dbUser.academic_role as AcademicRole) || "none",
            nip: dbUser.nip ?? null,
            email: dbUser.username,
            institution: getCachedSettings().school_name || "SMK TEKNOLOGI",
          });
        })
        .catch(() => {
          localStorage.removeItem(STORAGE_KEY);
          setAuthToken(null);
          setUser(null);
          setToken(null);
        })
        .finally(() => setLoading(false));
    }

    return () => window.removeEventListener("smartcbt:auth-expired", handleExpired);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  const login = (u: AuthUser, t: string) => {
    setUser(u);
    setToken(t);
  };

  const loginWithCredentials = async (username: string, password: string) => {
    setLoading(true);
    try {
      const res: LoginResponse = await apiLogin(username, password);
      setAuthToken(res.token);
      setToken(res.token);
      const dbUser = res.user;
      const authUser: AuthUser = {
        id: dbUser.id,
        name: dbUser.full_name,
        role: mapRole(dbUser.role as DBRole),
        academicRole: (dbUser.academic_role as AcademicRole) || "none",
        nip: dbUser.nip ?? null,
        email: dbUser.username,
        institution: getCachedSettings().school_name || "SMK TEKNOLOGI",
      };
      setUser(authUser);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign out: revoke the session server-side, *then* clear local state.
   *
   * The revoke is awaited before anything is dropped locally. The previous
   * version fired `void apiLogout()` and cleared the token synchronously, so
   * the request often went out without a bearer token and the server-side
   * session survived — the user kept showing as "online" in the admin
   * dashboard until the 8-hour TTL expired.
   */
  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      /* the token is cleared locally regardless */
    }
    try {
      await logoutSetupSession({ revokeAdminSession: false });
    } catch {
      /* ignore setup token revoke error */
    }
    setSetupToken(null);
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithCredentials, logout, loading, settings, refreshSettings }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
