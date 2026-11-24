/**
 * SmartCBT — Pure Calculation Engine for Minggu Efektif & Jam Pelajaran (JP) Efektif
 *
 * Implements standard Indonesian Kurikulum Merdeka effective-weeks analysis:
 *   1. Enumerate every calendar week overlapping [startDate, endDate].
 *   2. Group each week cleanly into a single month (using Thursday / majority of
 *      its days inside [startDate, endDate] so split weeks are never double-counted).
 *   3. Determine scheduled school working days (5-day Mon–Fri or 6-day Mon–Sat).
 *   4. Subtract non-effective days covered by Kalender Pendidikan events where
 *      `is_effective = false` (holidays, exam periods, MPLS, etc.).
 *   5. A week is counted as an Effective Week when its effective school days
 *      are at least half of its scheduled working days in the semester range
 *      (e.g. >= 3 of 5 days, or >= 3 of 6 days) and > 0.
 *   6. Compute `totalEffectiveJp = effectiveWeeks * jpPerWeek`.
 */

export interface CalendarEventInput {
  id?: string;
  title: string;
  event_type:
    | "effective_day"
    | "holiday_national"
    | "holiday_semester"
    | "school_agenda"
    | "exam_period"
    | string;
  start_date: string;
  end_date: string;
  is_effective: boolean | number;
}

export interface WeekBreakdown {
  weekNumber: number;
  monthKey: string;
  startDate: string;
  endDate: string;
  scheduledDays: number;
  effectiveDays: number;
  nonEffectiveDays: number;
  isEffective: boolean;
  holidays: string[];
}

export interface MonthBreakdown {
  monthKey: string;
  monthLabel: string;
  totalWeeks: number;
  nonEffectiveWeeks: number;
  effectiveWeeks: number;
  scheduledDays: number;
  nonEffectiveDays: number;
  effectiveDays: number;
  holidays: string[];
}

export interface EffectiveWeeksResult {
  startDate: string;
  endDate: string;
  workingDaysPerWeek: 5 | 6;
  jpPerWeek: number;
  totalWeeks: number;
  nonEffectiveWeeks: number;
  effectiveWeeks: number;
  totalScheduledDays: number;
  nonEffectiveDays: number;
  effectiveDays: number;
  totalEffectiveJp: number;
  months: MonthBreakdown[];
  weeks: WeekBreakdown[];
}

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Parse `YYYY-MM-DD` strictly in UTC midnight so local TZ shifts never occur. */
export function parseIsoDateUtc(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

export function formatIsoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES_ID[idx] ?? m} ${y}`;
}

function isTruthishEffective(val: boolean | number | undefined): boolean {
  if (typeof val === "number") return val !== 0;
  return Boolean(val);
}

/**
 * Pure deterministic effective weeks calculation.
 */
export function calculateEffectiveWeeks(params: {
  startDate: string;
  endDate: string;
  workingDaysPerWeek?: 5 | 6;
  jpPerWeek?: number;
  events?: CalendarEventInput[];
}): EffectiveWeeksResult {
  const start = parseIsoDateUtc(params.startDate);
  const end = parseIsoDateUtc(params.endDate);
  if (!start || !end) {
    throw new Error("Format tanggal harus YYYY-MM-DD yang valid.");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("Tanggal selesai semester tidak boleh sebelum tanggal mulai.");
  }

  const workingDaysPerWeek: 5 | 6 = params.workingDaysPerWeek === 6 ? 6 : 5;
  const jpPerWeek = Math.max(1, Math.min(40, Math.round(Number(params.jpPerWeek || 2))));
  const events = Array.isArray(params.events) ? params.events : [];

  // Normalize non-effective event date ranges once.
  const nonEffectiveRanges = events
    .filter((ev) => !isTruthishEffective(ev.is_effective))
    .map((ev) => ({
      title: String(ev.title || "Agenda Non-Efektif").trim(),
      start: String(ev.start_date || "").slice(0, 10),
      end: String(ev.end_date || "").slice(0, 10),
    }))
    .filter((ev) => ev.start && ev.end);

  // Align the first calendar week bucket to the Monday of `start`'s week.
  // JS getUTCDay(): 0 = Sun, 1 = Mon .. 6 = Sat
  const startDow = start.getUTCDay();
  const offsetToMonday = startDow === 0 ? -6 : 1 - startDow;
  let cursorMon = addDaysUtc(start, offsetToMonday);

  const weeks: WeekBreakdown[] = [];
  let weekNum = 0;

  while (cursorMon.getTime() <= end.getTime()) {
    const weekSun = addDaysUtc(cursorMon, 6);
    const clampedStart = cursorMon.getTime() < start.getTime() ? start : cursorMon;
    const clampedEnd = weekSun.getTime() > end.getTime() ? end : weekSun;

    let scheduledDays = 0;
    let nonEffectiveDays = 0;
    const weekHolidays = new Set<string>();
    const monthVotes = new Map<string, number>();

    for (let d = clampedStart; d.getTime() <= clampedEnd.getTime(); d = addDaysUtc(d, 1)) {
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      const isSchoolDow =
        workingDaysPerWeek === 6 ? dow >= 1 && dow <= 6 : dow >= 1 && dow <= 5;
      const iso = formatIsoDateUtc(d);

      // Count working day votes (or all days if only Sunday falls in range)
      // so a week belongs cleanly to the month containing most of its days.
      const mKey = monthKeyOf(d);
      monthVotes.set(mKey, (monthVotes.get(mKey) ?? 0) + (isSchoolDow ? 10 : 1));

      if (!isSchoolDow) continue;
      scheduledDays += 1;

      const matched = nonEffectiveRanges.filter(
        (r) => iso >= r.start && iso <= r.end,
      );
      if (matched.length > 0) {
        nonEffectiveDays += 1;
        for (const m of matched) weekHolidays.add(m.title);
      }
    }

    if (scheduledDays > 0) {
      weekNum += 1;
      let dominantMonthKey = monthKeyOf(clampedStart);
      let bestScore = -1;
      for (const [mk, score] of monthVotes.entries()) {
        if (score > bestScore) {
          bestScore = score;
          dominantMonthKey = mk;
        }
      }

      const effectiveDays = Math.max(0, scheduledDays - nonEffectiveDays);
      // Standard rule: week is effective if at least half of its scheduled
      // working days are effective (e.g. >= 3 out of 5 days, or >= 2 out of 3).
      const minRequired = Math.ceil(scheduledDays / 2);
      const isEffective = effectiveDays >= minRequired && effectiveDays > 0;

      weeks.push({
        weekNumber: weekNum,
        monthKey: dominantMonthKey,
        startDate: formatIsoDateUtc(clampedStart),
        endDate: formatIsoDateUtc(clampedEnd),
        scheduledDays,
        effectiveDays,
        nonEffectiveDays,
        isEffective,
        holidays: Array.from(weekHolidays),
      });
    }

    cursorMon = addDaysUtc(cursorMon, 7);
  }

  // Group into ordered monthly breakdown.
  const monthMap = new Map<string, MonthBreakdown>();
  for (const w of weeks) {
    let mb = monthMap.get(w.monthKey);
    if (!mb) {
      mb = {
        monthKey: w.monthKey,
        monthLabel: monthLabelFromKey(w.monthKey),
        totalWeeks: 0,
        nonEffectiveWeeks: 0,
        effectiveWeeks: 0,
        scheduledDays: 0,
        nonEffectiveDays: 0,
        effectiveDays: 0,
        holidays: [],
      };
      monthMap.set(w.monthKey, mb);
    }
    mb.totalWeeks += 1;
    if (w.isEffective) mb.effectiveWeeks += 1;
    else mb.nonEffectiveWeeks += 1;
    mb.scheduledDays += w.scheduledDays;
    mb.nonEffectiveDays += w.nonEffectiveDays;
    mb.effectiveDays += w.effectiveDays;
    for (const h of w.holidays) {
      if (!mb.holidays.includes(h)) mb.holidays.push(h);
    }
  }

  const months = Array.from(monthMap.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

  const totalWeeks = weeks.length;
  const effectiveWeeks = weeks.filter((w) => w.isEffective).length;
  const nonEffectiveWeeks = totalWeeks - effectiveWeeks;
  const totalScheduledDays = weeks.reduce((s, w) => s + w.scheduledDays, 0);
  const nonEffectiveDays = weeks.reduce((s, w) => s + w.nonEffectiveDays, 0);
  const effectiveDays = weeks.reduce((s, w) => s + w.effectiveDays, 0);

  return {
    startDate: formatIsoDateUtc(start),
    endDate: formatIsoDateUtc(end),
    workingDaysPerWeek,
    jpPerWeek,
    totalWeeks,
    nonEffectiveWeeks,
    effectiveWeeks,
    totalScheduledDays,
    nonEffectiveDays,
    effectiveDays,
    totalEffectiveJp: effectiveWeeks * jpPerWeek,
    months,
    weeks,
  };
}
