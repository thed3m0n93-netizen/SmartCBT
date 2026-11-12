import { useState, useEffect } from "react";
import { useI18n } from "../i18n";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../app/AuthContext";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { fetchSettings, type SchoolSettings } from "../lib/api";

const DEFAULT_SUPER_ADMIN = {
  username: "username",
  password: "Admin@123",
};

const SUPER_ADMIN_STORAGE_KEY = "examsecure:super-admin-credentials";

function getStoredSuperAdminCredentials() {
  try {
    const raw = localStorage.getItem(SUPER_ADMIN_STORAGE_KEY);
    if (!raw) return DEFAULT_SUPER_ADMIN;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_SUPER_ADMIN>;
    return {
      username: parsed.username || DEFAULT_SUPER_ADMIN.username,
      password: parsed.password || DEFAULT_SUPER_ADMIN.password,
    };
  } catch {
    return DEFAULT_SUPER_ADMIN;
  }
}

/** Demo credentials matching the PostgreSQL seed data. Verified server-side via crypt(). */
export default function LoginPage() {
  const { loginWithCredentials, loading: authLoading, user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [superAdmin, setSuperAdmin] = useState(() => getStoredSuperAdminCredentials());
  const [username, setUsername] = useState(() => getStoredSuperAdminCredentials().username);
  const [password, setPassword] = useState(() => getStoredSuperAdminCredentials().password);
  const [schoolName, setSchoolName] = useState("SMK TEKNOLOGI");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [schoolLogo, setSchoolLogo] = useState("");
  const [schoolBackground, setSchoolBackground] = useState("");

  // Fetch school settings on mount (public endpoint — no auth required)
  useEffect(() => {
    fetchSettings()
      .then((s: SchoolSettings) => {
        if (s.school_name) setSchoolName(s.school_name);
        if (s.school_address) setSchoolAddress(s.school_address);
        if (s.school_logo) setSchoolLogo(s.school_logo);
        if (s.school_background) setSchoolBackground(s.school_background);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  useEffect(() => {
    localStorage.setItem(SUPER_ADMIN_STORAGE_KEY, JSON.stringify(superAdmin));
  }, [superAdmin]);

  useEffect(() => {
    if (!user) return;
    navigate(
      user.role === "admin"
        ? "/admin/dashboard"
        : user.role === "teacher"
        ? "/teacher/questions"
        : "/student/dashboard",
      { replace: true }
    );
  }, [user, navigate]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    if (!cleanUsername || !cleanPassword) {
      setError("Username dan password wajib diisi.");
      return;
    }

    setError(null);

    try {
      const nextAdmin = { username: cleanUsername, password: cleanPassword };
      setSuperAdmin(nextAdmin);
      await loginWithCredentials(cleanUsername, cleanPassword);
      navigate("/admin/dashboard", { replace: true });
    } catch (err: any) {
      setError(err.message || "Login gagal. Periksa username dan password.");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4F8" }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p style={{ color: "#64748b" }}>{t("Checking session…")}</p>
        </div>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#F0F4F8" }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-col w-[42%] p-12 relative overflow-hidden"
        style={{
          background: schoolBackground
            ? `linear-gradient(160deg, rgba(13,27,42,0.9) 0%, rgba(13,27,42,0.78) 100%), url("${schoolBackground}") center / cover no-repeat`
            : "#0D1B2A",
        }}
      >
        <div className="relative z-10 flex-1 flex flex-col">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={schoolName}
                className="w-10 h-10 rounded-xl object-contain"
                style={{ background: "rgba(255,255,255,0.92)", border: "1px solid rgba(255,255,255,0.4)" }}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
                style={{ background: "#1D4ED8", color: "#fff" }}
              >
                SE
              </div>
            )}
            <div>
              <div
                className="font-bold text-lg"
                style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}
              >
                SmartCBT
              </div>
              <div className="text-xs" style={{ color: "#475569" }}>
                Digital Examination Platform
              </div>
            </div>
          </div>

          {/* Hero text */}
          <div className="flex-1">
            <h1
              className="text-4xl font-bold leading-tight mb-6"
              style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}
            >
              {t("Secure, Reliable")}
              <br />
              Digital Exams
            </h1>
            <p className="text-base leading-relaxed mb-10" style={{ color: "#64748b" }}>
              {t("End-to-end digital examination with Safe Exam Browser integration, real-time monitoring, and automated grading analytics.")}
            </p>

            {/* Feature list */}
            <div className="space-y-4">
              {[
                { icon: "🔒", text: t("Safe Exam Browser (SEB) compatibility & validation") },
                { icon: "📡", text: t("Real-time monitoring with WebSocket status feeds") },
                { icon: "🎲", text: t("Seeded randomization — unique question order per student") },
                { icon: "📊", text: t("Item analysis: Tingkat Kesukaran & Daya Beda") },
              ].map((f) => (
                <div key={f.text} className="flex items-start gap-3">
                  <span className="text-sm mt-0.5">{f.icon}</span>
                  <span className="text-sm" style={{ color: "#94a3b8" }}>
                    {f.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Background decoration */}
        <div
          className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full opacity-10"
          style={{ background: "#1D4ED8" }}
        />
        <div
          className="absolute top-1/3 -right-10 w-32 h-32 rounded-full opacity-5"
          style={{ background: "#1D4ED8" }}
        />
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="absolute top-5 right-5">
            <LanguageSwitcher />
          </div>
          <div className="mb-8">
            <div className="lg:hidden flex items-center gap-2 mb-6">
              {schoolLogo ? (
                <img
                  src={schoolLogo}
                  alt={schoolName}
                  className="w-8 h-8 rounded-lg object-contain"
                  style={{ background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0" }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
                  style={{ background: "#1D4ED8", color: "#fff" }}
                >
                  SE
                </div>
              )}
              <span
                className="font-bold"
                style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
              >
                SmartCBT
              </span>
            </div>
            <h2
              className="text-2xl font-bold mb-1"
              style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
            >
              {t("Sign in to your account")}
            </h2>
            <p className="text-sm" style={{ color: "#64748b" }}>
              {t("Select a demo role to explore the platform")}
            </p>
          </div>

          {/* SEB Detection Banner */}
          <div
            className="rounded-lg px-4 py-3 mb-6 text-sm flex items-center gap-2"
            style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
          >
            <span>⚠</span>
            <span>
              {t("SEB not detected — accessing via standard browser.")}{" "}
              <span className="font-medium">{t("Demo mode active.")}</span>
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            <div className="rounded-xl p-4" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                    Super Admin
                  </div>
                  <div className="text-sm mt-1" style={{ color: "#64748b" }}>
                    {t("Default credentials can be updated by the admin.")}
                  </div>
                </div>
                <div className="text-xl">⚙</div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      const next = e.target.value;
                      setUsername(next);
                      setSuperAdmin((prev) => ({ ...prev, username: next }));
                    }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                    placeholder="username"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPassword(next);
                      setSuperAdmin((prev) => ({ ...prev, password: next }));
                    }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                    placeholder="Password"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
              style={{ background: "#1D4ED8", color: "#fff" }}
            >
              {authLoading ? t("Signing in...") : t("Login")}
            </button>
          </form>

          {/* Students may create their own account (form is public). */}
          <div className="text-center text-xs mb-4" style={{ color: "#64748b" }}>
            {t("Belum punya akun siswa?")}{" "}
            <Link to="/register" className="font-semibold" style={{ color: "#1D4ED8" }}>
              {t("Daftar Akun Siswa")}
            </Link>
          </div>

          <div className="text-center text-xs" style={{ color: "#94a3b8" }}>
            {schoolName} · SmartCBT v2.4.1 · 2026
          </div>
        </div>
      </div>
    </div>
  );
}