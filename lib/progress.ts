// Course progress for the Courses tab overview. Pure helpers.
// The Courses tab lists and counts a course's ASSESSMENTS (graded work); class sessions and readings stay
// on the calendar. Personal events are never counted in any percentage.
import type { EventItem } from './db';

export const ASSESSMENT_TYPES = ['exam', 'quiz', 'assignment', 'project'] as const;
// Graded work: an assessment type, or anything with a grade weight.
export const isAssessment = (e: Pick<EventItem, 'type' | 'weight'>) =>
  (ASSESSMENT_TYPES as readonly string[]).includes(e.type) || (e.weight != null && e.weight > 0);

export type Progress = {
  total: number;      // tasks in the course
  done: number;       // completed tasks
  percent: number;    // 0-100, rounded; 0 when there are no tasks
  review: number;     // open tasks flagged "Check date"
  undated: number;    // tasks without a date
  next?: EventItem;   // earliest open task dated today or later
};

export const percentOf = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

export function courseProgress(events: readonly EventItem[], todayKey: string): Progress {
  const done = events.filter((e) => e.completed).length;
  const open = events.filter((e) => !e.completed);
  const next = open.filter((e) => e.date && e.date >= todayKey).sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '').localeCompare(b.time ?? ''))[0];
  return {
    total: events.length,
    done,
    percent: percentOf(done, events.length),
    review: open.filter((e) => e.needsReview).length,
    undated: events.filter((e) => !e.date).length,
    next,
  };
}

// Overall progress across syllabus courses' assessments only (scans with kind 'personal' are skipped).
export function overallProgress(scans: readonly { kind?: string; events: readonly EventItem[] }[]) {
  const tasks = scans.filter((s) => s.kind !== 'personal').flatMap((s) => s.events).filter(isAssessment);
  const done = tasks.filter((e) => e.completed).length;
  return { total: tasks.length, done, percent: percentOf(done, tasks.length) };
}

// Tasks in date order (then time, then title); undated tasks last.
export const sortTasks = <T extends Pick<EventItem, 'date' | 'time' | 'title'>>(events: readonly T[]) =>
  [...events].sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : a.title.localeCompare(b.title);
    return a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title);
  });
