import { useState, useEffect, useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { C, S } from "../styles/tokens";
import {
  fetchClasses,
  fetchSettings,
  registerStudent,
  type ClassRow,
  type SchoolSettings,
} from "../lib/api";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../components/ThemeToggle";

const EMPTY = {
  fullName: "",
  username: "",
  studentNumber: "",
  classId: "",
  email: "",
  phone: "",
  address: "",
  password: "",
  confirmPassword: "",
};

export default function StudentRegisterPage() {
  const { t } = useI18n();
  const [form, setForm] = useState({ ...EMPTY });
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const setField = (patch: Partial<typeof EMPTY>) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    fetchSettings()
      .then(setSettings)
      .catch(() => {
        /* keep defaults */
      });
    fetchClasses()
      .then(setClasses)
      .catch(() => setClasses([]))
      .finally(() => setLoadingClasses(false));
  }, []);

  const schoolName = settings?.school_name || "SmartCBT";
  const schoolLogo = settings?.school_logo || "";

  const validationError = useMemo(() => {
    if (!form.fullName.trim()) return t("Nama lengkap wajib diisi.");
    if (form.username.trim().length < 3) return t("Username minimal 3 karakter.");
    if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) {
      return t("Username hanya boleh berisi huruf, angka, titik, garis bawah, atau minus.");
    }
    if (form.studentNumber.trim().length < 4) return t("NISN minimal 4 karakter.");
    if (!form.classId) return t("Kelas wajib dipilih.");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return t("Format email tidak valid.");
    }
    if (form.phone.trim() && form.phone.replace(/\D/g, "").length < 8) {
      return t("Nomor WhatsApp minimal 8 digit angka.");
    }
    if (form.password.length < 6) return t("Password minimal 6 karakter.");
    if (form.password !== form.confirmPassword) return t("Konfirmasi password tidak sama.");
    return null;
  }, [form, t]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerStudent({
        fullName: form.fullName.trim(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
        classId: Number(form.classId),
        studentNumber: form.studentNumber.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      setDone(true);
      setForm({ ...EMPTY });
    } catch (err: any) {
      setError(err?.message || t("Gagal mendaftarkan akun."));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    minHeight: 44,
    borderRadius: 10,
    fontSize: 14,
    outline: "none",
    border: `1px solid ${C.base.border}`,
    background: C.base.surfaceMuted,
    color: C.base.text,
    boxShadow: S.inset,
  } as const;

  return (
    <div className="min-h-screen safe-area-top safe-area-bottom" style={{ background: C.base.page }}>
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
        {/* Top Controls + Header */}
        <div className="flex items-center justify-between gap-3 mb-7">
          <div className="flex items-center gap-3 min-w-0">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={schoolName}
                className="w-11 h-11 rounded-xl object-contain p-0.5 shrink-0"
                style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.control }}
              />
            ) : (
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center font-bold shrink-0"
                style={{
                  background: "linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)",
                  color: "#FFFFFF",
                  boxShadow: S.btnPrimary,
                }}
              >
                SE
              </div>
            )}
            <div className="min-w-0">
              <div className="font-bold text-lg truncate" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                {t("Daftar Akun Siswa")}
              </div>
              <div className="text-xs truncate" style={{ color: C.base.textMuted }}>
                {schoolName} · SmartCBT
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle compact />
            <LanguageSwitcher />
          </div>
        </div>

        <div
          className="cbt-card rounded-2xl p-5 sm:p-8"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
        >
          <p className="text-sm leading-relaxed mb-6" style={{ color: C.base.textMuted }}>
            {t("Isi data berikut untuk membuat akun siswa. Hubungi admin sekolah bila nama kelas Anda belum tersedia.")}
          </p>

          {done ? (
            <div className="space-y-5">
              <div
                className="rounded-xl px-4 py-3 text-sm flex items-start gap-2.5"
                style={{ background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t("Akun siswa dibuat. Silakan login memakai username dan password Anda.")}</span>
              </div>
              <Link
                to="/login"
                className="flex items-center justify-center w-full py-3 rounded-xl text-sm font-semibold min-h-[48px]"
                style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
              >
                {t("Login di sini")}
              </Link>
              <button
                type="button"
                onClick={() => setDone(false)}
                className="w-full text-center text-xs py-2"
                style={{ color: C.base.textMuted }}
              >
                {t("Daftar lagi")}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                  {t("Full Name")} <span style={{ color: C.danger.main }}>*</span>
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setField({ fullName: e.target.value })}
                  style={inputStyle}
                  placeholder={t("e.g. Ahmad Santoso, S.Pd.")}
                  maxLength={128}
                  required
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {t("NISN / NIS")} <span style={{ color: C.danger.main }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={form.studentNumber}
                    onChange={(e) => setField({ studentNumber: e.target.value })}
                    style={inputStyle}
                    placeholder={t("e.g. 0098765432")}
                    maxLength={20}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {t("Kelas (pilih dari daftar)")} <span style={{ color: C.danger.main }}>*</span>
                  </label>
                  <select
                    value={form.classId}
                    onChange={(e) => setField({ classId: e.target.value })}
                    style={inputStyle}
                    required
                  >
                    <option value="">
                      {loadingClasses ? t("Memuat…") : t("— Pilih kelas —")}
                    </option>
                    {classes.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.grade_level} {c.class_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.base.textFaint }}>
                  {t("Data Kontak Siswa")}
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Email Aktif")}
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setField({ email: e.target.value })}
                      style={inputStyle}
                      placeholder={t("e.g. siswa@email.com")}
                      maxLength={128}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Nomor WhatsApp")}
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setField({ phone: e.target.value })}
                      style={inputStyle}
                      placeholder={t("e.g. 081234567890")}
                      maxLength={32}
                    />
                    <div className="text-xs mt-1" style={{ color: C.base.textFaint }}>
                      {t("Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.")}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Alamat Lengkap")}
                    </label>
                    <textarea
                      value={form.address}
                      onChange={(e) => setField({ address: e.target.value })}
                      style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                      placeholder={t("e.g. Jl. Teknologi No. 1, Karawang")}
                      maxLength={512}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      Username <span style={{ color: C.danger.main }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(e) => setField({ username: e.target.value })}
                      style={inputStyle}
                      placeholder={t("e.g. ahmad_santoso")}
                      maxLength={64}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Password")} <span style={{ color: C.danger.main }}>*</span>
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setField({ password: e.target.value })}
                      style={inputStyle}
                      placeholder={t("Min. 6 characters")}
                      required
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {t("Konfirmasi Password")} <span style={{ color: C.danger.main }}>*</span>
                  </label>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) => setField({ confirmPassword: e.target.value })}
                    style={inputStyle}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div
                  className="rounded-xl px-3.5 py-2.5 text-sm"
                  style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !!validationError}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[48px] active:scale-[0.99]"
                style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
              >
                {busy ? t("Menyimpan…") : t("Daftar Akun Siswa")}
              </button>

              <p className="text-xs text-center" style={{ color: C.base.textFaint }}>
                {t("Bisa juga didaftarkan oleh admin di halaman Pengguna.")}
              </p>
            </form>
          )}
        </div>

        <div className="text-center text-xs mt-6" style={{ color: C.base.textFaint }}>
          {t("Sudah punya akun?")}{" "}
          <Link to="/login" className="font-semibold hover:underline" style={{ color: C.brand.dark }}>
            {t("Login di sini")}
          </Link>
        </div>
      </div>
    </div>
  );
}
