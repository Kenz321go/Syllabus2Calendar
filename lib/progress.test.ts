import { describe, expect, it } from 'vitest';
import { courseProgress, isAssessment, overallProgress, percentOf, sortTasks } from './progress';
import type { EventItem } from './db';

const ev = (id: string, date: string | null, extra: Partial<EventItem> = {}): EventItem =>
  ({ id, title: id, type: 'other', date, time: null, weight: null, source: '', needsReview: false, ...extra });

describe('courseProgress', () => {
  const events = [
    ev('a', '2026-09-01', { completed: true }),
    ev('b', '2026-09-08', { completed: true }),
    ev('c', '2026-11-20', { needsReview: true }),
    ev('d', '2026-11-25'),
    ev('e', null),
  ];

  it('counts done / total and rounds the percentage', () => {
    expect(courseProgress(events, '2026-11-23')).toMatchObject({ total: 5, done: 2, percent: 40 });
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
  });
  it('is 0% (not NaN) for a course with no tasks, and 100% when everything is done', () => {
    expect(courseProgress([], '2026-11-23')).toMatchObject({ total: 0, done: 0, percent: 0, next: undefined });
    expect(courseProgress([ev('x', '2026-09-01', { completed: true })], '2026-11-23').percent).toBe(100);
  });
  it('picks the next open task dated today or later', () => {
    expect(courseProgress(events, '2026-11-23').next?.id).toBe('d');
    expect(courseProgress(events, '2026-11-20').next?.id).toBe('c');
    expect(courseProgress(events, '2026-12-01').next).toBeUndefined();
  });
  it('counts open "check date" tasks and undated tasks', () => {
    expect(courseProgress(events, '2026-11-23')).toMatchObject({ review: 1, undated: 1 });
    expect(courseProgress([ev('r', '2026-11-20', { needsReview: true, completed: true })], '2026-11-23').review).toBe(0);
  });
});

describe('overallProgress', () => {
  it('counts only syllabus course assessments; class sessions and personal tasks never count', () => {
    const scans = [
      { events: [ev('a', '2026-09-01', { type: 'exam', completed: true }), ev('b', '2026-09-02', { type: 'quiz' }), ev('session', '2026-09-03', { completed: true })] },
      { events: [ev('c', '2026-09-03', { type: 'assignment', completed: true }), ev('d', '2026-09-04', { type: 'other', weight: 10, completed: true })] },
      { kind: 'personal', events: [ev('p1', '2026-09-05', { type: 'exam' }), ev('p2', '2026-09-06'), ev('p3', '2026-09-07')] },
    ];
    expect(overallProgress(scans)).toEqual({ total: 4, done: 3, percent: 75 });
  });
  it('is 0% with no courses', () => {
    expect(overallProgress([{ kind: 'personal', events: [ev('p', null, { completed: true })] }])).toEqual({ total: 0, done: 0, percent: 0 });
  });
});

describe('sortTasks', () => {
  it('orders by date, then time, then title, with undated tasks last; does not mutate', () => {
    const list = [ev('z', null), ev('late', '2026-10-02'), ev('b', '2026-10-01', { time: '14:00' }), ev('a', '2026-10-01', { time: '09:00' }), ev('y', null)];
    const snapshot = list.map((e) => e.id);
    expect(sortTasks(list).map((e) => e.id)).toEqual(['a', 'b', 'late', 'y', 'z']);
    expect(list.map((e) => e.id)).toEqual(snapshot);
  });
});

describe('isAssessment', () => {
  it('treats exams, quizzes, assignments, projects and anything weighted as assessments', () => {
    for (const type of ['exam', 'quiz', 'assignment', 'project']) expect(isAssessment({ type, weight: null })).toBe(true);
    expect(isAssessment({ type: 'other', weight: 15 })).toBe(true);
  });
  it('excludes class sessions, readings and unweighted other events', () => {
    for (const type of ['other', 'reading', 'personal']) expect(isAssessment({ type, weight: null })).toBe(false);
    expect(isAssessment({ type: 'other', weight: 0 })).toBe(false);
  });
});
