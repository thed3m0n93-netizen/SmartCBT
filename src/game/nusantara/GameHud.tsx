import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  HelpCircle,
  LayoutDashboard,
  UserCog,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PlayerRole, SchoolPhase } from './schoolMap';
import {
  getRankTitle,
  ROLE_LABELS,
  type GameToast,
  type HudStats,
  type NearbyInteraction,
} from './types';

interface ToastStackProps {
  toasts: GameToast[];
  onDismiss: (id: number) => void;
  compact?: boolean;
}

const ToastStack: React.FC<ToastStackProps> = ({ toasts, onDismiss, compact = false }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className={
        compact
          ? 'w-full flex flex-col gap-1 pointer-events-auto'
          : 'w-64 flex flex-col items-end gap-1.5'
      }
    >
      {toasts.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onDismiss(item.id)}
          className={`w-full text-left rounded-lg font-medium shadow-lg border backdrop-blur-md flex items-center transition-opacity ${
            compact ? 'px-2.5 py-1.5 text-[11px] gap-1.5' : 'px-3 py-2 text-xs gap-2'
          } ${
            item.tone === 'ok'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100'
              : item.tone === 'warn'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
              : 'bg-slate-900/90 border-sky-500/50 text-sky-100'
          }`}
        >
          {item.tone === 'ok' ? (
            <CheckCircle2
              className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 text-emerald-400`}
            />
          ) : item.tone === 'warn' ? (
            <AlertTriangle
              className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 text-rose-400`}
            />
          ) : (
            <Bell className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 text-sky-400`} />
          )}
          <span className="flex-1 leading-snug break-words">{item.text}</span>
          <X className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 opacity-60`} />
        </button>
      ))}
    </div>
  );
};

interface GameHudProps {
  playerName: string;
  playerRole: PlayerRole;
  onlineCount: number;
  hudStats: HudStats;
  phase: SchoolPhase;
  phaseTimer: number;
  zoneName: string;
  lobbyLabel: string | null;
  toasts: GameToast[];
  onDismissToast: (id: number) => void;
  isTouch: boolean;
  muted: boolean;
  showControls: boolean;
  nearbyAction: NearbyInteraction | null;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  onAdjustZoom: (delta: number) => void;
  onToggleMute: () => void;
  onToggleControls: () => void;
  onCloseControls: () => void;
  onOpenStudy: () => void;
  onOpenCustomizer: () => void;
  onInteract: () => void;
  onExitToLobby?: () => void;
  onExitToDashboard?: () => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  playerName,
  playerRole,
  onlineCount,
  hudStats,
  phase,
  phaseTimer,
  zoneName,
  lobbyLabel,
  toasts,
  onDismissToast,
  isTouch,
  muted,
  showControls,
  nearbyAction,
  minimapRef,
  onAdjustZoom,
  onToggleMute,
  onToggleControls,
  onCloseControls,
  onOpenStudy,
  onOpenCustomizer,
  onInteract,
  onExitToLobby,
  onExitToDashboard,
}) => {
  const rankTitle = getRankTitle(hudStats.xp);
  const phaseColor =
    phase.accent === '#2563eb'
      ? '#60a5fa'
      : phase.accent === '#059669'
      ? '#34d399'
      : '#fbbf24';

  return (
    <>
      {/* Desktop / Tablet Top-Left: Player Stats */}
      <div className="hidden md:block pointer-events-auto fixed top-3.5 left-3.5 w-60 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-3.5 shadow-lg">
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

        <div className="mt-2.5">
          <div className="flex justify-between text-xs text-slate-300 mb-1">
            <span>Energi Lari</span>
            <span className="font-mono-num">{hudStats.energy}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-sm overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-150"
              style={{ width: `${hudStats.energy}%` }}
            />
          </div>
        </div>

        <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
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

      {/* Desktop / Tablet Top-Center: Schedule & Current Zone */}
      <div className="hidden md:block pointer-events-auto fixed top-3.5 left-1/2 -translate-x-1/2 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl px-5 py-2 text-center shadow-lg min-w-[230px]">
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-300">
          <span className="font-semibold" style={{ color: phaseColor }}>
            {phase.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num text-slate-200">{phaseTimer}s</span>
        </div>
        <div className="font-display font-bold text-sm text-slate-50 mt-0.5 whitespace-nowrap">
          {zoneName}
        </div>
        {lobbyLabel && (
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
            🏫 Lobi {lobbyLabel}
          </div>
        )}
      </div>

      {/* Mobile Unified Top HUD Row */}
      <div className="md:hidden fixed top-2.5 inset-x-2.5 flex items-start justify-between gap-2 pointer-events-none">
        <div className="flex flex-col items-start gap-1.5 min-w-0 max-w-[54vw]">
          <div className="pointer-events-auto w-full bg-slate-900/88 backdrop-blur-md border border-slate-700/75 rounded-xl p-2.5 shadow-lg">
            <div className="flex items-baseline justify-between gap-1.5">
              <span className="font-display font-bold text-xs text-slate-50 truncate">
                {playerName}
              </span>
              <span className="text-[10px] text-sky-400 shrink-0">{onlineCount} Online</span>
            </div>
            <div className="mt-1.5 w-full h-1.5 bg-slate-800 rounded-sm overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-150"
                style={{ width: `${hudStats.energy}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="font-mono-num font-bold text-slate-100">{hudStats.xp} XP</span>
              <span className="font-mono-num font-bold text-emerald-400">
                Rp {hudStats.money.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-800/90 text-[10px] leading-tight">
              <div className="flex items-center gap-1 text-slate-300 truncate">
                <span className="font-semibold" style={{ color: phaseColor }}>
                  {phase.name}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">{phaseTimer}s</span>
              </div>
              <div className="text-slate-100 font-semibold truncate mt-0.5">{zoneName}</div>
              {lobbyLabel && (
                <div className="text-amber-300/90 font-semibold truncate mt-0.5">
                  🏫 {lobbyLabel}
                </div>
              )}
            </div>
          </div>

          <ToastStack toasts={toasts} onDismiss={onDismissToast} compact />
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenCustomizer}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-sky-500/40 bg-sky-950/75 text-sky-200 hover:text-white hover:bg-sky-900 backdrop-blur transition-colors cursor-pointer"
              title="Ganti karakter & seragam"
            >
              <UserCog className="w-3 h-3" />
              <span>Karakter</span>
            </button>
            {onExitToLobby && (
              <button
                type="button"
                onClick={onExitToLobby}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-300 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors cursor-pointer"
                title="Kembali ke lobby"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Lobby</span>
              </button>
            )}
            {onExitToDashboard && (
              <button
                type="button"
                onClick={onExitToDashboard}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors cursor-pointer"
                title="Kembali ke Dashboard Mode Biasa"
              >
                <LayoutDashboard className="w-3 h-3" />
                <span>Mode Biasa</span>
              </button>
            )}
          </div>

          <div className="bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-1 flex items-center gap-0.5 shadow-lg">
            <button
              type="button"
              onClick={() => onAdjustZoom(-0.15)}
              title="Perkecil kamera"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onAdjustZoom(0.15)}
              title="Perbesar kamera"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              title={muted ? 'Nyalakan suara' : 'Bisukan suara'}
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onToggleControls}
              title="Panduan kontrol"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenStudy}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white font-semibold text-xs shadow-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            📚 Modul &amp; Tugas
          </button>
        </div>
      </div>

      {/* Desktop / Tablet Top-Right Dock */}
      <div className="hidden md:flex pointer-events-auto fixed top-3.5 right-3.5 flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCustomizer}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-sky-500/40 bg-sky-950/75 text-sky-200 hover:text-white hover:bg-sky-900 backdrop-blur transition-colors cursor-pointer"
            title="Ganti karakter & seragam"
          >
            <UserCog className="w-3 h-3" />
            <span>Karakter</span>
          </button>
          {onExitToLobby && (
            <button
              type="button"
              onClick={onExitToLobby}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-300 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors cursor-pointer"
              title="Kembali ke lobby"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Lobby</span>
            </button>
          )}
          {onExitToDashboard && (
            <button
              type="button"
              onClick={onExitToDashboard}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors cursor-pointer"
              title="Kembali ke Dashboard Mode Biasa"
            >
              <LayoutDashboard className="w-3 h-3" />
              <span>Mode Biasa</span>
            </button>
          )}
        </div>

        <div className="bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-2 shadow-lg">
          {!isTouch && (
            <canvas
              ref={minimapRef}
              width={128}
              height={128}
              className="block rounded-md border border-slate-800 bg-slate-950"
            />
          )}
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => onAdjustZoom(-0.15)}
              title="Perkecil kamera"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onAdjustZoom(0.15)}
              title="Perbesar kamera"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              title={muted ? 'Nyalakan suara' : 'Bisukan suara'}
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleControls}
              title="Panduan kontrol"
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isTouch && (
          <button
            type="button"
            onClick={onOpenStudy}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white font-semibold text-xs shadow-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            📚 Modul &amp; Tugas
          </button>
        )}

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

        <ToastStack toasts={toasts} onDismiss={onDismissToast} />
      </div>

      {/* Mobile Controls Guide Popover */}
      {showControls && (
        <div className="md:hidden pointer-events-auto fixed top-36 right-2.5 w-56 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 text-xs text-slate-300 space-y-1 shadow-xl z-30">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-slate-100">Panduan Kontrol</span>
            <button
              type="button"
              onClick={onCloseControls}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div>Joystick — Jalan</div>
          <div>Sprint / Lompat — Tombol kanan</div>
          <div>Aksi [E] — Interaksi objek</div>
        </div>
      )}

      {/* Contextual Interact Button */}
      {nearbyAction && (
        <button
          type="button"
          onClick={onInteract}
          className="pointer-events-auto fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-2.5 min-h-[44px] rounded-lg bg-sky-600 hover:bg-sky-500 border border-sky-400/50 text-white font-semibold text-sm shadow-xl transition-colors cursor-pointer whitespace-nowrap"
        >
          {nearbyAction.label}
        </button>
      )}

      {/* Desktop Bottom-Right Dock: Modul & Tugas */}
      {!isTouch && (
        <button
          type="button"
          onClick={onOpenStudy}
          className="hidden md:inline-flex pointer-events-auto fixed bottom-3.5 right-3.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white font-semibold text-sm shadow-xl transition-colors cursor-pointer whitespace-nowrap"
        >
          📚 Modul &amp; Tugas
        </button>
      )}
    </>
  );
};
