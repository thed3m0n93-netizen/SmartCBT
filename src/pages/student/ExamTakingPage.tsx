import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useNavigate } from "react-router"
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  Loader2,
  Lock,
  Maximize2,
  Menu,
  Send,
  Shuffle,
  Smartphone,
  WifiOff,
  X,
} from "lucide-react"
import { useAuth } from "../../app/AuthContext"
import MathText from "../../components/MathText"
import QuestionMedia from "../../components/QuestionMedia"
import { usePwaInstall, useOnlineStatus } from "../../hooks/usePwa"
import { useI18n } from "../../i18n"
import { C, S } from "../../styles/tokens"
import {
  buildPolicy,
  enterFullscreen,
  exitFullscreen,
  fullscreenSupported,
  isBlockedShortcut,
  isFullscreen,
  ViolationTracker,
  VIOLATION_DETAIL_KEY,
  VIOLATION_TITLE_KEY,
  type AntiCheatPolicy,
  type ViolationKind,
} from "../../lib/anticheat"
import {
  fetchExamForStudent,
  saveAnswer,
  startSession,
  submitSession,
  fetchExamResults,
  recordFocusLoss,
  recordViolation,
  reportViolationWithBeacon,
  enforceSeb,
  apiUrl,
  getAuthToken,
  type ExamResultsRow,
  type ExamTakingData,
} from "../../lib/api"

type QType = "single" | "multiple" | "truefalse" | "matching" | "essay"

interface Choice {
  key: string
  text: string
}

interface Question {
  id: string
  type: QType
  text: string
  choices?: Choice[]
  leftOptions?: Choice[]
  rightOptions?: Choice[]
  points: number
  topic: string
  formulaLatex?: string | null
  mediaType?: string | null
  mediaUrl?: string | null
  correctAnswer?: any
}

type AnswerValue = string | string[] | null

type ViewMode = "loading" | "taking" | "submitting" | "result" | "error"

function buildResponse(q: Question, val: AnswerValue): { response: any } {
  if (val === null || val === undefined) {
    return { response: null }
  }

  let response: any

  if (q.type === "single") {
    response = { selected: val as string }
  } else if (q.type === "multiple") {
    response = { selected: val as string[] }
  } else if (q.type === "truefalse") {
    response = { selected: val as string }
  } else if (q.type === "matching") {
    response = { pairs: val as any[] ?? [] }
  } else {
    response = { text: val as string }
  }

  // NOTE: correctness is NOT computed client-side anymore. The server derives
  // `is_correct`/`score_obtained` authoritatively from the stored
  // `correct_answer` (see `src/lib/server/scoring.ts`), and the student
  // endpoint no longer exposes `correct_answer` at all.
  return { response }
}

function restoreAnswer(q: Question, raw: any): AnswerValue | undefined {
  if (!raw) return undefined
  const resp = raw.student_response
  if (!resp) return undefined
  if (q.type === "essay") {
    return resp.text ?? null
  }
  if (q.type === "matching") {
    return resp.pairs ?? null
  }
  return resp.selected ?? null
}

function seededShuffle<T>(array: T[], seed: string): T[] {
  let rng = seed
    .split("")
    .reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    rng = (rng * 1664525 + 1013904223) | 0
    const j = Math.abs(rng) % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Map a DB question row to the exam UI model. */
function mapDbQuestion(row: any): Question {
  let type: QType = "essay"
  switch (row.question_type) {
    case "single_choice":
      type = "single"
      break
    case "multiple_choice":
      type = "multiple"
      break
    case "true_false":
      type = "truefalse"
      break
    case "matching":
      type = "matching"
      break
  }

  let choices: Choice[] | undefined
  let leftOptions: Choice[] | undefined
  let rightOptions: Choice[] | undefined

  const opts = row.options
  if (type === "matching" && opts && !Array.isArray(opts)) {
    leftOptions = (opts.left || []).map((l: any) => ({
      key: l.id,
      text: l.text,
    }))
    rightOptions = (opts.right || []).map((r: any) => ({
      key: r.id,
      text: r.text,
    }))
  } else {
    const arr = Array.isArray(opts?.choices)
      ? opts.choices
      : Array.isArray(opts)
        ? opts
        : null
    if (arr) {
      choices = arr.map((o: any) => ({
        key: o.key ?? String(o),
        text: o.text ?? String(o),
      }))
    }
  }

  return {
    id: row.id,
    type,
    text: row.content ?? "",
    choices,
    leftOptions,
    rightOptions,
    points: Number(row.score_weight) || 1,
    topic: row.bank_title ?? "Bank Soal",
    formulaLatex: row.formula_latex,
    mediaType: row.media_type ?? null,
    mediaUrl: row.media_url ?? null,
    correctAnswer: row.correct_answer,
  }
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

function getDeviceId(): string {
  const key = "smartcbt:device-id"
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const value =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(key, value)
  return value
}

/** Detect SEB from user agent or window properties. */
function detectSeb(): { detected: boolean; configKeyHash: string | null } {
  const ua = navigator.userAgent || ""
  const hasSebUa = /SafeExamBrowser|SEB\//i.test(ua)
  // SEB exposes a configKeyHash via window.SEB or localStorage in some versions
  let configKeyHash: string | null = null
  try {
    const stored = localStorage.getItem("smartcbt:seb-config-hash")
    if (stored && /^[0-9a-fA-F]{64}$/.test(stored)) configKeyHash = stored
  } catch {
    // ignore
  }
  // Some SEB versions expose window.SEB or window.configKey
  const win = window as any
  if (!configKeyHash && win.SEB?.configKeyHash) {
    configKeyHash = win.SEB.configKeyHash
  }
  if (!configKeyHash && win.configKey) {
    configKeyHash = win.configKey
  }
  return { detected: hasSebUa || !!configKeyHash, configKeyHash }
}

/**
 * Fire-and-forget focus-loss recorder for use inside `visibilitychange`
 * (pagehide / tab switch).
 *
 * `fetch()` biasa akan DIBATALKAN oleh browser saat tab menjadi hidden/sedang
 * di-unload, jadi event tab-switch sering tidak pernah sampai ke server —
 * itulah sebabnya kolom "Tab Switches" di halaman Monitoring tampak kosong
 * padahal notifikasi di sisi siswa sudah muncul. `navigator.sendBeacon()`
 * dijamin tetap terkirim (tanpa menunggu respons), dengan `fetch(...,
 * keepalive)` sebagai fallback bila beacon tidak tersedia. Keduanya
 * mengembalikan nilainya secara sinkron sehingga bisa dipanggil langsung dari
 * event handler.
 *
 * @returns `true` bila percobaan pengiriman sudah dijadwalkan browser.
 */
function postFocusLossWithBeacon(sessionId: string): boolean {
  const url = apiUrl("/api/monitoring/focus-loss")
  // Build 139: `sendBeacon` tidak bisa membawa header Authorization, dan
  // endpoint kini meminta bukti kepemilikan — token login ikut di body
  // (diresolusi server via `callerFromRequest` fallback `body.sessionToken`).
  const payload = JSON.stringify({
    sessionId,
    reason: "visibilitychange",
    sessionToken: getAuthToken() ?? undefined,
  })
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(
        url,
        new Blob([payload], { type: "application/json" }),
      )
      if (sent) return true
    }
  } catch {
    /* Blob/beacon unsupported — fall through to the keepalive fetch below. */
  }
  try {
    const token = getAuthToken()
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
    }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

export default function ExamTakingPage() {
  const { t, lang } = useI18n()
  const { examId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const studentId = user?.id ?? ""

  const [view, setView] = useState<ViewMode>("loading")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [exam, setExam] = useState<any>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [sebDetected, setSebDetected] = useState(false)
  const [sebBlocked, setSebBlocked] = useState(false)
  const [sebBlockMessage, setSebBlockMessage] = useState<string | null>(null)
  // Mobile-only slide-over for the question navigator (the 224px sidebar
  // would leave almost no room for the question on a phone screen).
  const [navOpen, setNavOpen] = useState(false)
  const [tabSwitches, setTabSwitches] = useState(0)
  const [saveState, setSaveState] =
    useState<"idle" | "saving" | "saved" | "offline">("idle")
  const [copyAttempted, setCopyAttempted] = useState(false)
  const [results, setResults] = useState<ExamResultsRow | null>(null)
  const online = useOnlineStatus()
  const { canInstall, promptInstall } = usePwaInstall()
  // Focus-loss (tab switch / keluar fullscreen) recorder.
  //
  // Event-nya harus dicatat secara SINYAL-SINKRON (satu-satunya cara `navigator.sendBeacon`
  // dapat bekerja saat tab disembunyikan), jadi pause/flush di bawah memakai ref — bukan
  // state — agar handler `visibilitychange` selalu membaca nilai terbaru.
  //
  // `focusLossPending` menyimpan berapa kejadian yang belum terkirim; `focusLossInFlight`
  // menandai ada request POST yang sedang berjalan. Keduanya dipisah supaya percobaan
  // yang gagal tidak pernah hilang (dulu `recordLoss()` di-skip total ketika ada request
  // berjalan, sehingga tab-switch saat "in flight" hilang dari DB) sementara visual
  // "→ 0" tepat setelah submit tetap dijaga (dulu respons POST yang datang setelah
  // submit menurunkan hitungan kembali ke 0).
  const focusLossPending = useRef(0)
  const focusLossInFlight = useRef(false)
  const focusLossPaused = useRef(false)
  const saveTimer = useRef<number | null>(null)
  // Cleanup pending save-indicator timeout on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [])
  // Latest handleSubmit — assigned after its useCallback declaration so the
  // countdown timer above never calls a stale closure.
  const handleSubmitRef = useRef((auto = false) => {})
  // ── Server-authoritative deadline (build 138) ──────────────────────────
  // Server menghitung deadline dari started_at + duration + extra_time.
  // Klien memakainya sebagai sumber hitungan mundur agar rekayasa timer lokal
  // tidak berguna, dan koreksi `clockOffset` menetralkan selisih jam perangkat.
  const deadlineRef = useRef<number | null>(null)
  const clockOffsetRef = useRef(0)
  const [timeUpNotice, setTimeUpNotice] = useState<string | null>(null)

  /**
   * Sinkronkan countdown ke `expiresAt` (timestamp absolut versi server).
   * `serverTime` hanya ada di respons load/start — dari situ diukur selisih
   * jam perangkat; respons saveAnswer cukup mengirim expiresAt sehingga
   * offset yang sudah terukur tidak boleh ditimpa. Return true bila sinkron.
   */
  const applyServerDeadline = useCallback(
    (expiresAt?: string | null, serverTime?: string | null) => {
      const expiry = expiresAt ? new Date(expiresAt).getTime() : NaN
      if (!Number.isFinite(expiry)) return false
      if (serverTime) {
        const serverNow = new Date(serverTime).getTime()
        if (Number.isFinite(serverNow)) clockOffsetRef.current = serverNow - Date.now()
      }
      deadlineRef.current = expiry
      const remaining = Math.ceil(
        (expiry - (Date.now() + clockOffsetRef.current)) / 1000,
      )
      setTimeLeft(Math.max(0, remaining))
      return true
    },
    [],
  )

  /** Server menutup sesi karena waktu habis: buang antrean offline, langsung ke hasil. */
  const handleServerTimeUp = useCallback(
    (message?: string) => {
      if (sessionId) {
        try {
          localStorage.removeItem(`smartcbt:pending-answers:${sessionId}`)
        } catch {
          /* storage unavailable */
        }
      }
      setTimeLeft(0)
      setSaveState("idle")
      setTimeUpNotice(
        message || "Waktu ujian sudah habis — sesi ditutup oleh server.",
      )
      setTimeout(() => handleSubmitRef.current(true), 0)
    },
    [sessionId],
  )
  useEffect(() => {
    if (!examId || !studentId) {
      setErrorMsg(t("Missing exam or student ID"))
      setView("error")
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data: ExamTakingData = await fetchExamForStudent(
          examId,
          studentId,
        )
        if (cancelled) return
        // Seeded shuffle: honours exam.randomize_questions / randomize_options.
        // Order is stable per student (NIS seed) so resume/refresh keeps the
        // same layout and restored answers still match their questions.
        const seedBase =
          data.exam?.student_number || studentId || examId || "smartcbt"
        let mappedQs: Question[] = data.questions.map(mapDbQuestion)
        if (data.exam?.randomize_questions) {
          mappedQs = seededShuffle(mappedQs, `q:${seedBase}`)
        }
        if (data.exam?.randomize_options) {
          mappedQs = mappedQs.map((mq) => ({
            ...mq,
            choices: mq.choices
              ? seededShuffle(mq.choices, `c:${seedBase}:${mq.id}`)
              : mq.choices,
            rightOptions: mq.rightOptions
              ? seededShuffle(mq.rightOptions, `r:${seedBase}:${mq.id}`)
              : mq.rightOptions,
          }))
        }
        setExam(data.exam)
        setQuestions(mappedQs)
        let sid: string | null = data.sessionId ?? null
        let startRes: Awaited<ReturnType<typeof startSession>> | null = null
        if (!sid) {
          // Exams with an entry token: re-send the already-verified token (the
          // server re-verifies it in POST /api/sessions/start).
          const entryToken = data.exam?.is_token_active
            ? (sessionStorage.getItem(`smartcbt_token_${examId}`) ?? undefined)
            : undefined
          const sebInfo = detectSeb()
          setSebDetected(sebInfo.detected)
          startRes = await startSession(examId, studentId, entryToken, {
            deviceId: getDeviceId(),
            seb: sebInfo.detected,
            configKeyHash: sebInfo.configKeyHash ?? undefined,
          })
          sid = startRes.session?.id ?? null
          if (entryToken) sessionStorage.removeItem(`smartcbt_token_${examId}`)
        }
        setSessionId(sid)
        if (cancelled) return
        const restored: Record<string, AnswerValue> = {}
        const restoredFlagged = new Set<string>()
        for (const q of mappedQs) {
          const existing = data.existingAnswers?.[q.id]
          if (existing) {
            const val = restoreAnswer(q, existing)
            if (val !== undefined) restored[q.id] = val
            if (existing.is_flagged) restoredFlagged.add(q.id)
          }
        }
        setAnswers(restored)
        setFlagged(restoredFlagged)
        // Hitungan mundur dari deadline SERVER (build 138) — untuk sesi lama
        // lewat `data.expiresAt`, untuk sesi baru lewat respons start. Formula
        // lokal hanya fallback bila server belum bisa menghitung (mis.
        // started_at kosong atau ujian tanpa durasi).
        const extraMin = Number(data.extraTimeMinutes) || 0
        if (
          !applyServerDeadline(data.expiresAt, data.serverTime) &&
          !applyServerDeadline(startRes?.expiresAt, startRes?.serverTime)
        ) {
          setTimeLeft(data.exam.duration_minutes * 60 + extraMin * 60)
        }
        setView("taking")
      } catch (err: any) {
        console.error(err)
        setErrorMsg(err.message || t("Failed to load exam"))
        setView("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [examId, studentId])

  useEffect(() => {
    if (view !== "taking") return
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        // Build 138: dengan deadline server hitungan ULANG dari jam (bukan
        // minus 1 per tick) — setInterval di tab background ter-throttle
        // sehingga timer decrement bisa tertinggal jauh dari waktu nyata.
        const next =
          deadlineRef.current !== null
            ? Math.ceil(
                (deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000,
              )
            : t - 1
        if (next <= 0) {
          clearInterval(timer)
          // Defer so handleSubmit (declared below) is always the latest closure.
          setTimeout(() => handleSubmitRef.current(true), 0)
          return 0
        }
        return next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [view])

  // SEB enforcement: periodically verify SEB is still active during the exam.
  // If `seb_required` is true and SEB is no longer detected, block the exam.
  useEffect(() => {
    if (view !== "taking" || !sessionId || !exam) return
    if (!exam.seb_required) return

    let cancelled = false

    const checkSeb = async () => {
      try {
        const sebInfo = detectSeb()
        const result = await enforceSeb({
          sessionId,
          seb: sebInfo.detected,
          configKeyHash: sebInfo.configKeyHash ?? undefined,
        })
        if (cancelled) return
        if (!result.enforced) {
          setSebBlocked(true)
          setSebBlockMessage(
            result.error || "SEB tidak terdeteksi. Ujian diblokir.",
          )
        } else {
          setSebBlocked(false)
          setSebBlockMessage(null)
          setSebDetected(result.sebDetected ?? false)
        }
      } catch {
        if (cancelled) return
        // If enforce endpoint returns 403, block the exam
        setSebBlocked(true)
        setSebBlockMessage(
          "Safe Exam Browser (SEB) wajib digunakan. Buka ujian melalui aplikasi SEB.",
        )
      }
    }

    // Check immediately on mount, then every 15 seconds
    checkSeb()
    const interval = setInterval(checkSeb, 15000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [view, sessionId, exam])

  const [kioskGrace, setKioskGrace] = useState(false)
  const kioskGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kioskWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showKioskWarning, setShowKioskWarning] = useState(false)

  // ── Anti-cheat policy & violation tracking ─────────────────────────────
  // The policy comes from the exam (strict mode) and the device capability;
  // the tracker is a plain class instance (not React state) so it can be
  // driven from unload-prone event handlers.
  const antiCheatPolicy = useMemo<AntiCheatPolicy>(
    () =>
      buildPolicy({
        strict: !!exam?.anticheat_strict,
        fullscreenSupported: fullscreenSupported(),
      }),
    [exam?.anticheat_strict],
  )
  const violationsRef = useRef<ViolationTracker | null>(null)
  if (violationsRef.current === null) {
    violationsRef.current = new ViolationTracker(antiCheatPolicy)
  }
  // Keep the policy in sync when the exam payload arrives after first render.
  violationsRef.current.rules !== antiCheatPolicy &&
    (violationsRef.current = new ViolationTracker(antiCheatPolicy))

  const [violationCount, setViolationCount] = useState(0)
  const [lastViolation, setLastViolation] = useState<ViolationKind | null>(null)
  const [lockedOut, setLockedOut] = useState(false)
  // Kiosk gate: the exam body is not rendered until the student is in
  // fullscreen (only when the browser supports it and the policy requires it).
  const [gateAccepted, setGateAccepted] = useState(false)
  const [gateBusy, setGateBusy] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)

  /**
   * Central violation sink.
   *
   * Every detection path funnels through here so counting, server reporting
   * and the auto-submit decision stay consistent. Reads the tracker
   * synchronously (it is a ref, not state) because several callers run inside
   * `visibilitychange` / `pagehide`, where React state updates are unreliable.
   */
  const recordSecurityViolation = useCallback(
    (kind: ViolationKind) => {
      const tracker = violationsRef.current
      if (!tracker) return
      const event = tracker.record(kind)
      // Deduped (same physical action) — nothing to show, nothing to report.
      if (!event) return

      setViolationCount(event.count)
      setLastViolation(event.kind)

      // Tell the server (teacher Live Monitor). Focus-kind events also bump
      // `focus_loss_count`; clipboard/shortcut ones only bump the violation
      // counter. Beacon-first so it survives tab hiding.
      if (sessionId) {
        if (kind === "visibility" || kind === "blur") {
          // `recordLoss()`/`focusLossCore` already owns the tab-switch counter.
        } else if (!reportViolationWithBeacon(sessionId, kind, 1)) {
          void recordViolation(sessionId, kind, 1).catch(() => undefined)
        }
      }

      if (event.severity === "critical") {
        // Hard lock: keep the overlay open (no auto-dismiss) and stop the exam.
        if (kioskWarningTimer.current) clearTimeout(kioskWarningTimer.current)
        setShowKioskWarning(true)
        if (tracker.shouldAutoSubmit()) {
          setLockedOut(true)
          // Give the student a beat to read the reason before submitting.
          window.setTimeout(() => handleSubmitRef.current(true), 1200)
        }
        return
      }

      setShowKioskWarning(true)
      if (kioskWarningTimer.current) clearTimeout(kioskWarningTimer.current)
      kioskWarningTimer.current = setTimeout(() => {
        setShowKioskWarning(false)
      }, 6000)
    },
    [sessionId],
  )

  const handleSecurityViolationAction = useCallback(
    (action: "retry" | "submit" | "cancel") => {
      setShowKioskWarning(false)
      if (kioskWarningTimer.current) clearTimeout(kioskWarningTimer.current)
      if (action === "submit") {
        handleSubmitRef.current(true)
      }
    },
    [],
  )

  /** Kiosk gate: enter fullscreen (and therefore unlock the exam body). */
  const acceptKioskGate = useCallback(async () => {
    setGateBusy(true)
    setGateError(null)
    const ok = await enterFullscreen()
    setGateBusy(false)
    if (ok || !antiCheatPolicy.requireFullscreen) {
      setGateAccepted(true)
    } else {
      setGateError(
        t(
          "Browser menolak masuk mode layar penuh. Izinkan layar penuh untuk browser ini, lalu coba lagi.",
        ),
      )
    }
  }, [antiCheatPolicy.requireFullscreen, t])

  useEffect(() => {
    if (view !== "taking" || !sessionId) return

    // Tab sudah aktif kembali setelah event `hidden` — sisa event yang belum
    // terkirim boleh dikirim lagi via `fetch` biasa (lebih andal + hasilnya
    // bisa dipakai untuk memperbarui angka di UI).
    const flushPending = () => {
      if (focusLossPaused.current) return
      if (focusLossPending.current <= 0 || focusLossInFlight.current) return
      focusLossPending.current -= 1
      focusLossInFlight.current = true
      recordFocusLoss(sessionId)
        .then((result) => setTabSwitches(result.focusLossCount))
        .catch((err) => console.error("Failed to record focus loss:", err))
        .finally(() => {
          focusLossInFlight.current = false
          // Masih ada sisa event? Kirim sekarang juga.
          flushPending()
        })
    }

    /**
     * Catat satu kejadian kehilangan fokus.
     *
     * Prioritas: `sendBeacon` sinkron (satu-satunya yang dapat diandalkan saat
     * tab disembunyikan/masih proses unload — sehingga tidak perlu diberi
     * tenggang waktu) → hitungan lokal + antrean untuk dikirim saat tab aktif
     * kembali. Berbeda dengan implementasi sebelumnya, event TIDAK PERNAH
     * dibuang hanya karena ada request lain yang sedang berjalan — itulah
     * penyebab hitungan di DB (kolom "Tab Switches" halaman Monitoring) lebih
     * kecil / nol dibanding hitungan di UI siswa.
     */
    const recordLoss = () => {
      if (postFocusLossWithBeacon(sessionId)) {
        // Server sudah menaikkan counter-nya sendiri; pantulan respons tidak
        // diperlukan (dan memang tidak tersedia lewat beacon).
        setTabSwitches((count) => count + 1)
        return
      }
      focusLossPending.current += 1
      setTabSwitches((count) => count + 1)
      flushPending()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tahan pengiriman `fetch` selama tab hidden (fetch akan dibatalkan
        // browser); event yang tertahan diantre lalu dikirim saat tab kembali.
        focusLossPaused.current = true
        recordLoss()
      } else {
        focusLossPaused.current = false
        flushPending()
      }
    }

    // Safari/iOS memakai `pagehide` sebagai pengganti `beforeunload`; tab
    // switch di sana kadang tidak memicu `visibilitychange`.
    const handlePageHide = () => recordLoss()

    // Kembalikan fokus ke tab ini juga dihitung sebagai akhir periode hidden.
    const handleWindowFocus = () => {
      focusLossPaused.current = false
      flushPending()
    }

    // Plain function — NOT a hook call. This used to be a `useCallback(...)`
    // inside the effect body, which is an invalid hook call (React error
    // #321 "Invalid hook call") that crashed the page exactly when an exam
    // started (this effect only runs once `view` becomes "taking").
    let lastBlurAt = 0

    const handleFullscreenChange = () => {
      if (!isFullscreen()) {
        recordLoss()
        setKioskGrace(true)
        if (kioskGraceTimer.current) clearTimeout(kioskGraceTimer.current)
        kioskGraceTimer.current = setTimeout(() => setKioskGrace(false), 3000)
        recordSecurityViolation("fullscreen")
        // Best effort: pull the student back into the kiosk.
        if (antiCheatPolicy.autoRefocusFullscreen) {
          setTimeout(() => {
            if (!isFullscreen()) void enterFullscreen()
          }, 500)
        }
      } else {
        setKioskGrace(false)
        if (kioskGraceTimer.current) {
          clearTimeout(kioskGraceTimer.current)
          kioskGraceTimer.current = null
        }
      }
    }

    /**
     * Leaving the window (another app / window takes focus). Not fatal on its
     * own, but counted so a pattern of app switching is visible to the teacher.
     * Ignored while the tab is already hidden — `visibilitychange` covers that
     * case and would otherwise double-count.
     */
    const handleWindowBlur = () => {
      if (document.visibilityState === "hidden") return
      const now = Date.now()
      if (now - lastBlurAt < 700) return
      lastBlurAt = now
      recordSecurityViolation("blur")
    }

    // Blocked keystrokes (copy/paste, print, devtools, F11, PrintScreen, …).
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isBlockedShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      setCopyAttempted(true)
      setTimeout(() => setCopyAttempted(false), 2000)
      recordSecurityViolation("shortcut")
    }

    // Prevent dropping dragged content into answer fields (essay questions).
    const handleDrop = (e: Event) => {
      e.preventDefault()
      recordSecurityViolation("clipboard")
    }

    const handleDragStart = (e: Event) => {
      e.preventDefault()
      recordSecurityViolation("clipboard")
    }

    // Anti-copy-paste protection for exam area
    const handleCopy = (e: Event) => {
      e.preventDefault()
      setCopyAttempted(true)
      setTimeout(() => setCopyAttempted(false), 2000)
      recordSecurityViolation("clipboard")
    }

    const handleCut = (e: Event) => {
      e.preventDefault()
      setCopyAttempted(true)
      setTimeout(() => setCopyAttempted(false), 2000)
      recordSecurityViolation("clipboard")
    }

    const handlePaste = (e: Event) => {
      e.preventDefault()
      setCopyAttempted(true)
      setTimeout(() => setCopyAttempted(false), 2000)
      recordSecurityViolation("clipboard")
    }

    const handleContextMenu = (e: Event) => {
      e.preventDefault()
      setCopyAttempted(true)
      setTimeout(() => setCopyAttempted(false), 2000)
      recordSecurityViolation("clipboard")
    }

    const handleSelectStart = (e: Event) => {
      if ((e.target as HTMLElement).tagName !== "TEXTAREA") {
        e.preventDefault()
        setCopyAttempted(true)
        setTimeout(() => setCopyAttempted(false), 2000)
        recordSecurityViolation("clipboard")
      }
    }


    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pagehide", handlePageHide)
    window.addEventListener("focus", handleWindowFocus)
    window.addEventListener("blur", handleWindowBlur)
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
    document.addEventListener("copy", handleCopy)
    document.addEventListener("cut", handleCut)
    document.addEventListener("paste", handlePaste)
    document.addEventListener("contextmenu", handleContextMenu)
    document.addEventListener("selectstart", handleSelectStart)
    document.addEventListener("dragstart", handleDragStart)
    document.addEventListener("drop", handleDrop)
    document.addEventListener("keydown", handleKeyDown, true)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pagehide", handlePageHide)
      window.removeEventListener("focus", handleWindowFocus)
      window.removeEventListener("blur", handleWindowBlur)
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
      document.removeEventListener("copy", handleCopy)
      document.removeEventListener("cut", handleCut)
      document.removeEventListener("paste", handlePaste)
      document.removeEventListener("contextmenu", handleContextMenu)
      document.removeEventListener("selectstart", handleSelectStart)
      document.removeEventListener("dragstart", handleDragStart)
      document.removeEventListener("drop", handleDrop)
      document.removeEventListener("keydown", handleKeyDown, true)
      if (kioskGraceTimer.current) clearTimeout(kioskGraceTimer.current)
      if (kioskWarningTimer.current) clearTimeout(kioskWarningTimer.current)
    }
  }, [view, sessionId, recordSecurityViolation, antiCheatPolicy.autoRefocusFullscreen])

  const answeredCount = questions.filter(
    (q) => answers[q.id] !== undefined && answers[q.id] !== null,
  ).length

  const setAnswer = useCallback(
    async (qId: string, val: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [qId]: val }))
      const q = questions.find((q) => q.id === qId)
      if (q && sessionId) {
        const { response } = buildResponse(q, val)
        if (!navigator.onLine) {
          // Queue offline — autosave resumes when the connection returns.
          try {
            const key = `smartcbt:pending-answers:${sessionId}`
            const pending = JSON.parse(localStorage.getItem(key) ?? "{}")
            pending[qId] = response
            localStorage.setItem(key, JSON.stringify(pending))
          } catch {
            /* storage full — ignore, server still has last state */
          }
          setSaveState("offline")
          return
        }
        setSaveState("saving")
        try {
          // Only the raw response is sent — the server authoritatively computes
          // correctness & score (client-sent scores would be ignored anyway).
          const saveRes = await saveAnswer(sessionId, qId, response)
          // Echo deadline server → timer ikut extra time yang baru diberikan
          // guru tanpa perlu reload.
          applyServerDeadline(saveRes?.expiresAt)
          setSaveState("saved")
          if (saveTimer.current) window.clearTimeout(saveTimer.current)
          saveTimer.current = window.setTimeout(
            () => setSaveState((s) => (s === "saved" ? "idle" : s)),
            2000,
          )
        } catch (err: any) {
          console.error("Failed to save answer:", err)
          if (err?.status === 409 && err?.payload?.code === "SESSION_EXPIRED") {
            // Build 138: server menutup sesi (waktu habis + grace terlewat).
            handleServerTimeUp(err?.payload?.error)
            return
          }
          setSaveState("offline")
        }
      }
    },
    [questions, sessionId],
  )

  // Flush queued offline answers once connectivity returns.
  useEffect(() => {
    if (!online || !sessionId || view !== "taking") return
    const key = `smartcbt:pending-answers:${sessionId}`
    let pending: Record<string, any> = {}
    try {
      pending = JSON.parse(localStorage.getItem(key) ?? "{}")
    } catch {
      return
    }
    const ids = Object.keys(pending)
    if (ids.length === 0) return
    ;(async () => {
      setSaveState("saving")
      for (const qId of ids) {
        try {
          const saveRes = await saveAnswer(sessionId, qId, pending[qId])
          applyServerDeadline(saveRes?.expiresAt)
          delete pending[qId]
        } catch (err: any) {
          if (err?.status === 409 && err?.payload?.code === "SESSION_EXPIRED") {
            // Waktu sudah lewat selama offline — antrean tidak akan pernah
            // diterima lagi; buang lalu serahkan ke alhasil waktu-habis.
            try {
              localStorage.removeItem(key)
            } catch {
              /* ignore */
            }
            handleServerTimeUp(err?.payload?.error)
            return
          }
          break
        }
      }
      try {
        if (Object.keys(pending).length === 0) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(pending))
      } catch {
        /* ignore */
      }
      setSaveState(Object.keys(pending).length === 0 ? "saved" : "offline")
    })()
  }, [online, sessionId, view])

  const toggleFlag = useCallback((qId: string) => {
    setFlagged((prev) => {
      const next = new Set(prev)
      next.has(qId) ? next.delete(qId) : next.add(qId)
      return next
    })
  }, [])

  const getQuestionStatus = (q: Question) => {
    if (flagged.has(q.id)) return "flagged"
    if (answers[q.id] !== undefined && answers[q.id] !== null) return "answered"
    return "unanswered"
  }

  const statusColor = {
    answered: { bg: C.brand.main, text: "#FFFFFF" },
    flagged: { bg: C.warn.main, text: "#FFFFFF" },
    unanswered: { bg: C.base.surfaceSoft, text: C.base.textMuted },
    current: { bg: C.base.dark, text: "#FFFFFF" },
  }

  const handleSubmit = useCallback(
    async (auto = false) => {
      setShowSubmitModal(false)
      setView("submitting")
      try {
        if (sessionId) {
          // Flush any answers queued while offline before submitting.
          const key = `smartcbt:pending-answers:${sessionId}`
          try {
            const pending = JSON.parse(localStorage.getItem(key) ?? "{}")
            for (const qId of Object.keys(pending)) {
              try {
                await saveAnswer(sessionId, qId, pending[qId])
              } catch {
                /* keep queued */ break
              }
              delete pending[qId]
            }
            if (Object.keys(pending).length === 0) localStorage.removeItem(key)
            else localStorage.setItem(key, JSON.stringify(pending))
          } catch {
            /* storage unavailable — submit with server state */
          }
          await submitSession(sessionId)
          // Tandai "selesai" SEBELUM POST focus-loss terakhir resolve, supaya
          // respons yang datang telat tidak menurunkan lagi hitungan di UI
          // (server sudah mengembalikan 409 untuk sesi completed sehingga tidak
          // ada kejadian baru yang tercatat). Sisa antrean dibuang karena
          // server menolak update setelah submit — angkanya sudah tersimpan.
          focusLossPaused.current = true
          focusLossPending.current = 0
          setTabSwitches(0)
          const res = await fetchExamResults(sessionId)
          setResults(res)
        }
        setView("result")
      } catch (err: any) {
        console.error(err)
        setView("result")
      }
    },
    [sessionId],
  )

  useEffect(() => {
    handleSubmitRef.current = handleSubmit
  }, [handleSubmit])

  if (view === "loading") {
    return (
      <div
        className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4"
        style={{ background: C.base.page }}
      >
        <div className="text-center flex flex-col items-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: C.brand.bg, color: C.brand.dark, boxShadow: S.card }}
          >
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <p className="font-medium" style={{ color: C.base.textMuted }}>{t("Loading exam…")}</p>
          <p className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
            {t("Preparing questions & session")}
          </p>
        </div>
      </div>
    )
  }

  if (view === "error") {
    return (
      <div
        className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4"
        style={{ background: C.base.page }}
      >
        <div
          className="cbt-card text-center max-w-md w-full rounded-2xl p-6"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.elevated }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: C.danger.bg, color: C.danger.text }}
            aria-hidden
          >
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Unable to Load Exam")}
          </h2>
          <p className="text-sm break-words" style={{ color: C.base.textMuted }}>
            {errorMsg}
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 mt-5">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-semibold min-h-[48px] sm:min-h-0"
              style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
            >
              {t("Coba lagi")}
            </button>
            <button
              onClick={() => navigate("/student/dashboard")}
              className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-medium min-h-[48px] sm:min-h-0 cbt-row-hover"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textBody, background: C.base.surface }}
            >
              {t("Return to Dashboard")}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (view === "submitting") {
    return (
      <div
        className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4"
        style={{ background: C.base.page }}
      >
        <div className="text-center flex flex-col items-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: C.ok.bg, color: C.ok.dark, boxShadow: S.card }}
            aria-hidden
          >
            <Send className="w-6 h-6 animate-pulse" />
          </div>
          <p className="font-semibold" style={{ color: C.base.text }}>
            {t("Submitting exam…")}
          </p>
          <p className="text-xs mt-1" style={{ color: C.base.textFaint }}>
            {t("Please wait — do not close this page")}
          </p>
        </div>
      </div>
    )
  }

  if (view === "result") {
    const totalScore = results?.total_score ?? 0
    const maxScore = questions.reduce((sum, q) => sum + q.points, 0)
    const pct = maxScore > 0 ? (Number(totalScore) / maxScore) * 100 : 0
    return (
      <div
        className="min-h-screen min-h-[100dvh] flex items-center justify-center safe-area-top safe-area-bottom"
        style={{ background: C.base.page }}
      >
        <div className="max-w-md w-full text-center px-4 py-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: C.ok.bg, color: C.ok.main, boxShadow: S.card }}
            aria-hidden
          >
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {t("Exam Submitted!")}
          </h1>
          {timeUpNotice && (
            <div
              className="mb-4 rounded-xl px-3.5 py-2.5 text-xs font-semibold inline-flex items-center gap-1.5"
              style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>{timeUpNotice}</span>
            </div>
          )}
          <p className="text-sm mb-6 tabular-nums" style={{ color: C.base.textMuted }}>
            {exam?.title} · {answeredCount}/{questions.length}{" "}
            {t("questions answered")}
          </p>
          <div
            className="cbt-card rounded-2xl p-6 mb-6"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="text-xs uppercase tracking-wide font-semibold mb-1" style={{ color: C.base.textFaint }}>
              {t("Objective Score")}
            </div>
            <div
              className="text-6xl font-bold mb-1 tabular-nums"
              style={{ color: C.brand.dark, fontFamily: "var(--font-serif)" }}
            >
              {Number(totalScore).toFixed(2)}
            </div>
            <div className="text-sm tabular-nums" style={{ color: C.base.textMuted }}>
              / {maxScore} ({pct.toFixed(1)}%)
            </div>
            {results?.grade_status === "pending_essay_grading" && (
              <div className="text-xs mt-2 font-medium" style={{ color: C.warn.dark }}>
                {t("Essay responses pending manual grading")}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate("/student/dashboard")}
            className="w-full py-3.5 sm:py-3 rounded-xl text-sm font-semibold hover:opacity-90 min-h-[52px] active:scale-[0.99]"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            {t("Return to Dashboard")}
          </button>
        </div>
      </div>
    )
  }

  // ── Kiosk gate ─────────────────────────────────────────────────────────
  if (view === "taking" && antiCheatPolicy.requireFullscreen && !gateAccepted) {
    return (
      <div
        className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4"
        style={{ background: C.base.dark }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-6 text-center"
          style={{ background: "#132942", border: "1px solid #1E3A5F", boxShadow: S.elevated }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(59,130,246,0.18)", color: "#93C5FD" }}
            aria-hidden
          >
            <Lock className="w-7 h-7" />
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}
          >
            {t("Mode Ujian Layar Penuh")}
          </h2>
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            {t(
              "Ujian ini berjalan dalam mode layar penuh. Keluar dari layar penuh akan dicatat sebagai pelanggaran.",
            )}
          </p>
          <ul
            className="text-xs text-left mb-5 space-y-1.5 pl-1"
            style={{ color: "#CBD5E1" }}
          >
            <li>• {t("Copy, paste, dan menu klik-kanan dinonaktifkan")}</li>
            <li>
              •{" "}
              {t("Berpindah tab atau aplikasi akan tercatat oleh pengawas")}
            </li>
            <li>
              •{" "}
              {t(
                "Setelah {n} pelanggaran, ujian otomatis dikumpulkan",
                { n: antiCheatPolicy.maxViolations },
              )}
            </li>
          </ul>
          {gateError && (
            <p className="text-xs mb-3" style={{ color: "#FCD34D" }}>
              {gateError}
            </p>
          )}
          <button
            onClick={acceptKioskGate}
            disabled={gateBusy}
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold min-h-[52px] active:scale-[0.99] disabled:opacity-60"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            <Maximize2 className="w-4 h-4" />
            {gateBusy ? t("Memasuki mode ujian…") : t("Mulai Ujian")}
          </button>
          <button
            onClick={() => navigate("/student/dashboard")}
            className="mt-3 text-xs min-h-[40px] px-3"
            style={{ color: "#94a3b8" }}
          >
            {t("Return to Dashboard")}
          </button>
        </div>
      </div>
    )
  }

  const q = questions[currentQ]
  const locale = lang === "en" ? "en-US" : "id-ID"
  const examDateLabel = exam?.start_time
    ? new Date(exam.start_time).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null

  const violationKind = lastViolation
  const kioskWarningTitle = violationKind
    ? t(VIOLATION_TITLE_KEY[violationKind])
    : t("Exit Fullscreen Warning")
  const kioskWarningCaption = violationKind
    ? violationKind === "fullscreen"
      ? t("Kemunculan Out-of-Focus / Fullscreen Ke {n}", {
          n: violationCount,
        })
      : t("Pelanggaran ke-{n} dari {max}", {
          n: violationCount,
          max: antiCheatPolicy.maxViolations || "∞",
        })
    : t("Pencobaan Copy/Paste Terblokir")
  // The overlay turns hard-locked (red, no dismiss) once the policy limit is
  // hit — it is no longer a dismissible warning.
  const warningIsHardLock = lockedOut
  const warningNeedsFullscreen = violationKind === "fullscreen" && !warningIsHardLock

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: C.base.page, fontFamily: "var(--font-sans)" }}
    >
      {showKioskWarning && (
        <div className="absolute z-50 inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="mx-4 w-full max-w-sm rounded-2xl p-5 text-center shadow-2xl pointer-events-auto animate-in fade-in duration-200"
            style={{
              background: warningIsHardLock
                ? "#7F1D1D"
                : warningNeedsFullscreen
                  ? "#7F1D1D"
                  : "#1E3A8A",
              color: "#FFFFFF",
              border: warningIsHardLock ? "2px solid #FCA5A5" : undefined,
            }}
          >
            <div className="flex justify-center mb-3" aria-hidden>
              {warningIsHardLock ? (
                <Ban className="w-10 h-10" />
              ) : warningNeedsFullscreen ? (
                <Lock className="w-10 h-10" />
              ) : (
                <AlertTriangle className="w-10 h-10" />
              )}
            </div>
            <h3
              className="text-xl font-bold mb-2"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {kioskWarningTitle}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: "rgba(255,255,255,0.9)" }}
            >
              {kioskWarningCaption}
            </p>
            <p
              className="text-xs mb-5"
              style={{ color: "rgba(255,255,255,0.78)" }}
            >
              {warningIsHardLock
                ? t(
                    "Batas pelanggaran tercapai. Ujian Anda dikumpulkan otomatis.",
                  )
                : violationKind
                  ? t(VIOLATION_DETAIL_KEY[violationKind])
                  : t(
                      "Ujian dikunci. Submit ujian atau tutup peringatan untuk melanjutkan.",
                    )}
            </p>
            <div className="flex gap-2">
              {warningNeedsFullscreen && (
                <button
                  onClick={() => {
                    void enterFullscreen().then((ok) => {
                      if (ok) setShowKioskWarning(false)
                    })
                  }}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold min-h-[48px] active:scale-[0.98]"
                  style={{ background: "#FCD34D", color: "#7C2D12" }}
                >
                  {t("Enter Fullscreen")}
                </button>
              )}
              <button
                onClick={() => handleSecurityViolationAction("submit")}
                className="flex-1 py-3 rounded-xl text-sm font-semibold hover:opacity-90 min-h-[48px] active:scale-[0.98]"
                style={{ background: "#FEE2E2", color: "#7F1D1D" }}
              >
                {t("Submit & Exit")}
              </button>
            </div>
            <p
              className="text-[11px] mt-3 tabular-nums"
              style={{ color: "rgba(255,255,255,0.65)" }}
            >
              {t("Pelanggaran: {n} / {max}", {
                n: violationCount,
                max: antiCheatPolicy.maxViolations || "∞",
              })}
            </p>
          </div>
        </div>
      )}

      {/* Top bar — compact on mobile, full info on desktop */}
      <div className="shrink-0 safe-area-top" style={{ background: C.base.dark, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div
          className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2"
          style={{ minHeight: 56 }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              onClick={() => setNavOpen(true)}
              className="md:hidden w-11 h-11 rounded-xl flex items-center justify-center shrink-0 active:scale-95"
              style={{ background: C.base.darkSoft, color: C.base.textOnDark }}
              aria-label={t("Questions")}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: C.brand.main, color: "#FFFFFF" }}
              aria-hidden
            >
              SE
            </div>
            <div className="min-w-0">
              <div
                className="text-sm font-semibold truncate"
                style={{ color: C.base.textOnDark }}
              >
                {exam?.title ?? "Loading…"}
              </div>
              <div
                className="text-[11px] sm:text-xs truncate"
                style={{ color: "#94a3b8" }}
              >
                {exam?.subject_name ?? ""}
                {examDateLabel ? ` · ${examDateLabel}` : ""} · NIS{" "}
                {exam?.student_number ?? ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!sebDetected && (
              <div
                className="hidden lg:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "#FEF3C7", color: "#92400E" }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {t("SEB not detected — Demo Mode")}
              </div>
            )}
            {tabSwitches > 0 && (
              <div
                className="inline-flex items-center gap-1 text-[11px] sm:text-xs px-2 py-1.5 rounded-lg tabular-nums font-semibold"
                style={{ background: "#FEE2E2", color: "#DC2626" }}
                title={t("{n} tab switch(es)", { n: tabSwitches })}
              >
                <Flag className="w-3 h-3" />
                {tabSwitches}
              </div>
            )}
            {/* Autosave / connectivity indicator */}
            <div
              className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg"
              style={{
                background:
                  !online || saveState === "offline"
                    ? "#FEF3C7"
                    : saveState === "saving"
                      ? "#EFF6FF"
                      : "#ECFDF5",
                color:
                  !online || saveState === "offline"
                    ? "#92400E"
                    : saveState === "saving"
                      ? "#1D4ED8"
                      : "#047857",
              }}
              title={t("Autosave status")}
            >
              {!online || saveState === "offline" ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  {t("Offline — queued")}
                </>
              ) : saveState === "saving" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("Saving…")}
                </>
              ) : saveState === "saved" ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t("Saved")}
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t("Auto-save")}
                </>
              )}
            </div>
            <div
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl"
              role="timer"
              aria-live="off"
              style={{
                background:
                  timeLeft < 300
                    ? "#FEE2E2"
                    : timeLeft < 900
                      ? "#FEF3C7"
                      : C.base.darkSoft,
                color:
                  timeLeft < 300
                    ? "#DC2626"
                    : timeLeft < 900
                      ? "#D97706"
                      : C.base.textOnDark,
              }}
            >
              <Clock className="w-4 h-4 shrink-0" aria-hidden />
              <span
                className="text-sm sm:text-base font-bold tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </div>
        {/* Offline strip (mobile) */}
        {!online && (
          <div
            className="sm:hidden px-3 pb-2 text-[11px] flex items-center gap-1.5"
            style={{ color: "#FCD34D" }}
            role="alert"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            {t("Offline — answers are queued and will sync automatically")}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Question navigator — desktop sidebar */}
        <div
          className="hidden md:flex w-60 shrink-0 flex-col border-r overflow-y-auto p-3.5"
          style={{ background: C.base.surface, borderColor: C.base.border }}
        >
          <div
            className="text-xs font-semibold uppercase tracking-wide mb-3 px-1"
            style={{ color: C.base.textFaint }}
          >
            {t("Questions")}
          </div>
          <div className="grid grid-cols-4 gap-1.5 mb-4">
            {questions.map((qq, i) => {
              const status = i === currentQ ? "current" : getQuestionStatus(qq)
              return (
                <button
                  key={qq.id}
                  onClick={() => setCurrentQ(i)}
                  className="w-full aspect-square rounded-lg flex items-center justify-center text-xs font-bold transition-all hover:scale-105 min-h-[38px] tabular-nums"
                  style={{
                    background: statusColor[status].bg,
                    color: statusColor[status].text,
                    boxShadow: i === currentQ ? S.control : undefined,
                  }}
                >
                  {flagged.has(qq.id) && i !== currentQ ? (
                    <Flag className="w-3.5 h-3.5" />
                  ) : (
                    i + 1
                  )}
                </button>
              )
            })}
          </div>
          <div className="space-y-1.5 text-xs">
            {[
              {
                label: t("Answered"),
                count: answeredCount,
                bg: C.brand.bg,
                text: C.brand.dark,
              },
              {
                label: t("Flagged"),
                count: flagged.size,
                bg: C.warn.bg,
                text: C.warn.dark,
              },
              {
                label: t("Not answered"),
                count: questions.length - answeredCount,
                bg: C.base.surfaceSoft,
                text: C.base.textMuted,
              },
            ].map((s) => (
              <div
                key={s.label}
                className="flex justify-between px-2.5 py-1.5 rounded-lg tabular-nums"
                style={{ background: s.bg }}
              >
                <span style={{ color: s.text }}>{s.label}</span>
                <span className="font-bold" style={{ color: s.text }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
          <div
            className="mt-4 pt-3 border-t"
            style={{ borderColor: C.base.borderLight }}
          >
            <div className="text-xs mb-2" style={{ color: C.base.textFaint }}>
              {t("Randomization")}
            </div>
            <div
              className="flex items-start gap-1.5 text-xs px-2.5 py-2 rounded-lg"
              style={{ background: C.purple.bg, color: C.purple.dark }}
            >
              <Shuffle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {t("Seeded by NIS {nis} — unique order per student", {
                  nis: exam?.student_number ?? "",
                })}
              </span>
            </div>
          </div>
          {canInstall && (
            <button
              onClick={promptInstall}
              className="mt-4 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold hover:opacity-90 active:scale-[0.98]"
              style={{ background: C.base.dark, color: "#FFFFFF", boxShadow: S.control }}
            >
              <Smartphone className="w-3.5 h-3.5" />
              {t("Install App")}
            </button>
          )}
        </div>

        {/* Mobile navigator drawer */}
        {navOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            role="dialog"
            aria-label={t("Questions")}
          >
            <div
              className="absolute inset-0"
              style={{ background: S.overlay }}
              onClick={() => setNavOpen(false)}
            />
            <div
              className="absolute inset-y-0 left-0 w-[85vw] max-w-[320px] flex flex-col overflow-y-auto p-4 safe-area-top safe-area-bottom"
              style={{
                background: C.base.surface,
                boxShadow: S.elevated,
                borderRight: `1px solid ${C.base.border}`,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold tabular-nums" style={{ color: C.base.text }}>
                  {t("Questions")} · {answeredCount}/{questions.length}
                </div>
                <button
                  onClick={() => setNavOpen(false)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: C.base.surfaceSoft, color: C.base.textMuted }}
                  aria-label={t("Close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {questions.map((qq, i) => {
                  const status =
                    i === currentQ ? "current" : getQuestionStatus(qq)
                  return (
                    <button
                      key={qq.id}
                      onClick={() => {
                        setCurrentQ(i)
                        setNavOpen(false)
                      }}
                      className="w-full aspect-square rounded-xl flex items-center justify-center text-sm font-bold min-h-[44px] active:scale-95 tabular-nums"
                      style={{
                        background: statusColor[status].bg,
                        color: statusColor[status].text,
                      }}
                    >
                      {flagged.has(qq.id) && i !== currentQ ? (
                        <Flag className="w-4 h-4" />
                      ) : (
                        i + 1
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="space-y-1.5 text-xs">
                {[
                  {
                    label: t("Answered"),
                    count: answeredCount,
                    bg: C.brand.bg,
                    text: C.brand.dark,
                  },
                  {
                    label: t("Flagged"),
                    count: flagged.size,
                    bg: C.warn.bg,
                    text: C.warn.dark,
                  },
                  {
                    label: t("Not answered"),
                    count: questions.length - answeredCount,
                    bg: C.base.surfaceSoft,
                    text: C.base.textMuted,
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="flex justify-between px-3 py-2.5 rounded-xl tabular-nums"
                    style={{ background: s.bg }}
                  >
                    <span style={{ color: s.text }}>{s.label}</span>
                    <span className="font-bold" style={{ color: s.text }}>
                      {s.count}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="mt-4 w-full py-3.5 rounded-xl text-sm font-semibold min-h-[48px]"
                style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
              >
                {t("Submit Exam →")}
              </button>
            </div>
          </div>
        )}

        {/* Question area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-6">
            <div className="max-w-2xl mx-auto pb-4">
              {/* Question header */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-5">
                <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs sm:text-sm">
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: C.base.text }}
                  >
                    {t("Question {a} of {b}", {
                      a: currentQ + 1,
                      b: questions.length,
                    })}
                  </span>
                  <span style={{ color: C.base.textFaint }}>·</span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: C.ok.dark }}
                  >
                    {t("{p} pts", { p: q.points })}
                  </span>
                  {q.topic && (
                    <>
                      <span style={{ color: C.base.textFaint }}>·</span>
                      <span
                        className="font-medium max-w-[160px] sm:max-w-none truncate"
                        style={{ color: C.brand.dark }}
                      >
                        {q.topic}
                      </span>
                    </>
                  )}
                  {q.type === "essay" && (
                    <>
                      <span style={{ color: C.base.textFaint }}>·</span>
                      <span
                        className="font-medium"
                        style={{ color: C.warn.dark }}
                      >
                        {t("Essay")}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => toggleFlag(q.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl transition-all min-h-[44px]"
                  style={{
                    background: flagged.has(q.id) ? C.warn.bg : C.base.surface,
                    color: flagged.has(q.id) ? C.warn.dark : C.base.textMuted,
                    border: `1px solid ${flagged.has(q.id) ? C.warn.border : C.base.border}`,
                    boxShadow: S.control,
                  }}
                >
                  <Flag className="w-3.5 h-3.5" />
                  {flagged.has(q.id) ? t("Flagged") : t("Flag")}
                </button>
              </div>

              {/* Question text */}
              <div
                className="cbt-card rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  boxShadow: S.card,
                  color: C.base.text,
                }}
              >
                <MathText
                  content={q.text}
                  formula={q.formulaLatex}
                  className="text-sm sm:text-base leading-relaxed"
                />
              </div>

              {/* Attached media (image / audio / video) */}
              {q.mediaType && q.mediaType !== "none" && q.mediaUrl && (
                <div className="mb-4 sm:mb-6">
                  <QuestionMedia mediaType={q.mediaType} mediaUrl={q.mediaUrl} maxHeight={340} />
                </div>
              )}

              {/* Single Choice */}
              {q.type === "single" && q.choices && (
                <div className="space-y-2.5">
                  {q.choices.map((c) => {
                    const isSelected = answers[q.id] === c.key
                    return (
                      <button
                        key={c.key}
                        onClick={() => setAnswer(q.id, c.key)}
                        className="w-full text-left flex items-center gap-3 sm:gap-4 px-3.5 sm:px-4 py-3.5 rounded-2xl transition-all min-h-[54px] active:scale-[0.99]"
                        style={{
                          background: isSelected ? C.brand.bg : C.base.surface,
                          border: `1.5px solid ${isSelected ? C.brand.main : C.base.border}`,
                          boxShadow: isSelected ? S.cardHover : S.control,
                        }}
                      >
                        <div
                          className="w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{
                            background: isSelected ? C.brand.main : C.base.surfaceSoft,
                            color: isSelected ? "#FFFFFF" : C.base.textMuted,
                          }}
                        >
                          {isSelected ? <Check className="w-3.5 h-3.5" /> : c.key}
                        </div>
                        <span
                          className="text-sm sm:text-[15px] break-words min-w-0"
                          style={{
                            color: isSelected ? C.brand.dark : C.base.text,
                            fontFamily: c.text.includes("$")
                              ? "var(--font-mono)"
                              : "inherit",
                          }}
                        >
                          {c.text}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Multiple Choice */}
              {q.type === "multiple" && q.choices && (
                <div className="space-y-2.5">
                  <div
                    className="text-xs mb-2 sm:mb-3"
                    style={{ color: C.base.textFaint }}
                  >
                    {t("Select all correct answers")}
                  </div>
                  {q.choices.map((c) => {
                    const selected = answers[q.id] as string[] | null ?? []
                    const isSelected = selected.includes(c.key)
                    return (
                      <button
                        key={c.key}
                        onClick={() => {
                          const next = isSelected
                            ? selected.filter((v) => v !== c.key)
                            : [...selected, c.key]
                          setAnswer(q.id, next.length > 0 ? next : null)
                        }}
                        className="w-full text-left flex items-center gap-3 sm:gap-4 px-3.5 sm:px-4 py-3.5 rounded-2xl transition-all min-h-[54px] active:scale-[0.99]"
                        style={{
                          background: isSelected ? C.brand.bg : C.base.surface,
                          border: `1.5px solid ${isSelected ? C.brand.main : C.base.border}`,
                          boxShadow: isSelected ? S.cardHover : S.control,
                        }}
                      >
                        <div
                          className="w-6 h-6 sm:w-5 sm:h-5 rounded-md flex items-center justify-center text-xs shrink-0"
                          style={{
                            background: isSelected ? C.brand.main : C.base.surfaceSoft,
                            color: isSelected ? "#FFFFFF" : C.base.textMuted,
                          }}
                        >
                          {isSelected ? <Check className="w-3.5 h-3.5" /> : ""}
                        </div>
                        <span
                          className="text-sm sm:text-[15px] break-words min-w-0"
                          style={{
                            color: isSelected ? C.brand.dark : C.base.text,
                            fontFamily: c.text.includes("$")
                              ? "var(--font-mono)"
                              : "inherit",
                          }}
                        >
                          {c.text}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* True/False */}
              {q.type === "truefalse" && (
                <div className="flex gap-3 sm:gap-4">
                  {[
                    { val: "true", label: "True / Benar" },
                    { val: "false", label: "False / Salah" },
                  ].map(({ val, label }) => {
                    const isSelected = answers[q.id] === val
                    return (
                      <button
                        key={val}
                        onClick={() => setAnswer(q.id, val)}
                        className="flex-1 py-5 sm:py-6 rounded-2xl flex flex-col items-center gap-2 transition-all min-h-[104px] active:scale-[0.98]"
                        style={{
                          background: isSelected
                            ? val === "true"
                              ? C.brand.bg
                              : C.danger.bgLight
                            : C.base.surface,
                          border: `2px solid ${
                            isSelected
                              ? val === "true"
                                ? C.brand.main
                                : C.danger.main
                              : C.base.border
                          }`,
                          boxShadow: isSelected ? S.cardHover : S.control,
                        }}
                      >
                        <span
                          style={{
                            color: isSelected
                              ? val === "true"
                                ? C.brand.main
                                : C.danger.main
                              : C.base.textMuted,
                          }}
                        >
                          {val === "true" ? (
                            <Circle className="w-7 h-7" />
                          ) : (
                            <X className="w-7 h-7" />
                          )}
                        </span>
                        <span
                          className="text-xs sm:text-sm font-semibold text-center px-1"
                          style={{
                            color: isSelected
                              ? val === "true"
                                ? C.brand.dark
                                : C.danger.text
                              : C.base.textMuted,
                          }}
                        >
                          {label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Matching — stacked on mobile, side-by-side on desktop */}
              {q.type === "matching" && q.leftOptions && q.rightOptions && (
                <div className="space-y-2.5">
                  <div
                    className="text-xs mb-2 sm:mb-3"
                    style={{ color: C.base.textFaint }}
                  >
                    {t(
                      "Match each item on the left with the correct pair on the right",
                    )}
                  </div>
                  {q.leftOptions.map((l) => {
                    const pairs = answers[q.id] as any[] ?? []
                    const pair = pairs.find((p) => p.left_id === l.key)
                    return (
                      <div
                        key={l.key}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 sm:p-2.5 rounded-2xl"
                        style={{
                          background: C.base.surface,
                          border: `1px solid ${C.base.border}`,
                          boxShadow: S.card,
                        }}
                      >
                        <div
                          className="text-sm flex-1 break-words min-w-0 sm:px-2 sm:py-1"
                          style={{ color: C.base.text }}
                        >
                          {l.text}
                        </div>
                        <select
                          value={pair?.right_id ?? ""}
                          onChange={(e) => {
                            const newPairs = pairs.filter(
                              (p) => p.left_id !== l.key,
                            )
                            if (e.target.value)
                              newPairs.push({
                                left_id: l.key,
                                right_id: e.target.value,
                              })
                            setAnswer(
                              q.id,
                              newPairs.length > 0 ? newPairs : null,
                            )
                          }}
                          className="w-full sm:flex-1 px-3 py-3 rounded-xl text-base sm:text-sm outline-none min-h-[48px]"
                          style={{
                            border: `1.5px solid ${C.base.border}`,
                            color: pair ? C.base.text : C.base.textMuted,
                            background: C.base.surfaceAlt,
                            boxShadow: S.inset,
                          }}
                        >
                          <option value="">{t("— Select match —")}</option>
                          {q.rightOptions!.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.text}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Essay */}
              {q.type === "essay" && (
                <div>
                  <textarea
                    rows={8}
                    value={answers[q.id] as string ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value || null)}
                    placeholder={t(
                      "Tulis jawaban Anda di sini. Gunakan rumus atau notasi yang relevan...",
                    )}
                    className="w-full px-3.5 sm:px-4 py-3 rounded-2xl text-base outline-none resize-y min-h-[180px]"
                    style={{
                      border: `1.5px solid ${C.base.border}`,
                      color: C.base.text,
                      background: C.base.surface,
                      boxShadow: S.inset,
                      lineHeight: "1.8",
                      fontSize: 16,
                    }}
                  />
                  <div
                    className="flex justify-between gap-2 mt-1.5 text-[11px] sm:text-xs"
                    style={{ color: C.base.textFaint }}
                  >
                    <span className="truncate">
                      {t("Essay response — manually graded by teacher")}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {t("{n} chars", {
                        n: (answers[q.id] as string ?? "").length,
                      })}
                    </span>
                  </div>
                </div>
              )}
              {/* Mobile prev/next helper */}
              <div className="flex gap-2.5 mt-6 md:hidden safe-area-bottom">
                <button
                  disabled={currentQ === 0}
                  onClick={() => setCurrentQ((c) => c - 1)}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-3 rounded-xl text-sm font-medium disabled:opacity-30 active:scale-[0.98] min-h-[48px]"
                  style={{
                    border: `1px solid ${C.base.border}`,
                    color: C.base.textBody,
                    background: C.base.surface,
                    boxShadow: S.control,
                  }}
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t("Prev")}
                </button>
                {currentQ < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentQ((c) => c + 1)}
                    className="flex-[2] inline-flex items-center justify-center gap-1 py-3 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-[0.98] min-h-[48px]"
                    style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
                  >
                    {t("Next")}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowSubmitModal(true)}
                    className="flex-[2] py-3 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-[0.98] min-h-[48px]"
                    style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
                  >
                    {t("Submit Exam →")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom navigation — desktop only (mobile uses inline nav above) */}
          <div
            className="hidden md:flex h-16 items-center justify-between px-6 shrink-0 border-t safe-area-bottom"
            style={{ background: C.base.surface, borderColor: C.base.border }}
          >
            <button
              disabled={currentQ === 0}
              onClick={() => setCurrentQ((c) => c - 1)}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-30 cbt-row-hover"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textBody, background: C.base.surface, boxShadow: S.control }}
            >
              <ChevronLeft className="w-4 h-4" />
              {t("Previous")}
            </button>

            <div className="text-xs tabular-nums" style={{ color: C.base.textFaint }}>
              {answeredCount}/{questions.length} {t("answered")}
            </div>

            {currentQ < questions.length - 1 ? (
              <button
                onClick={() => setCurrentQ((c) => c + 1)}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all"
                style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
              >
                {t("Save & Next")}
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setShowSubmitModal(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all"
                style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
              >
                {t("Submit Exam →")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Submit modal — bottom sheet on mobile, centered dialog on desktop */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={{ background: S.overlay }}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 safe-area-bottom"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.elevated,
            }}
          >
            <div className="sm:hidden w-10 h-1 rounded-full mx-auto mb-3" style={{ background: C.base.border }} />
            <div className="text-center mb-5">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
                style={{ background: timeLeft === 0 ? C.warn.bg : C.ok.bg, color: timeLeft === 0 ? C.warn.dark : C.ok.dark }}
              >
                {timeLeft === 0 ? <Clock className="w-6 h-6" /> : <Send className="w-6 h-6" />}
              </div>
              <h3
                className="font-bold text-lg"
                style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
              >
                {timeLeft === 0 ? t("Time's Up!") : t("Submit Exam?")}
              </h3>
              <p className="text-sm mt-1" style={{ color: C.base.textMuted }}>
                {timeLeft === 0
                  ? t("Your exam has been automatically submitted.")
                  : t("Once submitted, you cannot return to this exam.")}
              </p>
            </div>

            <div
              className="rounded-xl p-3.5 mb-5 space-y-2 text-sm"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
            >
              {[
                {
                  label: t("Answered"),
                  value: `${answeredCount}/${questions.length}`,
                },
                { label: t("Flagged"), value: flagged.size.toString() },
                {
                  label: t("Not answered"),
                  value: (questions.length - answeredCount).toString(),
                },
                { label: t("Time remaining"), value: formatTime(timeLeft) },
              ].map((r) => (
                <div key={r.label} className="flex justify-between">
                  <span style={{ color: C.base.textMuted }}>{r.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: C.base.text }}>
                    {r.value}
                  </span>
                </div>
              ))}
            </div>

            {questions.length - answeredCount > 0 && timeLeft > 0 && (
              <div
                className="flex items-start gap-2 rounded-xl p-3 mb-4 text-xs"
                style={{
                  background: C.warn.bg,
                  color: C.warn.dark,
                  border: `1px solid ${C.warn.border}`,
                }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {t("You have {n} unanswered question(s).", {
                    n: questions.length - answeredCount,
                  })}
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {timeLeft > 0 && (
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-medium border min-h-[48px] sm:min-h-0 cbt-row-hover"
                  style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}
                >
                  {t("Continue Exam")}
                </button>
              )}
              <button
                onClick={() => handleSubmit(false)}
                className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 min-h-[48px] sm:min-h-0"
                style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
              >
                {timeLeft === 0 ? t("View Results") : t("Submit Now")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
