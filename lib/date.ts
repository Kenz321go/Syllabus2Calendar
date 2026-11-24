export type DateSource = {
  date: string | null;
  week: number | null;
  weekday: number | null;
  confidence: 'high' | 'medium' | 'low';
};

export function resolveDate(event: DateSource, start: string) {
  if (event.date) return { date: event.date, review: event.confidence !== 'high' };
  if (event.week && event.weekday && start) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (event.week - 1) * 7 + (event.weekday - 1));
    return { date: d.toISOString().slice(0, 10), review: true };
  }
  return { date: null, review: true };
}

// Weekdays a class can meet on (Mon=1 ... Fri=5).
export const CLASS_DAYS = [1, 2, 3, 4, 5] as const;

// Parse the two class days chosen in the UI. Both must be weekdays, with Day 1 before Day 2 in the week.
export function parseClassDays(day1: unknown, day2: unknown): [number, number] | null {
  const a = Number(day1);
  const b = Number(day2);
  const ok = (d: number) => (CLASS_DAYS as readonly number[]).includes(d);
  return ok(a) && ok(b) && a < b ? [a, b] : null;
}

// Course Outline sessions have no calendar dates. Gemini reports the printed session number and the
// server places it on the class days: session 1 -> Day 1 of week 1, session 2 -> Day 2 of week 1,
// session 3 -> Day 1 of week 2, and so on. A weekday the syllabus actually prints still wins.
// An event with only a stated week ("Week 9") lands on Day 1 of that week. resolveDate flags all of these for review.
export function scheduleFor(
  e: { session: number | null; week: number | null; weekday: number | null },
  classDays: readonly number[],
) {
  const perWeek = classDays.length;
  const week = e.session != null ? Math.ceil(e.session / perWeek) : e.week;
  if (week == null || week > 52) return { week: null, weekday: e.weekday };
  const classDay = e.session != null ? classDays[(e.session - 1) % perWeek] : classDays[0];
  return { week, weekday: e.weekday ?? classDay };
}
