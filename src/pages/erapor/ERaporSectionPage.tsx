/**
 * SmartCBT - Halaman placeholder E-Rapor.
 *
 * Tahap awal implementasi §12: menu sudah tersedia (laci "E-Rapor" di sidebar)
 * tetapi seluruh isinya belum ada. Alih-alih menampilkan halaman kosong atau
 * 404, setiap kategori menampilkan apa saja yang direncanakan beserta tahap
 * pengerjaannya, sehingga，用户 tahu fitur ini memang sedang dibangun dan tim
 * devs punya checklist yang bisa dicoret.
 *
 * Halaman ini akan diganti bertahap per kategori begitu backend-nya siap —
 * komponennya sengaja dibuat generik (data dari `eraporCatalog`), jadi
 * penggantian tidak menyentuh navigasi maupun sidebar.
 */
import { Link, useParams } from "react-router";
import { ChevronRight, Construction } from "lucide-react";
import { useI18n } from "../../i18n";
import { C, S } from "../../styles/tokens";
import { PageHeader, SectionCard, Chip } from "../../components/ui";
import {
  ERAPOR_SECTIONS,
  findERaporSection,
  eraporPath,
  type ERaporSection,
} from "../../lib/eraporCatalog";

/** Pita status "sedang dalam pengembangan". */
function UnderDevelopmentBanner() {
  const { t } = useI18n();
  return (
    <div
      className="rounded-2xl px-5 py-4 flex items-start gap-3"
      style={{ background: C.warn.bg, border: `1px solid ${C.warn.border}`, boxShadow: S.card }}
      role="status"
    >
      <Construction className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.warn.deep }} />
      <div>
        <div className="font-semibold text-sm" style={{ color: C.warn.deep }}>
          {t("Fitur sedang dalam pengembangan")}
        </div>
        <p className="text-sm mt-1" style={{ color: C.warn.deep, opacity: 0.9 }}>
          {t(
            "Halaman ini sudah disiapkan sebagai tempat fitur, namun belum ada data yang bisa ditampilkan. Rencana lengkap tersedia di FEATURES.md bagian 12.",
          )}
        </p>
      </div>
    </div>
  );
}

/** Daftar fitur yang direncanakan untuk sebuah kategori. */
function PlannedList({ section }: { section: ERaporSection }) {
  const { t } = useI18n();
  return (
    <SectionCard
      title={t("Rencana Fitur")}
      subtitle={t("Rincian item yang akan diimplementasikan pada tahap ini.")}
      right={
        <Chip color={C.brand.main} size="sm">
          {t("Tahap")} {section.phase}
        </Chip>
      }
      bodyStyle={{ padding: 0 }}
    >
      <ul className="divide-y">
        {section.planned.map((item, i) => (
          <li
            key={`${item.ref}-${i}`}
            className="px-5 py-2.5 flex items-start gap-3"
            style={{ borderColor: C.base.borderLight }}
          >
            {/* Kotak centang kosong = belum dikerjakan. */}
            <span
              aria-hidden
              className="mt-0.5 w-4 h-4 rounded border shrink-0"
              style={{ borderColor: C.base.border, background: C.base.surfaceMuted }}
            />
            <span className="flex-1 text-sm" style={{ color: C.base.textBody }}>
              {item.label}
            </span>
            <span
              className="text-[11px] font-mono shrink-0 px-1.5 py-0.5 rounded"
              style={{ background: C.base.surfaceMuted, color: C.base.textFaint }}
            >
              {item.ref}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export default function ERaporSectionPage() {
  const { sectionId } = useParams();
  const { t } = useI18n();
  const section = findERaporSection(sectionId);

  // URL tidak dikenal (mis. diketik manual) — jangan 404, arahkan ke daftar.
  if (!section) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("E-Rapor")} subtitle={t("Bagian tidak ditemukan.")} />
        <UnderDevelopmentBanner />
        <SectionCard title={t("Kategori Tersedia")} bodyStyle={{ padding: 0 }}>
          <ul className="divide-y">
            {ERAPOR_SECTIONS.map((s) => (
              <li key={s.id} style={{ borderColor: C.base.borderLight }}>
                <Link
                  to={eraporPath(s.id)}
                  className="flex items-center gap-3 px-5 py-3.5 cbt-row-hover transition-colors min-h-[48px]"
                >
                  <span className="text-base">{s.icon}</span>
                  <span className="flex-1 text-sm font-medium" style={{ color: C.base.text }}>
                    {s.label}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: C.base.textFaint }} />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    );
  }

  const siblings = ERAPOR_SECTIONS.filter((s) => s.roles.some((r) => section.roles.includes(r)));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${section.icon} ${section.label}`}
        subtitle={section.subtitle}
      />

      <UnderDevelopmentBanner />

      {/* Navigasi antar kategori — agarlacinya terasa hidup walau isinya belum ada. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium" style={{ color: C.base.textMuted }}>
          {t("Kategori")}
        </span>
        {siblings.map((s) => {
          const active = s.id === section.id;
          return (
            <Link
              key={s.id}
              to={eraporPath(s.id)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-colors inline-flex items-center gap-1.5 min-h-[38px]"
              style={{
                background: active ? C.brand.main : C.base.surface,
                color: active ? "#FFFFFF" : C.base.textBody,
                border: `1px solid ${active ? C.brand.main : C.base.border}`,
                boxShadow: active ? S.btnPrimary : S.control,
              }}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </Link>
          );
        })}
      </div>

      <PlannedList section={section} />
    </div>
  );
}