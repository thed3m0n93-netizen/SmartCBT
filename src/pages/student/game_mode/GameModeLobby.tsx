/**
 * SmartCBT - Game Mode Lobby (Nusantara High).
 * Build 141: tema diganti dari "RPG Trivia — Sekolah Sihir" menjadi
 * "Nusantara High — Isometric School MMO". Tidak lagi memakai aset PNG
 * game-mode-trivia (dihapus); hero digambar dengan CSS murni.
 */
import { useNavigate } from "react-router";
import { useState } from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { useI18n } from "../../../i18n";

export default function GameModeLobby() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [showControls, setShowControls] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-12%] left-[-10%] w-[45%] h-[45%] bg-emerald-500/15 rounded-full blur-[130px]" />
        <div className="absolute bottom-[-12%] right-[-10%] w-[45%] h-[45%] bg-sky-500/15 rounded-full blur-[130px]" />
        <div className="absolute top-[24%] right-[22%] w-[28%] h-[28%] bg-amber-400/10 rounded-full blur-[90px]" />
      </div>

      {/* Persistent exit bar back to normal Student Dashboard */}
      <div className="fixed top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <button
          type="button"
          onClick={() => navigate("/student/dashboard", { replace: true })}
          className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-700/80 bg-slate-900/85 hover:bg-slate-800 text-slate-200 hover:text-white text-xs sm:text-sm font-semibold backdrop-blur transition-colors min-h-[40px] shadow-lg"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>{t("Kembali ke Dashboard")}</span>
        </button>
      </div>

      {/* Header */}
      <header className="relative z-10 mt-16 mb-8 text-center px-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 text-3xl mb-4" aria-hidden>
          🏫
        </div>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight bg-gradient-to-r from-emerald-300 via-sky-300 to-amber-200 bg-clip-text text-transparent mb-2">
          NUSANTARA HIGH
        </h1>
        <p className="text-sm sm:text-base text-slate-400 tracking-widest uppercase">
          Isometric School MMO
        </p>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-col items-center gap-5 max-w-lg w-full px-6 pb-10">
        {/* Hero card */}
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2 shrink-0" aria-hidden>
              <span className="w-9 h-9 rounded-full bg-emerald-500/80 border-2 border-slate-900 flex items-center justify-center text-sm">🎓</span>
              <span className="w-9 h-9 rounded-full bg-sky-500/80 border-2 border-slate-900 flex items-center justify-center text-sm">🧑‍🏫</span>
              <span className="w-9 h-9 rounded-full bg-amber-400/80 border-2 border-slate-900 flex items-center justify-center text-sm">⭐</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Selamat datang di sekolah!</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Jelajahi kampus isometrik, ngobrol dengan teman, ikuti bel sekolah,
                jawab kuis untuk menambah XP &amp; uang saku — semua real-time.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
          <button
            type="button"
            onClick={() => navigate("/student/game-mode/play")}
            className="w-full sm:w-auto px-8 py-3.5 bg-emerald-500 text-slate-950 font-bold text-base sm:text-lg rounded-xl tracking-wide shadow-[0_0_30px_rgba(16,185,129,0.35)] hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.55)] transition-all active:scale-95 min-h-[48px]"
          >
            Masuk Sekolah
          </button>

          <button
            type="button"
            onClick={() => navigate("/student/dashboard", { replace: true })}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white text-sm font-semibold transition-colors min-h-[48px]"
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>{t("Kembali ke Mode Biasa")}</span>
          </button>
        </div>

        {showControls ? (
          <div className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <p><span className="text-emerald-300 font-bold">Gerak:</span> WASD / Panah, atau klik peta</p>
              <p><span className="text-emerald-300 font-bold">Lari / Lompat:</span> Shift / Spasi</p>
              <p><span className="text-emerald-300 font-bold">Interaksi:</span> E di dekat objek (meja, loker, lapangan)</p>
              <p><span className="text-emerald-300 font-bold">Zoom:</span> Roda mouse / tombol +−</p>
              <p><span className="text-emerald-300 font-bold">Kuis:</span> dekati papan kuis lalu jawab (XP + uang)</p>
              <p><span className="text-emerald-300 font-bold">Chat &amp; Ekspresi:</span> panel kanan</p>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setShowControls(!showControls)}
          className="text-xs text-slate-500 hover:text-slate-300 underline decoration-slate-700 hover:decoration-slate-400 transition-all"
        >
          {showControls ? "Sembunyikan Panduan" : "Lihat Panduan Bermain"}
        </button>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto mb-6 text-[10px] text-slate-600 tracking-widest uppercase">
        SmartCBT &bull; Game Mode — Nusantara High
      </footer>
    </div>
  );
}
