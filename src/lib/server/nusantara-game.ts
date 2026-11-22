/**
 * SmartCBT — Nusantara High game server (modularized & strict class-room isolation).
 *
 * Modules:
 *  - `nusantara-rooms.ts` — Pure class-room resolution & in-memory room registry.
 *  - `nusantara-store.ts` — SQL repository (`game_nusantara_state`, `student_profiles`).
 *  - `nusantara-game.ts`  — Socket.IO gateway, room-scoped event dispatcher,
 *                           world schedule/payday loops, and health route.
 */

import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Http2Server, Http2SecureServer } from "node:http2";
import { Server, type Socket } from "socket.io";
import { getSession } from "./auth-session.js";
import { addRoute, json, type AuthenticatedRequest } from "./utils.js";
import {
  NusantaraRoomRegistry,
  resolveLobbyDescriptor,
  type LobbyDescriptor,
  type StudentClassProfileRow,
} from "./nusantara-rooms.js";
import {
  fetchStudentClassProfile,
  loadGameState,
  saveGameState,
} from "./nusantara-store.js";
import {
  MAP_SIZE,
  QUIZ_BANK,
  SCHEDULES,
  buildSchoolMap,
  type Direction,
  type HairStyle,
  type PlayerRole,
  type PlayerState,
} from "../../game/nusantara/schoolMap.js";

export const GAME_SOCKET_PATH = "/game-socket.io";

const schoolMap = buildSchoolMap();
const registry = new NusantaraRoomRegistry();

let scheduleIndex = 0;
let scheduleTimer = SCHEDULES[0].duration;

let attached: Server | null = null;
let loopsStarted = false;

const VALID_UNIFORMS: PlayerRole[] = ["sma", "smp", "osis", "guru"];
const VALID_HAIR_STYLES: HairStyle[] = ["short", "long", "hijab"];
const VALID_DIRS: Direction[] = ["n", "s", "e", "w"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isWalkableServer(wx: number, wy: number): boolean {
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return false;
  return !schoolMap.solid[gy][gx];
}

async function resolveAuthoritativeLobby(user: {
  id: string;
  role: string;
}): Promise<LobbyDescriptor> {
  if (user.role === "teacher" || user.role === "admin" || user.role === "super_admin") {
    return resolveLobbyDescriptor(user, null);
  }
  const profile: StudentClassProfileRow | null = await fetchStudentClassProfile(user.id);
  return resolveLobbyDescriptor(user, profile);
}

/** Ensures a socket leaves all rooms other than its own private socket.id room. */
async function leaveNonSelfRooms(socket: Socket): Promise<void> {
  const staleRooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
  for (const room of staleRooms) {
    await socket.leave(room);
  }
}

/** Room-scoped broadcast helper so no player event ever leaks globally. */
function emitToRoom(io: Server, room: string, event: string, payload: unknown): void {
  io.to(room).emit(event, payload);
}

function emitToRoomExceptSender(
  socket: Socket,
  room: string,
  event: string,
  payload: unknown
): void {
  if (!socket.rooms.has(room)) return;
  socket.to(room).emit(event, payload);
}

/**
 * Evicts any pre-existing live socket belonging to the same userId before
 * registering a fresh connection, preventing duplicate ghost avatars when
 * a student opens a new tab or reconnects.
 */
function evictPreviousUserSockets(io: Server, userId: string, currentSocketId: string): void {
  const existingIds = registry.findSocketsByUserId(userId);
  for (const oldSocketId of existingIds) {
    if (oldSocketId === currentSocketId) continue;
    const removed = registry.removePlayer(oldSocketId);
    if (removed) {
      emitToRoom(io, removed.meta.room, "playerLeft", oldSocketId);
      void saveGameState(removed.meta.userId, removed.player, removed.meta.classId);
    }
    const oldSocket = io.sockets.sockets.get(oldSocketId);
    if (oldSocket) {
      oldSocket.emit("joinError", {
        message: "Sesi game dibuka di tab atau perangkat lain.",
      });
      oldSocket.disconnect(true);
    }
  }
}

function registerHandlers(io: Server): void {
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
    socket.on(
      "joinGame",
      async (payload?: {
        role?: string;
        hairStyle?: string;
        hairColor?: string;
        skinColor?: string;
      }) => {
        const user = (socket.data as any).smartcbtUser as
          | { id: string; full_name?: string; username?: string; role: string }
          | undefined;
        if (!user || !registry.beginJoin(socket.id)) return;

        try {
          let lobby: LobbyDescriptor;
          try {
            lobby = await resolveAuthoritativeLobby(user);
          } catch (err) {
            console.error("[nusantara] resolve authoritative lobby failed:", err);
            if (socket.connected) {
              socket.emit("joinError", {
                message: "Gagal memverifikasi data kelas dari server. Coba masuk kembali.",
              });
            }
            return;
          }

          const saved = await loadGameState(user.id);
          if (!socket.connected) return;

          // Evict older tabs/connections of the same user only after DB verification succeeds.
          evictPreviousUserSockets(io, user.id, socket.id);

          // NAMA SELALU dari akun — payload.name tidak pernah dibaca.
          const displayName =
            String(user.full_name || user.username || "Siswa").trim().slice(0, 24) || "Siswa";
          const uniform = VALID_UNIFORMS.includes(payload?.role as PlayerRole)
            ? (payload?.role as PlayerRole)
            : (saved?.uniform as PlayerRole) || "sma";
          const hairStyle: HairStyle = VALID_HAIR_STYLES.includes(payload?.hairStyle as HairStyle)
            ? (payload?.hairStyle as HairStyle)
            : VALID_HAIR_STYLES.includes(saved?.hair_style as HairStyle)
              ? (saved?.hair_style as HairStyle)
              : "short";
          const hairColor = HEX_COLOR.test(String(payload?.hairColor ?? ""))
            ? String(payload?.hairColor)
            : saved?.hair_color || (hairStyle === "hijab" ? "#f8fafc" : "#1e293b");
          const skinColor = HEX_COLOR.test(String(payload?.skinColor ?? ""))
            ? String(payload?.skinColor)
            : saved?.skin_color || "#f6d198";

          const savedX = Number(saved?.wx);
          const savedY = Number(saved?.wy);
          const useSaved =
            Number.isFinite(savedX) &&
            Number.isFinite(savedY) &&
            isWalkableServer(savedX, savedY);
          const spawnX = useSaved ? savedX : 15.5 + (Math.random() * 1.6 - 0.8);
          const spawnY = useSaved ? savedY : 27.5 + (Math.random() * 1.2 - 0.6);
          const dir = VALID_DIRS.includes(saved?.dir as Direction)
            ? (saved?.dir as Direction)
            : "s";

          const newPlayer: PlayerState = {
            id: socket.id,
            name: displayName,
            role: uniform,
            hairStyle,
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

          await leaveNonSelfRooms(socket);
          if (!socket.connected) return;

          await socket.join(lobby.room);
          if (!socket.connected) return;

          registry.registerPlayer(socket.id, newPlayer, {
            userId: String(user.id),
            role: user.role,
            room: lobby.room,
            classId: lobby.classId,
            classLabel: lobby.label,
          });

          socket.emit("initGame", {
            selfId: socket.id,
            players: registry.snapshotRoom(lobby.room, lobby.classId),
            phase: SCHEDULES[scheduleIndex],
            timer: scheduleTimer,
            lobby: {
              room: lobby.room,
              kind: lobby.kind,
              label: lobby.label,
              classId: lobby.classId,
            },
            profile: {
              name: displayName,
              xp: newPlayer.xp,
              money: newPlayer.money,
              restored: useSaved,
            },
          });

          emitToRoomExceptSender(socket, lobby.room, "playerJoined", {
            ...newPlayer,
            room: lobby.room,
          });
          emitToRoom(
            io,
            lobby.room,
            "systemChat",
            `${displayName} baru saja memasuki gerbang sekolah.`
          );
        } finally {
          registry.endJoin(socket.id);
        }
      }
    );

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
        const entry = registry.getPlayer(socket.id);
        if (!entry || !data) return;
        const { player: p, meta: m } = entry;

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

        emitToRoomExceptSender(socket, m.room, "playerMoved", {
          id: socket.id,
          room: m.room,
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
      const entry = registry.getPlayer(socket.id);
      if (!entry || typeof msg !== "string") return;
      const { player: p, meta: m } = entry;
      const cleanMsg = msg.trim().slice(0, 90);
      if (!cleanMsg) return;

      emitToRoom(io, m.room, "chatBroadcast", {
        id: socket.id,
        room: m.room,
        name: p.name,
        role: p.role,
        text: cleanMsg,
        timestamp: Date.now(),
      });
    });

    socket.on("emote", (emoji: unknown) => {
      const entry = registry.getPlayer(socket.id);
      if (!entry || typeof emoji !== "string") return;
      const { meta: m } = entry;
      const cleanEmoji = emoji.trim().slice(0, 4);
      if (!cleanEmoji) return;

      emitToRoom(io, m.room, "playerEmote", {
        id: socket.id,
        room: m.room,
        emoji: cleanEmoji,
      });
    });

    socket.on("interactAction", (actionType: unknown) => {
      const entry = registry.getPlayer(socket.id);
      if (!entry || typeof actionType !== "string") return;
      const { player: p, meta: m } = entry;

      if (actionType !== "buy_food" && !registry.checkActionCooldown(socket.id, 800)) {
        return;
      }

      if (actionType === "study" || actionType === "read") {
        p.xp += 15;
        p.money += 250;
      } else if (actionType === "buy_food") {
        if (p.money < 2000) {
          socket.emit("actionFeedback", {
            ok: false,
            message: "Uang saku belum cukup (butuh Rp 2.000).",
          });
          return;
        }
        p.money -= 2000;
      } else if (actionType === "basketball") {
        p.xp += 10;
        const scored = Math.random() > 0.35;
        if (scored) p.xp += 5;
        emitToRoom(io, m.room, "worldEffect", {
          type: "basketball",
          room: m.room,
          playerId: socket.id,
          name: p.name,
          scored,
        });
      } else if (actionType === "locker") {
        p.money += 100;
      }

      socket.emit("statsUpdate", { xp: p.xp, money: p.money });
    });

    socket.on("quizAnswer", (payload?: { questionId?: number; selectedIndex?: number }) => {
      const entry = registry.getPlayer(socket.id);
      if (!entry) return;
      const { player: p } = entry;
      const q = QUIZ_BANK.find((item) => item.id === payload?.questionId);
      if (!q) return;

      if (q.answerIndex === payload?.selectedIndex) {
        p.xp += 30;
        p.money += 1000;
        socket.emit("statsUpdate", { xp: p.xp, money: p.money });
        socket.emit("quizResult", {
          correct: true,
          message: "Jawaban benar! +30 XP & Rp 1.000",
        });
      } else {
        socket.emit("quizResult", {
          correct: false,
          message: `Kurang tepat. Jawaban benar: ${q.options[q.answerIndex]}`,
        });
      }
    });

    socket.on("disconnect", () => {
      const removed = registry.removePlayer(socket.id);
      if (!removed) return;
      const { player: p, meta: m } = removed;
      emitToRoom(io, m.room, "systemChat", `${p.name} telah pulang dari sekolah.`);
      emitToRoom(io, m.room, "playerLeft", socket.id);
      void saveGameState(m.userId, p, m.classId);
    });
  });
}

/** Interval dunia — sekali per proses. */
function startWorldLoops(io: Server): void {
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
    registry.forEachConnection((player, _meta, socketId) => {
      player.money += 500;
      io.to(socketId).emit("statsUpdate", { xp: player.xp, money: player.money });
    });
  }, 20000).unref?.();

  // Flush persistensi berkala — server crash tidak menghapus progression.
  setInterval(() => {
    registry.forEachConnection((player, meta) => {
      void saveGameState(meta.userId, player, meta.classId);
    });
  }, 60000).unref?.();
}

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
  const lobbies = registry.snapshotLobbies();
  return {
    attached: attached !== null,
    playersOnline: registry.onlineCount,
    isolatedRooms: lobbies.length,
    lobbies,
    phase: SCHEDULES[scheduleIndex].name,
    socketPath: GAME_SOCKET_PATH,
  };
}

// GET /api/game/nusantara/status — staff-only, ikut dispatcher /api.
addRoute("GET", /^\/api\/game\/nusantara\/status$/, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser;
  const staff =
    user && (user.role === "teacher" || user.role === "admin" || user.role === "super_admin");
  if (!staff) {
    return json(res, { error: "Hanya guru/admin yang dapat melihat status game." }, 403);
  }
  json(res, getNusantaraGameStatus());
});
