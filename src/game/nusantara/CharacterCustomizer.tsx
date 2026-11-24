import React, { useEffect, useRef } from 'react';
import { drawCharacterSprite } from './isoRenderer';
import type { HairStyle, PlayerRole } from './schoolMap';
import type { CharacterConfig } from './types';

export const ROLES: { value: PlayerRole; label: string; uniform: string }[] = [
  { value: 'sma', label: 'Siswa SMA', uniform: 'Putih Abu-Abu' },
  { value: 'smp', label: 'Siswa SMP', uniform: 'Putih Biru' },
  { value: 'osis', label: 'Pengurus OSIS', uniform: 'Jas Almamater' },
  { value: 'guru', label: 'Guru', uniform: 'Seragam Batik' },
];

export const CHARACTER_STYLES: { value: HairStyle; label: string; desc: string }[] = [
  { value: 'short', label: 'Rambut Pendek', desc: 'Celana seragam' },
  { value: 'long', label: 'Rambut Panjang', desc: 'Perempuan · Rok' },
  { value: 'hijab', label: 'Berkerudung', desc: 'Perempuan · Hijab' },
];

export const HAIR_COLORS = [
  { hex: '#1e293b', label: 'Hitam' },
  { hex: '#451a03', label: 'Cokelat Tua' },
  { hex: '#9a3412', label: 'Cokelat' },
  { hex: '#ca8a04', label: 'Pirang' },
  { hex: '#be185d', label: 'Merah Muda' },
  { hex: '#0284c7', label: 'Biru' },
];

export const HIJAB_COLORS = [
  { hex: '#f8fafc', label: 'Putih Sekolah' },
  { hex: '#1e293b', label: 'Hitam' },
  { hex: '#1e3a8a', label: 'Biru Dongker' },
  { hex: '#78350f', label: 'Cokelat Pramuka' },
  { hex: '#059669', label: 'Hijau Sage' },
  { hex: '#9f1239', label: 'Maroon' },
  { hex: '#be185d', label: 'Dusty Pink' },
  { hex: '#fde68a', label: 'Krem' },
];

export const SKIN_COLORS = [
  { hex: '#fde6c4', label: 'Cerah' },
  { hex: '#f6d198', label: 'Kuning Langsat' },
  { hex: '#dba670', label: 'Sawo Matang' },
  { hex: '#a86b3e', label: 'Gelap' },
];

export const DEFAULT_CHARACTER_CONFIG: CharacterConfig = {
  role: 'sma',
  hairStyle: 'short',
  hairColor: '#1e293b',
  skinColor: '#f6d198',
};

export function sanitizeCharacterConfig(raw?: Partial<CharacterConfig> | null): CharacterConfig {
  const role: PlayerRole =
    raw?.role && ROLES.some((r) => r.value === raw.role) ? raw.role : DEFAULT_CHARACTER_CONFIG.role;
  const hairStyle: HairStyle =
    raw?.hairStyle && CHARACTER_STYLES.some((s) => s.value === raw.hairStyle)
      ? raw.hairStyle
      : DEFAULT_CHARACTER_CONFIG.hairStyle;
  const defaultHair = hairStyle === 'hijab' ? '#f8fafc' : '#1e293b';
  const hairColor =
    raw?.hairColor && /^#[0-9a-fA-F]{6}$/.test(raw.hairColor) ? raw.hairColor : defaultHair;
  const skinColor =
    raw?.skinColor && /^#[0-9a-fA-F]{6}$/.test(raw.skinColor)
      ? raw.skinColor
      : DEFAULT_CHARACTER_CONFIG.skinColor;
  return { role, hairStyle, hairColor, skinColor };
}

interface CharacterPreviewProps {
  name: string;
  config: CharacterConfig;
}

export const CharacterPreview: React.FC<CharacterPreviewProps> = ({ name, config }) => {
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const renderPreview = (time: number) => {
      const canvas = previewRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawCharacterSprite(
            ctx,
            {
              id: 'preview',
              name: name.trim() || 'Siswa',
              role: config.role,
              hairStyle: config.hairStyle,
              hairColor: config.hairColor,
              skinColor: config.skinColor,
              dir: 's',
              moving: true,
              sitting: false,
              jumpOffset: 0,
              walkPhase: time / 140,
            },
            canvas.width / 2,
            canvas.height - 16,
            true,
            undefined,
            undefined,
            time,
            false
          );
        }
      }
      raf = requestAnimationFrame(renderPreview);
    };
    raf = requestAnimationFrame(renderPreview);
    return () => cancelAnimationFrame(raf);
  }, [name, config.role, config.hairStyle, config.hairColor, config.skinColor]);

  return (
    <div className="shrink-0 bg-slate-950/80 border border-slate-800 rounded-lg p-2 flex flex-col items-center">
      <canvas ref={previewRef} width={76} height={84} />
      <span className="text-[11px] text-slate-400 mt-1">Pratinjau</span>
    </div>
  );
};

interface CharacterCustomizerFieldsProps {
  value: CharacterConfig;
  onChange: (next: CharacterConfig) => void;
}

export const CharacterCustomizerFields: React.FC<CharacterCustomizerFieldsProps> = ({
  value,
  onChange,
}) => {
  const colorOptions = value.hairStyle === 'hijab' ? HIJAB_COLORS : HAIR_COLORS;

  const handleSelectStyle = (nextStyle: HairStyle) => {
    let nextHairColor = value.hairColor;
    if (nextStyle === 'hijab' && !HIJAB_COLORS.some((c) => c.hex === nextHairColor)) {
      nextHairColor = '#f8fafc';
    } else if (nextStyle !== 'hijab' && !HAIR_COLORS.some((c) => c.hex === nextHairColor)) {
      nextHairColor = '#1e293b';
    }
    onChange({
      ...value,
      hairStyle: nextStyle,
      hairColor: nextHairColor,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="block text-sm font-medium text-slate-200 mb-1.5">Gaya Karakter</span>
        <div className="grid grid-cols-3 gap-2">
          {CHARACTER_STYLES.map((st) => {
            const active = value.hairStyle === st.value;
            return (
              <button
                key={st.value}
                type="button"
                onClick={() => handleSelectStyle(st.value)}
                className={`text-left px-2.5 py-2 rounded-lg border transition-colors min-h-[44px] cursor-pointer ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-400 text-slate-50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-xs sm:text-sm font-semibold leading-tight">{st.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{st.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="block text-sm font-medium text-slate-200 mb-1.5">Peran dan Seragam</span>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => {
            const active = value.role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => onChange({ ...value, role: r.value })}
                className={`text-left px-3 py-2 rounded-lg border transition-colors min-h-[42px] cursor-pointer ${
                  active
                    ? 'bg-sky-500/15 border-sky-500 text-slate-50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-sm font-semibold whitespace-nowrap">{r.label}</div>
                <div className="text-xs text-slate-400 whitespace-nowrap">{r.uniform}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <span className="block text-sm font-medium text-slate-200 mb-1.5">
            {value.hairStyle === 'hijab' ? 'Warna Kerudung' : 'Warna Rambut'}
          </span>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                aria-label={`${value.hairStyle === 'hijab' ? 'Kerudung' : 'Rambut'} ${c.label}`}
                onClick={() => onChange({ ...value, hairColor: c.hex })}
                className={`w-8 h-8 rounded-md border-2 transition-transform cursor-pointer ${
                  value.hairColor === c.hex
                    ? 'border-sky-400 scale-110'
                    : 'border-slate-700 hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-200 mb-1.5">Warna Kulit</span>
          <div className="flex flex-wrap gap-2">
            {SKIN_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                aria-label={`Kulit ${c.label}`}
                onClick={() => onChange({ ...value, skinColor: c.hex })}
                className={`w-8 h-8 rounded-md border-2 transition-transform cursor-pointer ${
                  value.skinColor === c.hex
                    ? 'border-sky-400 scale-110'
                    : 'border-slate-700 hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
