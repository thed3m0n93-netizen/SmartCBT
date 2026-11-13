/**
 * SmartCBT — Nusantara High game server (build 141, lobby kelas + akun build 142).
 *
 * Port logika multiplayer template "Nusantara High — Isometric School MMO"
 * (server.ts aslinya Express + Socket.IO berdiri sendiri) menjadi modul yang
 * MENEMPEL di http.Server SmartCBT yang sudah ada — tidak ada proses ketiga:
 *
 *   - path Socket.IO khusus `/game-socket.io` supaya tidak bertabrakan dengan
 *     dispatcher `/api/*`; handler request SmartCBT melewati path ini (lihat
 *     standalone.ts & vite.config.ts).
 *   - handshake WAJIB membawa token login SmartCBT (socket.handshake.auth.token)
 *     yang diverifikasi lewat `getSession()` — lobi sekolah tidak terbuka untuk
 *     anonim di origin publik.
 *
 * Build 142 — game menjadi bagian resmi akun & kelas:
 *   1. IDENTITAS DARI AKUN. Nama pemain SELALU dari sesi login (payload.name
 *      klien diabaikan); payload hanya boleh membawa kosmetik (seragam & warna).
 *   2. LOBI PER KELAS. Setiap koneksi dipetakan ke room Socket.IO
 *      `class:<class_id>` (siswa tanpa kelas → `class:none`; guru/admin →
 *      `staff`). SEMUA broadcast (gerak, join/leave, chat, emote, efek dunia)
 *      di-scope ke room — siswa kelas 10 dan 11 yang online bersamaan tidak
 *      pernah melihat avatar satu sama lain.
 *   3. PROGRES PERSISTEN PER AKUN. Tabel baru `game_nusantara_state`
 *      (xp, money, posisi, kosmetik) dimuat saat join dan disimpan saat
 *      disconnect + flush berkala — keluar-masuk game tidak kehilangan XP.
 *
 * state pemain tetap in-memory → deployment multi-instance butuh shared
 * layer (dicatat di FEATURES, sama seperti sesi login & SSE).
 */

import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Http2Server, Http2SecureServer } from "node:http2";
import { Server, type Socket } from "socket.io";
import { getSession } from "./auth-session.js";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "./utils.js";
import { getDbType, isMySqlLike } from "../db.js";
import {
  MAP_SIZE,
  QUIZ_BANK,
  SCHEDULES,
  buildSchoolMap,
  type Direction,
  type PlayerRole,
  type PlayerState,
} from "../../game/nusantara/schoolMap.js";

export const GAME_SOCKET_PATH = "/game-socket.io";

const schoolMap = buildSchoolMap();
const players = new Map<string, PlayerState>();
/** socket.id → identitas akun + room lobi kelas. */
interface ConnectionMeta {
  userId: string;
  role: string;
  room: string;
  classLabel: string;
}
const meta = new Map<string, ConnectionMeta>();
const actionCooldowns = new Map<string, number>();

let scheduleIndex = 0;
let scheduleTimer = SCHEDULES[0].duration;

let attached: Server | null = null;
let loopsStarted = false;

/* ── Tabel persistensi progres (self-heal, pola news.ts) ────────────────── */

let gameTableReady: Promise<void> | null = null;

function ensureGameTable(): Promise<void> {
  if (!gameTableReady) {
    gameTableReady = (async () => {
      const mysql = isMySqlLike(getDbType());
      const ddl = mysql
        ? `CREATE TABLE IF NOT EXISTS game_nusantara_state (
             user_id    CHAR(36)     NOT NULL,
             class_id   BIGINT       NULL,
             xp         INT          NOT NULL DEFAULT 0,
             money      INT          NOT NULL DEFAULT 10000,
             wx         DOUBLE       NULL,
             wy         DOUBLE       NULL,
             dir        VARCHAR(1)   NOT NULL DEFAULT 'n',
             uniform    VARCHAR(8)   NOT NULL DEFAULT 'sma',
             hair_color VARCHAR(16)  NOT NULL DEFAULT '#1e293b',
             skin_color VARCHAR(16)  NOT NULL DEFAULT '#f6d198',
             updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
             PRIMARY KEY (user_id),
             CONSTRAINT fk_gns_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
           )`
        : `CREATE TABLE IF NOT EXISTS game_nusantara_state (
             user_id    UUID        NOT NULL,
             class_id   BIGINT      NULL,
             xp         INT         NOT NULL DEFAULT 0,
             money      INT         NOT NULL DEFAULT 10000,
             wx         DOUBLE PRECISION NULL,
             wy         DOUBLE PRECISION NULL,
             dir        VARCHAR(1)  NOT NULL DEFAULT 'n',
             uniform    VARCHAR(8)  NOT NULL DEFAULT 'sma',
             hair_color VARCHAR(16) NOT NULL DEFAULT '#1e293b',
             skin_color VARCHAR(16) NOT NULL DEFAULT '#f6d198',
             updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
             CONSTRAINT pk_game_nusantara_state PRIMARY KEY (user_id),
             CONSTRAINT fk_gns_user FOREIGN KEY (user_id)
                 REFERENCES users(id) ON DELETE CASCADE
           )`;
      await query(ddl, []);
    })().catch((err) => {
      gameTableReady = null;
      throw err;
    });
  }
  return gameTableReady;
}

interface GameStateRow {
  xp: number | string;
  money: number | string;
  wx: number | string | null;
  wy: number | string | null;
  dir: string | null;
  uniform: string | null;
  hair_color: string | null;
  skin_color: string | null;
}

async function loadGameState(userId: string): Promise<GameStateRow | null> {
  try {
    await ensureGameTable();
    return await queryOne<GameStateRow>(
      `SELECT xp, money, wx, wy, dir, uniform, hair_color, skin_color
       FROM game_nusantara_state WHERE user_id = $1`,
      [userId]
    );
  } catch (err) {
    console.error("[nusantara] load game state failed:", err);
    return null;
  }
}

/** UPSERT progres — ON CONFLICT diterjemahkan db.ts ke ON DUPLICATE KEY (MySQL). */
async function saveGameState(userId: string, p: PlayerState): Promise<void> {
  try {
    await ensureGameTable();
    await query(
      `INSERT INTO game_nusantara_state (user_id, xp, money, wx, wy, dir, uniform, hair_color, skin_color, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         xp = EXCLUDED.xp, money = EXCLUDED.money, wx = EXCLUDED.wx,
         wy = EXCLUDED.wy, dir = EXCLUDED.dir, uniform = EXCLUDED.uniform,
         hair_color = EXCLUDED.hair_color, skin_color = EXCLUDED.skin_color,
         updated_at = NOW()`,
      [userId, p.xp, p.money, p.wx, p.wy, p.dir, p.role, p.hairColor, p.skinColor]
    );
  } catch (err) {
    console.error("[nusantara] save game state failed:", err);
  }
}

/* ── Lobi / room ─────────────────────────────────────────────────────────── */

function isWalkableServer(wx: number, wy: number): boolean {
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return false;
  return !schoolMap.solid[gy][gx];
}

/** Snapshot pemain DI DALAM room saja — ini inti isolasi antar kelas. */
function snapshotRoom(room: string): Record<string, PlayerState> {
  const out: Record<string, PlayerState> = {};
  meta.forEach((m, socketId) => {
    if (m.room !== room) return;
    const p = players.get(socketId);
    if (p) out[socketId] = p;
  });
  return out;
}

/**
 * Room lobi siswa: kelas dari student_profiles. Tanpa kelas → `class:none`
 * (tetap terisolasi dari kelas mana pun, tidak hilang). Staff → `staff`.
 */
async function resolveLobby(user: {
  id: string;
  role: string;
}): Promise<{ room: string; label: string; classId: number | string | null }> {
  if (user.role === "teacher" || user.role === "admin" || user.role === "super_admin") {
    return { room: "staff", label: "Ruang Guru", classId: null };
  }
  let row: { class_id: number | string | null; class_name: string | null; grade_level: string | null } | null = null;
  try {
    row = await queryOne(
      `SELECT sp.class_id, c.class_name, c.grade_level
       FROM student_profiles sp
       LEFT JOIN classes c ON c.id = sp.class_id
       WHERE sp.user_id = $1`,
      [user.id]
    );
  } catch (err) {
    console.error("[nusantara] resolve class failed:", err);
  }
  if (row?.class_id != null) {
    const label = `${row.grade_level ?? ""} ${row.class_name ?? ""}`.trim() || `Kelas ${row.class_id}`;
    return { room: `class:${row.class_id}`, label, classId: row.class_id };
  }
  return { room: "class:none", label: "Belum Ada Kelas", classId: null };
}

function snapshotLobbies() {
  const byRoom = new Map<string, { room: string; label: string; players: number }>();
  meta.forEach((m) => {
    const entry = byRoom.get(m.room) || { room: m.room, label: m.classLabel, players: 0 };
    entry.players += 1;
    byRoom.set(m.room, entry);
  });
  return Array.from(byRoom.values()).sort((a, b) => b.players - a.players);
}

const VALID_UNIFORMS: PlayerRole[] = ["sma", "smp", "osis", "guru"];
const VALID_DIRS: Direction[] = ["n", "s", "e", "w"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/* ── Handler ─────────────────────────────────────────────────────────────── */

function registerHandlers(io: Server) {
  io.use((socket, next) => {
    const token = String((socket.handshake.auth as any)?.token ?? "").trim();
    const user = getSession(token || undefined);
    if (!user) {
      next(new Error("UNAUTHORIZED_GAME_SESSION"));
      return;
    }
    (socket.data as any).smartcbtUser = user;
    next();
  });

  io.on("connection", (socket: Socket) => {
    socket.on("joinGame", async (payload?: { role?: string; hairColor?: string; skinColor?: string }) => {
      const user = (socket.data as any).smartcbtUser as
        | { id: string; full_name?: string; username?: string; role: string }
        | undefined;
      if (!user || meta.has(socket.id)) return;

      const { room, label, classId } = await resolveLobby(user);
      const saved = await loadGameState(user.id);

      // NAMA SELALU dari akun (build 142) — payload.name tidak pernah dibaca.
      const displayName = String(user.full_name || user.username || "Siswa").trim().slice(0, 24) || "Siswa";
      const uniform = VALID_UNIFORMS.includes(payload?.role as PlayerRole)
        ? (payload?.role as PlayerRole)
        : ((saved?.uniform as PlayerRole) || "sma");
      const hairColor = HEX_COLOR.test(String(payload?.hairColor ?? ""))
        ? String(payload?.hairColor)
        : saved?.hair_color || "#1e293b";
      const skinColor = HEX_COLOR.test(String(payload?.skinColor ?? ""))
        ? String(payload?.skinColor)
        : saved?.skin_color || "#f6d198";

      // Posisi: lanjut terakhir bila masih valid (peta bisa berubah).
      const savedX = Number(saved?.wx);
      const savedY = Number(saved?.wy);
      const useSaved =
        Number.isFinite(savedX) && Number.isFinite(savedY) && isWalkableServer(savedX, savedY);
      const spawnX = useSaved ? savedX : 15.5 + (Math.random() * 1.6 - 0.8);
      const spawnY = useSaved ? savedY : 27.5 + (Math.random() * 1.2 - 0.6);
      const dir = VALID_DIRS.includes(saved?.dir as Direction) ? (saved?.dir as Direction) : "s";

      const newPlayer: PlayerState = {
        id: socket.id,
        name: displayName,
        role: uniform,
        hairColor,
        skinColor,
        wx: spawnX,
        wy: spawnY,
        dir,
        moving: false,
        sprinting: false,
        sitting: false,
        jumpOffset: 0,
        xp: Math.max(0, Number(saved?.xp) || 0),
        money: Math.max(0, Number(saved?.money) || 10000),
        energy: 100,
      };

      players.set(socket.id, newPlayer);
      meta.set(socket.id, { userId: String(user.id), role: user.role, room, classLabel: label });
      await socket.join(room);

      socket.emit("initGame", {
        selfId: socket.id,
        players: snapshotRoom(room),
        phase: SCHEDULES[scheduleIndex],
        timer: scheduleTimer,
        // Build 142 — lobi & identitas akun.
        lobby: { kind: user.role === "student" ? "class" : "staff", label, classId },
        profile: { name: displayName, xp: newPlayer.xp, money: newPlayer.money, restored: useSaved },
      });

      socket.to(room).emit("playerJoined", newPlayer);
      io.to(room).emit("systemChat", `${displayName} baru saja memasuki gerbang sekolah.`);
    });

    socket.on(
      "playerMove",
      (data?: {
        wx?: number;
        wy?: number;
        dir?: Direction;
        moving?: boolean;
        sprinting?: boolean;
        sitting?: boolean;
        jumpOffset?: number;
      }) => {
        const p = players.get(socket.id);
        const m = meta.get(socket.id);
        if (!p || !m || !data) return;

        const nextWx = Number(data.wx);
        const nextWy = Number(data.wy);
        if (Number.isFinite(nextWx) && Number.isFinite(nextWy)) {
          const clampedX = Math.max(1.2, Math.min(MAP_SIZE - 1.2, nextWx));
          const clampedY = Math.max(1.2, Math.min(MAP_SIZE - 1.2, nextWy));
          if (isWalkableServer(clampedX, clampedY)) {
            p.wx = clampedX;
            p.wy = clampedY;
          }
        }

        if (data.dir && VALID_DIRS.includes(data.dir)) p.dir = data.dir;
        p.moving = Boolean(data.moving);
        p.sprinting = Boolean(data.sprinting);
        p.sitting = Boolean(data.sitting);
        p.jumpOffset = Math.max(0, Math.min(60, Number(data.jumpOffset) || 0));

        socket.to(m.room).emit("playerMoved", {
          id: socket.id,
          wx: p.wx,
          wy: p.wy,
          dir: p.dir,
          moving: p.moving,
          sprinting: p.sprinting,
          sitting: p.sitting,
          jumpOffset: p.jumpOffset,
        });
      }
    );

    socket.on("chatMessage", (msg: unknown) => {
      const p = players.get(socket.id);
      const m = meta.get(socket.id);
      if (!p || !m || typeof msg !== "string") return;
      const cleanMsg = msg.trim().slice(0, 90);
      if (!cleanMsg) return;
      // Chat hanya sesama penghuni lobi kelas (build 142).
      io.to(m.room).emit("chatBroadcast", {
        id: socket.id,
        name: p.name,
        role: p.role,
        text: cleanMsg,
        timestamp: Date.now(),
      });
    });

    socket.on("emote", (emoji: unknown) => {
      const p = players.get(socket.id);
      const m = meta.get(socket.id);
      if (!p || !m || typeof emoji !== "string") return;
      const cleanEmoji = emoji.trim().slice(0, 4);
      if (!cleanEmoji) return;
      io.to(m.room).emit("playerEmote", { id: socket.id, emoji: cleanEmoji });
    });

    socket.on("interactAction", (actionType: unknown) => {
      const p = players.get(socket.id);
      const m = meta.get(socket.id);
      if (!p || !m || typeof actionType !== "string") return;

      const now = Date.now();
      const last = actionCooldowns.get(socket.id) || 0;
      if (now - last < 800 && actionType !== "buy_food") return;
      actionCooldowns.set(socket.id, now);

      if (actionType === "study" || actionType === "read") {
        p.xp += 15;
        p.money += 250;
      } else if (actionType === "buy_food") {
        if (p.money < 2000) {
          socket.emit("actionFeedback", { ok: false, message: "Uang saku belum cukup (butuh Rp 2.000)." });
          return;
        }
        p.money -= 2000;
      } else if (actionType === "basketball") {
        p.xp += 10;
        const scored = Math.random() > 0.35;
        if (scored) p.xp += 5;
        io.to(m.room).emit("worldEffect", { type: "basketball", playerId: socket.id, name: p.name, scored });
      } else if (actionType === "locker") {
        p.money += 100;
      }

      socket.emit("statsUpdate", { xp: p.xp, money: p.money });
    });

    socket.on("quizAnswer", (payload?: { questionId?: number; selectedIndex?: number }) => {
      const p = players.get(socket.id);
      if (!p) return;
      const q = QUIZ_BANK.find((item) => item.id === payload?.questionId);
      if (!q) return;

      if (q.answerIndex === payload?.selectedIndex) {
        p.xp += 30;
        p.money += 1000;
        socket.emit("statsUpdate", { xp: p.xp, money: p.money });
        socket.emit("quizResult", { correct: true, message: "Jawaban benar! +30 XP & Rp 1.000" });
      } else {
        socket.emit("quizResult", {
          correct: false,
          message: `Kurang tepat. Jawaban benar: ${q.options[q.answerIndex]}`,
        });
      }
    });

    socket.on("disconnect", () => {
      const p = players.get(socket.id);
      const m = meta.get(socket.id);
      if (p && m) {
        io.to(m.room).emit("systemChat", `${p.name} telah pulang dari sekolah.`);
        io.to(m.room).emit("playerLeft", socket.id);
        // Progres tersimpan per akun — sesi berikutnya lanjut dari sini.
        void saveGameState(m.userId, p);
      }
      players.delete(socket.id);
      meta.delete(socket.id);
      actionCooldowns.delete(socket.id);
    });
  });
}

/** Interval dunia — sekali per proses. */
function startWorldLoops(io: Server) {
  if (loopsStarted) return;
  loopsStarted = true;

  setInterval(() => {
    scheduleTimer -= 1;
    if (scheduleTimer <= 0) {
      scheduleIndex = (scheduleIndex + 1) % SCHEDULES.length;
      scheduleTimer = SCHEDULES[scheduleIndex].duration;
      io.emit("schoolBell", { phase: SCHEDULES[scheduleIndex], timer: scheduleTimer });
    } else {
      io.emit("timeSync", { phase: SCHEDULES[scheduleIndex], timer: scheduleTimer });
    }
  }, 1000).unref?.();

  setInterval(() => {
    players.forEach((player, id) => {
      player.money += 500;
      io.to(id).emit("statsUpdate", { xp: player.xp, money: player.money });
    });
  }, 20000).unref?.();

  // Flush persistensi berkala — server crash tidak menghapus progression.
  setInterval(() => {
    meta.forEach((m, socketId) => {
      const p = players.get(socketId);
      if (p) void saveGameState(m.userId, p);
    });
  }, 60000).unref?.();
}

/**
 * Tipe target pasang — persis union yang diterima konstruktor Socket.IO,
 * supaya `http.Server` (standalone) dan `server.httpServer` (Vite, yang
 * berupa union http/http2) sama-sama assignable tanpa cast.
 */
export type GameAttachTarget =
  | HttpServer
  | HttpsServer
  | Http2Server
  | Http2SecureServer;

/**
 * Pasang server game di http.Server SmartCBT (dipanggil sekali dari
 * standalone.ts dan plugin dev Vite). Idempoten.
 */
export function attachNusantaraGame(httpServer: GameAttachTarget): Server {
  if (attached) return attached;
  const io = new Server(httpServer, {
    path: GAME_SOCKET_PATH,
    cors: { origin: "*" },
    serveClient: false,
  });
  registerHandlers(io);
  startWorldLoops(io);
  attached = io;
  console.log(`[nusantara] game socket ready at ${GAME_SOCKET_PATH} (lobi per kelas, in-memory)`);
  return io;
}

/** Status ringkas untuk panel System Health / troubleshooting (staff). */
export function getNusantaraGameStatus() {
  return {
    attached: attached !== null,
    playersOnline: players.size,
    lobbies: snapshotLobbies(),
    phase: SCHEDULES[scheduleIndex].name,
    socketPath: GAME_SOCKET_PATH,
  };
}

// GET /api/game/nusantara/status — staff-only, ikut dispatcher /api.
addRoute("GET", /^\/api\/game\/nusantara\/status$/, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser;
  const staff = user && (user.role === "teacher" || user.role === "admin" || user.role === "super_admin");
  if (!staff) return json(res, { error: "Hanya guru/admin yang dapat melihat status game." }, 403);
  json(res, getNusantaraGameStatus());
});
