import Dexie, { Table } from 'dexie';
// `completed` is optional so events stored before it existed (and older backups) read as not completed.
// Events live inside each scan's `events` array and are not indexed, so no Dexie schema version bump is needed.
// `originalDate` is the date before any Cascade Shift (set on the first shift, cleared when the event is back
// on it or its date is edited by hand); the calendar's "Shifts off" view shows events there.
export type EventItem = { id: string; title: string; type: string; date: string | null; time: string | null; weight: number | null; source: string; needsReview: boolean; completed?: boolean; originalDate?: string };
// classDays: the course's two meeting weekdays (Mon=1 ... Fri=5) chosen at scan time; missing on older scans.
// lastShift: dates before the most recent Cascade Shift, so it can be undone exactly (one level of undo).
// kind: 'personal' marks the one per-semester scan that holds events the user added on the calendar
// (see lib/personal.ts); missing means an AI-extracted syllabus course.
// All three are optional and unindexed, so no Dexie schema version bump is needed.
export type Scan = {
  id?: number; course: string; fileName: string; semester: string; merged: boolean; events: EventItem[]; createdAt: number;
  kind?: 'syllabus' | 'personal';
  // Colour chosen in the Courses sidebar (a key of COURSE_COLORS in lib/courseFilter.ts); default by position if missing.
  color?: string;
  classDays?: number[];
  lastShift?: { at: number; label: string; previous: Record<string, string> };
};
export type Semester = { id?: number; name: string; startDate: string; createdAt: number };
class DB extends Dexie {
  scans!: Table<Scan, number>;
  semesters!: Table<Semester, number>;
  constructor() {
    super('syllabus2cal');
    this.version(1).stores({ scans: '++id, semester, merged' });
    this.version(2).stores({ scans: '++id, semester, merged', semesters: '++id, &name' });
  }
}
export const db = new DB(); // scans live in the browser (IndexedDB); nothing is stored on the server
