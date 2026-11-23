import { describe, expect, it } from 'vitest';
import { allVisible, chipStyle, COURSE_COLORS, COURSE_PALETTE_SIZE, courseColorIndex, courseColors, filterByCourse, parseHidden, serializeHidden, toggleAll, toggleCourse } from './courseFilter';

const course = (id: number, createdAt: number, kind?: 'personal') => ({ id, createdAt, kind });

describe('courseColorIndex', () => {
  it('gives each syllabus course a distinct colour by position, oldest first', () => {
    const map = courseColorIndex([course(7, 300), course(3, 100), course(5, 200)]);
    expect([...map.entries()]).toEqual([[3, 0], [5, 1], [7, 2]]);
  });
  it('skips the personal-events scan, so it takes no palette slot', () => {
    const map = courseColorIndex([course(1, 100), course(2, 150, 'personal'), course(3, 200)]);
    expect(map.has(2)).toBe(false);
    expect([map.get(1), map.get(3)]).toEqual([0, 1]);
  });
  it('cycles through the palette when there are more courses than colours', () => {
    const many = Array.from({ length: COURSE_PALETTE_SIZE + 2 }, (_, i) => course(i + 1, i));
    const map = courseColorIndex(many);
    expect(new Set([...map.values()].slice(0, COURSE_PALETTE_SIZE)).size).toBe(COURSE_PALETTE_SIZE);
    expect([map.get(COURSE_PALETTE_SIZE + 1), map.get(COURSE_PALETTE_SIZE + 2)]).toEqual([0, 1]);
  });
});

describe('course visibility', () => {
  const events = [{ id: 'a', scanId: 1 }, { id: 'b', scanId: 2 }, { id: 'c', scanId: 1 }, { id: 'p', scanId: 9 }];

  it('shows everything when nothing is hidden (new courses are visible by default)', () => {
    expect(filterByCourse(events, new Set()).map((e) => e.id)).toEqual(['a', 'b', 'c', 'p']);
  });
  it('hides every event of an unticked course, including the personal list', () => {
    expect(filterByCourse(events, new Set([1])).map((e) => e.id)).toEqual(['b', 'p']);
    expect(filterByCourse(events, new Set([1, 9])).map((e) => e.id)).toEqual(['b']);
  });
  it('toggleCourse ticks and unticks one course without mutating the input', () => {
    const hidden = new Set([2]);
    expect([...toggleCourse(hidden, 1, false)].sort()).toEqual([1, 2]);
    expect([...toggleCourse(hidden, 2, true)]).toEqual([]);
    expect([...hidden]).toEqual([2]);
  });
  it('Select all / Deselect all: hides all when all are visible, otherwise shows all', () => {
    const ids = [1, 2, 9];
    const none = toggleAll(new Set(), ids);
    expect([...none].sort()).toEqual([1, 2, 9]);
    expect(allVisible(none, ids)).toBe(false);
    const some = toggleAll(new Set([2]), ids); // partly hidden -> Select all
    expect([...some]).toEqual([]);
    expect(allVisible(some, ids)).toBe(true);
  });
  it('leaves hidden ids for courses outside the current list alone', () => {
    expect([...toggleAll(new Set([42, 1]), [1, 2])].sort((a, b) => a - b)).toEqual([42]);
  });
});

describe('hidden-course persistence', () => {
  it('round-trips through localStorage text', () => {
    expect([...parseHidden(serializeHidden(new Set([5, 1, 3])))]).toEqual([1, 3, 5]);
  });
  it('treats missing or corrupted values as "nothing hidden"', () => {
    for (const raw of [null, '', 'not json', '{"a":1}', '[1.5,"x",null]']) expect([...parseHidden(raw)]).toEqual([]);
  });
});

describe('chipStyle (syllabus first)', () => {
  it('always uses the course colour (or the personal colour), never a warning style', () => {
    expect(chipStyle({}, { personal: false })).toEqual({ variant: 'course', done: false });
    expect(chipStyle({}, { personal: true })).toEqual({ variant: 'personal', done: false });
  });
  it('keeps completed events on the calendar, just marked done (crossed through)', () => {
    expect(chipStyle({ completed: true }, { personal: false })).toEqual({ variant: 'course', done: true });
    expect(chipStyle({ completed: true }, { personal: true })).toEqual({ variant: 'personal', done: true });
  });
});

describe('courseColors (defaults and user choice)', () => {
  const scan = (id: number, createdAt: number, extra: { kind?: 'personal'; color?: string } = {}) => ({ id, createdAt, ...extra });

  it('defaults Course 1 to red, Course 2 to blue, Course 3 to green, and the personal list to pink', () => {
    const map = courseColors([scan(1, 10), scan(2, 20), scan(3, 30), scan(9, 5, { kind: 'personal' })]);
    expect([map.get(1), map.get(2), map.get(3), map.get(9)]).toEqual(['red', 'blue', 'green', 'pink']);
  });
  it('uses the colour the user picked, for courses and the personal list alike', () => {
    const map = courseColors([scan(1, 10, { color: 'teal' }), scan(2, 20), scan(9, 5, { kind: 'personal', color: 'amber' })]);
    expect([map.get(1), map.get(2), map.get(9)]).toEqual(['teal', 'blue', 'amber']);
  });
  it('falls back to the default for an unknown saved colour', () => {
    expect(courseColors([scan(1, 10, { color: 'chartreuse' })]).get(1)).toBe('red');
  });
  it('offers 8 presets, and every default is one of them', () => {
    expect(COURSE_COLORS).toHaveLength(8);
    const many = Array.from({ length: 10 }, (_, i) => scan(i + 1, i));
    for (const c of courseColors(many).values()) expect(COURSE_COLORS).toContain(c);
  });
});
