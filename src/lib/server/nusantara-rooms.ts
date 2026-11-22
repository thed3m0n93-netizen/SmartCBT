/**
 * SmartCBT — Nusantara High Room & Lobby Isolation Registry.
 *
 * Pure in-memory room & membership state with strict per-class isolation:
 * - Students with a valid `class_id` are mapped strictly to `class:<normalizedClassId>`.
 * - Students without a resolved `class_id` are isolated to `unassigned:<userId>`
 *   so no two students from different or unknown classes ever share a room.
 * - Staff (`teacher`, `admin`, `super_admin`) share the `staff` room.
 */

import type { PlayerState } from "../../game/nusantara/schoolMap.js";

export interface LobbyDescriptor {
  room: string;
  kind: "class" | "staff";
  label: string;
  classId: string | null;
}

export interface ConnectionMeta {
  userId: string;
  role: string;
  room: string;
  classId: string | null;
  classLabel: string;
}

export interface StudentClassProfileRow {
  class_id: unknown;
  class_name: string | null;
  grade_level: string | null;
}

const STAFF_ROLES = new Set(["teacher", "admin", "super_admin"]);

/**
 * Normalizes a class_id from Postgres (string int8 / number), MySQL (number / bigint),
 * or external callers into a canonical trimmed string so `"10"`, `10`, and `10n`
 * always map to the exact same room key `"class:10"`.
 */
export function normalizeClassId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      // Strip leading zeros so "01" and 1 map consistently.
      return String(BigInt(trimmed));
    }
    return trimmed;
  }
  return null;
}

export function resolveLobbyDescriptor(
  user: { id: string; role: string },
  profile: StudentClassProfileRow | null
): LobbyDescriptor {
  if (STAFF_ROLES.has(user.role)) {
    return {
      room: "staff",
      kind: "staff",
      label: "Ruang Guru",
      classId: null,
    };
  }

  const normalizedClassId = normalizeClassId(profile?.class_id);
  if (normalizedClassId !== null) {
    const label =
      `${profile?.grade_level ?? ""} ${profile?.class_name ?? ""}`.trim() ||
      `Kelas ${normalizedClassId}`;
    return {
      room: `class:${normalizedClassId}`,
      kind: "class",
      label,
      classId: normalizedClassId,
    };
  }

  // Defense-in-depth: an unassigned student (no student_profiles row / class_id)
  // gets an isolated room keyed by userId so two unplaced students or failed lookups
  // cannot leak into each other's space.
  const safeUserId = String(user.id || "").trim() || "unknown";
  return {
    room: `unassigned:${safeUserId}`,
    kind: "class",
    label: "Belum Ada Kelas",
    classId: null,
  };
}

export class NusantaraRoomRegistry {
  private readonly players = new Map<string, PlayerState>();
  private readonly meta = new Map<string, ConnectionMeta>();
  private readonly actionCooldowns = new Map<string, number>();
  private readonly joiningSockets = new Set<string>();

  beginJoin(socketId: string): boolean {
    if (this.meta.has(socketId) || this.joiningSockets.has(socketId)) {
      return false;
    }
    this.joiningSockets.add(socketId);
    return true;
  }

  endJoin(socketId: string): void {
    this.joiningSockets.delete(socketId);
  }

  findSocketsByUserId(userId: string): string[] {
    const target = String(userId);
    const out: string[] = [];
    this.meta.forEach((m, socketId) => {
      if (m.userId === target) out.push(socketId);
    });
    return out;
  }

  registerPlayer(socketId: string, player: PlayerState, connectionMeta: ConnectionMeta): void {
    this.players.set(socketId, player);
    this.meta.set(socketId, connectionMeta);
  }

  removePlayer(socketId: string): { player: PlayerState; meta: ConnectionMeta } | null {
    const player = this.players.get(socketId);
    const connectionMeta = this.meta.get(socketId);
    this.players.delete(socketId);
    this.meta.delete(socketId);
    this.actionCooldowns.delete(socketId);
    this.joiningSockets.delete(socketId);
    if (!player || !connectionMeta) return null;
    return { player, meta: connectionMeta };
  }

  getPlayer(socketId: string): { player: PlayerState; meta: ConnectionMeta } | null {
    const player = this.players.get(socketId);
    const connectionMeta = this.meta.get(socketId);
    if (!player || !connectionMeta) return null;
    return { player, meta: connectionMeta };
  }

  /**
   * Returns a snapshot strictly scoped to `room`.
   * Double-checks both room string equality and classId consistency.
   */
  snapshotRoom(room: string, expectedClassId?: string | null): Record<string, PlayerState> {
    const out: Record<string, PlayerState> = {};
    this.meta.forEach((m, socketId) => {
      if (m.room !== room) return;
      if (expectedClassId !== undefined && m.classId !== expectedClassId) return;
      const p = this.players.get(socketId);
      if (p) out[socketId] = p;
    });
    return out;
  }

  snapshotLobbies(): Array<{ room: string; label: string; classId: string | null; players: number }> {
    const byRoom = new Map<string, { room: string; label: string; classId: string | null; players: number }>();
    this.meta.forEach((m) => {
      const entry = byRoom.get(m.room) || {
        room: m.room,
        label: m.classLabel,
        classId: m.classId,
        players: 0,
      };
      entry.players += 1;
      byRoom.set(m.room, entry);
    });
    return Array.from(byRoom.values()).sort((a, b) => b.players - a.players);
  }

  checkActionCooldown(socketId: string, minIntervalMs: number, now = Date.now()): boolean {
    const last = this.actionCooldowns.get(socketId) || 0;
    if (now - last < minIntervalMs) return false;
    this.actionCooldowns.set(socketId, now);
    return true;
  }

  forEachConnection(cb: (player: PlayerState, meta: ConnectionMeta, socketId: string) => void): void {
    this.meta.forEach((connectionMeta, socketId) => {
      const player = this.players.get(socketId);
      if (player) cb(player, connectionMeta, socketId);
    });
  }

  get onlineCount(): number {
    return this.players.size;
  }
}
