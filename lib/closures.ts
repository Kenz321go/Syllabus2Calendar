// Built-in Campus Closed rule engine. Pure functions over "YYYY-MM-DD" keys (UTC arithmetic, so no
// daylight-saving surprises). Nothing here shifts dates automatically; the UI only flags events and
// offers a manual cascade shift.
import type { EventItem } from './db';

export type Closure = { from: string; to: string; name: string };

// Campus closures (inclusive ranges), kept in date order.
export const CAMPUS_CLOSURES: readonly Closure[] = [
  // Fall 2026
  { from: '2026-09-24', to: '2026-09-24', name: 'Constitutional Day' },
  { from: '2026-10-10', to: '2026-10-12', name: 'Pchum Ben' },
  { from: '2026-10-15', to: '2026-10-15', name: 'Commemoration Day' },
  { from: '2026-10-29', to: '2026-10-29', name: 'Coronation Day' },
  { from: '2026-11-09', to: '2026-11-09', name: 'Independence Day' },
  { from: '2026-11-23', to: '2026-11-25', name: 'Water Festival' },
  { from: '2026-12-25', to: '2026-12-25', name: 'Christmas' },
  { from: '2026-12-29', to: '2026-12-29', name: 'Peace Day' },
  // Spring 2027
  { from: '2027-01-01', to: '2027-01-01', name: 'International New Year' },
  { from: '2027-01-07', to: '2027-01-07', name: 'Victory Over Genocide Day' },
  { from: '2027-02-05', to: '2027-02-05', name: 'Lunar New Year' },
  { from: '2027-03-08', to: '2027-03-08', name: "International Women's Day" },
  { from: '2027-04-14', to: '2027-04-16', name: 'Khmer New Year' },
  { from: '2027-05-01', to: '2027-05-01', name: 'International Labor Day' },
  { from: '2027-05-14', to: '2027-05-14', name: "King Norodom Sihamoni's Birthday" },
  { from: '2027-05-20', to: '2027-05-20', name: 'Visak Bochea Day' },
  { from: '2027-05-24', to: '2027-05-24', name: 'Royal Plowing Ceremony Day' },
  // Summer 2027
  { from: '2027-06-18', to: '2027-06-18', name: "Queen Monineath's Birthday" },
];

export const closureOn = (key: string, closures: readonly Closure[] = CAMPUS_CLOSURES) =>
  closures.find((c) => key >= c.from && key <= c.to);

export const isClosed = (key: string, closures: readonly Closure[] = CAMPUS_CLOSURES) => !!closureOn(key, closures);

export function addDaysToKey(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const isWeekend = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
};

// A day classes can be held: a weekday that is not a campus closure.
export const isOpenDay = (key: string, closures: readonly Closure[] = CAMPUS_CLOSURES) => !isWeekend(key) && !isClosed(key, closures);

// The nearest open day strictly after (dir = 1) or before (dir = -1) `key`.
export function nearestOpenDay(key: string, dir: 1 | -1, closures: readonly Closure[] = CAMPUS_CLOSURES) {
  let k = addDaysToKey(key, dir);
  for (let i = 0; i < 366 && !isOpenDay(k, closures); i++) k = addDaysToKey(k, dir);
  return k;
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

// ISO weekday of a date key: Mon=1 ... Sun=7 (same numbering as the class-day pickers).
export const weekdayOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
};

// A class "slot": a date on one of the course's class weekdays that is an open (non-closed) weekday.
export const isClassSlot = (key: string, classDays: readonly number[], closures: readonly Closure[] = CAMPUS_CLOSURES) =>
  classDays.includes(weekdayOf(key)) && isOpenDay(key, closures);

// The nearest class slot strictly after (dir = 1) or before (dir = -1) `key`.
export function nearestClassSlot(key: string, classDays: readonly number[], dir: 1 | -1, closures: readonly Closure[] = CAMPUS_CLOSURES) {
  let k = addDaysToKey(key, dir);
  for (let i = 0; i < 400 && !isClassSlot(k, classDays, closures); i++) k = addDaysToKey(k, dir);
  return k;
}

// Best guess at a course's two class weekdays from its dated events (for courses scanned before class
// days were stored): the two most frequent Mon-Fri weekdays used by at least two events.
// Class sessions are the better signal, so graded work (exams, quizzes, assignments, projects) is ignored
// when there are enough other events.
export function inferClassDays(events: readonly EventItem[]): number[] {
  const graded = new Set(['exam', 'quiz', 'assignment', 'project']);
  const sessions = events.filter((e) => e.date && !graded.has(e.type));
  const source = sessions.length >= 2 ? sessions : events;
  const counts = new Map<number, number>();
  for (const e of source) if (e.date) { const w = weekdayOf(e.date); if (w <= 5) counts.set(w, (counts.get(w) ?? 0) + 1); }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map(([w]) => w).sort((a, b) => a - b);
}

export type DateChange = { id: string; from: string; to: string };
export type CascadeResult = {
  events: EventItem[];
  changes: DateChange[];
  // Set when the shift was refused because it would overwrite another session.
  blocked?: { title: string; date: string };
  // true when the target is not on a class day, so only the target moved (no cascade).
  single?: boolean;
};

// The same weekday `dir` weeks away, skipping further whole weeks while it lands on a closure.
export function shiftOneWeek(key: string, dir: 1 | -1, closures: readonly Closure[] = CAMPUS_CLOSURES) {
  let k = addDaysToKey(key, 7 * dir);
  for (let i = 0; i < 60 && isClosed(k, closures); i++) k = addDaysToKey(k, 7 * dir);
  return k;
}

// Cascade Shift: move to the next (or previous) available CLASS DAY, and take the rest of the course along.
//
// What moves: the target and every later dated task of the same course. Earlier and undated tasks never move.
//
// Tasks on the course's class days ("sessions") move to the next open class day, in date order - e.g. with
// Tue/Thu classes a Thursday session moves to the following Tuesday (not a week later), the Tuesday one to
// Thursday, and so on: the schedule slides by one class meeting. Closed days are skipped, sessions never
// stack, and they never land on a day without class. Sessions sharing a date move together.
//
// The clicked task itself ALWAYS moves to the next (or previous) class slot when the class days are known,
// even if it sits on another weekday (e.g. a session the scan put on a Wednesday of a Tue/Thu course): it
// lands on the very next designated class day, never the same weekday a week later.
//
// Other later tasks on other weekdays (a Friday deadline, a Saturday quiz) have no class slot, so they move
// one week to the same weekday (another week if that is a closure), keeping their order.
//
// If the class days are unknown, everything moves one week.
//
// Backward: sessions move to the previous open class day; the shift is refused if the target's previous
// class day already holds an earlier session (nothing is overwritten), and a later session that can't move
// back without colliding stays put. For sessions on open class days, Backward exactly undoes Forward.
// Moving off a closed day can't be undone with Backward (the closed day isn't a class slot); use the saved
// snapshot for that ("Undo last shift" / undoShift).
export function cascadeShift(
  events: EventItem[], eventId: string, dir: 1 | -1, classDays: readonly number[] = [], closures: readonly Closure[] = CAMPUS_CLOSURES,
): CascadeResult {
  const target = events.find((e) => e.id === eventId);
  if (!target?.date) return { events, changes: [] };
  const start = target.date;
  // Dates that move by class slot: the course's class weekdays, plus the target's own date (so the clicked
  // class always goes to the adjacent class day). Tasks sharing the target's date move with it.
  const bySlot = (key: string) => classDays.length > 0 && (key === start || classDays.includes(weekdayOf(key)));
  const later = events.filter((e) => e.date && e.date >= start);
  const sessionDates = [...new Set(later.filter((e) => bySlot(e.date!)).map((e) => e.date!))].sort();
  const otherDates = [...new Set(later.filter((e) => !bySlot(e.date!)).map((e) => e.date!))].sort();
  const moveTo = new Map<string, string>();

  // Sessions: by class slot.
  if (dir === 1) {
    let prev = '';
    for (const d of sessionDates) {
      const to = nearestClassSlot(prev && prev >= d ? prev : d, classDays, 1, closures);
      moveTo.set(d, to);
      prev = to;
    }
  } else if (sessionDates.length) {
    const first = nearestClassSlot(sessionDates[0], classDays, -1, closures);
    const occupant = events.find((e) => e.date === first); // `first` is before the target, so this task stays put
    if (occupant) return { events, changes: [], blocked: { title: occupant.title, date: first } };
    let prev = '';
    for (const d of sessionDates) {
      const back = nearestClassSlot(d, classDays, -1, closures);
      const to = !prev || back > prev ? back : d; // stay put rather than collide
      moveTo.set(d, to);
      prev = to;
    }
  }

  // Everything else: one week, same weekday, skipping closures, keeping order.
  const others = dir === 1 ? otherDates : [...otherDates].reverse();
  let prev = '';
  for (const d of others) {
    let to = shiftOneWeek(d, dir, closures);
    for (let i = 0; i < 60 && prev && (dir === 1 ? to <= prev : to >= prev); i++) to = shiftOneWeek(to, dir, closures);
    moveTo.set(d, to);
    prev = to;
  }

  const changes: DateChange[] = [];
  const out = events.map((e) => {
    const to = e.date && e.date >= start ? moveTo.get(e.date) : undefined;
    if (!to || to === e.date) return e;
    changes.push({ id: e.id, from: e.date!, to });
    return moveDate(e, to);
  });
  return { events: out, changes };
}

// Give an event a shifted date, remembering its pre-shift date in `originalDate` (kept across several shifts,
// dropped once the event is back on its original date).
export function moveDate(e: EventItem, to: string): EventItem {
  const original = e.originalDate ?? e.date ?? undefined;
  const { originalDate: _drop, ...rest } = e;
  return original && original !== to ? { ...rest, date: to, originalDate: original } : { ...rest, date: to };
}

// Restore the dates recorded by the last shift (events deleted since then are skipped).
export const undoShift = (events: EventItem[], previous: Record<string, string>) =>
  events.map((e) => (e.id in previous ? moveDate(e, previous[e.id]) : e));

// The date the calendar shows: after shifts (normal), or the original date when shifts are turned off.
export const displayDate = (e: Pick<EventItem, 'date' | 'originalDate'>, showShifts: boolean) =>
  showShifts ? e.date : e.originalDate ?? e.date;

// Change a course's class days, e.g. Tue/Thu -> Mon/Wed. Day 1 maps to Day 1 and Day 2 to Day 2 within the
// same week (Tue -> Mon is -1 day, Thu -> Wed is -1 day). Only events on an old class day move; other
// events (a Friday deadline) stay. Original (pre-shift) dates are remapped the same way. Changing the days
// back maps everything back exactly.
//
// Going from ONE old class day to two or more new ones (e.g. older scans that put both weekly sessions on
// Friday): events sharing a date are spread over the new days in order - the first of that week goes to
// Day 1, the second to Day 2 - so they stop being stacked on one day.
export function remapClassDays(events: EventItem[], oldDays: readonly number[], newDays: readonly number[]): { events: EventItem[]; moved: number } {
  const delta = new Map<number, number>();
  for (let i = 0; i < Math.min(oldDays.length, newDays.length); i++) delta.set(oldDays[i], newDays[i] - oldDays[i]);
  // Per-event delta for the "spread stacked events" case.
  const spread = new Map<string, number>();
  if (oldDays.length === 1 && newDays.length > 1) {
    const seen = new Map<string, number>();
    for (const e of events) {
      if (!e.date || weekdayOf(e.date) !== oldDays[0]) continue;
      const k = seen.get(e.date) ?? 0;
      seen.set(e.date, k + 1);
      spread.set(e.id, newDays[Math.min(k, newDays.length - 1)] - oldDays[0]);
    }
  }
  const shiftBy = (key: string | undefined | null, d: number | undefined) => (key && d ? addDaysToKey(key, d) : key);
  // How far a date on an old class day moves: the event's spread slot if it has one, else its weekday's delta.
  const deltaFor = (e: EventItem, key: string) => (weekdayOf(key) === oldDays[0] && spread.has(e.id) ? spread.get(e.id) : delta.get(weekdayOf(key)));
  let moved = 0;
  const out = events.map((e) => {
    const date = e.date ? shiftBy(e.date, deltaFor(e, e.date))! : null;
    const originalDate = e.originalDate ? shiftBy(e.originalDate, deltaFor(e, e.originalDate))! : undefined; // keep "Shifts off" in step
    if (date === e.date && originalDate === e.originalDate) return e;
    if (date !== e.date) moved++;
    const { originalDate: _drop, ...rest } = e;
    return originalDate && originalDate !== date ? { ...rest, date, originalDate } : { ...rest, date };
  });
  return { events: out, moved };
}

