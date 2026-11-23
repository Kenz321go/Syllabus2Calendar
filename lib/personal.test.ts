import { describe, expect, it } from 'vitest';
import { isPersonalScan, makePersonalEvent, PERSONAL_COURSE, personalScanFor, withPersonalEvent } from './personal';
import type { EventItem, Scan } from './db';

const made = (input: Parameters<typeof makePersonalEvent>[0]) => {
  const r = makePersonalEvent(input, 'id-1');
  if ('error' in r) throw new Error(r.error);
  return r.event;
};

describe('makePersonalEvent', () => {
  it('builds a stored event from the Add Event form, defaulting the type to "personal"', () => {
    expect(made({ title: '  Study group  ', date: '2026-10-07', time: '18:30', note: '  Library room 2 ' })).toEqual({
      id: 'id-1', title: 'Study group', type: 'personal', date: '2026-10-07', time: '18:30', weight: null,
      source: 'Library room 2', needsReview: false, completed: false,
    });
  });

  it('keeps a chosen type and treats an empty time or note as none', () => {
    expect(made({ title: 'Mock exam', date: '2026-11-02', time: '', type: 'exam' })).toMatchObject({ type: 'exam', time: null, source: '' });
  });

  it.each([
    [{ title: '   ', date: '2026-10-07' }, 'Enter a title.'],
    [{ title: 'x'.repeat(301), date: '2026-10-07' }, 'Keep the title under 300 characters.'],
    [{ title: 'A', date: '' }, 'Choose a valid date.'],
    [{ title: 'A', date: '2026-13-40' }, 'Choose a valid date.'],
    [{ title: 'A', date: '07/10/2026' }, 'Choose a valid date.'],
    [{ title: 'A', date: '2026-10-07', time: '25:00' }, 'Enter the time as HH:MM.'],
    [{ title: 'A', date: '2026-10-07', time: '9:30' }, 'Enter the time as HH:MM.'],
  ])('rejects invalid input %j', (input, error) => {
    expect(makePersonalEvent(input, 'id')).toEqual({ error });
  });
});

describe('personal scan storage', () => {
  const syllabus: Scan = { id: 1, course: 'BUS 201', fileName: 'bus.pdf', semester: 'Fall 2026', merged: true, events: [], createdAt: 1 };
  const personalFall: Scan = { id: 2, course: PERSONAL_COURSE, fileName: '', semester: 'Fall 2026', merged: true, kind: 'personal', events: [], createdAt: 2 };
  const personalSpring: Scan = { ...personalFall, id: 3, semester: 'Spring 2027' };
  const event = (id: string): EventItem => ({ ...made({ title: id, date: '2026-10-07' }), id });

  it('creates the "My Personal Tasks" scan for the semester on first use, already merged', () => {
    const scan = withPersonalEvent(undefined, event('a'), 'Fall 2026', 123);
    expect(scan).toEqual({ course: PERSONAL_COURSE, fileName: '', semester: 'Fall 2026', merged: true, kind: 'personal', events: [event('a')], createdAt: 123 });
    expect(isPersonalScan(scan)).toBe(true);
  });

  it('appends to the existing personal scan without mutating it', () => {
    const existing = { ...personalFall, events: [event('a')] };
    const next = withPersonalEvent(existing, event('b'), 'Fall 2026');
    expect(next.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(next.id).toBe(2);
    expect(existing.events.map((e) => e.id)).toEqual(['a']);
  });

  it('finds only the personal scan of the requested semester, never a syllabus course', () => {
    const scans = [syllabus, personalSpring, personalFall];
    expect(personalScanFor(scans, 'Fall 2026')?.id).toBe(2);
    expect(personalScanFor(scans, 'Spring 2027')?.id).toBe(3);
    expect(personalScanFor([syllabus], 'Fall 2026')).toBeUndefined();
    expect(isPersonalScan(syllabus)).toBe(false);
  });
});
