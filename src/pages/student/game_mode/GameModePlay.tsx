/**
 * SmartCBT - Game Mode Play (RPG Trivia).
 * Halaman utama permainan RPG Trivia. Memuat demo RPG Trivia (canvas 2D,
 * tile-based, pixel art) di dalam iframe sebagai permainan trivia interaktif.
 */
import { useNavigate } from "react-router";

export default function GameModePlay() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 bg-[#14101f] text-[#e8e4f0] font-mono flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-[#2a1f4f] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#f0d878] rounded flex items-center justify-center text-[#14101f] font-bold text-xs">
            RPG
          </div>
          <span className="text-sm font-bold tracking-widest text-[#f0d878]">TRIVIA</span>
        </div>
        <button
          onClick={() => navigate("/student/game-mode", { replace: true })}
          className="px-4 py-2 text-xs text-[#8a80a8] hover:text-[#e8e4f0] transition-colors border border-[#2a1f4f] rounded hover:bg-[#1a1230]"
        >
          Kembali ke Lobby
        </button>
      </header>

      {/* Game iframe */}
      <main className="flex-1 relative overflow-hidden bg-[#0a0812]">
        <iframe
          src="/game-mode-trivia/demo/index.html"
          className="w-full h-full block border-0"
          title="RPG Trivia Game"
          allow="fullscreen"
        />
      </main>

      {/* Footer hint */}
      <footer className="h-10 border-t border-[#2a1f4f] flex items-center justify-center px-6 shrink-0 text-[10px] text-[#4a3f70] tracking-widest uppercase">
        RPG Trivia — Sekolah Sihir &bull; Gerakkan karakter dengan WASD / Panah, bicara NPC dengan E / Spasi
      </footer>
    </div>
  );
}