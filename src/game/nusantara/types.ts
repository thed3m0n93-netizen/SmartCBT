import type { HairStyle, PlayerRole } from './schoolMap';

export type GameState = 'TITLE_MENU' | 'PLAYING';

export interface CharacterConfig {
  role: PlayerRole;
  hairStyle: HairStyle;
  hairColor: string;
  skinColor: string;
}

export interface ChatMessage {
  id: string;
  sender?: string;
  role?: PlayerRole;
  text: string;
  system?: boolean;
}

export interface NearbyInteraction {
  type: 'study' | 'quiz' | 'read' | 'buy_food' | 'sit' | 'salute' | 'basketball' | 'locker';
  label: string;
  tx?: number;
  ty?: number;
}

export interface GameToast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'warn';
}

export interface HudStats {
  xp: number;
  money: number;
  energy: number;
}

export interface LobbyInfo {
  room?: string;
  kind?: 'class' | 'staff' | string;
  label?: string;
  classId?: number | string | null;
}

export const ROLE_LABELS: Record<PlayerRole, string> = {
  sma: 'Siswa SMA',
  smp: 'Siswa SMP',
  osis: 'OSIS',
  guru: 'Guru',
};

export const QUICK_EMOTES = [
  { key: '1', emoji: '👋', label: 'Sapa' },
  { key: '2', emoji: '😂', label: 'Tertawa' },
  { key: '3', emoji: '❤️', label: 'Suka' },
  { key: '4', emoji: '🔥', label: 'Semangat' },
];

export function getRankTitle(xp: number): string {
  if (xp >= 150) return 'Bintang Sekolah';
  if (xp >= 60) return 'Juara Kelas';
  if (xp >= 20) return 'Siswa Rajin';
  return 'Siswa Baru';
}
