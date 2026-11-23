import { describe, expect, it } from 'vitest';
import { localDateKey, monthGrid, shiftCursor, startOfWeek, viewLabel, viewRange, visibleOnCalendar, weekDays, withCompleted } from './calendar';
import type { EventItem } from './db';

const d = (s: string) => new Date(`${s}T00:00:00`); // local midnight
const keys = (dates: Date[]) => dates.map(localDateKey);

describe('week helpers', () => {
  it('starts weeks on Monday, including when the cursor is a Sunday', () => {
    expect(localDateKey(startOfWeek(d('2026-11-23')))).toBe('2026-11-23'); // Monday
    expect(localDateKey(startOfWeek(d('2026-11-29')))).toBe('2026-11-23'); // Sunday
  });
  it('returns the 7 days Mon-Sun around the cursor, across a month boundary', () => {
    expect(keys(weekDays(d('2026-12-02')))).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
  });
});

describe('monthGrid', () => {
  it('covers the month in 42 days starting on the Monday on/before the 1st', () => {
    const grid = monthGrid(d('2026-11-23')); // Nov 1, 2026 is a Sunday
    expect(grid).toHaveLength(42);
    expect(localDateKey(grid[0])).toBe('2026-10-26');
    expect(keys(grid)).toContain('2026-11-30');
    expect(localDateKey(grid[41])).toBe('2026-12-06');
  });
});

describe('shiftCursor', () => {
  it('moves by a week, a month or a year', () => {
    expect(localDateKey(shiftCursor(d('2026-12-29'), 'week', 1))).toBe('2027-01-05');
    expect(localDateKey(shiftCursor(d('2026-01-31'), 'month', 1))).toBe('2026-02-01'); // no Jan 31 -> Mar 3 overflow
    expect(localDateKey(shiftCursor(d('2026-01-15'), 'month', -1))).toBe('2025-12-01');
    expect(localDateKey(shiftCursor(d('2026-11-23'), 'year', 1))).toBe('2027-11-01');
  });
});

describe('viewRange / viewLabel', () => {
  it('gives the inclusive date range of each view', () => {
    expect(viewRange(d('2026-11-25'), 'week')).toEqual(['2026-11-23', '2026-11-29']);
    expect(viewRange(d('2026-02-10'), 'month')).toEqual(['2026-02-01', '2026-02-28']);
    expect(viewRange(d('2028-02-10'), 'month')).toEqual(['2028-02-01', '2028-02-29']); // leap year
    expect(viewRange(d('2026-06-01'), 'year')).toEqual(['2026-01-01', '2026-12-31']);
  });
  it('labels each view', () => {
    expect(viewLabel(d('2026-11-25'), 'year')).toBe('2026');
    expect(viewLabel(d('2026-11-25'), 'month', 'en-US')).toBe('November 2026');
    expect(viewLabel(d('2026-11-25'), 'week', 'en-US')).toBe('Nov 23 – Nov 29, 2026');
  });
});

describe('completion', () => {
  const ev = (id: string, extra: Partial<EventItem> = {}): EventItem => ({ id, title: id, type: 'exam', date: '2026-11-25', time: null, weight: null, source: '', needsReview: true, ...extra });

  it('withCompleted toggles only the target event and keeps needsReview', () => {
    const out = withCompleted([ev('a'), ev('b')], 'b', true);
    expect(out).toEqual([ev('a'), ev('b', { completed: true })]);
    expect(out[1].needsReview).toBe(true);
    expect(withCompleted(out, 'b', false)[1].completed).toBe(false);
  });

  it('visibleOnCalendar hides completed events only when asked; legacy events without the flag count as open', () => {
    const list = [ev('open'), ev('done', { completed: true }), ev('legacy')];
    expect(visibleOnCalendar(list, true).map((e) => e.id)).toEqual(['open', 'done', 'legacy']);
    expect(visibleOnCalendar(list, false).map((e) => e.id)).toEqual(['open', 'legacy']);
  });
});
