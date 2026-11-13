import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Send, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { LoginScreen } from './LoginScreen';
import { QuizModal } from './QuizModal';
import {
  renderMinimap,
  renderSchoolScene,
  screenToWorld,
  toIso,
  type ChatBubble,
  type EmoteEffect,
  type MoveTarget,
  type RenderPlayer,
  type WorldEffect,
} from './isoRenderer';
import { soundFX } from './sound';
import {
  MAP_SIZE,
  QUIZ_BANK,
  SCHEDULES,
  buildSchoolMap,
  getZoneName,
  type PlayerRole,
  type PlayerState,
  type QuizQuestion,
  type SchoolPhase,
} from './schoolMap';
import { getAuthToken } from '../../lib/api';

type GameState = 'TITLE_MENU' | 'PLAYING';

interface ChatMessage {
  id: string;
  sender?: string;
  role?: PlayerRole;
  text: string;
  system?: boolean;
}

interface NearbyInteraction {
  type: 'study' | 'quiz' | 'read' | 'buy_food' | 'sit' | 'salute' | 'basketball' | 'locker';
  label: string;
  tx?: number;
  ty?: number;
}

const ROLE_LABELS: Record<PlayerRole, string> = {
  sma: 'Siswa SMA',
  smp: 'Siswa SMP',
  osis: 'OSIS',
  guru: 'Guru',
};

const QUICK_EMOTES = [
  { key: '1', emoji: '👋', label: 'Sapa' },
  { key: '2', emoji: '😂', label: 'Tertawa' },
  { key: '3', emoji: '❤️', label: 'Suka' },
  { key: '4', emoji: '🔥', label: 'Semangat' },
];

export default function GameNusantara() {
  const schoolMap = useMemo(() => buildSchoolMap(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  // Mutable simulation refs for smooth 60fps loop
  const playersRef = useRef<Record<string, RenderPlayer>>({});
  const selfIdRef = useRef<string | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const cameraRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomRef = useRef<number>(1.05);
  const jumpRef = useRef<{ active: boolean; vel: number; height: number }>({
    active: false,
    vel: 0,
    height: 0,
  });
  const energyRef = useRef<number>(100);
  const lastEmitRef = useRef<number>(0);
  const chatBubblesRef = useRef<Record<string, ChatBubble>>({});
  const emotesRef = useRef<Record<string, EmoteEffect>>({});
  const worldEffectsRef = useRef<WorldEffect[]>([]);
  const moveTargetRef = useRef<MoveTarget | null>(null);
  const phaseRef = useRef<SchoolPhase>(SCHEDULES[0]);

  // React UI state
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('Siswa01');
  const [playerRole, setPlayerRole] = useState<PlayerRole>('sma');
  const [hudStats, setHudStats] = useState({ xp: 0, money: 10000, energy: 100 });
  const [onlineCount, setOnlineCount] = useState(1);
  const [phase, setPhase] = useState<SchoolPhase>(SCHEDULES[0]);
  const [phaseTimer, setPhaseTimer] = useState(SCHEDULES[0].duration);
  const [zoneName, setZoneName] = useState('Taman & Gerbang Sekolah');
  const [nearbyAction, setNearbyAction] = useState<NearbyInteraction | null>(null);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'ok' | 'warn' } | null>(null);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizQuestion | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const triggerToast = useCallback((text: string, tone: 'info' | 'ok' | 'warn' = 'info') => {
    setToast({ text, tone });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const appendChat = useCallback((msg: ChatMessage) => {
    setChatLog((prev) => [...prev.slice(-45), msg]);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  const toRenderPlayer = useCallback((p: PlayerState): RenderPlayer => ({
    id: p.id,
    name: p.name,
    role: p.role,
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
  }), []);

  // Connect Socket.io on mount — attaches to the SmartCBT backend at a
  // dedicated path (/game-socket.io) so it never collides with the /api
  // dispatcher. The student's SmartCBT login token rides in the handshake
  // `auth` payload; the server verifies it before letting them join, so the
  // school is not open to anonymous outsiders on the public origin.
  useEffect(() => {
    const socket = io({
      path: "/game-socket.io",
      auth: { token: getAuthToken() ?? "" },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect_error', (err) => {
      const denied = /unauthorized|auth/i.test(String(err?.message || ""));
      setConnError(
        denied
          ? 'Sesi login tidak dikenali untuk mode game. Muat ulang halaman atau login kembali.'
          : 'Koneksi ke server terganggu. Mencoba menghubungkan ulang...',
      );
      setConnecting(false);
    });

    socket.on('initGame', (data: {
      selfId: string;
      players: Record<string, PlayerState>;
      phase: SchoolPhase;
      timer: number;
    }) => {
      selfIdRef.current = data.selfId;
      const nextMap: Record<string, RenderPlayer> = {};
      Object.values(data.players).forEach((pl) => {
        nextMap[pl.id] = toRenderPlayer(pl);
      });
      playersRef.current = nextMap;
      setOnlineCount(Object.keys(nextMap).length);

      const me = data.players[data.selfId];
      if (me) {
        setPlayerName(me.name);
        setPlayerRole(me.role);
        setHudStats({ xp: me.xp, money: me.money, energy: 100 });
        energyRef.current = 100;
      }

      phaseRef.current = data.phase;
      setPhase(data.phase);
      setPhaseTimer(data.timer);
      setConnecting(false);
      setConnError(null);
      setGameState('PLAYING');
      appendChat({
        id: `sys-welcome-${Date.now()}`,
        text: 'Selamat datang di Nusantara High. Tekan Enter untuk chat atau klik lantai untuk berjalan.',
        system: true,
      });
    });

    socket.on('playerJoined', (p: PlayerState) => {
      if (!playersRef.current[p.id]) {
        playersRef.current[p.id] = toRenderPlayer(p);
      }
      setOnlineCount(Object.keys(playersRef.current).length);
    });

    socket.on('playerMoved', (data: {
      id: string;
      wx: number;
      wy: number;
      dir: RenderPlayer['dir'];
      moving: boolean;
      sprinting: boolean;
      sitting: boolean;
      jumpOffset: number;
    }) => {
      const p = playersRef.current[data.id];
      if (!p) return;
      p.wx = data.wx;
      p.wy = data.wy;
      p.dir = data.dir;
      p.moving = data.moving;
      p.sprinting = data.sprinting;
      p.sitting = data.sitting;
      p.jumpOffset = data.jumpOffset;
    });

    socket.on('playerLeft', (id: string) => {
      delete playersRef.current[id];
      delete chatBubblesRef.current[id];
      delete emotesRef.current[id];
      setOnlineCount(Object.keys(playersRef.current).length);
    });

    socket.on('chatBroadcast', (data: {
      id: string;
      name: string;
      role: PlayerRole;
      text: string;
      timestamp?: number;
    }) => {
      appendChat({
        id: `${data.id}-${data.timestamp || Date.now()}-${Math.random()}`,
        sender: data.name,
        role: data.role,
        text: data.text,
      });
      chatBubblesRef.current[data.id] = {
        text: data.text,
        expires: performance.now() + 4500,
      };
    });

    socket.on('systemChat', (text: string) => {
      appendChat({
        id: `sys-${Date.now()}-${Math.random()}`,
        text,
        system: true,
      });
    });

    socket.on('playerEmote', ({ id, emoji }: { id: string; emoji: string }) => {
      emotesRef.current[id] = { emoji, expires: performance.now() + 2400 };
    });

    socket.on('schoolBell', ({ phase: nextPhase, timer }: { phase: SchoolPhase; timer: number }) => {
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
      setPhaseTimer(timer);
      soundFX.playSchoolBell();
      triggerToast(`Bel Sekolah: ${nextPhase.name}`, 'info');
    });

    socket.on('timeSync', ({ phase: nextPhase, timer }: { phase: SchoolPhase; timer: number }) => {
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
      setPhaseTimer(timer);
    });

    socket.on('statsUpdate', (stats: { xp: number; money: number }) => {
      setHudStats((prev) => ({
        ...prev,
        xp: stats.xp,
        money: stats.money,
      }));
    });

    socket.on('actionFeedback', (fb: { ok: boolean; message: string }) => {
      triggerToast(fb.message, fb.ok ? 'ok' : 'warn');
      soundFX.playInteract(fb.ok);
    });

    socket.on('quizResult', (res: { correct: boolean; message: string }) => {
      setActiveQuiz(null);
      triggerToast(res.message, res.correct ? 'ok' : 'warn');
      soundFX.playInteract(res.correct);
    });

    socket.on('worldEffect', (ef: {
      type: string;
      playerId: string;
      name: string;
      scored?: boolean;
    }) => {
      const shooter = playersRef.current[ef.playerId];
      if (ef.type === 'basketball' && shooter) {
        worldEffectsRef.current.push({
          type: 'ball',
          wx: shooter.renderWx,
          wy: shooter.renderWy,
          targetWx: 25.5,
          targetWy: shooter.renderWy < 20.5 ? 15.5 : 26.5,
          progress: 0,
          scored: ef.scored,
        });
        if (ef.playerId === selfIdRef.current) {
          soundFX.playInteract(true);
          triggerToast(
            ef.scored ? 'Bola masuk ring! +15 XP' : 'Lemparan bagus! +10 XP',
            ef.scored ? 'ok' : 'info'
          );
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [appendChat, toRenderPlayer, triggerToast]);

  const canMoveTo = useCallback(
    (wx: number, wy: number) => {
      const r = 0.23;
      const corners: [number, number][] = [
        [wx - r, wy - r],
        [wx + r, wy - r],
        [wx - r, wy + r],
        [wx + r, wy + r],
      ];
      for (const [px, py] of corners) {
        const gx = Math.floor(px);
        const gy = Math.floor(py);
        if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return false;
        if (schoolMap.solid[gy][gx]) return false;
      }
      return true;
    },
    [schoolMap]
  );

  const getNearbyInteraction = useCallback(
    (p: RenderPlayer): NearbyInteraction | null => {
      const tx = Math.floor(p.wx);
      const ty = Math.floor(p.wy);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
          const obj = schoolMap.objects[ny][nx];
          if (obj === 'board') {
            return { type: 'quiz', label: 'Tekan [E] Ujian Kilat di Papan Tulis (+30 XP)' };
          }
          if (obj === 'bookshelf') {
            return { type: 'read', label: 'Tekan [E] Baca Buku Perpus (+15 XP)' };
          }
          if (obj === 'stall') {
            return { type: 'buy_food', label: 'Tekan [E] Beli Bakso & Es Teh (Rp 2.000)' };
          }
          if (obj === 'chair' || obj === 'bench') {
            return {
              type: 'sit',
              label: p.sitting ? 'Tekan [E] Berdiri' : 'Tekan [E] Duduk',
              tx: nx + 0.5,
              ty: ny + 0.5,
            };
          }
          if (obj === 'flagpole' || obj === 'podium') {
            return { type: 'salute', label: 'Tekan [E] Hormat Bendera Merah Putih' };
          }
          if (obj === 'locker') {
            return { type: 'locker', label: 'Tekan [E] Cek Loker Sekolah' };
          }
        }
      }

      if (p.wx >= 21 && p.wx <= 29 && p.wy >= 15 && p.wy <= 26) {
        return { type: 'basketball', label: 'Tekan [E] Lempar Bola Basket (+10 XP)' };
      }
      return null;
    },
    [schoolMap]
  );

  const performInteraction = useCallback(() => {
    const id = selfIdRef.current;
    if (!id) return;
    const p = playersRef.current[id];
    const socket = socketRef.current;
    if (!p || !socket) return;

    const act = getNearbyInteraction(p);
    if (!act) return;

    if (act.type === 'sit' && act.tx !== undefined && act.ty !== undefined) {
      p.sitting = !p.sitting;
      if (p.sitting) {
        p.wx = act.tx;
        p.wy = act.ty;
        p.renderWx = act.tx;
        p.renderWy = act.ty;
        moveTargetRef.current = null;
      }
      socket.emit('playerMove', {
        wx: p.wx,
        wy: p.wy,
        dir: p.dir,
        moving: false,
        sprinting: false,
        sitting: p.sitting,
        jumpOffset: p.jumpOffset,
      });
      soundFX.playInteract(true);
    } else if (act.type === 'quiz') {
      const randomQ = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
      setActiveQuiz(randomQ);
      soundFX.playInteract(true);
    } else if (act.type === 'buy_food') {
      if (hudStats.money < 2000) {
        triggerToast('Uang saku belum cukup (butuh Rp 2.000).', 'warn');
        soundFX.playInteract(false);
        return;
      }
      energyRef.current = 100;
      setHudStats((prev) => ({ ...prev, energy: 100 }));
      socket.emit('interactAction', 'buy_food');
      soundFX.playInteract(true);
      triggerToast('Energi kembali 100%!', 'ok');
    } else if (act.type === 'read') {
      socket.emit('interactAction', 'read');
      socket.emit('emote', '📖');
      soundFX.playInteract(true);
      triggerToast('Membaca buku · +15 XP & Rp 250', 'ok');
    } else if (act.type === 'salute') {
      socket.emit('emote', '🫡');
      soundFX.playInteract(true);
      triggerToast('Hormat grak!', 'info');
    } else if (act.type === 'locker') {
      socket.emit('interactAction', 'locker');
      soundFX.playInteract(true);
      triggerToast('Loker rapi · Menemukan uang koin Rp 100!', 'ok');
    } else if (act.type === 'basketball') {
      socket.emit('interactAction', 'basketball');
    }
  }, [getNearbyInteraction, hudStats.money, triggerToast]);

  const sendEmote = useCallback((emoji: string) => {
    if (!selfIdRef.current || !socketRef.current) return;
    socketRef.current.emit('emote', emoji);
  }, []);

  // Keyboard bindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === chatInputRef.current) {
        if (e.key === 'Escape') {
          chatInputRef.current?.blur();
        }
        return;
      }

      if (activeQuiz) {
        if (e.key === 'Escape') setActiveQuiz(null);
        return;
      }

      if (gameState !== 'PLAYING' || !selfIdRef.current) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        chatInputRef.current?.focus();
        return;
      }

      const lower = e.key.toLowerCase();
      keysRef.current[lower] = true;

      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(lower)) {
        moveTargetRef.current = null;
      }

      if (e.code === 'Space' && !jumpRef.current.active) {
        e.preventDefault();
        jumpRef.current.active = true;
        jumpRef.current.vel = 6.6;
        const me = playersRef.current[selfIdRef.current];
        if (me) me.sitting = false;
        soundFX.playJump();
      }

      if (lower === 'e') {
        performInteraction();
      }

      const foundEmote = QUICK_EMOTES.find((item) => item.key === e.key);
      if (foundEmote) {
        sendEmote(foundEmote.emoji);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeQuiz, gameState, performInteraction, sendEmote]);

  // Main 60fps Game Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let lastHudSync = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        if (canvas.width !== Math.floor(viewW * dpr) || canvas.height !== Math.floor(viewH * dpr)) {
          canvas.width = Math.floor(viewW * dpr);
          canvas.height = Math.floor(viewH * dpr);
        }

        const selfId = selfIdRef.current;
        const me = selfId ? playersRef.current[selfId] : null;

        if (me && gameState === 'PLAYING') {
          let screenDx = 0;
          let screenDy = 0;
          const k = keysRef.current;
          if (k['w'] || k['arrowup']) screenDy -= 1;
          if (k['s'] || k['arrowdown']) screenDy += 1;
          if (k['a'] || k['arrowleft']) screenDx -= 1;
          if (k['d'] || k['arrowright']) screenDx += 1;

          let moveWx = screenDx + screenDy;
          let moveWy = screenDy - screenDx;

          // Click-to-move fallback when no directional keys pressed
          if (moveWx === 0 && moveWy === 0 && moveTargetRef.current) {
            const dx = moveTargetRef.current.wx - me.wx;
            const dy = moveTargetRef.current.wy - me.wy;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.14) {
              moveTargetRef.current = null;
            } else {
              moveWx = dx;
              moveWy = dy;
              // Derive approximate screen direction for facing
              screenDx = dx - dy;
              screenDy = dx + dy;
            }
          }

          const isMoving = moveWx !== 0 || moveWy !== 0;
          const wantsSprint = Boolean(k['shift']) && energyRef.current > 5 && isMoving;

          if (wantsSprint) {
            energyRef.current = Math.max(0, energyRef.current - 22 * dt);
          } else {
            energyRef.current = Math.min(100, energyRef.current + (me.sitting ? 18 : 7) * dt);
          }

          if (isMoving) {
            me.sitting = false;
            const len = Math.hypot(moveWx, moveWy);
            const speed = wantsSprint ? 6.2 : 3.7;
            const vx = (moveWx / len) * speed * dt;
            const vy = (moveWy / len) * speed * dt;

            const movedX = canMoveTo(me.wx + vx, me.wy);
            if (movedX) me.wx += vx;
            const movedY = canMoveTo(me.wx, me.wy + vy);
            if (movedY) me.wy += vy;

            if (!movedX && !movedY && moveTargetRef.current) {
              moveTargetRef.current = null;
            }

            if (Math.abs(screenDx) > Math.abs(screenDy)) {
              me.dir = screenDx > 0 ? 'e' : 'w';
            } else {
              me.dir = screenDy > 0 ? 's' : 'n';
            }
          }

          // Jump physics
          if (jumpRef.current.active) {
            jumpRef.current.height += jumpRef.current.vel * 4.5 * dt;
            jumpRef.current.vel -= 22 * dt;
            if (jumpRef.current.height <= 0) {
              jumpRef.current.height = 0;
              jumpRef.current.active = false;
              jumpRef.current.vel = 0;
            }
          }

          me.moving = isMoving;
          me.sprinting = wantsSprint;
          me.jumpOffset = jumpRef.current.height;
          me.renderWx = me.wx;
          me.renderWy = me.wy;

          if (now - lastEmitRef.current > 45 && socketRef.current) {
            socketRef.current.emit('playerMove', {
              wx: me.wx,
              wy: me.wy,
              dir: me.dir,
              moving: me.moving,
              sprinting: me.sprinting,
              sitting: me.sitting,
              jumpOffset: me.jumpOffset,
            });
            lastEmitRef.current = now;
          }

          const meIso = toIso(me.renderWx, me.renderWy);
          const targetCamX = meIso.x - viewW / 2;
          const targetCamY = meIso.y - viewH / 2;
          cameraRef.current.x += (targetCamX - cameraRef.current.x) * Math.min(1, 10 * dt);
          cameraRef.current.y += (targetCamY - cameraRef.current.y) * Math.min(1, 10 * dt);

          if (now - lastHudSync > 120) {
            lastHudSync = now;
            setHudStats((prev) => ({ ...prev, energy: Math.round(energyRef.current) }));
            setZoneName(getZoneName(me.wx, me.wy));
            setNearbyAction(getNearbyInteraction(me));
          }
        } else {
          // Gentle scenic pan around courtyard during title screen
          const centerIso = toIso(
            15.5 + Math.sin(now / 5000) * 3,
            19.5 + Math.cos(now / 6000) * 2.5
          );
          cameraRef.current.x = centerIso.x - viewW / 2;
          cameraRef.current.y = centerIso.y - viewH / 2;
        }

        // Interpolate remote players & animate walk phases
        Object.values(playersRef.current).forEach((pl) => {
          if (pl.id !== selfId) {
            pl.renderWx += (pl.wx - pl.renderWx) * Math.min(1, 12 * dt);
            pl.renderWy += (pl.wy - pl.renderWy) * Math.min(1, 12 * dt);
          }
          if (pl.moving) {
            pl.walkPhase = (pl.walkPhase || 0) + (pl.sprinting ? 16 : 10) * dt;
          } else {
            pl.walkPhase = 0;
          }
        });

        worldEffectsRef.current = worldEffectsRef.current.filter((ef) => {
          ef.progress += 1.5 * dt;
          return ef.progress < 1;
        });

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          renderSchoolScene({
            ctx,
            width: viewW,
            height: viewH,
            map: schoolMap,
            players: playersRef.current,
            selfId,
            camX: cameraRef.current.x,
            camY: cameraRef.current.y,
            zoom: zoomRef.current,
            chatBubbles: chatBubblesRef.current,
            emotes: emotesRef.current,
            worldEffects: worldEffectsRef.current,
            moveTarget: moveTargetRef.current,
            ambientTint: phaseRef.current.ambientTint,
          });
          ctx.restore();
        }

        const miniCtx = minimapRef.current?.getContext('2d');
        if (miniCtx) {
          renderMinimap(miniCtx, schoolMap, playersRef.current, selfId);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [canMoveTo, gameState, getNearbyInteraction, schoolMap]);

  const handleJoin = (config: {
    name: string;
    role: PlayerRole;
    hairColor: string;
    skinColor: string;
  }) => {
    if (!socketRef.current) return;
    setConnecting(true);
    setConnError(null);
    socketRef.current.emit('joinGame', config);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameState !== 'PLAYING' || activeQuiz) return;
    const world = screenToWorld(
      e.clientX,
      e.clientY,
      cameraRef.current.x,
      cameraRef.current.y,
      zoomRef.current,
      window.innerWidth,
      window.innerHeight
    );
    const clampedX = Math.max(1.2, Math.min(MAP_SIZE - 1.2, world.wx));
    const clampedY = Math.max(1.2, Math.min(MAP_SIZE - 1.2, world.wy));
    if (canMoveTo(clampedX, clampedY)) {
      moveTargetRef.current = {
        wx: clampedX,
        wy: clampedY,
        createdAt: performance.now(),
      };
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    zoomRef.current = Math.max(0.72, Math.min(1.5, zoomRef.current + delta));
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim();
    if (trimmed && socketRef.current) {
      socketRef.current.emit('chatMessage', trimmed);
      setChatText('');
    }
    chatInputRef.current?.blur();
  };

  const toggleMute = () => {
    soundFX.muted = !soundFX.muted;
    setMuted(soundFX.muted);
  };

  const adjustZoom = (delta: number) => {
    zoomRef.current = Math.max(0.72, Math.min(1.5, zoomRef.current + delta));
  };

  const rankTitle =
    hudStats.xp >= 150
      ? 'Bintang Sekolah'
      : hudStats.xp >= 60
      ? 'Juara Kelas'
      : hudStats.xp >= 20
      ? 'Siswa Rajin'
      : 'Siswa Baru';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        className="block w-full h-full cursor-crosshair"
      />

      {gameState === 'TITLE_MENU' && (
        <LoginScreen onJoin={handleJoin} connecting={connecting} errorMsg={connError} />
      )}

      {gameState === 'PLAYING' && (
        <div className="pointer-events-none fixed inset-0 z-20">
          {/* Top Left: Player Stats */}
          <div className="pointer-events-auto fixed top-3.5 left-3.5 w-64 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-3.5 shadow-lg">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display font-bold text-sm text-slate-50 truncate">
                {playerName}
              </span>
              <span className="text-xs text-sky-400 shrink-0">{ROLE_LABELS[playerRole]}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span>{rankTitle}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">{onlineCount} Online</span>
            </div>

            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Energi Lari</span>
                <span className="font-mono-num">{hudStats.energy}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${hudStats.energy}%` }}
                />
              </div>
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-slate-800 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 block">Pengetahuan</span>
                <span className="font-mono-num font-bold text-slate-100">{hudStats.xp} XP</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block">Uang Saku</span>
                <span className="font-mono-num font-bold text-emerald-400">
                  Rp {hudStats.money.toLocaleString('id-ID')}
                </span>
              </div>
            </div>
          </div>

          {/* Top Center: Schedule & Current Zone */}
          <div className="pointer-events-auto fixed top-3.5 left-1/2 -translate-x-1/2 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl px-5 py-2.5 text-center shadow-lg min-w-[240px]">
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-300">
              <span className="font-semibold" style={{ color: phase.accent === '#2563eb' ? '#60a5fa' : phase.accent === '#059669' ? '#34d399' : '#fbbf24' }}>
                {phase.name}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-slate-200">{phaseTimer}s</span>
            </div>
            <div className="font-display font-bold text-sm text-slate-50 mt-0.5 whitespace-nowrap">
              {zoneName}
            </div>
          </div>

          {/* Top Right: Minimap & Utility Controls */}
          <div className="pointer-events-auto fixed top-3.5 right-3.5 flex flex-col items-end gap-2">
            <div className="bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-2 shadow-lg">
              <canvas
                ref={minimapRef}
                width={128}
                height={128}
                className="block rounded-md border border-slate-800 bg-slate-950"
              />
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => adjustZoom(-0.15)}
                  title="Perkecil kamera"
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => adjustZoom(0.15)}
                  title="Perbesar kamera"
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  title={muted ? 'Nyalakan suara' : 'Bisukan suara'}
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowControls((v) => !v)}
                  title="Panduan kontrol"
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showControls && (
              <div className="w-60 bg-slate-900/92 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 text-xs text-slate-300 space-y-1 shadow-xl">
                <div className="font-semibold text-slate-100 mb-1">Panduan Kontrol</div>
                <div>WASD / Panah / Klik — Jalan</div>
                <div>Shift — Lari Cepat</div>
                <div>Spasi — Lompat</div>
                <div>E — Interaksi / Duduk</div>
                <div>1–4 — Emote Cepat</div>
                <div>Enter — Buka Chat</div>
                <div>Scroll Mouse — Zoom Kamera</div>
              </div>
            )}
          </div>

          {/* Toast Notification */}
          {toast && (
            <div
              className={`fixed top-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-semibold shadow-xl border ${
                toast.tone === 'ok'
                  ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-200'
                  : toast.tone === 'warn'
                  ? 'bg-rose-950/95 border-rose-500/60 text-rose-200'
                  : 'bg-slate-900/95 border-sky-500/60 text-sky-200'
              }`}
            >
              {toast.text}
            </div>
          )}

          {/* Contextual Interact Button */}
          {nearbyAction && (
            <button
              type="button"
              onClick={performInteraction}
              className="pointer-events-auto fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-2.5 min-h-[44px] rounded-lg bg-sky-600 hover:bg-sky-500 border border-sky-400/50 text-white font-semibold text-sm shadow-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              {nearbyAction.label}
            </button>
          )}

          {/* Bottom Left: Live Chat & Emotes */}
          <div className="pointer-events-auto fixed bottom-3.5 left-3.5 w-80 sm:w-96 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-3 shadow-lg">
            <div className="h-32 overflow-y-auto chat-scroll space-y-1.5 text-xs pr-1">
              {chatLog.map((m) => (
                <div key={m.id} className="leading-snug break-words">
                  {m.system ? (
                    <span className="text-amber-300/90 italic">{m.text}</span>
                  ) : (
                    <>
                      <span
                        className={`font-semibold mr-1.5 ${
                          m.role === 'guru'
                            ? 'text-amber-400'
                            : m.role === 'osis'
                            ? 'text-sky-400'
                            : 'text-slate-100'
                        }`}
                      >
                        {m.sender}:
                      </span>
                      <span className="text-slate-300">{m.text}</span>
                    </>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-1.5">
              {QUICK_EMOTES.map((em) => (
                <button
                  key={em.key}
                  type="button"
                  onClick={() => sendEmote(em.emoji)}
                  title={`${em.label} [${em.key}]`}
                  className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-sm transition-colors cursor-pointer"
                >
                  {em.emoji}
                </button>
              ))}
            </div>

            <form onSubmit={handleSendChat} className="mt-2 flex gap-1.5">
              <input
                ref={chatInputRef}
                type="text"
                maxLength={90}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Ketik pesan lalu Enter..."
                className="flex-1 h-9 px-3 rounded-lg bg-slate-950/90 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                aria-label="Kirim pesan"
                className="px-3 h-9 rounded-lg bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}

      {activeQuiz && (
        <QuizModal
          question={activeQuiz}
          onAnswer={(selectedIndex) => {
            socketRef.current?.emit('quizAnswer', {
              questionId: activeQuiz.id,
              selectedIndex,
            });
          }}
          onClose={() => setActiveQuiz(null)}
        />
      )}
    </div>
  );
}
