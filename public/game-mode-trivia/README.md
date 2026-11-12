# RPG Trivia Assets — Magic School (Pixel Art)

Paket assets pixel art untuk game **RPG Trivia** bertema Sekolah Sihir.
Semua gambar dibuat secara terprogram — grid presisi, palet konsisten, siap dipakai
di engine mana pun (Godot, Unity, Phaser, GameMaker, canvas HTML5, dsb).

**Lisensi: CC0 (bebas dipakai untuk proyek apa pun, tanpa atribusi).**

## Struktur

```
rpg-trivia-assets/
├── preview.png            → contact sheet semua assets
├── README.md
├── characters/            → sprite sheet karakter (128x128, kecuali shade 64x32)
├── tilesets/              → 3 tileset (128x32 per sheet, tile 16x16)
├── objects/               → objek dunia (tree 16x32, lainnya 16x16)
├── ui/                    → elemen UI (heart, star, panel 9-slice, button)
├── maps/                  → data peta JSON + render preview PNG
└── demo/                  → demo playable (buka demo/index.html di browser)
```

## Sprite Sheet Karakter (128 x 128)

Tiap karakter = **4 arah x 4 frame animasi jalan**, frame 32x32:

```
kolom : frame 0 (berdiri) | 1 | 2 | 3   (siklus jalan: 0-1-2-3)
baris : 0 = bawah  1 = kiri  2 = kanan  3 = atas
```

| File | Karakter |
|---|---|
| `player.png` | Murid penyihir (jubah biru, trim emas) — pemain |
| `archmage.png` | Kepala Sekolah (jubah ungu, janggut putih) |
| `librarian.png` | Pustakawan (hijau, berkacamata) |
| `student.png` | Murid baru (teal) |
| `guard.png` | Penjaga taman (abu-abu, aksen merah) |
| `shade.png` | Musuh bayangan — 2 frame melayang (64x32) |

Cara pakai: `drawImage(sheet, frame*32, dir*32, 32, 32, x, y, 32, 32)`

## Tileset (128 x 32 = 8 kolom x 2 baris, tile 16x16)

Indeks tile = `baris * 8 + kolom` (baris-utama).

| # | `overworld.png` | `interior.png` | `trivia.png` |
|---|---|---|---|
| 0 | rumput | lantai kayu | lantai sihir |
| 1 | rumput (var) | lantai kayu (var) | lantai sihir (var) |
| 2 | rumput bunga | karpet merah | ubin rune |
| 3 | jalan tanah | papan tulis | pilar |
| 4 | air | dinding ruangan | dinding gelap |
| 5 | batu | pintu kayu | portal swirl |
| 6 | pagar horizontal | meja | pintu gelap |
| 7 | pagar vertikal | kursi | kristal |
| 8 | dinding batu | obor dinding | lantai bintang |
| 9 | jendela | kauldron | — |
| 10 | pintu sekolah | karpet portal | — |
| 11 | semak | (rak ramuan = 14) | — |
| 12 | rumput gelap | (lantai gelap = 12, dinding var = 13) | — |

## Objek Dunia (gambar terpisah, transparan)

`tree.png` (16x32), `chest.png`, `potion.png`, `book.png`, `sparkle.png` (16x16).
Gambar *di atas* tile lantai, urutkan berdasar Y (kaki) agar tumpang tindih benar.

## UI

- `heart.png` (16x16) — nyawa
- `star.png` (16x16) — skor
- `panel.png` (48x48) — panel 9-slice (border 8px) untuk dialog/quiz
- `button.png` / `button_hover.png` (48x14) — tombol 3-slice

## Maps (JSON)

`maps/over.json`, `maps/interior.json`, `maps/trivia.json`:

```json
{
  "id": "over", "name": "Halaman Sekolah Sihir",
  "tileset": "overworld.png", "w": 40, "h": 25,
  "tiles": [[0,12,0,...]],        // indeks tile per sel
  "solids": [4,5,6,8,9,11],       // indeks tile yang menabrak
  "objects": [{"x":5,"y":2,"img":"tree.png"}],
  "npcs": [{"x":24,"y":11,"sheet":"student.png","name":"...","text":"..."}],
  "doors": [{"x":19,"y":7,"to":"interior"}]
}
```

`maps/previews/*.png` = render peta jadi satu gambar (referensi visual).

Alur dunia: **Halaman Sekolah** → pintu besar → **Kelas Sihir** → karpet portal →
**Ruang Trivia** → portal cahaya → Ujian Trivia (5 soal).

## Demo Playable

Buka `demo/index.html` di browser (Chrome/Firefox/Edge) — tidak perlu server.

- Gerak: tombol panah / WASD
- Bicara dengan NPC: **E** atau **Spasi**
- Masuk pintu/portal: jalan ke arahnya
- Portal cahaya di Ruang Trivia → quiz 5 soal (nyawa 3, skor bintang)

Kode demo: `demo/js/game.js` (engine mini canvas 400x288, kamera mengikuti pemain,
collision tile, transisi peta, dialog NPC, quiz) dan `demo/js/maps.js` (data peta,
di-generate otomatis). Silakan jadikan referensi integrasi ke engine lain.

## Catatan Teknis

- Seluruh PNG = RGBA 8-bit, filter 0, lossless.
- Karakter: titik collision yang disarankan = area kaki (lebar 16px, tinggi 6px
  di bagian bawah sprite) agar bisa lewat celah selebar 1 tile.
- Ingin mengganti soal quiz? Edit array `QUESTIONS` di `demo/js/game.js`.
- Ingin menambah karakter? Duplikat palet di generator dan jalankan ulang.
