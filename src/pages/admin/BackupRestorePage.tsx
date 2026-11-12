import { useState, useRef } from 'react';
import { useI18n } from '../../i18n';
import { createBackup, restoreBackup, downloadFromBase64, type BackupRestoreResult } from '../../lib/api';
import { C } from '../../styles/tokens';
import { Btn, Notice, SectionCard, Card } from '../../components/ui';

export default function BackupRestorePage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRestore, setLastRestore] = useState<BackupRestoreResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleBackup = async () => {
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await createBackup();
      downloadFromBase64(result);
      setSuccess(
        t('Backup berhasil dibuat — {n} tabel. File diunduh otomatis: {file}', {
          n: result.tableCount ?? 0,
          file: result.fileName,
        })
      );
    } catch (err) {
      setError((err as any)?.message ?? t('Gagal membuat backup.'));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedFile) {
      setError(t('Pilih file backup (.json) terlebih dahulu.'));
      return;
    }
    if (
      !window.confirm(
        t('Restore akan MENGHAPUS semua data saat ini lalu menggantinya dari backup. Lanjutkan?')
      )
    ) {
      return;
    }
    setRestoring(true);
    setError(null);
    setSuccess(null);
    setLastRestore(null);
    try {
      const result = await restoreBackup(selectedFile);
      setLastRestore(result);
      setSuccess(t('Restore berhasil — {n} baris dipulihkan.', { n: result.total ?? 0 }));
      if (fileRef.current) fileRef.current.value = '';
      setSelectedFile(null);
    } catch (err) {
      setError((err as any)?.message ?? t('Gagal melakukan restore.'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className='max-w-2xl mx-auto space-y-5'>
      <div>
        <h1 className='text-2xl font-bold' style={{ color: C.base.text, fontFamily: 'var(--font-serif)' }}>
          {t('Backup & Restore Database')}
        </h1>
        <p className='text-sm mt-0.5' style={{ color: C.base.textMuted }}>
          {t('Buat cadangan seluruh isi database ke file, atau pulihkan database dari file backup.')}
        </p>
      </div>

      {success && <Notice type='ok'>{success}</Notice>}
      {error && <Notice type='error'>{error}</Notice>}

      {/* Backup */}
      <SectionCard title={t('Buat Backup')} subtitle={t('Unduh snapshot seluruh tabel (users, ujian, soal, hasil, dsb.) sebagai file .json.')}>
        <div className='flex flex-col gap-4'>
          <p className='text-xs' style={{ color: C.base.textMuted }}>
            {t('Backup menyimpan seluruh data aplikasi termasuk akun, bank soal, ujian, sesi, jawaban, hasil, materi belajar, dan pengaturan.')}
          </p>
          <div className='flex justify-end'>
            <Btn onClick={handleBackup} disabled={creating}>
              {creating ? t('Menyiapkan…') : t('↓ Backup Sekarang')}
            </Btn>
          </div>
        </div>
      </SectionCard>

      {/* Restore */}
      <SectionCard
        title={t('Restore dari Backup')}
        subtitle={t('Pulihkan database dari file backup .json. Data saat ini akan DIHAPUS dan digantikan isi backup.')}
      >
        <div className='flex flex-col gap-4'>
          <div>
            <label className='block text-sm font-medium mb-1.5' style={{ color: C.base.textBody }}>
              {t('File Backup (.json)')}
            </label>
            <input
              ref={fileRef}
              type='file'
              accept='.json,application/json'
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className='w-full px-3 py-2 rounded-lg text-sm outline-none'
              style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}` }}
            />
            {selectedFile && (
              <div className='text-xs mt-1.5' style={{ color: C.base.textMuted }}>
                {t('File terpilih:')} <span style={{ fontWeight: 600, color: C.base.text }}>{selectedFile.name}</span>
              </div>
            )}
          </div>
          <div className='rounded-lg px-3 py-2.5 text-xs' style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}>
            ⚠ {t('Restore menghapus data yang ada. Pastikan Anda punya backup terbaru sebelum melanjutkan.')}
          </div>
          <div className='flex justify-end'>
            <Btn onClick={handleRestore} disabled={restoring || !selectedFile} style={{ background: C.danger.main, color: C.base.surface }}>
              {restoring ? t('Merestore…') : t('↺ Restore Database')}
            </Btn>
          </div>

          {lastRestore && (
            <Card pad>
              <div className='flex items-center justify-between mb-3'>
                <div className='font-semibold text-sm' style={{ color: C.ok.dark }}>{t('Hasil restore')}</div>
                <span className='text-sm font-bold' style={{ color: C.ok.main }}>{t('{n} baris', { n: lastRestore.total ?? 0 })}</span>
              </div>
              <div className='grid grid-cols-2 gap-x-4 gap-y-1.5 max-h-64 overflow-y-auto pr-1'>
                {Object.entries(lastRestore.restored ?? {}).map(([table, count]) => (
                  <div key={table} className='flex justify-between text-xs'>
                    <span style={{ fontFamily: 'var(--font-mono)', color: C.base.textMuted }}>{table}</span>
                    <span style={{ color: C.base.text }}>{count}</span>
                  </div>
                ))}
              </div>
              <div className='mt-3 text-xs' style={{ color: C.base.textFaint }}>
                {lastRestore.databaseType && t('Database: {db}', { db: lastRestore.databaseType })}
                {lastRestore.createdAt && <> · {t('Dibuat: {date}', { date: new Date(lastRestore.createdAt).toLocaleString('id-ID') })}</>}
              </div>
            </Card>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
