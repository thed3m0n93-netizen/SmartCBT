import React, { useEffect, useRef, useState } from 'react';
import { School, Users } from 'lucide-react';
import {
  CharacterCustomizerFields,
  CharacterPreview,
  DEFAULT_CHARACTER_CONFIG,
  sanitizeCharacterConfig,
} from './CharacterCustomizer';
import type { CharacterConfig } from './types';

interface LoginScreenProps {
  /** Build 142 — nama pemain dikunci dari akun yang login (read-only). */
  accountName: string;
  initialConfig?: CharacterConfig | null;
  onJoin: (config: CharacterConfig) => void;
  connecting: boolean;
  errorMsg: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  accountName,
  initialConfig,
  onJoin,
  connecting,
  errorMsg,
}) => {
  const name = accountName.slice(0, 14);
  const [config, setConfig] = useState<CharacterConfig>(() =>
    initialConfig ? sanitizeCharacterConfig(initialConfig) : DEFAULT_CHARACTER_CONFIG
  );
  const dirtyRef = useRef(false);

  // Sync fetched saved appearance on first mount unless user already edited fields.
  useEffect(() => {
    if (initialConfig && !dirtyRef.current) {
      setConfig(sanitizeCharacterConfig(initialConfig));
    }
  }, [initialConfig]);

  const handleConfigChange = (next: CharacterConfig) => {
    dirtyRef.current = true;
    setConfig(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (connecting) return;
    onJoin(config);
  };

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
            <CharacterPreview name={name} config={config} />
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

            <CharacterCustomizerFields value={config} onChange={handleConfigChange} />

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
