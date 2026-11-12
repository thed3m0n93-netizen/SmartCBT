/**
 * SmartCBT - Game Mode Lobby (RPG Trivia).
 * Lobby permainan RPG Trivia bertema Sekolah Sihir untuk siswa.
 * Menggunakan assets pixel art dari src/pages/student/game_mode/trivia/rpg-trivia-assets/.
 */
import { useNavigate } from "react-router";
import { useState } from "react";

export default function GameModeLobby() {
  const navigate = useNavigate();
  const [showControls, setShowControls] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#14101f] text-[#e8e4f0] font-mono selection:bg-[#f0d878] selection:text-[#14101f]">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#2a1f4f]/30 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#4a3f70]/30 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] right-[20%] w-[30%] h-[30%] bg-[#f0d878]/10 rounded-full blur-[80px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-[#f0d878] tracking-widest drop-shadow-[0_0_10px_rgba(240,216,120,0.6)] mb-2">
          RPG TRIVIA
        </h1>
        <p className="text-sm sm:text-base text-[#8a80a8] tracking-wider uppercase letter-spacing-widest">
          Sekolah Sihir — Ujian Penyihir
        </p>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-col items-center gap-6 max-w-md w-full px-6">
        {/* Hero character / card */}
        <div className="relative group">
          <div className="bg-[#1a1230] border-2 border-[#e0c870] rounded-xl p-8 shadow-[0_0_40px_rgba(224,200,112,0.2)] relative overflow-hidden">
            {/* Decorative corners */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#f0d878]" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#f0d878]" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#f0d878]" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#f0d878]" />

            <div className="flex items-center justify-center gap-4">
              <div className="relative">
                <img
                  src="/game-mode-trivia/characters/player.png"
                  alt="Pemain"
                  className="w-32 h-32 image-rendering-pixelated drop-shadow-[0_0_20px_rgba(59,130,246,0.4)] animate-bounce-slow"
                />
                <div className="absolute -bottom-2 -right-2 bg-[#f0d878] text-[#14101f] text-xs font-bold px-2 py-0.5 rounded">
                  Kamu
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-start text-left">
                <h2 className="text-xl font-bold text-[#e8e4f0]">Selamat Datang, Penyihir!</h2>
                <p className="text-xs text-[#8a80a8] mt-1">
                  Uji pengetahuanmu melalui ruang trivia sihir. Jawab 5 pertanyaan<br />
                  dengan benar untuk meraih bintang dan juara!
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
          <button
            onClick={() => navigate("/student/game-mode/play")}
            className="flex-1 sm:flex-none px-8 py-4 bg-[#f0d878] text-[#14101f] font-bold text-lg rounded-lg tracking-widest uppercase shadow-[0_0_20px_rgba(240,216,120,0.5)] hover:bg-[#e0c870] hover:shadow-[0_0_30px_rgba(240,216,120,0.8)] transition-all active:scale-95"
          >
            Mulai Permainan
          </button>
        </div>

        {showControls ? (
          <div className="mt-6 bg-[#1a1230]/50 border border-[#2a1f4f]/50 rounded-lg p-4 text-xs text-[#8a80a8] leading-relaxed text-center">
            <p className="mb-2"><span className="text-[#f0d878] font-bold">Gerak:</span> Panah / WASD</p>
            <p className="mb-2"><span className="text-[#f0d878] font-bold">Bicara NPC:</span> E / Spasi</p>
            <p><span className="text-[#f0d878] font-bold">Masuk pintu:</span> Jalan ke arah pintu</p>
          </div>
        ) : null}

        <button
          onClick={() => setShowControls(!showControls)}
          className="mt-4 text-xs text-[#5b4fa3] hover:text-[#8a80a8] underline decoration-[#5b4fa3]/30 hover:decoration-[#8a80a8] transition-all"
        >
          {showControls ? "Sembunyikan Panduan" : "Lihat Panduan Bermain"}
        </button>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto mb-6 text-[10px] text-[#4a3f70] tracking-widest uppercase">
        SmartCBT &bull; Game Mode — RPG Trivia
      </footer>
    </div>
  );
}