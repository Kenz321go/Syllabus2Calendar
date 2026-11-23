// Pure calendar helpers for the Week / Month / Year views. All dates are local (no UTC), and
// weeks start on Monday to match the grid headers.
import type { EventItem } from './db';

export type CalendarView = 'week' | 'month' | 'year';

export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

// The 7 days (Mon-Sun) of the week containing `cursor`.
export const weekDays = (cursor: Date) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));

// 6 full weeks (42 days) covering the month containing `cursor`, starting on a Monday.
export const monthGrid = (cursor: Date) => {
  const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};

// Move the cursor one view-sized step (dir = -1 or 1).
export function shiftCursor(cursor: Date, view: CalendarView, dir: number) {
  if (view === 'week') return addDays(cursor, 7 * dir);
  if (view === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  return new Date(cursor.getFullYear() + dir, cursor.getMonth(), 1);
}

// Inclusive [from, to] date keys of the period shown by a view.
export function viewRange(cursor: Date, view: CalendarView): [string, string] {
  if (view === 'week') { const days = weekDays(cursor); return [localDateKey(days[0]), localDateKey(days[6])]; }
  if (view === 'month') return [localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), localDateKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0))];
  return [`${cursor.getFullYear()}-01-01`, `${cursor.getFullYear()}-12-31`];
}

export function viewLabel(cursor: Date, view: CalendarView, locale?: string) {
  if (view === 'year') return String(cursor.getFullYear());
  if (view === 'month') return cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const [a, b] = [weekDays(cursor)[0], weekDays(cursor)[6]];
  const short = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${short(a)} – ${short(b)}, ${b.getFullYear()}`;
}

// Set one event's completed flag, leaving every other field (including needsReview) untouched.
export const withCompleted = (events: EventItem[], eventId: string, completed: boolean) =>
  events.map((e) => (e.id === eventId ? { ...e, completed } : e));

// Scope filter for the calendar grid.
export const visibleOnCalendar = <T extends { completed?: boolean }>(events: T[], showCompleted: boolean) =>
  showCompleted ? events : events.filter((e) => !e.completed);
