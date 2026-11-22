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
      <GameNusantara
        onExitToLobby={() => navigate("/student/game-mode", { replace: true })}
        onExitToDashboard={() => navigate("/student/dashboard", { replace: true })}
      />
    </div>
  );
}
