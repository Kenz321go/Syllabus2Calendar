// Personal events the user adds directly on the calendar. They live in one special scan per semester
// (kind: 'personal'), kept apart from AI-extracted syllabus courses but stored, rendered and edited
// with the same code paths. Pure helpers here; the IndexedDB transaction is in app/page.tsx.
import type { EventItem, Scan } from './db';

export const PERSONAL_COURSE = 'My Personal Tasks';
export const PERSONAL_TYPE = 'personal';

export type PersonalInput = { title: string; date: string; time?: string; type?: string; note?: string };

export const isPersonalScan = (scan: Pick<Scan, 'kind'>) => scan.kind === 'personal';

export const personalScanFor = <T extends Pick<Scan, 'kind' | 'semester'>>(scans: readonly T[], semester: string) =>
  scans.find((s) => isPersonalScan(s) && s.semester === semester);

// Validate the Add Event form and build the stored event. Returns an error message instead of throwing.
export function makePersonalEvent(input: PersonalInput, id: string): { event: EventItem } | { error: string } {
  const title = input.title.trim();
  if (!title) return { error: 'Enter a title.' };
  if (title.length > 300) return { error: 'Keep the title under 300 characters.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) return { error: 'Choose a valid date.' };
  const time = input.time?.trim() || null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Enter the time as HH:MM.' };
  return {
    event: {
      id, title, date: input.date, time, weight: null,
      type: input.type?.trim() || PERSONAL_TYPE,
      source: (input.note ?? '').trim().slice(0, 2000),
      needsReview: false, completed: false,
    },
  };
}

// The personal scan after adding `event`: appends to the existing one, or creates it for this semester.
// Never mutates its input.
export function withPersonalEvent(existing: Scan | undefined, event: EventItem, semester: string, now = Date.now()): Scan {
  if (existing) return { ...existing, events: [...existing.events, event] };
  return { course: PERSONAL_COURSE, fileName: '', semester, merged: true, kind: 'personal', events: [event], createdAt: now };
}
