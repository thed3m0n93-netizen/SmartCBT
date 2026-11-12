import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import {
  fetchClasses,
  fetchSettings,
  registerStudent,
  type ClassRow,
  type SchoolSettings,
} from "../lib/api";
import LanguageSwitcher from "../components/LanguageSwitcher";

/** Empty form state — one place so the reset stays in sync with the fields. */
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

/**
 * Public student self-registration (`/register`).
 *
 * The page is intentionally outside `AppLayout` — it must be reachable without
 * a session. Every field is validated twice: here for immediate feedback and
 * again on the server (`POST /api/register/student`, whitelisted in
 * `src/lib/server/index.ts`), because the server is the source of truth for
 * duplicate usernames/NISN and class existence.
 */
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
      .catch(() => { /* keep defaults — the form still works */ });
    fetchClasses()
      .then(setClasses)
      .catch(() => setClasses([]))
      .finally(() => setLoadingClasses(false));
  }, []);

  const schoolName = settings?.school_name || "SmartCBT";
  const schoolLogo = settings?.school_logo || "";

  /** Client-side validation mirroring the server rules. */
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
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
  } as const;

  return (
    <div className="min-h-screen" style={{ background: "#F0F4F8" }}>
      <div className="absolute top-5 right-5">
        <LanguageSwitcher />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          {schoolLogo ? (
            <img
              src={schoolLogo}
              alt={schoolName}
              className="w-11 h-11 rounded-xl object-contain"
              style={{ background: "#fff", border: "1px solid #e2e8f0" }}
            />
          ) : (
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold"
              style={{ background: "#1D4ED8", color: "#fff" }}
            >
              SE
            </div>
          )}
          <div>
            <div className="font-bold text-lg" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
              {t("Daftar Akun Siswa")}
            </div>
            <div className="text-xs" style={{ color: "#64748b" }}>
              {schoolName} · SmartCBT
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl p-6 sm:p-8"
          style={{ background: "#fff", border: "1px solid #e2e8f0", boxShadow: "0 8px 30px rgba(15,23,42,0.06)" }}
        >
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#64748b" }}>
            {t("Isi data berikut untuk membuat akun siswa. Hubungi admin sekolah bila nama kelas Anda belum tersedia.")}
          </p>

          {done ? (
            <div className="space-y-5">
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{ background: "#D1FAE5", color: "#065F46", border: "1px solid #A7F3D0" }}
              >
                ✓ {t("Akun siswa dibuat. Silakan login memakai username dan password Anda.")}
              </div>
              <Link
                to="/login"
                className="block w-full text-center py-3 rounded-lg text-sm font-semibold"
                style={{ background: "#1D4ED8", color: "#fff" }}
              >
                {t("Login di sini")}
              </Link>
              <button
                type="button"
                onClick={() => setDone(false)}
                className="w-full text-center text-xs"
                style={{ color: "#64748b" }}
              >
                {t("Daftar lagi")}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                  {t("Full Name")} <span style={{ color: "#DC2626" }}>*</span>
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
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    {t("NISN / NIS")} <span style={{ color: "#DC2626" }}>*</span>
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
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    {t("Kelas (pilih dari daftar)")} <span style={{ color: "#DC2626" }}>*</span>
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

              {/* Contact details */}
              <div className="pt-2" style={{ borderTop: "1px solid #f1f5f9" }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
                  {t("Data Kontak Siswa")}
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
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
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
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
                    <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                      {t("Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.")}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                      {t("Alamat Lengkap")}
                    </label>
                    <textarea
                      value={form.address}
                      onChange={(e) => setField({ address: e.target.value })}
                      style={{ ...inputStyle, minHeight: 76, resize: "vertical" }}
                      placeholder={t("e.g. Jl. Teknologi No. 1, Karawang")}
                      maxLength={512}
                    />
                  </div>
                </div>
              </div>

              {/* Credentials */}
              <div className="pt-2" style={{ borderTop: "1px solid #f1f5f9" }}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                      Username <span style={{ color: "#DC2626" }}>*</span>
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
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                      {t("Password")} <span style={{ color: "#DC2626" }}>*</span>
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
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    {t("Konfirmasi Password")} <span style={{ color: "#DC2626" }}>*</span>
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
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !!validationError}
                className="w-full py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                style={{ background: "#1D4ED8", color: "#fff" }}
              >
                {busy ? t("Menyimpan…") : t("Daftar Akun Siswa")}
              </button>

              <p className="text-xs text-center" style={{ color: "#94a3b8" }}>
                {t("Bisa juga didaftarkan oleh admin di halaman Pengguna.")}
              </p>
            </form>
          )}
        </div>

        <div className="text-center text-xs mt-6" style={{ color: "#94a3b8" }}>
          {t("Sudah punya akun?")}{" "}
          <Link to="/login" className="font-medium" style={{ color: "#1D4ED8" }}>
            {t("Login di sini")}
          </Link>
        </div>
      </div>
    </div>
  );
}
