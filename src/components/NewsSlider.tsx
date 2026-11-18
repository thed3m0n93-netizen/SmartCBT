/**
 * Headline slider for the student dashboard.
 *
 * A dashboard is a summary, not an article reader: showing three full news
 * bodies pushed the exams and results below the fold. This replaces the inline
 * cards with one rotating banner so news stays visible without costing
 * vertical space - clicking a slide opens the full article page.
 *
 * Plain CSS transform (no carousel dependency): the track is a flex row
 * translated by `-index * 100%`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { resolveAssetUrl, type NewsRow } from "../lib/api";
import { C } from "../styles/tokens";
import { formatNewsDate, newsCategoryStyle, newsTeaser } from "./NewsCard";

/** Auto-advance interval. Long enough to read a headline. */
const AUTOPLAY_MS = 6000;

export default function NewsSlider({ items }: { items: NewsRow[] }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // A long news list can arrive after the first render, which would leave
  // `index` pointing past the end and render a blank slide.
  const count = items.length;
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  // Autoplay pauses on hover/focus so a slide is not yanked away mid-read.
  useEffect(() => {
    if (count <= 1 || paused) return;
    const timer = window.setInterval(() => go(index + 1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count, index, paused, go]);

  // Arrow keys move between slides while the slider has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
  };

  // Swipe on touch devices, which have no hover to pause on.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    const end = e.changedTouches[0]?.clientX;
    touchX.current = null;
    if (start == null || end == null) return;
    const dx = end - start;
    if (Math.abs(dx) < 45) return; // treat small jitter as a tap
    go(index + (dx < 0 ? 1 : -1));
  };

  if (items.length === 0) return null;

  const open = (item: NewsRow) => navigate(`/news/${item.id}`);
return (
    <section
      aria-roledescription="carousel"
      aria-label="Berita sekolah"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="rounded-2xl overflow-hidden outline-none"
      style={{ background: "#0F172A", border: `1px solid ${C.base.border}`, boxShadow: "var(--shadow-card)" }}
    >
      {/* Fixed height so the block never resizes between articles. */}
      <div className="relative overflow-hidden" style={{ height: 176 }}>
        <div
          className="flex h-full transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {items.map((item) => {
            const cat = newsCategoryStyle(item.category);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => open(item)}
                aria-label={`Baca berita: ${item.title}`}
                className="relative shrink-0 h-full text-left focus:outline-none"
                style={{ width: `${100 / items.length}%` }}
              >
                {/* Banner: the cover image when present, else a tinted panel so
                    an article without artwork still looks intentional. */}
                {item.image_url ? (
                  <img
                    src={resolveAssetUrl(item.image_url)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)`,
                    }}
                  />
                )}
                {/* Scrim keeps the text readable over any photo. */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(15,23,42,0.28) 0%, rgba(15,23,42,0.90) 100%)",
                  }}
                />
                <div className="relative h-full flex flex-col justify-end p-4 sm:p-5">
                  <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(37,99,235,0.88)", color: "#FFFFFF" }}
                    >
                      {cat.label}
                    </span>
                    {item.pinned && (
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(255,255,255,0.18)", color: "#e2e8f0" }}
                      >
                        📌 Disematkan
                      </span>
                    )}
                    <span className="text-[11px]" style={{ color: "#94a3b8" }}>
                      {formatNewsDate(item.published_at ?? item.created_at)}
                    </span>
                  </div>
                  <h3
                    className="font-bold text-sm sm:text-base leading-snug line-clamp-2"
                    style={{ color: "#f8fafc", fontFamily: "var(--font-serif)" }}
                  >
                    {item.title}
                  </h3>
                  <p
                    className="text-xs mt-1 line-clamp-2 hidden sm:block"
                    style={{ color: "#cbd5e1" }}
                  >
                    {newsTeaser(item)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Arrows - hidden on a single slide, where they would be dead controls. */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(index - 1); }}
              aria-label="Berita sebelumnya"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-sm"
              style={{ background: "rgba(15,23,42,0.6)", color: "#fff" }}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(index + 1); }}
              aria-label="Berita berikutnya"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-sm"
              style={{ background: "rgba(15,23,42,0.6)", color: "#fff" }}
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Dots */}
      {items.length > 1 && (
        <div
          className="flex items-center justify-center gap-1.5 py-2"
          style={{ background: "#0b1220" }}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); go(i); }}
              aria-label={`Ke berita ${i + 1}`}
              aria-current={i === index}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                background: i === index ? "#60A5FA" : "#475569",
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
