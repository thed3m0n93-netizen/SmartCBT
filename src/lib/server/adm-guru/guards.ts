/**
 * SmartCBT — Administrasi Guru RBAC & Ownership Guards
 *
 * Separates CBT core system roles (`users.role`: super_admin | teacher | student)
 * from Indonesian school functional authority (`users.academic_role`:
 * none | guru | waka_kurikulum | kepala_sekolah).
 */
import { queryOne, json, type AuthenticatedRequest } from "../utils.js";
import {
  NO_CALLER,
  NOT_OWNER,
  NOT_STAFF,
  callerFromRequest,
  isAdminCaller,
  isStaffCaller,
} from "../ownership.js";
import { ensureUserAcademicColumns } from "./schema-init.js";

export const ACADEMIC_ROLES = [
  "none",
  "guru",
  "waka_kurikulum",
  "kepala_sekolah",
] as const;

export type AcademicRole = (typeof ACADEMIC_ROLES)[number];

export interface AcademicCaller {
  id: string;
  role: string;
  username: string;
  full_name: string;
  academic_role: AcademicRole;
  nip: string | null;
}

export const NOT_VALIDATOR = {
  status: 403,
  payload: {
    error: "Hanya Admin, Waka Kurikulum, atau Kepala Sekolah yang dapat melakukan operasi ini.",
    code: "VALIDATOR_ONLY",
  },
} as const;

export function normalizeAcademicRole(value: unknown): AcademicRole {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((ACADEMIC_ROLES as readonly string[]).includes(raw)) {
    return raw as AcademicRole;
  }
  return "none";
}

/**
 * Resolve the authenticated caller enriched with `academic_role` and `nip`.
 * Returns null if unauthenticated.
 */
export async function resolveAcademicCaller(
  req: AuthenticatedRequest,
): Promise<AcademicCaller | null> {
  const base = callerFromRequest(req);
  if (!base) return null;

  const maybeCached = base as any;
  if (
    typeof maybeCached.academic_role === "string" &&
    maybeCached.academic_role !== ""
  ) {
    return {
      id: String(base.id),
      role: String(base.role),
      username: String(maybeCached.username ?? ""),
      full_name: String(maybeCached.full_name ?? base.name ?? ""),
      academic_role: normalizeAcademicRole(maybeCached.academic_role),
      nip: maybeCached.nip ?? null,
    };
  }

  try {
    await ensureUserAcademicColumns();
    const row = await queryOne<{
      id: string;
      role: string;
      username: string;
      full_name: string;
      academic_role?: string | null;
      nip?: string | null;
    }>(
      `SELECT id, role, username, full_name, academic_role, nip FROM users WHERE id = $1`,
      [base.id],
    );
    if (row) {
      return {
        id: String(row.id),
        role: String(row.role),
        username: String(row.username ?? ""),
        full_name: String(row.full_name ?? ""),
        academic_role: normalizeAcademicRole(row.academic_role),
        nip: row.nip ?? null,
      };
    }
  } catch {
    /* fallback cleanly below if DB column lookup fails transiently */
  }

  return {
    id: String(base.id),
    role: String(base.role),
    username: String(maybeCached.username ?? ""),
    full_name: String(maybeCached.full_name ?? base.name ?? ""),
    academic_role: "none",
    nip: null,
  };
}

/**
 * True when caller may manage school-wide curriculum settings (Tahun Ajaran,
 * Kalender Pendidikan, validasi perangkat ajar).
 */
export function isValidatorCaller(caller: AcademicCaller | null): boolean {
  if (!caller) return false;
  if (isAdminCaller(caller)) return true;
  return (
    caller.academic_role === "waka_kurikulum" ||
    caller.academic_role === "kepala_sekolah"
  );
}

/**
 * Guard: any authenticated staff member (teacher, admin, super_admin).
 * Writes 401/403 and returns null if unauthorized.
 */
export async function requireAdmStaff(
  req: AuthenticatedRequest,
  res: any,
): Promise<AcademicCaller | null> {
  const caller = await resolveAcademicCaller(req);
  if (!caller) {
    json(res, NO_CALLER.payload, NO_CALLER.status);
    return null;
  }
  if (!isStaffCaller(caller)) {
    json(res, NOT_STAFF.payload, NOT_STAFF.status);
    return null;
  }
  return caller;
}

/**
 * Guard: Admin, Waka Kurikulum, or Kepala Sekolah.
 * Writes 401/403 and returns null if unauthorized.
 */
export async function requireValidator(
  req: AuthenticatedRequest,
  res: any,
): Promise<AcademicCaller | null> {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return null;
  if (!isValidatorCaller(caller)) {
    json(res, NOT_VALIDATOR.payload, NOT_VALIDATOR.status);
    return null;
  }
  return caller;
}

/**
 * Guard read access to a teacher-owned resource:
 * allowed for the owning teacher, admins, and validators (Kepsek/Waka).
 */
export function canReadTeacherResource(
  caller: AcademicCaller,
  ownerTeacherId: string,
): boolean {
  if (isValidatorCaller(caller)) return true;
  return String(caller.id) === String(ownerTeacherId);
}

/**
 * Guard write/delete access to a teacher-owned resource:
 * allowed for the owning teacher or admin/super_admin.
 */
export function canMutateTeacherResource(
  caller: AcademicCaller,
  ownerTeacherId: string,
): boolean {
  if (isAdminCaller(caller)) return true;
  return String(caller.id) === String(ownerTeacherId);
}

export { NOT_OWNER };
