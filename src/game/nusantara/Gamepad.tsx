/**
 * SmartCBT — Floating Gamepad (build 144 lanjutan: dukungan smartphone).
 *
 * Kontrol sentuh untuk Android/iPhone pada Nusantara High:
 *   - D-pad 8-arah (kiri bawah) TIDAK menggerakkan pemain sendiri — ia hanya
 *     menulis keadaan tombol ke keysRef game (lewat callback onDirection),
 *     sehingga SELURUH pipeline gerak yang ada (konversi isometrik, sprint,
 *     energi, collision, kirim playerMove) dipakai apa adanya.
 *   - Tombol E (interaksi), Lompat (guard sama dgn keyboard: tidak dobel),
 *     dan Lari (hold-to-sprint) di kanan bawah.
 *   - Pointer Events + setPointerCapture → multi-touch jujur: satu jari di
 *     D-pad + satu jari menekan E/Lompat bekerja simultan.
 *   - touch-action:none & select-none di semua elemen: mencegah scroll,
 *     double-tap zoom, dan callout iOS di atas kontrol.
 *   - Posisi memakai env(safe-area-inset) untuk home indicator iPhone &
 *     gesture bar Android.
 */
import React, { useCallback, useRef, useState } from 'react';

export interface VirtualDirection {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

interface GamepadProps {
  onDirection: (dir: VirtualDirection | null) => void;
  onInteract: () => void;
  onJump: () => void;
  onSprint: (active: boolean) => void;
}

const DEAD_ZONE = 0.22; // rasio radius sebelum arah dianggap aktif

const NO_TOUCH_STYLE: React.CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

export const Gamepad: React.FC<GamepadProps> = ({ onDirection, onInteract, onJump, onSprint }) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const [sprintOn, setSprintOn] = useState(false);

  const computeDirection = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const r = rect.width / 2;
      const dx = (clientX - cx) / r;
      const dy = (clientY - cy) / r;
      const mag = Math.hypot(dx, dy);

      // Knob visual mengikuti jari (di-clamp ke radius).
      const clamp = mag > 1 ? 1 / mag : 1;
      setKnob({ x: dx * clamp * (r - 22), y: dy * clamp * (r - 22) });

      if (mag < DEAD_ZONE) {
        onDirection({ up: false, down: false, left: false, right: false });
        return;
      }
      // 8-arah: bandingkan sudut terhadap oktan.
      const angle = Math.atan2(dy, dx); // -PI..PI, 0 = kanan
      const octant = Math.round(((angle + Math.PI) / (Math.PI / 4))) % 8;
      const dirs = [
        { left: true }, { up: true, left: true }, { up: true }, { up: true, right: true },
        { right: true }, { down: true, right: true }, { down: true }, { down: true, left: true },
      ][octant];
      onDirection({
        up: !!dirs.up,
        down: !!dirs.down,
        left: !!dirs.left,
        right: !!dirs.right,
      });
    },
    [onDirection],
  );

  const release = useCallback(() => {
    pointerIdRef.current = null;
    setKnob(null);
    onDirection(null);
  }, [onDirection]);

  const btnBase =
    'pointer-events-auto flex items-center justify-center rounded-full font-bold text-white shadow-lg border border-slate-600/80 active:scale-95 transition-transform';

  return (
    <>
      {/* ── D-pad (kiri bawah) ── */}
      <div
        ref={baseRef}
        className="fixed z-30 pointer-events-auto rounded-full bg-slate-900/55 border-2 border-slate-600/60 backdrop-blur-sm"
        style={{
          left: `calc(1rem + env(safe-area-inset-left))`,
          bottom: `calc(1.1rem + env(safe-area-inset-bottom))`,
          width: 128,
          height: 128,
          ...NO_TOUCH_STYLE,
        }}
        onPointerDown={(e) => {
          pointerIdRef.current = e.pointerId;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          computeDirection(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerIdRef.current === e.pointerId) computeDirection(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (pointerIdRef.current === e.pointerId) release();
        }}
        onPointerCancel={(e) => {
          if (pointerIdRef.current === e.pointerId) release();
        }}
        aria-label="D-pad virtual"
      >
        {/* garis sumbu dekoratif */}
        <div className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-slate-500/30" />
        <div className="absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-slate-500/30" />
        <div
          className="absolute left-1/2 top-1/2 w-11 h-11 rounded-full bg-sky-500/85 border-2 border-sky-200/70 shadow"
          style={{
            transform: `translate(calc(-50% + ${knob ? knob.x : 0}px), calc(-50% + ${knob ? knob.y : 0}px))`,
          }}
        />
      </div>

      {/* ── Tombol aksi (kanan bawah) ── */}
      <div
        className="fixed z-30 flex items-end gap-3"
        style={{
          right: `calc(1rem + env(safe-area-inset-right))`,
          bottom: `calc(1.1rem + env(safe-area-inset-bottom))`,
          ...NO_TOUCH_STYLE,
        }}
      >
        <button
          type="button"
          className={`${btnBase} w-12 h-12 text-[10px] ${sprintOn ? 'bg-emerald-500' : 'bg-slate-800/85'}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setSprintOn(true);
            onSprint(true);
          }}
          onPointerUp={() => {
            setSprintOn(false);
            onSprint(false);
          }}
          onPointerLeave={() => {
            if (sprintOn) {
              setSprintOn(false);
              onSprint(false);
            }
          }}
          onPointerCancel={() => {
            setSprintOn(false);
            onSprint(false);
          }}
          style={NO_TOUCH_STYLE}
          aria-label="Lari (tahan)"
        >
          LARI
        </button>
        <button
          type="button"
          className={`${btnBase} w-14 h-14 text-xs bg-slate-800/85`}
          onPointerDown={(e) => {
            e.preventDefault();
            onJump();
          }}
          style={NO_TOUCH_STYLE}
          aria-label="Lompat"
        >
          ⤒
        </button>
        <button
          type="button"
          className={`${btnBase} w-16 h-16 text-base bg-sky-600/90 border-sky-300/60`}
          onPointerDown={(e) => {
            e.preventDefault();
            onInteract();
          }}
          style={NO_TOUCH_STYLE}
          aria-label="Interaksi (E)"
        >
          E
        </button>
      </div>
    </>
  );
};
