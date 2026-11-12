/**
 * SmartCBT — Exam anti-cheat / kiosk helpers
 *
 * Pure, framework-free utilities shared by the exam runner
 * (`pages/student/ExamTakingPage.tsx`). Keeping the rules here means the
 * enforcement policy is testable, lives in one place, and is easy to reuse for
 * future lockdown features (e.g. a teacher-facing preview of the policy).
 *
 * Threat model (defence in depth, browser-honest):
 *  - Fullscreen / focus loss → detected client-side, counted, and reported to
 *    the server so a teacher can see it in the Live Monitor.
 *  - Copy / cut / paste / drop / context menu → blocked AND counted.
 *  - Repeated violations → the exam is force-submitted (fail-safe) instead of
 *    being locked behind a dismissible overlay the student can farm.
 *
 * NOTE: a browser can never be a hard guarantee (a determined student can
 * always use a second device). The real boundary is the server: while
 * `seb_required` is on, answers are only accepted from a session that proved
 * Safe Exam Browser usage — see `src/lib/server/answers.ts`.
 */

/** Kinds of violations the runner can detect. */
export type ViolationKind =
  | "fullscreen"
  | "visibility"
  | "blur"
  | "clipboard"
  | "shortcut";

/** `critical` = policy limit reached → the runner must force-submit. */
export type ViolationSeverity = "warn" | "critical";

export interface ViolationEvent {
  kind: ViolationKind;
  /** Total violations recorded for this session, including this one. */
  count: number;
  severity: ViolationSeverity;
  timestamp: number;
}

/**
 * Enforcement policy for a single exam session.
 *
 * The defaults are intentionally forgiving: students may lose fullscreen or
 * switch tabs a couple of times (OS notifications, accidental Esc, screen
 * readers) before the exam is taken away. Teachers can tighten this per exam
 * via the "Anti-cheat ketat" switch on the exam form.
 */
export interface AntiCheatPolicy {
  /** Require the browser to enter fullscreen before the exam starts. */
  requireFullscreen: boolean;
  /** Count a `visibilitychange` (tab switch) as a violation. */
  countVisibility: boolean;
  /** Count a window `blur` (another app/window focused) as a violation. */
  countBlur: boolean;
  /** Count copy/cut/paste/context-menu attempts as a violation. */
  countClipboard: boolean;
  /** Count blocked keyboard shortcuts (PrintScreen, DevTools, save, …). */
  countShortcut: boolean;
  /**
   * Violations allowed before the exam is locked. `0` disables the lock
   * entirely (violations are still recorded and reported to the server).
   */
  maxViolations: number;
  /** Auto-submit the exam once `maxViolations` is reached. */
  autoSubmitOnLimit: boolean;
  /** Re-request fullscreen every time it is lost (best effort). */
  autoRefocusFullscreen: boolean;
}

/** Default policy — 5 strikes, then the exam is force-submitted. */
export const DEFAULT_ANTICHEAT_POLICY: AntiCheatPolicy = {
  requireFullscreen: true,
  countVisibility: true,
  countBlur: true,
  countClipboard: true,
  countShortcut: true,
  maxViolations: 5,
  autoSubmitOnLimit: true,
  autoRefocusFullscreen: true,
};

/** Stricter policy applied when the exam enables strict anti-cheat. */
export const STRICT_ANTICHEAT_POLICY: AntiCheatPolicy = {
  ...DEFAULT_ANTICHEAT_POLICY,
  maxViolations: 3,
};

/**
 * Build the policy for an exam. `strict` widens enforcement; everything else
 * keeps the default.
 */
export function buildPolicy(opts?: {
  strict?: boolean;
  fullscreenSupported?: boolean;
}): AntiCheatPolicy {
  const base = opts?.strict ? STRICT_ANTICHEAT_POLICY : DEFAULT_ANTICHEAT_POLICY;
  // Devices without the Fullscreen API (iOS Safari on iPhone) must not be
  // locked out of the exam by a gate they can never satisfy.
  if (opts?.fullscreenSupported === false) {
    return { ...base, requireFullscreen: false, autoRefocusFullscreen: false };
  }
  return base;
}

/* ── Fullscreen (kiosk) helpers ───────────────────────────────────────── */

/** True when the browser exposes the Fullscreen API. */
export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  return typeof document.documentElement?.requestFullscreen === "function";
}

/** Is the document currently in fullscreen (vendor-prefix aware)? */
export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** Enter fullscreen on the document root. Resolves `false` when refused. */
export async function enterFullscreen(): Promise<boolean> {
  if (!fullscreenSupported()) return false;
  try {
    const el = document.documentElement as FullscreenElement;
    if (typeof el.webkitRequestFullscreen === "function") {
      await el.webkitRequestFullscreen();
      return true;
    }
    await el.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

/** Leave fullscreen, ignoring "not in fullscreen" errors. */
export async function exitFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as FullscreenDocument;
  try {
    if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === "function") {
      await doc.webkitExitFullscreen();
      return;
    }
    if (doc.fullscreenElement) await doc.exitFullscreen();
  } catch {
    /* already out of fullscreen */
  }
}

/* ── Blocked keystrokes ───────────────────────────────────────────────── */

/**
 * Keys blocked outright during an exam. Modifiers are matched loosely
 * (`Ctrl` or `Meta`) so the same list works on Windows/Linux and macOS.
 */
const BLOCKED_KEYS = new Set([
  "F11", // leaves the kiosk fullscreen
  "F12", // devtools
  "PrintScreen",
  "Insert", // legacy paste shortcut
]);

const BLOCKED_COMBOS: Array<{ key: string; shift: boolean }> = [
  { key: "c", shift: false }, // copy
  { key: "x", shift: false }, // cut
  { key: "v", shift: false }, // paste
  { key: "a", shift: false }, // select all
  { key: "u", shift: false }, // view source
  { key: "p", shift: false }, // print
  { key: "s", shift: false }, // save page
  { key: "i", shift: true }, // devtools
  { key: "j", shift: true }, // devtools console
  { key: "c", shift: true }, // devtools inspect
];

/** True when a keyboard event matches the blocked list. */
export function isBlockedShortcut(e: KeyboardEvent): boolean {
  if (BLOCKED_KEYS.has(e.key)) return true;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return false;
  const key = e.key.toLowerCase();
  return BLOCKED_COMBOS.some((combo) => combo.key === key && combo.shift === e.shiftKey);
}

/* ── Violation tracker ────────────────────────────────────────────────── */

/**
 * Small state machine that turns raw browser events into violation counts and
 * decides when the exam must be force-submitted.
 *
 * Deliberately NOT a React hook: the runner drives it from plain event
 * handlers (some of which fire while the tab is being hidden, where React
 * state updates are unreliable).
 */
export class ViolationTracker {
  private count = 0;
  private lastKind: ViolationKind | null = null;
  private lastAt = 0;
  /**
   * The same physical action usually fires several events (blur + visibility,
   * keydown + copy). Events within this window collapse into one violation.
   */
  private readonly dedupeMs: number;

  constructor(
    private readonly policy: AntiCheatPolicy,
    dedupeMs = 700,
  ) {
    this.dedupeMs = dedupeMs;
  }

  /** Violations recorded so far. */
  get total(): number {
    return this.count;
  }

  /** This exam's policy (read-only view). */
  get rules(): AntiCheatPolicy {
    return this.policy;
  }

  /** `true` while the exam is still within the allowed violation budget. */
  get withinBudget(): boolean {
    if (this.policy.maxViolations <= 0) return true;
    return this.count < this.policy.maxViolations;
  }

  /** `true` once the lock threshold has been reached. */
  get limitReached(): boolean {
    if (this.policy.maxViolations <= 0) return false;
    return this.count >= this.policy.maxViolations;
  }

  /** Record a violation and return the resulting event (`null` = ignored). */
  record(kind: ViolationKind): ViolationEvent | null {
    if (!this.kindEnabled(kind)) return null;
    const now = Date.now();
    if (this.lastKind !== null && now - this.lastAt < this.dedupeMs) {
      this.lastKind = kind;
      this.lastAt = now;
      return null;
    }
    this.lastKind = kind;
    this.lastAt = now;
    this.count += 1;
    return {
      kind,
      count: this.count,
      severity: this.limitReached ? "critical" : "warn",
      timestamp: now,
    };
  }

  /** True when the caller should force-submit now. */
  shouldAutoSubmit(): boolean {
    return this.policy.autoSubmitOnLimit && this.limitReached;
  }

  /** Reset the counter (e.g. when the runner re-arms after a resume). */
  reset(): void {
    this.count = 0;
    this.lastKind = null;
    this.lastAt = 0;
  }

  private kindEnabled(kind: ViolationKind): boolean {
    switch (kind) {
      case "fullscreen":
        return true; // leaving the kiosk is always a violation
      case "visibility":
        return this.policy.countVisibility;
      case "blur":
        return this.policy.countBlur;
      case "clipboard":
        return this.policy.countClipboard;
      case "shortcut":
        return this.policy.countShortcut;
      default:
        return false;
    }
  }
}

/* ── i18n keys for the violation overlay ──────────────────────────────── */

/** Overlay title key per violation kind (translated by the caller). */
export const VIOLATION_TITLE_KEY: Record<ViolationKind, string> = {
  fullscreen: "Exit Fullscreen Warning",
  visibility: "Tab Switch Detected",
  blur: "Window Focus Lost",
  clipboard: "Copy Attempt Blocked",
  shortcut: "Blocked Shortcut",
};

/** Overlay body-copy key per violation kind (translated by the caller). */
export const VIOLATION_DETAIL_KEY: Record<ViolationKind, string> = {
  fullscreen: "Ujian dikunci. Kembali ke fullscreen atau submit sekarang.",
  visibility: "Berpindah tab terdeteksi dan dicatat oleh pengawas.",
  blur: "Jendela ujian kehilangan fokus dan dicatat oleh pengawas.",
  clipboard: "Ujian dikunci. Submit ujian atau tutup peringatan untuk melanjutkan.",
  shortcut: "Pintasan ini diblokir selama ujian berlangsung.",
};
