import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthToken } from '../../lib/api';
import type {
  ChatBubble,
  EmoteEffect,
  MoveTarget,
  RenderPlayer,
  WorldEffect,
} from './isoRenderer';
import { soundFX } from './sound';
import type { HairStyle, PlayerRole, PlayerState, SchoolPhase } from './schoolMap';
import type { CharacterConfig, ChatMessage, GameToast, HudStats, LobbyInfo } from './types';

interface UseNusantaraSocketOptions {
  playersRef: MutableRefObject<Record<string, RenderPlayer>>;
  selfIdRef: MutableRefObject<string | null>;
  energyRef: MutableRefObject<number>;
  chatBubblesRef: MutableRefObject<Record<string, ChatBubble>>;
  emotesRef: MutableRefObject<Record<string, EmoteEffect>>;
  worldEffectsRef: MutableRefObject<WorldEffect[]>;
  moveTargetRef: MutableRefObject<MoveTarget | null>;
  phaseRef: MutableRefObject<SchoolPhase>;
  onInitSuccess: (payload: {
    playerName: string;
    playerRole: PlayerRole;
    cosmetics: CharacterConfig;
    onlineCount: number;
    lobbyLabel: string | null;
    hudStats: HudStats;
    phase: SchoolPhase;
    timer: number;
  }) => void;
  onSelfAppearanceChange?: (cosmetics: CharacterConfig) => void;
  onOnlineCountChange: (count: number) => void;
  onPhaseChange: (phase: SchoolPhase, timer: number) => void;
  onStatsUpdate: (stats: { xp: number; money: number }) => void;
  onAppendChat: (msg: ChatMessage) => void;
  onTriggerToast: (text: string, tone?: GameToast['tone']) => void;
  onQuizClose: () => void;
  onConnectionState: (connecting: boolean, error: string | null) => void;
}

function toRenderPlayer(p: PlayerState): RenderPlayer {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    hairStyle: p.hairStyle || 'short',
    hairColor: p.hairColor,
    skinColor: p.skinColor,
    wx: p.wx,
    wy: p.wy,
    renderWx: p.wx,
    renderWy: p.wy,
    dir: p.dir,
    moving: p.moving,
    sprinting: p.sprinting,
    sitting: p.sitting,
    jumpOffset: p.jumpOffset || 0,
    walkPhase: 0,
  };
}

export function useNusantaraSocket(opts: UseNusantaraSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  const pendingJoinRef = useRef<CharacterConfig | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const socket = io({
      path: '/game-socket.io',
      auth: (cb) => cb({ token: getAuthToken() ?? '' }),
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    const isSameRoomEvent = (incomingRoom?: string): boolean => {
      if (!incomingRoom || !activeRoomRef.current) return true;
      return incomingRoom === activeRoomRef.current;
    };

    socket.on('connect', () => {
      if (pendingJoinRef.current) {
        socket.emit('joinGame', pendingJoinRef.current);
      }
    });

    socket.on('connect_error', (err) => {
      const denied = /unauthorized|auth/i.test(String(err?.message || ''));
      optsRef.current.onConnectionState(
        false,
        denied
          ? 'Sesi login tidak dikenali untuk mode game. Muat ulang halaman atau login kembali.'
          : 'Koneksi ke server terganggu. Mencoba menghubungkan ulang...'
      );
    });

    socket.on('joinError', (payload: { message?: string }) => {
      pendingJoinRef.current = null;
      const msg = payload?.message || 'Gagal masuk ke lobi kelas.';
      optsRef.current.onConnectionState(false, msg);
      optsRef.current.onTriggerToast(msg, 'warn');
    });

    socket.on(
      'initGame',
      (data: {
        selfId: string;
        players: Record<string, PlayerState>;
        phase: SchoolPhase;
        timer: number;
        lobby?: LobbyInfo;
        profile?: { name?: string; xp?: number; money?: number; restored?: boolean };
      }) => {
        pendingJoinRef.current = null;
        const cur = optsRef.current;
        cur.selfIdRef.current = data.selfId;
        activeRoomRef.current = data.lobby?.room ?? null;

        // Clear any leftover visual FX / chat bubbles from a previous session
        cur.chatBubblesRef.current = {};
        cur.emotesRef.current = {};
        cur.worldEffectsRef.current = [];
        cur.moveTargetRef.current = null;

        const nextMap: Record<string, RenderPlayer> = {};
        Object.values(data.players).forEach((pl) => {
          nextMap[pl.id] = toRenderPlayer(pl);
        });
        cur.playersRef.current = nextMap;
        cur.energyRef.current = 100;
        cur.phaseRef.current = data.phase;

        const me = data.players[data.selfId];
        const cosmetics: CharacterConfig = {
          role: me?.role ?? 'sma',
          hairStyle: me?.hairStyle ?? 'short',
          hairColor: me?.hairColor ?? '#1e293b',
          skinColor: me?.skinColor ?? '#f6d198',
        };

        cur.onInitSuccess({
          playerName: me?.name ?? data.profile?.name ?? 'Siswa',
          playerRole: cosmetics.role,
          cosmetics,
          onlineCount: Object.keys(nextMap).length,
          lobbyLabel: data.lobby?.label ?? null,
          hudStats: {
            xp: me?.xp ?? data.profile?.xp ?? 0,
            money: me?.money ?? data.profile?.money ?? 10000,
            energy: 100,
          },
          phase: data.phase,
          timer: data.timer,
        });

        cur.onAppendChat({
          id: `sys-welcome-${Date.now()}`,
          text: `Selamat datang di lobi ${data.lobby?.label ?? 'sekolah'}${
            data.profile?.restored ? ' — progresmu dipulihkan' : ''
          }. Tekan Enter untuk chat, [E] di perpustakaan untuk Modul & Tugas.`,
          system: true,
        });
      }
    );

    socket.on('playerJoined', (p: PlayerState & { room?: string }) => {
      if (!isSameRoomEvent(p.room)) return;
      const cur = optsRef.current;
      cur.playersRef.current[p.id] = toRenderPlayer(p);
      cur.onOnlineCountChange(Object.keys(cur.playersRef.current).length);
    });

    socket.on(
      'playerUpdated',
      (data: {
        id: string;
        room?: string;
        role: PlayerRole;
        hairStyle: HairStyle;
        hairColor: string;
        skinColor: string;
      }) => {
        if (!isSameRoomEvent(data.room)) return;
        const cur = optsRef.current;
        const target = cur.playersRef.current[data.id];
        if (target) {
          target.role = data.role;
          target.hairStyle = data.hairStyle || 'short';
          target.hairColor = data.hairColor;
          target.skinColor = data.skinColor;
        }
        if (data.id === cur.selfIdRef.current) {
          cur.onSelfAppearanceChange?.({
            role: data.role,
            hairStyle: data.hairStyle || 'short',
            hairColor: data.hairColor,
            skinColor: data.skinColor,
          });
        }
      }
    );

    socket.on(
      'playerMoved',
      (data: {
        id: string;
        room?: string;
        wx: number;
        wy: number;
        dir: RenderPlayer['dir'];
        moving: boolean;
        sprinting: boolean;
        sitting: boolean;
        jumpOffset: number;
      }) => {
        if (!isSameRoomEvent(data.room)) return;
        const p = optsRef.current.playersRef.current[data.id];
        if (!p) return;
        p.wx = data.wx;
        p.wy = data.wy;
        p.dir = data.dir;
        p.moving = data.moving;
        p.sprinting = data.sprinting;
        p.sitting = data.sitting;
        p.jumpOffset = data.jumpOffset;
      }
    );

    socket.on('playerLeft', (id: string) => {
      const cur = optsRef.current;
      delete cur.playersRef.current[id];
      delete cur.chatBubblesRef.current[id];
      delete cur.emotesRef.current[id];
      cur.onOnlineCountChange(Object.keys(cur.playersRef.current).length);
    });

    socket.on(
      'chatBroadcast',
      (data: {
        id: string;
        room?: string;
        name: string;
        role: PlayerRole;
        text: string;
        timestamp?: number;
      }) => {
        if (!isSameRoomEvent(data.room)) return;
        const cur = optsRef.current;
        cur.onAppendChat({
          id: `${data.id}-${data.timestamp || Date.now()}-${Math.random()}`,
          sender: data.name,
          role: data.role,
          text: data.text,
        });
        cur.chatBubblesRef.current[data.id] = {
          text: data.text,
          expires: performance.now() + 4500,
        };
      }
    );

    socket.on('systemChat', (text: string) => {
      optsRef.current.onAppendChat({
        id: `sys-${Date.now()}-${Math.random()}`,
        text,
        system: true,
      });
    });

    socket.on('playerEmote', ({ id, room, emoji }: { id: string; room?: string; emoji: string }) => {
      if (!isSameRoomEvent(room)) return;
      optsRef.current.emotesRef.current[id] = {
        emoji,
        expires: performance.now() + 2400,
      };
    });

    socket.on('schoolBell', ({ phase: nextPhase, timer }: { phase: SchoolPhase; timer: number }) => {
      const cur = optsRef.current;
      cur.phaseRef.current = nextPhase;
      cur.onPhaseChange(nextPhase, timer);
      soundFX.playSchoolBell();
      cur.onTriggerToast(`Bel Sekolah: ${nextPhase.name}`, 'info');
    });

    socket.on('timeSync', ({ phase: nextPhase, timer }: { phase: SchoolPhase; timer: number }) => {
      const cur = optsRef.current;
      cur.phaseRef.current = nextPhase;
      cur.onPhaseChange(nextPhase, timer);
    });

    socket.on('statsUpdate', (stats: { xp: number; money: number }) => {
      optsRef.current.onStatsUpdate(stats);
    });

    socket.on('actionFeedback', (fb: { ok: boolean; message: string }) => {
      optsRef.current.onTriggerToast(fb.message, fb.ok ? 'ok' : 'warn');
      soundFX.playInteract(fb.ok);
    });

    socket.on('quizResult', (res: { correct: boolean; message: string }) => {
      const cur = optsRef.current;
      cur.onQuizClose();
      cur.onTriggerToast(res.message, res.correct ? 'ok' : 'warn');
      soundFX.playInteract(res.correct);
    });

    socket.on(
      'worldEffect',
      (ef: { type: string; room?: string; playerId: string; name: string; scored?: boolean }) => {
        if (!isSameRoomEvent(ef.room)) return;
        const cur = optsRef.current;
        const shooter = cur.playersRef.current[ef.playerId];
        if (ef.type === 'basketball' && shooter) {
          cur.worldEffectsRef.current.push({
            type: 'ball',
            wx: shooter.renderWx,
            wy: shooter.renderWy,
            targetWx: 25.5,
            targetWy: shooter.renderWy < 20.5 ? 15.5 : 26.5,
            progress: 0,
            scored: ef.scored,
          });
          if (ef.playerId === cur.selfIdRef.current) {
            soundFX.playInteract(true);
            cur.onTriggerToast(
              ef.scored ? 'Bola masuk ring! +15 XP' : 'Lemparan bagus! +10 XP',
              ef.scored ? 'ok' : 'info'
            );
          }
        }
      }
    );

    return () => {
      pendingJoinRef.current = null;
      socket.disconnect();
      socketRef.current = null;
      activeRoomRef.current = null;
    };
  }, []);

  const joinGame = useCallback((config: CharacterConfig) => {
    const socket = socketRef.current;
    if (!socket) return;
    pendingJoinRef.current = config;
    optsRef.current.onConnectionState(true, null);
    if (socket.connected) {
      socket.emit('joinGame', config);
    } else {
      socket.connect();
    }
  }, []);

  const updateAppearance = useCallback((config: CharacterConfig) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (socket.connected) {
      socket.emit('updateAppearance', config);
    }
  }, []);

  const emitMove = useCallback(
    (payload: {
      wx: number;
      wy: number;
      dir: RenderPlayer['dir'];
      moving: boolean;
      sprinting: boolean;
      sitting: boolean;
      jumpOffset: number;
    }) => {
      socketRef.current?.emit('playerMove', payload);
    },
    []
  );

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed && socketRef.current) {
      socketRef.current.emit('chatMessage', trimmed);
    }
  }, []);

  const sendEmote = useCallback((emoji: string) => {
    if (!optsRef.current.selfIdRef.current || !socketRef.current) return;
    socketRef.current.emit('emote', emoji);
  }, []);

  const sendInteract = useCallback((actionType: string) => {
    socketRef.current?.emit('interactAction', actionType);
  }, []);

  const sendQuizAnswer = useCallback((questionId: number, selectedIndex: number) => {
    socketRef.current?.emit('quizAnswer', { questionId, selectedIndex });
  }, []);

  return {
    joinGame,
    updateAppearance,
    emitMove,
    sendChat,
    sendEmote,
    sendInteract,
    sendQuizAnswer,
  };
}

