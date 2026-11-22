import React, { useEffect, useRef, useState } from 'react';
import { School, Users } from 'lucide-react';
import { drawCharacterSprite } from './isoRenderer';
import type { HairStyle, PlayerRole } from './schoolMap';

interface LoginScreenProps {
  /** Build 142 — nama pemain dikunci dari akun yang login (read-only). */
  accountName: string;
  onJoin: (config: {
    role: PlayerRole;
    hairStyle: HairStyle;
    hairColor: string;
    skinColor: string;
  }) => void;
  connecting: boolean;
  errorMsg: string | null;
}

const ROLES: { value: PlayerRole; label: string; uniform: string }[] = [
  { value: 'sma', label: 'Siswa SMA', uniform: 'Putih Abu-Abu' },
  { value: 'smp', label: 'Siswa SMP', uniform: 'Putih Biru' },
  { value: 'osis', label: 'Pengurus OSIS', uniform: 'Jas Almamater' },
  { value: 'guru', label: 'Guru', uniform: 'Seragam Batik' },
];

const CHARACTER_STYLES: { value: HairStyle; label: string; desc: string }[] = [
  { value: 'short', label: 'Rambut Pendek', desc: 'Celana seragam' },
  { value: 'long', label: 'Rambut Panjang', desc: 'Perempuan · Rok' },
  { value: 'hijab', label: 'Berkerudung', desc: 'Perempuan · Hijab' },
];

const HAIR_COLORS = [
  { hex: '#1e293b', label: 'Hitam' },
  { hex: '#451a03', label: 'Cokelat Tua' },
  { hex: '#9a3412', label: 'Cokelat' },
  { hex: '#ca8a04', label: 'Pirang' },
  { hex: '#be185d', label: 'Merah Muda' },
  { hex: '#0284c7', label: 'Biru' },
];

const HIJAB_COLORS = [
  { hex: '#f8fafc', label: 'Putih Sekolah' },
  { hex: '#1e293b', label: 'Hitam' },
  { hex: '#1e3a8a', label: 'Biru Dongker' },
  { hex: '#78350f', label: 'Cokelat Pramuka' },
  { hex: '#059669', label: 'Hijau Sage' },
  { hex: '#9f1239', label: 'Maroon' },
  { hex: '#be185d', label: 'Dusty Pink' },
  { hex: '#fde68a', label: 'Krem' },
];

const SKIN_COLORS = [
  { hex: '#fde6c4', label: 'Cerah' },
  { hex: '#f6d198', label: 'Kuning Langsat' },
  { hex: '#dba670', label: 'Sawo Matang' },
  { hex: '#a86b3e', label: 'Gelap' },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({
  accountName,
  onJoin,
  connecting,
  errorMsg,
}) => {
  const name = accountName.slice(0, 14);
  const [role, setRole] = useState<PlayerRole>('sma');
  const [hairStyle, setHairStyle] = useState<HairStyle>('short');
  const [hairColor, setHairColor] = useState('#1e293b');
  const [skinColor, setSkinColor] = useState('#f6d198');
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const handleSelectStyle = (nextStyle: HairStyle) => {
    setHairStyle(nextStyle);
    if (nextStyle === 'hijab' && !HIJAB_COLORS.some((c) => c.hex === hairColor)) {
      setHairColor('#f8fafc');
    } else if (nextStyle !== 'hijab' && !HAIR_COLORS.some((c) => c.hex === hairColor)) {
      setHairColor('#1e293b');
    }
  };

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
              role,
              hairStyle,
              hairColor,
              skinColor,
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
  }, [name, role, hairStyle, hairColor, skinColor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (connecting) return;
    onJoin({
      role,
      hairStyle,
      hairColor,
      skinColor,
    });
  };

  const colorOptions = hairStyle === 'hijab' ? HIJAB_COLORS : HAIR_COLORS;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden my-auto">
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-sky-400 mb-1">
                <School className="w-4 h-4" />
                <span>Isometric Open-World · Multiplayer</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-50 text-balance">
                Nusantara High
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Jelajahi kelas, perpustakaan, kantin, dan lapangan basket bersama pemain lain secara real-time.
              </p>
            </div>
            <div className="shrink-0 bg-slate-950/80 border border-slate-800 rounded-lg p-2 flex flex-col items-center">
              <canvas ref={previewRef} width={76} height={84} />
              <span className="text-[11px] text-slate-400 mt-1">Pratinjau</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <span className="block text-sm font-medium text-slate-200 mb-1.5">
                Masuk sebagai
              </span>
              <div className="flex items-center gap-2 w-full min-h-[42px] px-3.5 rounded-lg bg-slate-950/70 border border-slate-700 text-slate-100 text-sm">
                <School className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="font-semibold truncate">{name}</span>
                <span className="ml-auto text-[11px] text-slate-500 shrink-0">terkunci dari akun</span>
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-200 mb-1.5">
                Gaya Karakter
              </span>
              <div className="grid grid-cols-3 gap-2">
                {CHARACTER_STYLES.map((st) => {
                  const active = hairStyle === st.value;
                  return (
                    <button
                      key={st.value}
                      type="button"
                      onClick={() => handleSelectStyle(st.value)}
                      className={`text-left px-2.5 py-2 rounded-lg border transition-colors min-h-[44px] ${
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
              <span className="block text-sm font-medium text-slate-200 mb-1.5">
                Peran dan Seragam
              </span>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const active = role === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`text-left px-3 py-2 rounded-lg border transition-colors min-h-[42px] ${
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
                  {hairStyle === 'hijab' ? 'Warna Kerudung' : 'Warna Rambut'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      aria-label={`${hairStyle === 'hijab' ? 'Kerudung' : 'Rambut'} ${c.label}`}
                      onClick={() => setHairColor(c.hex)}
                      className={`w-8 h-8 rounded-md border-2 transition-transform ${
                        hairColor === c.hex
                          ? 'border-sky-400 scale-110'
                          : 'border-slate-700 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-200 mb-1.5">
                  Warna Kulit
                </span>
                <div className="flex flex-wrap gap-2">
                  {SKIN_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      aria-label={`Kulit ${c.label}`}
                      onClick={() => setSkinColor(c.hex)}
                      className={`w-8 h-8 rounded-md border-2 transition-transform ${
                        skinColor === c.hex
                          ? 'border-sky-400 scale-110'
                          : 'border-slate-700 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">
                {errorMsg}
              </div>
            )}

            <div className="pt-2 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Users className="w-4 h-4 text-slate-500" />
                <span>Buka 2 tab untuk tes multiplayer</span>
              </div>
              <button
                type="submit"
                disabled={connecting}
                className="px-6 py-2.5 min-h-[44px] rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {connecting ? 'Menghubungkan...' : 'Masuk ke Sekolah'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
