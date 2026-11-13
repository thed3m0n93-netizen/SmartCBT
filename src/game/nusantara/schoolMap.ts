export const MAP_SIZE = 32;
export const TILE_W = 68;
export const TILE_H = 34;

export type FloorType =
  | 'grass'
  | 'paving'
  | 'corridor'
  | 'class_floor'
  | 'lib_floor'
  | 'kantin_floor'
  | 'court'
  | 'court_key';

export type ObjectType =
  | 'wall'
  | 'window_wall'
  | 'brick_wall'
  | 'desk'
  | 'chair'
  | 'board'
  | 'bookshelf'
  | 'locker'
  | 'stall'
  | 'tree'
  | 'flower'
  | 'hoop'
  | 'flagpole'
  | 'podium'
  | 'bench'
  | 'gate';

export type PlayerRole = 'sma' | 'smp' | 'osis' | 'guru';
export type Direction = 'n' | 's' | 'e' | 'w';

export interface PlayerState {
  id: string;
  name: string;
  role: PlayerRole;
  hairColor: string;
  skinColor: string;
  wx: number;
  wy: number;
  dir: Direction;
  moving: boolean;
  sprinting: boolean;
  sitting: boolean;
  jumpOffset: number;
  xp: number;
  money: number;
  energy: number;
}

export interface SchoolPhase {
  id: 'study' | 'recess' | 'extracurricular';
  name: string;
  duration: number;
  accent: string;
  ambientTint: string;
}

export const SCHEDULES: SchoolPhase[] = [
  {
    id: 'study',
    name: 'Jam Pelajaran',
    duration: 75,
    accent: '#2563eb',
    ambientTint: 'rgba(255, 255, 255, 0)',
  },
  {
    id: 'recess',
    name: 'Jam Istirahat',
    duration: 50,
    accent: '#059669',
    ambientTint: 'rgba(254, 249, 195, 0.05)',
  },
  {
    id: 'extracurricular',
    name: 'Ekstrakurikuler',
    duration: 55,
    accent: '#d97706',
    ambientTint: 'rgba(251, 146, 60, 0.10)',
  },
];

export interface SchoolMapData {
  floor: FloorType[][];
  objects: (ObjectType | null)[][];
  solid: boolean[][];
}

export function buildSchoolMap(): SchoolMapData {
  const floor: FloorType[][] = [];
  const objects: (ObjectType | null)[][] = [];
  const solid: boolean[][] = [];

  for (let y = 0; y < MAP_SIZE; y++) {
    floor[y] = [];
    objects[y] = [];
    solid[y] = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      floor[y][x] = 'grass';
      objects[y][x] = null;
      solid[y][x] = false;
    }
  }

  const fillFloor = (x1: number, y1: number, x2: number, y2: number, type: FloorType) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        floor[y][x] = type;
      }
    }
  };

  const placeObj = (x: number, y: number, type: ObjectType, isSolid = true) => {
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return;
    objects[y][x] = type;
    solid[y][x] = isSolid;
  };

  // 1. Pagar Keliling Sekolah
  for (let i = 0; i < MAP_SIZE; i++) {
    placeObj(i, 0, 'brick_wall', true);
    placeObj(0, i, 'brick_wall', true);
    placeObj(MAP_SIZE - 1, i, 'brick_wall', true);
    if (i < 14 || i > 17) placeObj(i, MAP_SIZE - 1, 'brick_wall', true);
  }

  // Gerbang Utama & Jalan Masuk
  fillFloor(14, 26, 17, 31, 'paving');
  placeObj(13, 31, 'gate', true);
  placeObj(18, 31, 'gate', true);
  placeObj(13, 29, 'flower', false);
  placeObj(18, 29, 'flower', false);

  // 2. Koridor Utama (x: 2..29, y: 11..13)
  fillFloor(2, 11, 29, 13, 'corridor');
  // Loker di koridor
  placeObj(12, 11, 'locker', true);
  placeObj(23, 11, 'locker', true);

  // 3. Ruang Kelas IPA (x: 2..11, y: 2..10)
  fillFloor(2, 2, 11, 10, 'class_floor');
  for (let x = 2; x <= 11; x++) {
    placeObj(x, 2, x === 4 || x === 9 ? 'window_wall' : 'wall', true);
    if (x !== 6 && x !== 7) placeObj(x, 10, x === 4 || x === 9 ? 'window_wall' : 'wall', true);
  }
  for (let y = 2; y <= 10; y++) {
    placeObj(2, y, y === 5 || y === 8 ? 'window_wall' : 'wall', true);
    placeObj(11, y, 'wall', true);
  }
  placeObj(6, 2, 'board', true);
  placeObj(7, 2, 'board', true);
  placeObj(4, 4, 'desk', true); // Meja guru
  placeObj(4, 3, 'chair', false);
  // Bangku siswa
  [4, 6, 9].forEach((bx) => {
    [6, 8].forEach((by) => {
      placeObj(bx, by, 'desk', true);
      placeObj(bx, by + 1, 'chair', false);
    });
  });

  // 4. Perpustakaan (x: 13..22, y: 2..10)
  fillFloor(13, 2, 22, 10, 'lib_floor');
  for (let x = 13; x <= 22; x++) {
    placeObj(x, 2, x === 16 || x === 19 ? 'window_wall' : 'wall', true);
    if (x !== 17 && x !== 18) placeObj(x, 10, x === 15 || x === 20 ? 'window_wall' : 'wall', true);
  }
  for (let y = 2; y <= 10; y++) {
    placeObj(13, y, 'wall', true);
    placeObj(22, y, 'wall', true);
  }
  [14, 15, 20, 21].forEach((bx) => placeObj(bx, 3, 'bookshelf', true));
  [4, 6, 8].forEach((by) => {
    placeObj(14, by, 'bookshelf', true);
    placeObj(21, by, 'bookshelf', true);
  });
  placeObj(17, 6, 'desk', true);
  placeObj(18, 6, 'desk', true);
  placeObj(17, 7, 'chair', false);
  placeObj(18, 7, 'chair', false);

  // 5. Ruang OSIS & Guru (x: 24..29, y: 2..10)
  fillFloor(24, 2, 29, 10, 'class_floor');
  for (let x = 24; x <= 29; x++) {
    placeObj(x, 2, x === 26 || x === 27 ? 'window_wall' : 'wall', true);
    if (x !== 26 && x !== 27) placeObj(x, 10, 'wall', true);
  }
  for (let y = 2; y <= 10; y++) {
    placeObj(24, y, 'wall', true);
    placeObj(29, y, y === 5 || y === 8 ? 'window_wall' : 'wall', true);
  }
  placeObj(26, 4, 'desk', true);
  placeObj(27, 4, 'desk', true);
  placeObj(26, 5, 'chair', false);
  placeObj(27, 5, 'chair', false);
  placeObj(25, 3, 'bookshelf', true);

  // 6. Halaman Upacara & Tiang Bendera (x: 12..19, y: 15..25)
  fillFloor(12, 14, 19, 25, 'paving');
  placeObj(15, 19, 'flagpole', true);
  placeObj(16, 19, 'podium', true);
  placeObj(12, 16, 'bench', false);
  placeObj(19, 16, 'bench', false);
  placeObj(12, 23, 'bench', false);
  placeObj(19, 23, 'bench', false);

  // 7. Kantin Sekolah (x: 2..10, y: 15..24)
  fillFloor(2, 15, 10, 24, 'kantin_floor');
  placeObj(3, 16, 'stall', true);
  placeObj(3, 18, 'stall', true);
  placeObj(3, 20, 'stall', true);
  [6, 8].forEach((kx) => {
    [17, 21].forEach((ky) => {
      placeObj(kx, ky, 'desk', true);
      placeObj(kx, ky + 1, 'chair', false);
    });
  });

  // 8. Lapangan Basket (x: 21..29, y: 15..26)
  fillFloor(21, 15, 29, 26, 'court');
  fillFloor(24, 15, 26, 17, 'court_key');
  fillFloor(24, 24, 26, 26, 'court_key');
  placeObj(25, 15, 'hoop', true);
  placeObj(25, 26, 'hoop', true);

  // 9. Taman & Pepohonan
  const trees: [number, number][] = [
    [2, 27],
    [5, 28],
    [9, 27],
    [11, 22],
    [11, 26],
    [21, 28],
    [25, 29],
    [28, 28],
    [20, 14],
    [11, 14],
  ];
  trees.forEach(([tx, ty]) => placeObj(tx, ty, 'tree', true));

  const flowers: [number, number][] = [
    [3, 25],
    [7, 26],
    [13, 14],
    [18, 14],
    [22, 14],
    [28, 14],
  ];
  flowers.forEach(([fx, fy]) => placeObj(fx, fy, 'flower', false));

  return { floor, objects, solid };
}

export function getZoneName(wx: number, wy: number): string {
  if (wx >= 2 && wx <= 11 && wy >= 2 && wy <= 10) return 'Ruang Kelas IPA';
  if (wx >= 13 && wx <= 22 && wy >= 2 && wy <= 10) return 'Perpustakaan';
  if (wx >= 24 && wx <= 29 && wy >= 2 && wy <= 10) return 'Ruang Guru & OSIS';
  if (wx >= 2 && wx <= 10 && wy >= 15 && wy <= 24) return 'Kantin Sekolah';
  if (wx >= 21 && wx <= 29 && wy >= 15 && wy <= 26) return 'Lapangan Basket';
  if (wx >= 12 && wx <= 19 && wy >= 14 && wy <= 25) return 'Halaman Upacara';
  if (wy >= 11 && wy <= 13 && wx >= 2 && wx <= 29) return 'Koridor Utama';
  return 'Taman & Gerbang Sekolah';
}

export interface QuizQuestion {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answerIndex: number;
}

export const QUIZ_BANK: QuizQuestion[] = [
  {
    id: 1,
    subject: 'Biologi',
    question: 'Proses tumbuhan membuat makanan sendiri dengan bantuan cahaya matahari disebut?',
    options: ['Respirasi', 'Fotosintesis', 'Transpirasi', 'Fermentasi'],
    answerIndex: 1,
  },
  {
    id: 2,
    subject: 'Matematika',
    question: 'Jika sebuah segitiga siku-siku memiliki sisi tegak 6 cm dan 8 cm, panjang sisi miringnya adalah?',
    options: ['10 cm', '12 cm', '14 cm', '9 cm'],
    answerIndex: 0,
  },
  {
    id: 3,
    subject: 'Sejarah',
    question: 'Sumpah Pemuda diikrarkan pada tanggal?',
    options: ['17 Agustus 1945', '20 Mei 1908', '28 Oktober 1928', '10 November 1945'],
    answerIndex: 2,
  },
  {
    id: 4,
    subject: 'Fisika',
    question: 'Satuan Internasional (SI) untuk gaya adalah?',
    options: ['Joule', 'Watt', 'Pascal', 'Newton'],
    answerIndex: 3,
  },
  {
    id: 5,
    subject: 'Geografi',
    question: 'Garis khayal yang membelah Bumi menjadi belahan utara dan selatan adalah?',
    options: ['Garis Bujur', 'Garis Khatulistiwa', 'Garis Wallace', 'Garis Weber'],
    answerIndex: 1,
  },
  {
    id: 6,
    subject: 'Kimia',
    question: 'Rumus kimia untuk molekul air adalah?',
    options: ['CO2', 'NaCl', 'H2O', 'O2'],
    answerIndex: 2,
  },
];
