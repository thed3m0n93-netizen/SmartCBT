/**
 * SmartCBT — Nusantara High game server (build 141).
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
 *     anonim di origin publik. Ini melanjutkan pola otorisasi build 139.
 *   - state pemain in-memory seperti template: sama seperti sesi login & SSE,
 *     deployment multi-instance butuh shared layer (dicatat di FEATURES).
 *
 * Aturan game (jadwal bel, uang saku pasif, XP interaksi, quiz QUIZ_BANK)
 * dipertahankan 1:1 dari template — yang berubah hanya transport & auth.
 */

import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Http2Server, Http2SecureServer } from "node:http2";
import { Server, type Socket } from "socket.io";
import { getSession } from "./auth-session.js";
import { addRoute, json, type AuthenticatedRequest } from "./utils.js";
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
/** socket.id → user id SmartCBT (audit ringan; tidak dikirim ke klien). */
const sessionOf = new Map<string, string>();
const actionCooldowns = new Map<string, number>();

let scheduleIndex = 0;
let scheduleTimer = SCHEDULES[0].duration;

let attached: Server | null = null;
let loopsStarted = false;

function isWalkableServer(wx: number, wy: number): boolean {
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return false;
  return !schoolMap.solid[gy][gx];
}

function snapshotPlayers(): Record<string, PlayerState> {
  const out: Record<string, PlayerState> = {};
  players.forEach((p, id) => {
    out[id] = p;
  });
  return out;
}

/** Interval dunia (bel sekolah + uang saku pasif) — sekali per proses. */
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
}

function registerHandlers(io: Server) {
  // Handshake auth: token login SmartCBT di payload `auth` klien.
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
    socket.on("joinGame", (payload?: { name?: string; role?: string }) => {
      const user = (socket.data as any).smartcbtUser as
        | { id: string; full_name?: string; username?: string }
        | undefined;
      if (!user || players.has(socket.id)) return;

      const fallback = String(user.full_name || user.username || "Siswa").trim();
      const cleanName = String(payload?.name || fallback).trim().slice(0, 14) || fallback || "Siswa";
      const validRoles: PlayerRole[] = ["sma", "smp", "osis", "guru"];
      const role: PlayerRole = validRoles.includes(payload?.role as PlayerRole)
        ? (payload?.role as PlayerRole)
        : "sma";

      const newPlayer: PlayerState = {
        id: socket.id,
        name: cleanName,
        role,
        hairColor: "#1e293b",
        skinColor: "#f6d198",
        wx: 15.5 + (Math.random() * 1.6 - 0.8),
        wy: 27.5 + (Math.random() * 1.2 - 0.6),
        dir: "n",
        moving: false,
        sprinting: false,
        sitting: false,
        jumpOffset: 0,
        xp: 0,
        money: 10000,
        energy: 100,
      };

      players.set(socket.id, newPlayer);
      if (user.id) sessionOf.set(socket.id, String(user.id));

      socket.emit("initGame", {
        selfId: socket.id,
        players: snapshotPlayers(),
        phase: SCHEDULES[scheduleIndex],
        timer: scheduleTimer,
      });
      socket.broadcast.emit("playerJoined", newPlayer);
      io.emit("systemChat", `${cleanName} baru saja memasuki gerbang sekolah.`);
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
        if (!p || !data) return;

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

        const validDirs: Direction[] = ["n", "s", "e", "w"];
        if (data.dir && validDirs.includes(data.dir)) p.dir = data.dir;
        p.moving = Boolean(data.moving);
        p.sprinting = Boolean(data.sprinting);
        p.sitting = Boolean(data.sitting);
        p.jumpOffset = Math.max(0, Math.min(60, Number(data.jumpOffset) || 0));

        socket.broadcast.emit("playerMoved", {
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
      if (!p || typeof msg !== "string") return;
      const cleanMsg = msg.trim().slice(0, 90);
      if (!cleanMsg) return;
      io.emit("chatBroadcast", {
        id: socket.id,
        name: p.name,
        role: p.role,
        text: cleanMsg,
        timestamp: Date.now(),
      });
    });

    socket.on("emote", (emoji: unknown) => {
      const p = players.get(socket.id);
      if (!p || typeof emoji !== "string") return;
      const cleanEmoji = emoji.trim().slice(0, 4);
      if (!cleanEmoji) return;
      io.emit("playerEmote", { id: socket.id, emoji: cleanEmoji });
    });

    socket.on("interactAction", (actionType: unknown) => {
      const p = players.get(socket.id);
      if (!p || typeof actionType !== "string") return;

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
        io.emit("worldEffect", { type: "basketball", playerId: socket.id, name: p.name, scored });
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
      if (p) {
        io.emit("systemChat", `${p.name} telah pulang dari sekolah.`);
        players.delete(socket.id);
        sessionOf.delete(socket.id);
        actionCooldowns.delete(socket.id);
        io.emit("playerLeft", socket.id);
      }
    });
  });
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
  console.log(`[nusantara] game socket ready at ${GAME_SOCKET_PATH} (in-memory, single instance)`);
  return io;
}

/** Status ringkas untuk panel System Health / troubleshooting (staff). */
export function getNusantaraGameStatus() {
  return {
    attached: attached !== null,
    playersOnline: players.size,
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
