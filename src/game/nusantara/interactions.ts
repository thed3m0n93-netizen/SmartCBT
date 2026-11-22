import { MAP_SIZE, type SchoolMapData } from './schoolMap';
import type { RenderPlayer } from './isoRenderer';
import type { NearbyInteraction } from './types';

export function clampWorldCoord(value: number): number {
  return Math.max(1.2, Math.min(MAP_SIZE - 1.2, value));
}

export function canMoveTo(map: SchoolMapData, wx: number, wy: number): boolean {
  const r = 0.23;
  const corners: [number, number][] = [
    [wx - r, wy - r],
    [wx + r, wy - r],
    [wx - r, wy + r],
    [wx + r, wy + r],
  ];
  for (const [px, py] of corners) {
    const gx = Math.floor(px);
    const gy = Math.floor(py);
    if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return false;
    if (map.solid[gy][gx]) return false;
  }
  return true;
}

export function getNearbyInteraction(
  map: SchoolMapData,
  p: Pick<RenderPlayer, 'wx' | 'wy' | 'sitting'>
): NearbyInteraction | null {
  const tx = Math.floor(p.wx);
  const ty = Math.floor(p.wy);

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
      const obj = map.objects[ny][nx];
      if (obj === 'board') {
        return { type: 'quiz', label: 'Tekan [E] Ujian Kilat di Papan Tulis (+30 XP)' };
      }
      if (obj === 'bookshelf') {
        return { type: 'read', label: 'Tekan [E] Perpustakaan — Modul & Tugas (+15 XP)' };
      }
      if (obj === 'stall') {
        return { type: 'buy_food', label: 'Tekan [E] Beli Bakso & Es Teh (Rp 2.000)' };
      }
      if (obj === 'chair' || obj === 'bench') {
        return {
          type: 'sit',
          label: p.sitting ? 'Tekan [E] Berdiri' : 'Tekan [E] Duduk',
          tx: nx + 0.5,
          ty: ny + 0.5,
        };
      }
      if (obj === 'flagpole' || obj === 'podium') {
        return { type: 'salute', label: 'Tekan [E] Hormat Bendera Merah Putih' };
      }
      if (obj === 'locker') {
        return { type: 'locker', label: 'Tekan [E] Cek Loker Sekolah' };
      }
    }
  }

  if (p.wx >= 21 && p.wx <= 29 && p.wy >= 15 && p.wy <= 26) {
    return { type: 'basketball', label: 'Tekan [E] Lempar Bola Basket (+10 XP)' };
  }
  return null;
}
