import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { changePassword } from "../lib/api";
import { useI18n } from "../i18n";
import { C } from "../styles/tokens";
import { Btn, Field, Modal, Notice, controlStyle } from "./ui";

export interface ChangePasswordModalProps {
  onClose: () => void;
}

export default function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) {
      setError(t("Password saat ini wajib diisi."));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("Password baru minimal 8 karakter."));
      return;
    }
    if (newPassword.length > 128) {
      setError(t("Password baru maksimal 128 karakter."));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("Password baru harus berbeda dari password saat ini."));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("Konfirmasi password baru tidak cocok."));
      return;
    }

    setSaving(true);
    try {
      const res = await changePassword(currentPassword, newPassword);
      setSuccess(res?.message || t("Password berhasil diperbarui."));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setError(err?.message || t("Gagal memperbarui password."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" style={{ color: C.brand.main }} />
          {t("Ganti Password")}
        </span>
      }
      onClose={onClose}
      width={440}
      actions={
        <div className="flex items-center justify-end gap-2 w-full">
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            {t("Batal")}
          </Btn>
          <Btn
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || Boolean(success)}
          >
            <ShieldCheck className="w-4 h-4" />
            {saving ? t("Menyimpan...") : t("Simpan Password")}
          </Btn>
        </div>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice type="error">{error}</Notice>}
        {success && <Notice type="ok">{success}</Notice>}

        <Field label={t("Password Saat Ini")}>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("Masukkan password saat ini")}
              autoComplete="current-password"
              style={{ ...controlStyle, paddingRight: 44 }}
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              aria-label={showCurrent ? t("Sembunyikan password") : t("Lihat password")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center cbt-row-hover"
              style={{ color: C.base.textMuted }}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <Field
          label={t("Password Baru")}
          hint={t("Minimal 8 karakter, gunakan kombinasi huruf dan angka.")}
        >
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("Minimal 8 karakter")}
              autoComplete="new-password"
              style={{ ...controlStyle, paddingRight: 44 }}
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              aria-label={showNew ? t("Sembunyikan password") : t("Lihat password")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center cbt-row-hover"
              style={{ color: C.base.textMuted }}
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <Field label={t("Konfirmasi Password Baru")}>
          <input
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("Ulangi password baru")}
            autoComplete="new-password"
            style={controlStyle}
            disabled={saving}
          />
        </Field>
      </form>
    </Modal>
  );
}
