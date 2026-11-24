import { describe, expect, it } from 'vitest';
import { addDaysToKey, CAMPUS_CLOSURES, cascadeShift, closureOn, daysBetween, displayDate, remapClassDays, shiftOneWeek, inferClassDays, isClosed, isOpenDay, nearestClassSlot, nearestOpenDay, undoShift, weekdayOf } from './closures';
import type { EventItem } from './db';

const ev = (id: string, date: string | null, extra: Partial<EventItem> = {}): EventItem =>
  ({ id, title: id, type: 'other', date, time: null, weight: null, source: '', needsReview: true, ...extra });
const dates = (events: EventItem[]) => Object.fromEntries(events.map((e) => [e.id, e.date]));

describe('Campus Closed table', () => {
  it('matches single days and inclusive ranges', () => {
    expect(closureOn('2026-09-24')?.name).toBe('Constitutional Day');
    for (const k of ['2026-10-10', '2026-10-11', '2026-10-12']) expect(closureOn(k)?.name).toBe('Pchum Ben');
    for (const k of ['2026-11-23', '2026-11-24', '2026-11-25']) expect(closureOn(k)?.name).toBe('Water Festival');
    for (const k of ['2026-10-15', '2026-10-29', '2026-11-09', '2026-12-25', '2026-12-29']) expect(isClosed(k)).toBe(true);
  });
  it('does not match the days around a closure', () => {
    for (const k of ['2026-09-23', '2026-09-25', '2026-10-09', '2026-10-13', '2026-11-22', '2026-11-26', '2025-12-25']) expect(isClosed(k)).toBe(false);
  });
  it.each([
    ['2027-01-01', 'International New Year'],
    ['2027-01-07', 'Victory Over Genocide Day'],
    ['2027-02-05', 'Lunar New Year'],
    ['2027-03-08', "International Women's Day"],
    ['2027-04-14', 'Khmer New Year'],
    ['2027-04-15', 'Khmer New Year'],
    ['2027-04-16', 'Khmer New Year'],
    ['2027-05-01', 'International Labor Day'],
    ['2027-05-14', "King Norodom Sihamoni's Birthday"],
    ['2027-05-20', 'Visak Bochea Day'],
    ['2027-05-24', 'Royal Plowing Ceremony Day'],
    ['2027-06-18', "Queen Monineath's Birthday"],
  ])('Spring/Summer 2027: %s is closed for %s', (date, name) => {
    expect(closureOn(date)?.name).toBe(name);
  });
  it('does not close the days around the 2027 closures', () => {
    for (const k of ['2026-12-31', '2027-01-02', '2027-01-06', '2027-01-08', '2027-04-13', '2027-04-17', '2027-05-21', '2027-05-25', '2027-06-17', '2027-06-19']) expect(isClosed(k)).toBe(false);
  });
  it('keeps the closure table sorted with no overlapping ranges', () => {
    const list = CAMPUS_CLOSURES;
    for (let i = 0; i < list.length; i++) {
      expect(list[i].to >= list[i].from).toBe(true);
      if (i) expect(list[i].from > list[i - 1].to).toBe(true);
    }
  });
  it('treats weekends as not open, even when not a closure', () => {
    expect(isOpenDay('2026-09-26')).toBe(false); // Saturday
    expect(isOpenDay('2026-09-28')).toBe(true);  // Monday
  });
});

describe('nearestOpenDay', () => {
  it('steps over closures and weekends in either direction', () => {
    expect(nearestOpenDay('2026-09-24', 1)).toBe('2026-09-25');  // Thu closed -> Fri
    expect(nearestOpenDay('2026-09-24', -1)).toBe('2026-09-23'); // -> Wed
    expect(nearestOpenDay('2026-11-23', 1)).toBe('2026-11-26');  // Water Festival Mon-Wed -> Thu
    expect(nearestOpenDay('2026-11-23', -1)).toBe('2026-11-20'); // -> previous Fri, skipping the weekend
    expect(nearestOpenDay('2026-10-12', -1)).toBe('2026-10-09'); // Pchum Ben covers Sat-Mon
    expect(nearestOpenDay('2026-12-25', 1)).toBe('2026-12-28');  // Christmas Fri -> Mon
  });
  it('addDaysToKey crosses month and year ends', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('class-day helpers', () => {
  it('weekdayOf uses Mon=1 ... Sun=7', () => {
    expect(['2026-09-21', '2026-09-22', '2026-09-24', '2026-09-26', '2026-09-27'].map(weekdayOf)).toEqual([1, 2, 4, 6, 7]);
  });
  it('nearestClassSlot only lands on open class days', () => {
    expect(nearestClassSlot('2026-09-22', [2, 4], 1)).toBe('2026-09-29');  // Thu Sep 24 is closed -> next Tue
    expect(nearestClassSlot('2026-09-29', [2, 4], -1)).toBe('2026-09-22'); // and back, skipping it again
  });
  it('inferClassDays picks the two most used weekdays (Mon-Fri, at least 2 events each)', () => {
    const days = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-09-24', '2026-10-01', '2026-10-08', '2026-09-25', '2026-09-26', '2026-10-03'];
    expect(inferClassDays(days.map((d, i) => ev(String(i), d)))).toEqual([2, 4]);
    expect(inferClassDays([ev('x', '2026-09-22'), ev('y', null)])).toEqual([]);
  });
});

describe('shiftOneWeek', () => {
  it('moves exactly 7 days to the same weekday', () => {
    expect(shiftOneWeek('2026-09-22', 1)).toBe('2026-09-29');
    expect(shiftOneWeek('2026-09-29', -1)).toBe('2026-09-22');
    expect(weekdayOf(shiftOneWeek('2026-12-31', 1))).toBe(weekdayOf('2026-12-31'));
  });
  it('adds another 7 days for each closure it lands on', () => {
    expect(shiftOneWeek('2026-09-17', 1)).toBe('2026-10-01');   // Thu Sep 24 closed -> Thu Oct 1
    expect(shiftOneWeek('2026-10-08', 1)).toBe('2026-10-22');   // Thu Oct 15 closed
    expect(shiftOneWeek('2026-10-22', 1)).toBe('2026-11-05');   // Thu Oct 29 closed
    expect(shiftOneWeek('2026-10-01', -1)).toBe('2026-09-17');  // backward skips Sep 24 too
    expect(shiftOneWeek('2026-12-18', 1)).toBe('2027-01-08');   // Fri Dec 25 and Fri Jan 1 both closed
  });
});

describe('cascadeShift (next available class day)', () => {
  const TUE_THU = [2, 4];
  // Tue/Thu classes; Thu Sep 24 (Constitutional Day) and Thu Oct 15 (Commemoration Day) are closed.
  const course = () => [
    ev('s1', '2026-09-22'),
    ev('s2', '2026-09-24'),          // on a closed Thursday: the one the user shifts
    ev('s3', '2026-09-29'),
    ev('s4', '2026-10-01'),
    ev('s5', '2026-10-06'),
    ev('s6', '2026-10-08'),
    ev('s7', '2026-10-13'),
    ev('hw', '2026-09-25'),          // Friday deadline after the target (not a class day)
    ev('undated', null),
  ];
  const sessionOrder = (events: EventItem[]) => events.filter((e) => /^s\d$/.test(e.id)).sort((a, b) => a.date!.localeCompare(b.date!)).map((e) => e.id);

  it('moves a Thursday session to the next Tuesday class (not a week later)', () => {
    const r = cascadeShift(course(), 's2', 1, TUE_THU);
    expect(dates(r.events).s2).toBe('2026-09-29'); // Thu Sep 24 -> Tue Sep 29
  });

  it('slides every later session one class meeting, skipping closed class days', () => {
    const r = cascadeShift(course(), 's2', 1, TUE_THU);
    expect(dates(r.events)).toMatchObject({
      s1: '2026-09-22',                                   // earlier session untouched
      s2: '2026-09-29', s3: '2026-10-01', s4: '2026-10-06', s5: '2026-10-08', s6: '2026-10-13',
      s7: '2026-10-20',                                   // next class after Tue Oct 13 is Thu Oct 15 (closed) -> Tue Oct 20
      undated: null,
    });
  });

  it('never puts a session on a non-class day or a closed day, never stacks them, and keeps their order', () => {
    const r = cascadeShift(course(), 's2', 1, TUE_THU);
    const sessions = r.events.filter((e) => /^s\d$/.test(e.id)).map((e) => e.date!);
    expect(new Set(sessions).size).toBe(sessions.length);
    for (const d of sessions) { expect(TUE_THU).toContain(weekdayOf(d)); expect(isClosed(d)).toBe(false); }
    expect(sessionOrder(r.events)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  });

  it('moves later tasks on other weekdays too, by one week to the same weekday', () => {
    const r = cascadeShift([
      ev('before', '2026-10-02', { type: 'assignment' }),   // earlier: stays
      ev('lecture', '2026-10-06'),                          // target (Tue)
      ev('hw', '2026-10-09', { type: 'assignment' }),       // Fri
      ev('quiz', '2026-10-10', { type: 'quiz' }),           // Sat
      ev('thu', '2026-10-08'),                              // Thu session
    ], 'lecture', 1, TUE_THU);
    expect(dates(r.events)).toEqual({ before: '2026-10-02', lecture: '2026-10-08', thu: '2026-10-13', hw: '2026-10-16', quiz: '2026-10-17' });
    expect(dates(cascadeShift(course(), 's2', 1, TUE_THU).events).hw).toBe('2026-10-02'); // Fri Sep 25 -> Fri Oct 2
  });

  it('moves sessions that share the target\'s date together', () => {
    const r = cascadeShift([ev('lecture', '2026-10-06'), ev('quiz', '2026-10-06'), ev('next', '2026-10-08')], 'lecture', 1, TUE_THU);
    expect(dates(r.events)).toEqual({ lecture: '2026-10-08', quiz: '2026-10-08', next: '2026-10-13' });
  });

  it('works for other class days (Mon/Wed around Water Festival, Mon Nov 23 - Wed Nov 25)', () => {
    const r = cascadeShift([ev('a', '2026-11-18'), ev('b', '2026-11-23'), ev('c', '2026-11-25'), ev('d', '2026-11-30')], 'b', 1, [1, 3]);
    expect(dates(r.events)).toEqual({ a: '2026-11-18', b: '2026-11-30', c: '2026-12-02', d: '2026-12-07' });
  });

  it('works with 2027 closures (Mon/Wed around Khmer New Year, Wed Apr 14 - Fri Apr 16)', () => {
    const r = cascadeShift([ev('a', '2027-04-05'), ev('b', '2027-04-07'), ev('c', '2027-04-12'), ev('d', '2027-04-14')], 'a', 1, [1, 3]);
    expect(dates(r.events)).toEqual({ a: '2027-04-07', b: '2027-04-12', c: '2027-04-19', d: '2027-04-21' });
  });

  it('Shift Backward moves to the previous class day and exactly undoes Shift Forward', () => {
    const start = [ev('s1', '2026-09-22'), ev('s3', '2026-09-29'), ev('s4', '2026-10-01'), ev('s5', '2026-10-06'), ev('fri', '2026-10-02')];
    const fwd = cascadeShift(start, 's3', 1, TUE_THU);
    expect(dates(fwd.events)).toEqual({ s1: '2026-09-22', s3: '2026-10-01', s4: '2026-10-06', s5: '2026-10-08', fri: '2026-10-09' });
    const back = cascadeShift(fwd.events, 's3', -1, TUE_THU);
    expect(back.blocked).toBeUndefined();
    expect(dates(back.events)).toEqual(dates(start));
  });

  it('refuses Shift Backward when the previous class day already has a session (no overwrite)', () => {
    const events = course();
    const r = cascadeShift(events, 's2', -1, TUE_THU); // previous class day Tue Sep 22 holds s1
    expect(r.blocked).toEqual({ title: 's1', date: '2026-09-22' });
    expect(r.changes).toEqual([]);
    expect(r.events).toBe(events);
  });

  it('Shift Backward from a closed day into a free class day moves only what can move without colliding', () => {
    const r = cascadeShift([ev('s2', '2026-09-24'), ev('s3', '2026-09-29'), ev('s4', '2026-10-01')], 's2', -1, TUE_THU);
    expect(dates(r.events)).toEqual({ s2: '2026-09-22', s3: '2026-09-29', s4: '2026-10-01' });
  });

  it('a shift off a closed day is undone exactly by the saved snapshot (undoShift)', () => {
    const events = course();
    const fwd = cascadeShift(events, 's2', 1, TUE_THU);
    const previous = Object.fromEntries(fwd.changes.map((c) => [c.id, c.from]));
    expect(dates(undoShift(fwd.events, previous))).toEqual(dates(events));
  });

  it('falls back to one week for everything when the class days are unknown', () => {
    const r = cascadeShift([ev('a', '2026-09-21'), ev('b', '2026-09-28'), ev('c', '2026-10-02')], 'b', 1, []);
    expect(dates(r.events)).toEqual({ a: '2026-09-21', b: '2026-10-05', c: '2026-10-09' });
  });

  it('keeps other fields and does not mutate the input', () => {
    const events = [ev('s2', '2026-09-24', { completed: true, needsReview: false }), ev('s3', '2026-09-29')];
    const snapshot = JSON.stringify(events);
    const r = cascadeShift(events, 's2', 1, TUE_THU);
    expect(JSON.stringify(events)).toBe(snapshot);
    expect(r.events[0]).toMatchObject({ completed: true, needsReview: false, title: 's2', date: '2026-09-29' });
  });

  it('is a no-op for an unknown or undated event', () => {
    const events = course();
    expect(cascadeShift(events, 'nope', 1, TUE_THU)).toEqual({ events, changes: [] });
    expect(cascadeShift(events, 'undated', 1, TUE_THU)).toEqual({ events, changes: [] });
  });
});

describe('original dates (calendar "Shifts off" view)', () => {
  const TUE_THU = [2, 4];
  it('remembers the pre-shift date on the first shift and keeps it across further shifts', () => {
    const once = cascadeShift([ev('a', '2026-09-24'), ev('b', '2026-09-29')], 'a', 1, TUE_THU);
    expect(once.events.map((e) => [e.id, e.date, e.originalDate])).toEqual([['a', '2026-09-29', '2026-09-24'], ['b', '2026-10-01', '2026-09-29']]);
    const twice = cascadeShift(once.events, 'a', 1, TUE_THU);
    expect(twice.events.map((e) => e.originalDate)).toEqual(['2026-09-24', '2026-09-29']);
  });
  it('drops the original date once an event is back on it (Backward or Undo)', () => {
    const fwd = cascadeShift([ev('x', '2026-09-29'), ev('y', '2026-10-01')], 'x', 1, TUE_THU);
    const back = cascadeShift(fwd.events, 'x', -1, TUE_THU);
    expect(back.events.every((e) => e.originalDate === undefined)).toBe(true);
    const undone = undoShift(fwd.events, Object.fromEntries(fwd.changes.map((c) => [c.id, c.from])));
    expect(undone.every((e) => e.originalDate === undefined)).toBe(true);
  });
  it('displayDate shows the shifted date normally and the original date with shifts off', () => {
    const e = { date: '2026-09-29', originalDate: '2026-09-24' };
    expect(displayDate(e, true)).toBe('2026-09-29');
    expect(displayDate(e, false)).toBe('2026-09-24');
    expect(displayDate({ date: '2026-10-06' }, false)).toBe('2026-10-06'); // never shifted
  });
});

describe('remapClassDays (change a course\'s class days)', () => {
  const events = () => [
    ev('tue1', '2026-09-22'), ev('thu1', '2026-09-24'), ev('tue2', '2026-09-29'), ev('thu2', '2026-10-01'),
    ev('fri', '2026-09-25', { type: 'assignment' }), ev('undated', null),
  ];
  it('moves Tue/Thu sessions to Mon/Wed of the same week; other days stay', () => {
    const r = remapClassDays(events(), [2, 4], [1, 3]);
    expect(dates(r.events)).toEqual({ tue1: '2026-09-21', thu1: '2026-09-23', tue2: '2026-09-28', thu2: '2026-09-30', fri: '2026-09-25', undated: null });
    expect(r.moved).toBe(4);
    for (const e of r.events.filter((x) => x.id !== 'fri' && x.date)) expect([1, 3]).toContain(weekdayOf(e.date!));
  });
  it('changing the days back restores every date exactly', () => {
    const there = remapClassDays(events(), [2, 4], [1, 3]);
    expect(dates(remapClassDays(there.events, [1, 3], [2, 4]).events)).toEqual(dates(events()));
  });
  it('maps Day 1 to Day 1 and Day 2 to Day 2 (Tue/Thu -> Wed/Fri)', () => {
    const r = remapClassDays(events(), [2, 4], [3, 5]);
    expect(dates(r.events)).toMatchObject({ tue1: '2026-09-23', thu1: '2026-09-25', fri: '2026-09-25' });
  });
  it('remaps the original (pre-shift) dates too, so "Shifts off" follows the new days', () => {
    const shifted = cascadeShift(events(), 'thu1', 1, [2, 4]).events; // thu1 -> Tue Sep 29 (orig Thu Sep 24)
    const r = remapClassDays(shifted, [2, 4], [1, 3]);
    const thu1 = r.events.find((e) => e.id === 'thu1')!;
    expect([thu1.date, thu1.originalDate]).toEqual(['2026-09-28', '2026-09-23']);
  });
  it('is a no-op when the days do not change', () => {
    const list = events();
    expect(remapClassDays(list, [2, 4], [2, 4])).toEqual({ events: list, moved: 0 });
  });
});

describe('shift distance (next class day, never a full week when the next class day is open)', () => {
  it('Tue -> Thu is 2 days and Thu -> Tue is 5 days with Tue/Thu classes', () => {
    const tue = cascadeShift([ev('a', '2026-10-06'), ev('b', '2026-10-08')], 'a', 1, [2, 4]).changes.find((c) => c.id === 'a')!;
    const thu = cascadeShift([ev('a', '2026-10-08'), ev('b', '2026-10-13')], 'a', 1, [2, 4]).changes.find((c) => c.id === 'a')!;
    expect([tue.to, daysBetween(tue.from, tue.to)]).toEqual(['2026-10-08', 2]);
    expect([thu.to, daysBetween(thu.from, thu.to)]).toEqual(['2026-10-13', 5]);
  });
  it('only moves a whole week when the course has a single known class day', () => {
    const c = cascadeShift([ev('a', '2026-10-09')], 'a', 1, [5]).changes[0];
    expect(daysBetween(c.from, c.to)).toBe(7);
  });
});

describe('repairing older Friday-only courses', () => {
  // Older scans put both weekly sessions on the same Friday.
  const legacy = () => [ev('s1', '2026-09-04'), ev('s2', '2026-09-04'), ev('s3', '2026-09-11'), ev('s4', '2026-09-11'), ev('s5', '2026-09-18')];
  it('guesses Friday as the only class day', () => {
    expect(inferClassDays(legacy())).toEqual([5]);
  });
  it('changing Fri -> Tue/Thu spreads each week\'s sessions: first to Tue, second to Thu', () => {
    const r = remapClassDays(legacy(), [5], [2, 4]);
    expect(dates(r.events)).toEqual({ s1: '2026-09-01', s2: '2026-09-03', s3: '2026-09-08', s4: '2026-09-10', s5: '2026-09-15' });
  });
  it('after the repair, Shift Forward moves to the next class day (Tue -> Thu, 2 days)', () => {
    const fixed = remapClassDays(legacy(), [5], [2, 4]).events;
    const c = cascadeShift(fixed, 's3', 1, [2, 4]).changes.find((x) => x.id === 's3')!;
    expect([c.to, daysBetween(c.from, c.to)]).toEqual(['2026-09-10', 2]);
  });
});

describe('inferClassDays uses class sessions, not graded work', () => {
  it('ignores Friday quizzes when Tue/Thu sessions exist', () => {
    const events = [
      ev('t1', '2026-09-22'), ev('t2', '2026-09-29'), ev('h1', '2026-09-24'), ev('h2', '2026-10-01'),
      ev('q1', '2026-09-25', { type: 'quiz' }), ev('q2', '2026-10-02', { type: 'quiz' }), ev('q3', '2026-10-09', { type: 'quiz' }),
    ];
    expect(inferClassDays(events)).toEqual([2, 4]);
  });
});

// The rule: Shift Forward/Backward moves the clicked class to the very next/previous DESIGNATED class day
// (never the same weekday a week later), skips weekends and Campus Closed days, and cascades every later
// session by one class meeting.
describe('cascadeShift: next available class slot', () => {
  const TUE_THU = [2, 4];
  // Fall 2026 around the dates used here: Thu Oct 15 and Thu Oct 29 are closed; Mon Nov 9 is closed.

  it('Tue/Thu: a cancelled Thursday moves to the next Tuesday (5 days), not the next Thursday (7 days)', () => {
    const r = cascadeShift([ev('thu', '2026-10-15'), ev('tue', '2026-10-20')], 'thu', 1, TUE_THU);
    expect(dates(r.events).thu).toBe('2026-10-20');
    expect(daysBetween('2026-10-15', dates(r.events).thu!)).toBe(5);
    expect(weekdayOf(dates(r.events).thu!)).toBe(2);
  });

  it('cascades every later session one class meeting, skipping later closed class days', () => {
    const r = cascadeShift([
      ev('t1', '2026-10-13'), // before the target: stays
      ev('t2', '2026-10-15'), // closed Thursday (target)
      ev('t3', '2026-10-20'), ev('t4', '2026-10-22'), ev('t5', '2026-10-27'),
      ev('t6', '2026-11-03'), // the class after Oct 27 (Thu Oct 29 is closed)
      ev('t7', '2026-11-05'),
    ], 't2', 1, TUE_THU);
    expect(dates(r.events)).toEqual({
      t1: '2026-10-13',
      t2: '2026-10-20', t3: '2026-10-22', t4: '2026-10-27',
      t5: '2026-11-03', // next class day after Tue Oct 27 is Thu Oct 29 (closed) -> Tue Nov 3
      t6: '2026-11-05', t7: '2026-11-10',
    });
  });

  it('skips weekends: with Mon/Fri classes a cancelled Friday moves to Monday, then past a closed Friday', () => {
    // Fri Dec 25 (Christmas) cancelled; Fri Jan 1 (New Year) is closed too.
    const r = cascadeShift([ev('a', '2026-12-25'), ev('b', '2026-12-28'), ev('c', '2027-01-04')], 'a', 1, [1, 5]);
    expect(dates(r.events)).toEqual({ a: '2026-12-28', b: '2027-01-04', c: '2027-01-08' });
    for (const d of Object.values(dates(r.events))) expect(isOpenDay(d!)).toBe(true);
  });

  it('Shift Backward moves to the previous class day, skipping a closed one', () => {
    // Previous class day before Tue Oct 20 is Thu Oct 15 (closed) -> Tue Oct 13.
    const r = cascadeShift([ev('a', '2026-10-08'), ev('b', '2026-10-20'), ev('c', '2026-10-22')], 'b', -1, TUE_THU);
    expect(r.blocked).toBeUndefined();
    expect(dates(r.events)).toEqual({ a: '2026-10-08', b: '2026-10-13', c: '2026-10-20' });
  });

  it('Shift Backward: Thursday goes to the Tuesday of the same week (2 days), not the previous Thursday', () => {
    const r = cascadeShift([ev('a', '2026-10-01'), ev('b', '2026-10-08')], 'b', -1, TUE_THU);
    expect(dates(r.events).b).toBe('2026-10-06');
  });

  it('a clicked class on a non-class weekday still goes to the next class day, not a week later', () => {
    // A session the scan put on Wed Oct 7 in a Tue/Thu course: forward -> Thu Oct 8 (previously Wed Oct 14).
    const events = [ev('wed', '2026-10-07'), ev('thu', '2026-10-08'), ev('tue', '2026-10-13')];
    const fwd = cascadeShift(events, 'wed', 1, TUE_THU);
    expect(dates(fwd.events)).toEqual({ wed: '2026-10-08', thu: '2026-10-13', tue: '2026-10-20' }); // Thu Oct 15 closed
    const back = cascadeShift(events, 'wed', -1, TUE_THU);
    expect(dates(back.events).wed).toBe('2026-10-06');
  });

  it('later deadlines on non-class days still move one week (only the clicked task is forced onto a class day)', () => {
    const r = cascadeShift([ev('thu', '2026-10-01'), ev('fri', '2026-10-02', { type: 'assignment' })], 'thu', 1, TUE_THU);
    expect(dates(r.events)).toEqual({ thu: '2026-10-06', fri: '2026-10-09' });
  });

  it('the dry run used for the button label matches the real shift', () => {
    const events = [ev('thu', '2026-10-15'), ev('tue', '2026-10-20')];
    const preview = cascadeShift(events, 'thu', 1, TUE_THU).changes.find((c) => c.id === 'thu')?.to;
    expect(preview).toBe('2026-10-20');
    expect(preview).toBe(nearestClassSlot('2026-10-15', TUE_THU, 1));
  });
});
