/**
 * Catatan rilis internal (dipindahkan apa adanya — berkas ini tidak diekspor
 * dan tidak diimpor di mana pun; hanya menjaga modul tetap valid TypeScript).
 *
 * Ringkasan kebijakan (tanpa versi) — multi-provider AI di SmartCBT
 *
 * Build 115:
 * - 5 provider AI tambahan untuk Generate Soal & Grading Esai: Anthropic,
 *   DeepSeek, GLM/Zhipu, Mistral, Groq — didorong melalui registry di
 *   `src/lib/ai-providers.ts` dan server `callProvider()`, UI dynamic picker
 *   di DatabaseSetupPage.
 * - Update CHANGELOG.md dan FEATURES.md sesuai cepat; cocokkan nilai
 *   DEFAULT_AI_AGENT_SETTINGS + callProvider() untuk memastikan perubahan
 *   registry tertutup.
 * - Tes build & lint: `npx tsc --noEmit` → clean, `npm run build` /
 *   `npm run build:server` → sukses; `server/dist/server.mjs` mengandung
 *   semua 5 provider baru.
 * - Saat deploy, versi yang dijalankan disinkronkan berdasarkan nilai
 *   FEATURES.md / CHANGELOG.md pada saat checkout/rebuild. Untuk release
 *   pra-produksi, sesuaikan "versi terkurasi" di CHANGELOG.md dengan pola
 *   `build [NNN]` lalu push.
 */
export {};