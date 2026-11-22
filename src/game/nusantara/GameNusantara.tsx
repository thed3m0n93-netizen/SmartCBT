import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../../app/AuthContext';
import { GameChatPanel } from './GameChatPanel';
import { GameHud } from './GameHud';
import { Gamepad, type VirtualDirection } from './Gamepad';
import { canMoveTo, clampWorldCoord, getNearbyInteraction } from './interactions';
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
import { LearningHub } from './LearningHub';
import { LoginScreen } from './LoginScreen';
import { QuizModal } from './QuizModal';
import {
  QUIZ_BANK,
  SCHEDULES,
  buildSchoolMap,
  getZoneName,
  type HairStyle,
  type PlayerRole,
  type QuizQuestion,
  type SchoolPhase,
} from './schoolMap';
import { soundFX } from './sound';
import {
  QUICK_EMOTES,
  type ChatMessage,
  type GameState,
  type HudStats,
  type NearbyInteraction,
} from './types';
import { useGameToasts } from './useGameToasts';
import { useNusantaraSocket } from './useNusantaraSocket';

export interface GameNusantaraProps {
  onExitToLobby?: () => void;
  onExitToDashboard?: () => void;
}

export default function GameNusantara({ onExitToLobby, onExitToDashboard }: GameNusantaraProps) {
  const schoolMap = useMemo(() => buildSchoolMap(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
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

  const { user: authUser } = useAuth();
  const isTouch =
    typeof window !== 'undefined' &&
    (!!window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('Siswa01');
  const [playerRole, setPlayerRole] = useState<PlayerRole>('sma');
  const [lobbyLabel, setLobbyLabel] = useState<string | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(!isTouch);
  const [hudStats, setHudStats] = useState<HudStats>({ xp: 0, money: 10000, energy: 100 });
  const [onlineCount, setOnlineCount] = useState(1);
  const [phase, setPhase] = useState<SchoolPhase>(SCHEDULES[0]);
  const [phaseTimer, setPhaseTimer] = useState(SCHEDULES[0].duration);
  const [zoneName, setZoneName] = useState('Taman & Gerbang Sekolah');
  const [nearbyAction, setNearbyAction] = useState<NearbyInteraction | null>(null);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizQuestion | null>(null);

  const { toasts, triggerToast, dismissToast } = useGameToasts();

  const appendChat = useCallback((msg: ChatMessage) => {
    setChatLog((prev) => [...prev.slice(-45), msg]);
  }, []);

  const { joinGame, emitMove, sendChat, sendEmote, sendInteract, sendQuizAnswer } =
    useNusantaraSocket({
      playersRef,
      selfIdRef,
      energyRef,
      chatBubblesRef,
      emotesRef,
      worldEffectsRef,
      moveTargetRef,
      phaseRef,
      onInitSuccess: (data) => {
        setPlayerName(data.playerName);
        setPlayerRole(data.playerRole);
        setOnlineCount(data.onlineCount);
        setLobbyLabel(data.lobbyLabel);
        setHudStats(data.hudStats);
        setPhase(data.phase);
        setPhaseTimer(data.timer);
        setConnecting(false);
        setConnError(null);
        setGameState('PLAYING');
      },
      onOnlineCountChange: setOnlineCount,
      onPhaseChange: (nextPhase, timer) => {
        setPhase(nextPhase);
        setPhaseTimer(timer);
      },
      onStatsUpdate: (stats) => {
        setHudStats((prev) => ({ ...prev, xp: stats.xp, money: stats.money }));
      },
      onAppendChat: appendChat,
      onTriggerToast: triggerToast,
      onQuizClose: () => setActiveQuiz(null),
      onConnectionState: (isConn, err) => {
        setConnecting(isConn);
        setConnError(err);
      },
    });

  const applyVirtualDirection = useCallback((dir: VirtualDirection | null) => {
    const k = keysRef.current;
    k['w'] = !!dir?.up;
    k['s'] = !!dir?.down;
    k['a'] = !!dir?.left;
    k['d'] = !!dir?.right;
    if (dir && (dir.up || dir.down || dir.left || dir.right)) moveTargetRef.current = null;
  }, []);

  const virtualJump = useCallback(() => {
    if (jumpRef.current.active) return;
    jumpRef.current.active = true;
    jumpRef.current.vel = 6.6;
    const sid = selfIdRef.current;
    const me = sid ? playersRef.current[sid] : null;
    if (me) me.sitting = false;
    soundFX.playJump();
  }, []);

  const virtualSprint = useCallback((active: boolean) => {
    keysRef.current['shift'] = active;
  }, []);

  const performInteraction = useCallback(() => {
    const id = selfIdRef.current;
    if (!id) return;
    const p = playersRef.current[id];
    if (!p) return;

    const act = getNearbyInteraction(schoolMap, p);
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
      emitMove({
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
      sendInteract('buy_food');
      soundFX.playInteract(true);
      triggerToast('Energi kembali 100%!', 'ok');
    } else if (act.type === 'read') {
      sendInteract('read');
      sendEmote('📖');
      soundFX.playInteract(true);
      triggerToast('Membaca buku · +15 XP & Rp 250', 'ok');
      setStudyOpen(true);
    } else if (act.type === 'salute') {
      sendEmote('🫡');
      soundFX.playInteract(true);
      triggerToast('Hormat grak!', 'info');
    } else if (act.type === 'locker') {
      sendInteract('locker');
      soundFX.playInteract(true);
      triggerToast('Loker rapi · Menemukan uang koin Rp 100!', 'ok');
    } else if (act.type === 'basketball') {
      sendInteract('basketball');
    }
  }, [emitMove, hudStats.money, schoolMap, sendEmote, sendInteract, triggerToast]);

  // Keyboard bindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === chatInputRef.current) {
        if (e.key === 'Escape') chatInputRef.current?.blur();
        return;
      }

      if (activeQuiz || studyOpen) {
        if (e.key === 'Escape') {
          setActiveQuiz(null);
          setStudyOpen(false);
        }
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

      if (lower === 'e') performInteraction();

      const foundEmote = QUICK_EMOTES.find((item) => item.key === e.key);
      if (foundEmote) sendEmote(foundEmote.emoji);
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
  }, [activeQuiz, studyOpen, gameState, performInteraction, sendEmote]);

  // Main 60fps Simulation & Render Loop
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

          if (moveWx === 0 && moveWy === 0 && moveTargetRef.current) {
            const dx = moveTargetRef.current.wx - me.wx;
            const dy = moveTargetRef.current.wy - me.wy;
            if (Math.hypot(dx, dy) < 0.14) {
              moveTargetRef.current = null;
            } else {
              moveWx = dx;
              moveWy = dy;
              screenDx = dx - dy;
              screenDy = dx + dy;
            }
          }

          const isMoving = moveWx !== 0 || moveWy !== 0;
          const wantsSprint = Boolean(k['shift']) && energyRef.current > 5 && isMoving;

          energyRef.current = wantsSprint
            ? Math.max(0, energyRef.current - 22 * dt)
            : Math.min(100, energyRef.current + (me.sitting ? 18 : 7) * dt);

          if (isMoving) {
            me.sitting = false;
            const len = Math.hypot(moveWx, moveWy);
            const speed = wantsSprint ? 6.2 : 3.7;
            const vx = (moveWx / len) * speed * dt;
            const vy = (moveWy / len) * speed * dt;

            const movedX = canMoveTo(schoolMap, me.wx + vx, me.wy);
            if (movedX) me.wx += vx;
            const movedY = canMoveTo(schoolMap, me.wx, me.wy + vy);
            if (movedY) me.wy += vy;

            if (!movedX && !movedY && moveTargetRef.current) moveTargetRef.current = null;

            me.dir =
              Math.abs(screenDx) > Math.abs(screenDy)
                ? screenDx > 0
                  ? 'e'
                  : 'w'
                : screenDy > 0
                ? 's'
                : 'n';
          }

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

          if (now - lastEmitRef.current > 45) {
            emitMove({
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
          cameraRef.current.x += (meIso.x - viewW / 2 - cameraRef.current.x) * Math.min(1, 10 * dt);
          cameraRef.current.y += (meIso.y - viewH / 2 - cameraRef.current.y) * Math.min(1, 10 * dt);

          if (now - lastHudSync > 120) {
            lastHudSync = now;
            setHudStats((prev) => ({ ...prev, energy: Math.round(energyRef.current) }));
            setZoneName(getZoneName(me.wx, me.wy));
            setNearbyAction(getNearbyInteraction(schoolMap, me));
          }
        } else {
          const centerIso = toIso(
            15.5 + Math.sin(now / 5000) * 3,
            19.5 + Math.cos(now / 6000) * 2.5
          );
          cameraRef.current.x = centerIso.x - viewW / 2;
          cameraRef.current.y = centerIso.y - viewH / 2;
        }

        Object.values(playersRef.current).forEach((pl) => {
          if (pl.id !== selfId) {
            pl.renderWx += (pl.wx - pl.renderWx) * Math.min(1, 12 * dt);
            pl.renderWy += (pl.wy - pl.renderWy) * Math.min(1, 12 * dt);
          }
          pl.walkPhase = pl.moving
            ? (pl.walkPhase || 0) + (pl.sprinting ? 16 : 10) * dt
            : 0;
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
  }, [emitMove, gameState, schoolMap]);

  const handleJoin = (config: {
    role: PlayerRole;
    hairStyle: HairStyle;
    hairColor: string;
    skinColor: string;
  }) => {
    joinGame(config);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameState !== 'PLAYING' || activeQuiz || studyOpen) return;
    const world = screenToWorld(
      e.clientX,
      e.clientY,
      cameraRef.current.x,
      cameraRef.current.y,
      zoomRef.current,
      window.innerWidth,
      window.innerHeight
    );
    const clampedX = clampWorldCoord(world.wx);
    const clampedY = clampWorldCoord(world.wy);
    if (canMoveTo(schoolMap, clampedX, clampedY)) {
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

  const toggleMute = () => {
    soundFX.muted = !soundFX.muted;
    setMuted(soundFX.muted);
  };

  const adjustZoom = (delta: number) => {
    zoomRef.current = Math.max(0.72, Math.min(1.5, zoomRef.current + delta));
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-slate-950 touch-none select-none"
      style={{ height: '100dvh' } as React.CSSProperties}
    >
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        className="block w-full h-full cursor-crosshair"
      />

      {gameState === 'TITLE_MENU' && (
        <>
          <LoginScreen
            accountName={authUser?.name ?? 'Siswa'}
            onJoin={handleJoin}
            connecting={connecting}
            errorMsg={connError}
          />
          {(onExitToLobby || onExitToDashboard) && (
            <div className="fixed top-3.5 left-3.5 right-3.5 z-50 flex items-center justify-between gap-2 pointer-events-none">
              {onExitToLobby ? (
                <button
                  type="button"
                  onClick={onExitToLobby}
                  className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-700/80 bg-slate-900/85 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors min-h-[38px]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Lobby</span>
                </button>
              ) : (
                <span />
              )}
              {onExitToDashboard && (
                <button
                  type="button"
                  onClick={onExitToDashboard}
                  className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-700/80 bg-slate-900/85 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors min-h-[38px]"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Mode Biasa</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {gameState === 'PLAYING' && (
        <div className="pointer-events-none fixed inset-0 z-20">
          <GameHud
            playerName={playerName}
            playerRole={playerRole}
            onlineCount={onlineCount}
            hudStats={hudStats}
            phase={phase}
            phaseTimer={phaseTimer}
            zoneName={zoneName}
            lobbyLabel={lobbyLabel}
            toasts={toasts}
            onDismissToast={dismissToast}
            isTouch={isTouch}
            muted={muted}
            showControls={showControls}
            nearbyAction={nearbyAction}
            minimapRef={minimapRef}
            onAdjustZoom={adjustZoom}
            onToggleMute={toggleMute}
            onToggleControls={() => setShowControls((v) => !v)}
            onCloseControls={() => setShowControls(false)}
            onOpenStudy={() => setStudyOpen(true)}
            onInteract={performInteraction}
            onExitToLobby={onExitToLobby}
            onExitToDashboard={onExitToDashboard}
          />

          {isTouch && !chatOpen && !studyOpen && !activeQuiz && (
            <Gamepad
              onDirection={applyVirtualDirection}
              onInteract={performInteraction}
              onJump={virtualJump}
              onSprint={virtualSprint}
            />
          )}

          <GameChatPanel
            chatLog={chatLog}
            chatOpen={chatOpen}
            isTouch={isTouch}
            chatInputRef={chatInputRef}
            onToggleOpen={setChatOpen}
            onSendChat={sendChat}
            onSendEmote={sendEmote}
          />
        </div>
      )}

      {activeQuiz && (
        <QuizModal
          question={activeQuiz}
          onAnswer={(selectedIndex) => sendQuizAnswer(activeQuiz.id, selectedIndex)}
          onClose={() => setActiveQuiz(null)}
        />
      )}

      <LearningHub open={studyOpen} onClose={() => setStudyOpen(false)} />
    </div>
  );
}
