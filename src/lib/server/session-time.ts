/**
 * SmartCBT — Server-side exam session timing (build 138).
 *
 * Until now the countdown lived ONLY in the browser: the server accepted
 * answers and submissions long after a student's time was up (devtools, a
 * paused tab, or a scripted client could keep answering forever). These
 * helpers derive an authoritative deadline from data the SERVER owns:
 *
 *     deadline = started_at + (duration_minutes + extra_time_minutes)
 *
 * `started_at` is written by `POST /api/sessions/start` using the database
 * clock, and `extra_time_minutes` only ever changes through teacher actions,
 * so a student cannot manipulate any input of the formula.
 *
 * A small grace window (`SESSION_GRACE_SECONDS`) absorbs clock drift between
 * the DB host and the Node process plus in-flight network latency, so an
 * honest student who clicks "submit" at 00:00 is never punished. The same
 * deadline is echoed to the client (`expiresAt`) so its timer can resync —
 * granting extra time from the monitor page therefore becomes visible to the
 * student on the next autosave, without a page reload.
 */

/** Toleransi drift jam + latency (detik) sebelum jawaban dianggap lewat batas. */
export const SESSION_GRACE_SECONDS = 60;

export interface SessionTimingInput {
  /** `student_sessions.started_at` (pg: Date, mysql: Date|string). */
  startedAt?: Date | string | null;
  /** `exams.duration_minutes` (string dari driver yang tidak cast numerik). */
  durationMinutes?: number | string | null;
  /** `student_sessions.extra_time_minutes` (akumulasi dari monitor guru). */
  extraTimeMinutes?: number | string | null;
}

/**
 * Epoch-ms batas waktu sesi, atau `null` bila tidak dapat dihitung
 * (sesi belum mulai / ujian tanpa durasi) — `null` berarti TIDAK ditegakkan,
 * persis perilaku build lama.
 */
export function sessionDeadlineMs(input: SessionTimingInput): number | null {
  if (!input.startedAt) return null;
  const started = new Date(input.startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  const duration = Number(input.durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const extra = Number(input.extraTimeMinutes);
  const extraMin = Number.isFinite(extra) && extra > 0 ? extra : 0;
  return started + (duration + extraMin) * 60_000;
}

/** ISO string dari `sessionDeadlineMs`, untuk dikirim ke klien. */
export function sessionExpiresAtIso(input: SessionTimingInput): string | null {
  const ms = sessionDeadlineMs(input);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * TRUE bila sesi sudah lewat batas + grace. `now` injektabel untuk pengujian.
 */
export function isSessionExpired(
  input: SessionTimingInput,
  now: number = Date.now(),
): boolean {
  const ms = sessionDeadlineMs(input);
  return ms !== null && now > ms + SESSION_GRACE_SECONDS * 1000;
}
