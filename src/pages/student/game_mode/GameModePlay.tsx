/**
 * SmartCBT - Game Mode Play (Nusantara High).
 * Build 141: game mode diganti dari RPG Trivia (iframe HTML statis) menjadi
 * "Nusantara High — Isometric School MMO" yang dirender IN-APP sebagai
 * komponen React. Multiplayer berjalan lewat Socket.IO di backend SmartCBT
 * (path /game-socket.io, handshake membawa token login — lihat
 * src/lib/server/nusantara-game.ts), jadi tidak ada server/proses ketiga.
 */
import { useNavigate } from "react-router";
import GameNusantara from "../../../game/nusantara/GameNusantara";

export default function GameModePlay() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 overflow-hidden select-none">
      <GameNusantara />
      {/* Pintu keluar selalu tersedia meski UI game sedang penuh (HUD/chat). */}
      <button
        onClick={() => navigate("/student/game-mode", { replace: true })}
        className="absolute top-3 right-3 max-sm:left-3 max-sm:right-auto z-[60] px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700/70 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 backdrop-blur transition-colors"
        title="Kembali ke lobby"
      >
        ← Lobby
      </button>
    </div>
  );
}
