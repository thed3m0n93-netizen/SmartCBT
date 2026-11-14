/**
 * SmartCBT — Ownership & role guards (build 139).
 *
 * Build 138 menutup celah WAKTU (jawaban pasca-deadline ditolak server).
 * Build 139 menutup celah KEPEMILIKAN: endpoint jalur ujian dan monitoring
 * sebelumnya mempercayai `sessionId`/`studentId` dari body/URL tanpa mengecek
 * apakah pemanggil benar-benar pemiliknya — token login siswa mana pun bisa
 * dipakai mengirim jawaban untuk sesi siswa lain, membaca feed monitoring
 * (IP/device/skor semua orang), bahkan menekan force-submit/reset.
 *
 * Aturan yang diekspor modul ini:
 *   - Jalur siswa (answers, start, submit, results, exam-questions, profil):
 *     pemanggil harus role `student` DAN id resource == id caller
 *     (admin/super_admin boleh membaca hasil/profil — untuk dukungan teknis).
 *   - Aksi & feed monitoring: khusus staff (`teacher`/`admin`/`super_admin`).
 *   - Pelaporan focus-loss/violation: hanya pemilik sesi, dengan token yang
 *     boleh datang dari header Authorization ATAU field body `sessionToken`
 *     — karena `navigator.sendBeacon` secara struktural tidak bisa mengirim
 *     header, jalur beacon sebelumnya justru 401 dan event hilang senyap.
 */

import { getBearerToken, getSession } from "./auth-session.js";
import { json, queryOne } from "./utils.js";

/** Bentuk `req.authUser` yang dipasang dispatcher (role = nilai DB asli). */
export interface Caller {
  id: string;
  role: string;
  name?: string;
}

/**
 * Resolusi pemanggil tiga tingkat:
 *   1. `req.authUser` (sudah diverifikasi dispatcher untuk route non-public),
 *   2. header `Authorization: Bearer …` (route yang handler-nya memakai
 *      req sendiri tanpa melewati gate, mis. SSE),
 *   3. fallback `body.sessionToken` — HANYA untuk jalur beacon
 *      (`reportViolationWithBeacon`) yang tidak bisa membawa header.
 */
export function callerFromRequest(
  req: { headers: Record<string, any>; authUser?: Caller | null },
  body?: unknown,
): Caller | null {
  if (req.authUser) return req.authUser;
  const token = getBearerToken(req.headers?.authorization);
  const headerUser = token ? getSession(token) : null;
  if (headerUser) return headerUser as Caller;
  const bodyToken =
    body && typeof (body as any).sessionToken === "string"
      ? String((body as any).sessionToken).trim()
      : "";
  if (bodyToken) {
    const u = getSession(bodyToken);
    if (u) return u as Caller;
  }
  return null;
}

export function isStudentCaller(caller: Caller | null): boolean {
  return !!caller && caller.role === "student";
}

/**
 * Peran staff. `admin` ikut diterima meski CHECK role DB hanya
 * `super_admin|teacher|student` — klien memetakan super_admin→admin dan
 * sebagian deployment lama menyimpan `admin` (konsisten dengan cek di
 * settings/news yang sudah menerima kedua nilai).
 */
export function isStaffCaller(caller: Caller | null): boolean {
  return (
    !!caller &&
    (caller.role === "teacher" ||
      caller.role === "admin" ||
      caller.role === "super_admin")
  );
}

export function isAdminCaller(caller: Caller | null): boolean {
  return (
    !!caller && (caller.role === "admin" || caller.role === "super_admin")
  );
}

/** Payload 403 baku — kode stabil agar klien bisa membedakan dari error lain. */
export const NOT_OWNER = {
  status: 403,
  payload: {
    error: "Aksi ini hanya dapat dilakukan pada data milik Anda sendiri.",
    code: "NOT_OWNER",
  },
} as const;

export const NOT_STAFF = {
  status: 403,
  payload: {
    error: "Hanya guru atau admin yang dapat melakukan aksi ini.",
    code: "STAFF_ONLY",
  },
} as const;

/** Build 143 — gerbang master data/user management: khusus admin. */
export const NOT_ADMIN = {
  status: 403,
  payload: {
    error: "Hanya admin yang dapat melakukan operasi ini.",
    code: "ADMIN_ONLY",
  },
} as const;

export const NO_CALLER = {
  status: 401,
  payload: { error: "Authentication required" },
} as const;

/**
 * Tulis respons 401/403 sendiri dan kembalikan false bila caller bukan admin.
 * Dipakai rute sensitif auth-users/user-import (temuan E2E 2026-11-14:
 * endpoint ini dulu hanya menuntut "login apa pun").
 */
export function requireAdmin(
  req: { headers: Record<string, any>; authUser?: Caller | null },
  res: any,
): boolean {
  const caller = callerFromRequest(req);
  if (!caller) {
    json(res, NO_CALLER.payload, NO_CALLER.status);
    return false;
  }
  if (!isAdminCaller(caller)) {
    json(res, NOT_ADMIN.payload, NOT_ADMIN.status);
    return false;
  }
  return true;
}

/**
 * Build 144 — gerbang manajemen siswa (Data Siswa / promote / graduate /
 * status): guru ATAU admin. Mirip `requireAdmin` tapi menerima role teacher.
 * Menulis respons 401/403 sendiri; kembalikan true bila boleh lanjut.
 */
export function requireStaff(
  req: { headers: Record<string, any>; authUser?: Caller | null },
  res: any,
): boolean {
  const caller = callerFromRequest(req);
  if (!caller) {
    json(res, NO_CALLER.payload, NO_CALLER.status);
    return false;
  }
  if (!isStaffCaller(caller)) {
    json(res, NOT_STAFF.payload, NOT_STAFF.status);
    return false;
  }
  return true;
}

/**
 * Pemilik sesi ujian (user id pada student_sessions.student_id), atau null
 * bila sesi tidak ada. Dipakai handler yang belum terlanjur men-SELECT baris
 * sesi (jalur beacon/violation); handler yang sudah memuat sesi memakai
 * `ownsSessionRow` tanpa query ekstra.
 */
export async function sessionOwnerOf(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  const row = await queryOne<{ student_id: string }>(
    `SELECT student_id FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  return row ? String(row.student_id) : null;
}

/** Bandingkan baris sesi (kolom student_id) dengan caller. String-safe untuk BIGINT/UUID. */
export function ownsSessionRow(
  caller: Caller | null,
  sessionRow: { student_id?: unknown } | null | undefined,
): boolean {
  return (
    !!caller &&
    !!sessionRow &&
    String(sessionRow.student_id ?? "") === String(caller.id)
  );
}

/**
 * Gerbang kepemilikan untuk payload {sessionId}: auth → sesi ada → caller
 * pemilik. Handler memakai pola:
 *   const guard = await guardSessionOwner(caller, body?.sessionId);
 *   if (!guard.ok) return json(res, guard.payload, guard.status);
 */
export type GuardResult =
  | { ok: true; owner: string }
  | { ok: false; status: number; payload: any };

export async function guardSessionOwner(
  caller: Caller | null,
  sessionId: unknown,
): Promise<GuardResult> {
  if (!caller) return { ok: false, ...NO_CALLER };
  const owner = await sessionOwnerOf(String(sessionId ?? ""));
  if (!owner) return { ok: false, status: 404, payload: { error: "Session not found" } };
  if (owner !== String(caller.id)) return { ok: false, ...NOT_OWNER };
  return { ok: true, owner };
}
