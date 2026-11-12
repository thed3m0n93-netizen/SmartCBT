import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import {
  fetchTokens,
  generateToken,
  revokeToken,
  fetchExams,
  type TokenRow,
  type ExamRow,
} from "../../lib/api";
import { C } from "../../styles/tokens";
import { SectionCard, Btn, Field, Notice, controlStyle, Badge } from "../../components/ui";

function generateRequestHash(url: string, configKey: string): string {
  if (!url || !configKey) return "";
  let hash = 0;
  const combined = url + configKey;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SEBConfigPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const teacherId = user?.id ?? "";

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [newTokenExam, setNewTokenExam] = useState("");
  const [showNewToken, setShowNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tokRows, examRows] = await Promise.all([fetchTokens(), fetchExams()]);
      setTokens(tokRows);
      setExams(examRows);
    } catch (err: any) {
      setError(err?.message ?? t("Failed to load tokens from database"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const [hashUrl, setHashUrl] = useState("https://smktekno.mycbt.online/student/dashboard");
  const [hashKey, setHashKey] = useState("");
  const [computedHash, setComputedHash] = useState("");

  const [sebConfig, setSebConfig] = useState({
    allowBrowser: false,
    allowKeyboard: true,
    allowClipboard: false,
    allowSpellcheck: false,
    allowNetworkAccess: false,
    lockTaskbar: true,
    showTaskbar: false,
    enableAudioControl: true,
    quitPassword: "",
    startURL: "https://smktekno.mycbt.online/student/dashboard",
    browserWindowWebView: true,
    examSessionToken: true,
    sebServicePolicy: "block",
  });

  const [generatedSEB, setGeneratedSEB] = useState("");

  useEffect(() => {
    if (sebConfig.startURL) {
      localStorage.setItem("smartcbt_seb_start_url", sebConfig.startURL);
    }
  }, [sebConfig.startURL]);

  const generateSEBConfig = () => {
    if (sebConfig.startURL) {
      localStorage.setItem("smartcbt_seb_start_url", sebConfig.startURL);
    }
    const config = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>allowBrowsingBackForward</key>\n  <${sebConfig.allowBrowser ? "true" : "false"}/>\n  <key>allowClipboard</key>\n  <${sebConfig.allowClipboard ? "true" : "false"}/>\n  <key>allowSpellCheck</key>\n  <${sebConfig.allowSpellcheck ? "true" : "false"}/>\n  <key>allowWlan</key>\n  <${sebConfig.allowNetworkAccess ? "true" : "false"}/>\n  <key>blockKeyboard</key>\n  <${sebConfig.allowKeyboard ? "false" : "true"}/>\n  <key>enableAudioControl</key>\n  <${sebConfig.enableAudioControl ? "true" : "false"}/>\n  <key>examSessionClearCookiesOnEnd</key>\n  <true/>\n  <key>examSessionClearCookiesOnStart</key>\n  <true/>\n  <key>examSessionToken</key>\n  <${sebConfig.examSessionToken ? "true" : "false"}/>\n  <key>hashedQuitPassword</key>\n  <string>${sebConfig.quitPassword ? btoa(sebConfig.quitPassword) : "c7ad44cbad762a5da0a452f9e854fdc1e0e7a52a38015f23f3eab1d80b931dd472634dfac71cd34ebc35d16ab7fb8a90c81f975113d6c7538dc69dd8de9077ec"}</string>\n  <key>sebServicePolicy</key>\n  <integer>${sebConfig.sebServicePolicy === "block" ? "2" : "1"}</integer>\n  <key>sendBrowserExamKey</key>\n  <true/>\n  <key>showTaskBar</key>\n  <${sebConfig.showTaskbar ? "true" : "false"}/>\n  <key>startURL</key>\n  <string>${sebConfig.startURL}</string>\n  <key>urlFilterEnable</key>\n  <true/>\n  <key>urlFilterRules</key>\n  <array>\n    <dict>\n      <key>action</key><integer>1</integer>\n      <key>active</key><true/>\n      <key>expression</key>\n      <string>${new URL(sebConfig.startURL).hostname}</string>\n      <key>regex</key><false/>\n    </dict>\n  </array>\n</dict>\n</plist>`;
    setGeneratedSEB(config);
  };
  const handleGenerateToken = async () => {
    if (!newTokenExam) return;
    if (!teacherId) {
      setError(t("Sesi login tidak ditemukan. Silakan login kembali."));
      return;
    }
    try {
      setError(null);
      const result = await generateToken(newTokenExam, teacherId);
      setShowNewToken(result.token);
      await loadTokens();
    } catch (err: any) {
      setError(err?.message ?? t("Failed to generate token"));
    }
  };

  const handleRevokeToken = async (examId: string) => {
    if (!teacherId) {
      setError(t("Sesi login tidak ditemukan. Silakan login kembali."));
      return;
    }
    try {
      setError(null);
      await revokeToken(examId, teacherId);
      await loadTokens();
    } catch (err: any) {
      setError(err?.message ?? t("Failed to revoke token"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
          {t("SEB Config & Tokens")}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
          {t("Safe Exam Browser configuration generator · Dynamic entry tokens · Request hash validator")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SEB Config Generator */}
        <div className="space-y-4">
          <SectionCard title={t("🔒 SEB Configuration Generator")} subtitle={t("Generate a .seb file to distribute to students")}>
            <Field label={t("Exam Start URL")}>
              <input
                type="text"
                value={sebConfig.startURL}
                onChange={(e) => setSebConfig((p) => ({ ...p, startURL: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
                style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
              />
            </Field>

            <Field label={t("Quit Password")}>
              <input
                type="password"
                placeholder={t("Password to exit SEB during exam")}
                value={sebConfig.quitPassword}
                onChange={(e) => setSebConfig((p) => ({ ...p, quitPassword: e.target.value }))}
                style={controlStyle}
              />
            </Field>

            <div>
              <div className="text-xs font-medium mb-2" style={{ color: C.base.textBody }}>{t("Security Options")}</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "allowBrowser" as const, label: t("Allow Back/Forward") },
                  { key: "allowClipboard" as const, label: t("Allow Clipboard") },
                  { key: "allowSpellcheck" as const, label: t("Allow Spellcheck") },
                  { key: "allowNetworkAccess" as const, label: t("Allow Network") },
                  { key: "allowKeyboard" as const, label: t("Allow All Keys") },
                  { key: "enableAudioControl" as const, label: t("Audio Control") },
                  { key: "showTaskbar" as const, label: t("Show Taskbar") },
                  { key: "examSessionToken" as const, label: t("Session Token") },
                ].map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: C.base.textBody }}>
                    <input
                      type="checkbox"
                      checked={sebConfig[opt.key] as boolean}
                      onChange={(e) => setSebConfig((p) => ({ ...p, [opt.key]: e.target.checked }))}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <Field label={t("SEB Service Policy")}>
              <select
                value={sebConfig.sebServicePolicy}
                onChange={(e) => setSebConfig((p) => ({ ...p, sebServicePolicy: e.target.value }))}
                style={controlStyle}
              >
                <option value="block">{t("Block exam if SEB Service not running")}</option>
                <option value="warn">{t("Warn but allow exam to proceed")}</option>
              </select>
            </Field>

            <Btn variant="primary" onClick={generateSEBConfig} style={{ width: "100%" }}>{t("Generate .seb Config File")}</Btn>
            {generatedSEB && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-medium" style={{ color: C.base.textBody }}>{t("Generated Config")}</div>
                  <Btn
                    variant="success"
                    onClick={() => {
                      const blob = new Blob([generatedSEB], { type: "application/xml" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "exam-config.seb";
                      a.click();
                    }}
                    style={{ padding: "4px 12px" }}
                  >
                    {t("↓ Download .seb")}
                  </Btn>
                </div>
                <pre
                  className="text-xs p-3 rounded-lg overflow-auto max-h-48"
                  style={{
                    background: C.code.bg,
                    color: C.code.text,
                    fontFamily: "var(--font-mono)",
                    border: `1px solid ${C.code.border}`,
                  }}
                >
                  {generatedSEB}
                </pre>
              </div>
            )}
          </SectionCard>

          {/* Request Hash Validator */}
          <SectionCard title={t("X-SafeExamBrowser-RequestHash Validator")}>
            <Field label={t("Request URL")}>
              <input
                type="text"
                value={hashUrl}
                onChange={(e) => setHashUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
                style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
              />
            </Field>
            <Field label={t("Config Key (SHA-256 of .seb file)")}>
              <input
                type="text"
                value={hashKey}
                onChange={(e) => setHashKey(e.target.value)}
                placeholder={t("Paste SEB config key here…")}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
                style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
              />
            </Field>
            <Btn onClick={() => setComputedHash(generateRequestHash(hashUrl, hashKey))} style={{ width: "100%" }}>{t("Compute Hash")}</Btn>
            {computedHash && (
              <div>
                <div className="text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                  {t("Expected X-SafeExamBrowser-RequestHash:")}
                </div>
                <div
                  className="text-xs p-3 rounded-lg break-all"
                  style={{
                    background: C.ok.bgLight,
                    border: `1px solid ${C.ok.border}`,
                    color: C.ok.dark,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {computedHash}
                </div>
              </div>
            )}
          </SectionCard>
        </div>
        {/* Token Management */}
        <div className="self-start">
          <SectionCard
            title={t("Dynamic Entry Tokens")}
            subtitle={t("6-character alphanumeric tokens · Time-bound · One per exam session")}
          >
            <div className="flex gap-2">
              <select
                value={newTokenExam}
                onChange={(e) => setNewTokenExam(e.target.value)}
                style={{ ...controlStyle, flex: 1 }}
              >
                <option value="">{t("Select exam…")}</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>{exam.title}</option>
                ))}
              </select>
              <Btn variant="primary" onClick={handleGenerateToken}>{t("Generate Token")}</Btn>
            </div>

            {showNewToken && (
              <div
                className="rounded-lg p-4 text-center"
                style={{ background: C.brand.bg, border: `2px solid ${C.brand.main}` }}
              >
                <div className="text-xs mb-1" style={{ color: C.brand.light }}>{t("New Token Generated")}</div>
                <div className="text-4xl font-bold tracking-[0.3em] mb-2" style={{ color: C.brand.main, fontFamily: "var(--font-mono)" }}>
                  {showNewToken}
                </div>
                <div className="text-xs" style={{ color: C.base.textMuted }}>
                  {t("Share this with students before the exam begins")}
                </div>
                <button onClick={() => setShowNewToken(null)} className="mt-2 text-xs" style={{ color: C.base.textFaint }}>
                  {t("Dismiss")}
                </button>
              </div>
            )}

            <div className="space-y-2.5">
              {loading && (
                <div className="text-sm text-center py-6" style={{ color: C.base.textFaint }}>{t("Loading tokens…")}</div>
              )}
              {error && <Notice type="error">{error}</Notice>}
              {!loading && !error && tokens.length === 0 && (
                <div className="text-sm text-center py-6" style={{ color: C.base.textFaint }}>{t("No tokens yet. Generate one for an exam.")}</div>
              )}
              {tokens.map((tok) => (
                <div
                  key={tok.exam_id}
                  className="rounded-lg p-3.5 flex items-start justify-between"
                  style={{
                    background: tok.is_token_active ? "#FAFFFE" : C.base.surfaceMuted,
                    border: `1px solid ${tok.is_token_active ? C.ok.border : C.base.border}`,
                    opacity: tok.is_token_active ? 1 : 0.7,
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl font-bold tracking-[0.15em]" style={{ color: tok.is_token_active ? C.ok.main : C.base.textFaint, fontFamily: "var(--font-mono)" }}>
                        {tok.token}
                      </span>
                      {!tok.is_token_active && (
                        <Badge bg={C.base.surfaceSoft} color={C.base.textMuted}>{t("Revoked")}</Badge>
                      )}
                    </div>
                    <div className="text-xs mb-0.5" style={{ color: C.base.textBody }}>{tok.exam_title}</div>
                    <div className="text-xs" style={{ color: C.base.textFaint, fontFamily: "var(--font-mono)" }}>
                      {formatDateTime(tok.created_at)} → {formatDateTime(tok.end_time)} · {tok.created_by}
                    </div>
                  </div>
                  {tok.is_token_active && (
                    <Btn variant="danger" onClick={() => handleRevokeToken(tok.exam_id)} style={{ padding: "4px 10px", marginLeft: 12, flexShrink: 0 }}>
                      {t("Revoke")}
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
