import { useState, useEffect } from "react";
import { AlertTriangle, BarChart3, Lock, Radio, ShieldCheck, Shuffle } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../app/AuthContext";
import { useI18n } from "../i18n";
import { C, S } from "../styles/tokens";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../components/ThemeToggle";
import PWAInstallButton from "../components/PWAInstallButton";
import { fetchSettings, type SchoolSettings } from "../lib/api";

export default function LoginPage() {
  const { loginWithCredentials, loading: authLoading, user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [schoolName, setSchoolName] = useState("SMK TEKNOLOGI");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [schoolLogo, setSchoolLogo] = useState("");
  const [schoolBackground, setSchoolBackground] = useState("");

  useEffect(() => {
    fetchSettings()
      .then((s: SchoolSettings) => {
        if (s.school_name) setSchoolName(s.school_name);
        if (s.school_address) setSchoolAddress(s.school_address);
        if (s.school_logo) setSchoolLogo(s.school_logo);
        if (s.school_background) setSchoolBackground(s.school_background);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    navigate(
      user.role === "admin"
        ? "/admin/dashboard"
        : user.role === "teacher"
          ? "/teacher/questions"
          : "/student/dashboard",
      { replace: true },
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
      await loginWithCredentials(cleanUsername, cleanPassword);
      navigate("/admin/dashboard", { replace: true });
    } catch (err: any) {
      setError(err.message || "Login gagal. Periksa username dan password.");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.base.page }}>
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent mx-auto mb-4"
            style={{ borderColor: C.brand.main, borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("Checking session…")}
          </p>
        </div>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ background: C.base.page }}>
      {/* Left Institutional Panel */}
      <div
        className="hidden lg:flex flex-col w-[44%] xl:w-[42%] p-12 relative overflow-hidden cbt-arch-grid border-r"
        style={{
          background: schoolBackground
            ? `linear-gradient(160deg, rgba(9,19,31,0.92) 0%, rgba(13,27,42,0.84) 100%), url("${schoolBackground}") center / cover no-repeat`
            : "linear-gradient(165deg, #0D1B2A 0%, #09131F 100%)",
          borderColor: "#1B2A3E",
        }}
      >
        <div className="relative z-10 flex-1 flex flex-col">
          {/* Brand */}
          <div className="flex items-center gap-3.5 mb-14">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={schoolName}
                className="w-11 h-11 rounded-xl object-contain p-1"
                style={{
                  background: "rgba(255,255,255,0.95)",
                  border: "1px solid rgba(255,255,255,0.35)",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
                }}
              />
            ) : (
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base"
                style={{
                  background: "linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)",
                  color: "#FFFFFF",
                  boxShadow: "0 6px 16px rgba(37, 99, 235, 0.4), inset 0 1px 0 rgba(255,255,255,0.28)",
                }}
              >
                SE
              </div>
            )}
            <div>
              <div
                className="font-bold text-lg tracking-wide"
                style={{ color: "#F8FAFC", fontFamily: "var(--font-serif)" }}
              >
                SmartCBT
              </div>
              <div className="text-xs" style={{ color: "#7C8FA6" }}>
                Digital Examination Platform
              </div>
            </div>
          </div>

          {/* Hero Copy */}
          <div className="flex-1 flex flex-col justify-center max-w-md">
            <h1
              className="text-4xl font-bold leading-tight mb-5"
              style={{ color: "#F8FAFC", fontFamily: "var(--font-serif)" }}
            >
              {t("Secure, Reliable")}
              <br />
              Digital Exams
            </h1>
            <p className="text-base leading-relaxed mb-9" style={{ color: "#94A3B8" }}>
              {t(
                "End-to-end digital examination with Safe Exam Browser integration, real-time monitoring, and automated grading analytics.",
              )}
            </p>

            {/* Institutional Capabilities */}
            <div className="space-y-3.5">
              {[
                {
                  icon: <Lock className="w-4 h-4" />,
                  text: t("Safe Exam Browser (SEB) compatibility & validation"),
                },
                {
                  icon: <Radio className="w-4 h-4" />,
                  text: t("Real-time monitoring with WebSocket status feeds"),
                },
                {
                  icon: <Shuffle className="w-4 h-4" />,
                  text: t("Seeded randomization — unique question order per student"),
                },
                {
                  icon: <BarChart3 className="w-4 h-4" />,
                  text: t("Item analysis: Tingkat Kesukaran & Daya Beda"),
                },
              ].map((f) => (
                <div
                  key={f.text}
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <span className="mt-0.5 shrink-0" style={{ color: "#60A5FA" }}>
                    {f.icon}
                  </span>
                  <span className="text-sm leading-snug" style={{ color: "#CBD5E1" }}>
                    {f.text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {schoolAddress && (
            <div className="pt-6 text-xs" style={{ color: "#64748B" }}>
              {schoolName} · {schoolAddress}
            </div>
          )}
        </div>
      </div>

      {/* Right Authentication Panel */}
      <div className="flex-1 flex flex-col justify-between p-4 sm:p-8 safe-area-top safe-area-bottom">
        <div className="flex items-center justify-between lg:justify-end gap-2">
          <div className="lg:hidden flex items-center gap-2.5">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={schoolName}
                className="w-9 h-9 rounded-xl object-contain p-0.5"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  boxShadow: S.control,
                }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
                style={{
                  background: "linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)",
                  color: "#FFFFFF",
                  boxShadow: S.btnPrimary,
                }}
              >
                SE
              </div>
            )}
            <span
              className="font-bold text-base"
              style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
            >
              SmartCBT
            </span>
          </div>

          <div className="flex items-center gap-2">
            <PWAInstallButton variant="header" />
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>

        <div className="w-full max-w-md mx-auto my-auto py-6">
          <div className="mb-6">
            <h2
              className="text-2xl sm:text-3xl font-bold mb-1.5 tracking-tight"
              style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
            >
              {t("Sign in to your account")}
            </h2>
            <p className="text-sm" style={{ color: C.base.textMuted }}>
              {t("Masukkan username dan password akun Anda untuk melanjutkan.")}
            </p>
          </div>

          {/* SEB Detection Notice */}
          <div
            className="rounded-xl px-4 py-3 mb-5 text-xs sm:text-sm flex items-start gap-2.5"
            style={{
              background: C.warn.bg,
              color: C.warn.dark,
              border: `1px solid ${C.warn.border}`,
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {t("SEB not detected — accessing via standard browser.")}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            <div
              className="cbt-card rounded-2xl p-5 sm:p-6"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b" style={{ borderColor: C.base.borderLight }}>
                <div>
                  <div
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: C.base.textFaint, fontFamily: "var(--font-display)" }}
                  >
                    {t("Account Credentials")}
                  </div>
                  <div className="text-xs sm:text-sm mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Gunakan akun terdaftar untuk mengakses platform.")}
                  </div>
                </div>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: C.brand.bg,
                    color: C.brand.dark,
                    border: `1px solid ${C.brand.borderSoft}`,
                  }}
                >
                  <ShieldCheck className="w-5 h-5" />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: C.base.textBody, fontFamily: "var(--font-display)" }}
                  >
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    autoComplete="username"
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none min-h-[46px]"
                    style={{
                      border: `1px solid ${C.base.border}`,
                      background: C.base.surfaceMuted,
                      color: C.base.text,
                      boxShadow: S.inset,
                    }}
                    placeholder={t("Username")}
                  />
                </div>

                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: C.base.textBody, fontFamily: "var(--font-display)" }}
                  >
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none min-h-[46px]"
                    style={{
                      border: `1px solid ${C.base.border}`,
                      background: C.base.surfaceMuted,
                      color: C.base.text,
                      boxShadow: S.inset,
                    }}
                    placeholder={t("Password")}
                  />
                </div>
              </div>
            </div>

            {error && (
              <div
                className="rounded-xl px-3.5 py-2.5 text-sm"
                style={{
                  background: C.danger.bgLight,
                  color: C.danger.text,
                  border: `1px solid ${C.danger.border}`,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[48px] active:scale-[0.99]"
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                color: "#FFFFFF",
                boxShadow: S.btnPrimary,
                fontFamily: "var(--font-display)",
              }}
            >
              {authLoading ? t("Signing in...") : t("Login")}
            </button>
          </form>

          <div className="text-center text-xs mb-3" style={{ color: C.base.textMuted }}>
            {t("Belum punya akun siswa?")}{" "}
            <Link to="/register" className="font-semibold hover:underline" style={{ color: C.brand.dark }}>
              {t("Daftar Akun Siswa")}
            </Link>
          </div>
        </div>

        <div className="text-center text-xs py-2" style={{ color: C.base.textFaint }}>
          {schoolName} · SmartCBT v2.4.1 · 2026
        </div>
      </div>
    </div>
  );
}