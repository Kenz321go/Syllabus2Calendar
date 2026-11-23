import { describe, expect, it } from 'vitest';
import { ACADEMIC_CATEGORIES, ACADEMIC_EVENTS, ACADEMIC_TERMS, AcademicColor, academicOn, termOn } from './academic';

// [date, expected title, expected colour, expected term] for every date given for the calendar.
const EXPECTED: [string, string, AcademicColor, string][] = [
  // Fall 2026
  ['2026-08-17', 'First day of classes', 'green', 'Fall 2026'],
  ['2026-08-21', 'Last day to ADD/DROP', 'green', 'Fall 2026'],
  ['2026-08-30', 'Last day for 80% tuition refund', 'gray', 'Fall 2026'],
  ['2026-09-13', 'Last day for 40% tuition refund', 'gray', 'Fall 2026'],
  ['2026-10-11', 'Last day to WITHDRAW from courses with W grade', 'gray', 'Fall 2026'],
  ['2026-11-30', 'Course Evaluation opens', 'orange', 'Fall 2026'],
  ['2026-12-04', 'Last day of classes', 'yellow', 'Fall 2026'],
  ['2026-12-06', 'Course Evaluation closes', 'orange', 'Fall 2026'],
  ['2026-12-07', 'Final exam period', 'red', 'Fall 2026'],
  ['2026-12-15', 'Faculty final grade submission deadline', 'gray', 'Fall 2026'],
  ['2026-12-17', 'Grades posted on transcripts', 'gray', 'Fall 2026'],
  // Spring 2027
  ['2027-01-11', 'First day of classes', 'green', 'Spring 2027'],
  ['2027-01-15', 'Last day to ADD/DROP', 'green', 'Spring 2027'],
  ['2027-01-24', 'Last day for 80% refund', 'gray', 'Spring 2027'],
  ['2027-02-07', 'Last day for 40% refund', 'gray', 'Spring 2027'],
  ['2027-03-07', 'Withdrawal deadline', 'gray', 'Spring 2027'],
  ['2027-04-12', 'Course Evaluation opens', 'orange', 'Spring 2027'],
  ['2027-04-23', 'Course Evaluation closes', 'orange', 'Spring 2027'],
  ['2027-04-30', 'Last day of classes', 'yellow', 'Spring 2027'],
  ['2027-05-03', 'Final exam period', 'red', 'Spring 2027'],
  ['2027-05-08', 'AUPP Graduation Ceremony', 'blue', 'Spring 2027'],
  ['2027-05-11', 'Final grades due', 'gray', 'Spring 2027'],
  ['2027-05-13', 'Grades posted', 'gray', 'Spring 2027'],
  // Summer 2027
  ['2027-05-25', 'First day of classes', 'green', 'Summer 2027'],
  ['2027-05-28', 'Last day to ADD/DROP', 'green', 'Summer 2027'],
  ['2027-05-31', 'Last day for 80% refund', 'gray', 'Summer 2027'],
  ['2027-06-07', 'Last day for 40% refund', 'gray', 'Summer 2027'],
  ['2027-06-21', 'Withdrawal deadline', 'gray', 'Summer 2027'],
  ['2027-06-28', 'Course Evaluation opens', 'orange', 'Summer 2027'],
  ['2027-07-09', 'Course Evaluation closes', 'orange', 'Summer 2027'],
  ['2027-07-16', 'Last day of classes', 'yellow', 'Summer 2027'],
  ['2027-07-19', 'Final exam period', 'red', 'Summer 2027'],
  ['2027-07-23', 'Final grades due', 'gray', 'Summer 2027'],
  ['2027-07-27', 'Grades posted', 'gray', 'Summer 2027'],
];

describe('academic calendar', () => {
  it.each(EXPECTED)('%s is "%s" (%s, %s)', (date, title, color, term) => {
    expect(academicOn(date).map((a) => [a.title, a.color, a.term])).toEqual([[title, color, term]]);
  });

  it('spans every day of each final exam period, and nothing just outside it', () => {
    const periods: [string, string[], string, string][] = [
      ['Fall 2026', ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'], '2026-12-06', '2026-12-12'],
      ['Spring 2027', ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07'], '2027-05-02', '2027-05-08'],
      ['Summer 2027', ['2027-07-19', '2027-07-20', '2027-07-21'], '2027-07-18', '2027-07-22'],
    ];
    for (const [term, days, before, after] of periods) {
      for (const d of days) expect(academicOn(d).map((a) => [a.color, a.term])).toEqual([['red', term]]);
      expect(academicOn(before).some((a) => a.color === 'red')).toBe(false);
      expect(academicOn(after).some((a) => a.color === 'red')).toBe(false);
    }
  });

  it('marks the graduation ceremony blue, right after Spring finals', () => {
    expect(academicOn('2027-05-08')).toEqual([expect.objectContaining({ color: 'blue', title: 'AUPP Graduation Ceremony' })]);
    expect(ACADEMIC_CATEGORIES.blue).toBe('Ceremony');
  });

  it('Fall 2026 dates fall on the weekdays printed in the AUPP calendar', () => {
    const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    expect(['2026-08-30', '2026-09-13', '2026-10-11', '2026-12-15', '2026-12-17', '2026-11-30', '2026-12-06'].map(weekday))
      .toEqual(['Sun', 'Sun', 'Sun', 'Tue', 'Thu', 'Mon', 'Sun']);
  });

  it('Fall 2026 now has every category except blue, like Spring 2027', () => {
    const colours = (t: string) => new Set(ACADEMIC_EVENTS.filter((a) => a.term === t).map((a) => a.color));
    expect([...colours('Fall 2026')].sort()).toEqual(['gray', 'green', 'orange', 'red', 'yellow']);
    expect(ACADEMIC_EVENTS.filter((a) => a.term === 'Fall 2026' && a.color === 'gray')).toHaveLength(5);
    expect(ACADEMIC_EVENTS.filter((a) => a.term === 'Fall 2026' && a.color === 'orange')).toHaveLength(2);
  });

  it('returns nothing on a day with no academic event', () => {
    expect(academicOn('2027-02-20')).toEqual([]);
    expect(academicOn('2027-08-15')).toEqual([]);
  });

  it('has unique ids, valid ordered dates, a known category and a listed term for every entry', () => {
    expect(new Set(ACADEMIC_EVENTS.map((a) => a.id)).size).toBe(ACADEMIC_EVENTS.length);
    for (const a of ACADEMIC_EVENTS) {
      expect(a.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.to >= a.from).toBe(true);
      expect(ACADEMIC_CATEGORIES[a.color]).toBeTruthy();
      expect(ACADEMIC_TERMS).toContain(a.term);
    }
  });

  it('termOn finds the term a date falls in, and nothing between terms', () => {
    expect(termOn('2026-10-01')).toBe('Fall 2026');
    expect(termOn('2027-03-01')).toBe('Spring 2027');
    expect(termOn('2027-05-13')).toBe('Spring 2027');
    expect(termOn('2027-05-25')).toBe('Summer 2027');
    expect(termOn('2027-05-20')).toBeUndefined(); // gap between Spring and Summer
    expect(termOn('2026-12-20')).toBeUndefined();
  });
});
