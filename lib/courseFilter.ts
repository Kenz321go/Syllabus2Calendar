// Course filter + per-course colours for the calendar. Pure helpers; state lives in app/page.tsx.
//
// Visibility is stored as the set of HIDDEN scan ids, so a newly scanned course is visible by default.
// Colours are assigned by each syllabus course's position in the list (oldest first), cycling through
// the palette; the personal-events scan keeps its own fixed colour and takes no palette slot.

// Preset colours a course can use (user-selectable in the Courses sidebar).
export const COURSE_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'teal', 'amber', 'pink'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];
// Default colours for syllabus courses, by position (oldest first): Course 1 red, 2 blue, 3 green, ...
// Pink is left out so the personal list keeps its own default.
export const DEFAULT_COURSE_CYCLE: readonly CourseColor[] = ['red', 'blue', 'green', 'purple', 'orange', 'teal', 'amber'];
export const COURSE_PALETTE_SIZE = DEFAULT_COURSE_CYCLE.length;
export const PERSONAL_DEFAULT_COLOR: CourseColor = 'pink';

export const isCourseColor = (v: unknown): v is CourseColor => typeof v === 'string' && (COURSE_COLORS as readonly string[]).includes(v);

type CourseLike = { id?: number; kind?: string; createdAt: number; color?: string };

// scan id -> palette index for syllabus courses (position, oldest first, cycling).
export function courseColorIndex(courses: readonly CourseLike[]): Map<number, number> {
  const ordered = courses.filter((c) => c.id != null && c.kind !== 'personal').sort((a, b) => a.createdAt - b.createdAt || a.id! - b.id!);
  return new Map(ordered.map((c, i) => [c.id!, i % COURSE_PALETTE_SIZE]));
}

// scan id -> colour for every listed scan: the user's choice if valid, else the default for its position
// (personal list: pink). A user's choice never changes when other courses are added or deleted.
export function courseColors(scans: readonly CourseLike[]): Map<number, CourseColor> {
  const index = courseColorIndex(scans);
  const out = new Map<number, CourseColor>();
  for (const s of scans) {
    if (s.id == null) continue;
    out.set(s.id, isCourseColor(s.color) ? s.color : s.kind === 'personal' ? PERSONAL_DEFAULT_COLOR : DEFAULT_COURSE_CYCLE[index.get(s.id) ?? 0]);
  }
  return out;
}

export const filterByCourse = <T extends { scanId: number }>(events: readonly T[], hidden: ReadonlySet<number>) =>
  events.filter((e) => !hidden.has(e.scanId));

export function toggleCourse(hidden: ReadonlySet<number>, id: number, visible: boolean): Set<number> {
  const next = new Set(hidden);
  if (visible) next.delete(id); else next.add(id);
  return next;
}

// "Select all / Deselect all": if every listed course is visible, hide them all; otherwise show them all.
// Ids hidden for courses not in `ids` (e.g. another semester) are left alone.
export function toggleAll(hidden: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const allVisible = ids.every((id) => !hidden.has(id));
  const next = new Set(hidden);
  for (const id of ids) if (allVisible) next.add(id); else next.delete(id);
  return next;
}

export const allVisible = (hidden: ReadonlySet<number>, ids: readonly number[]) => ids.every((id) => !hidden.has(id));

// How an event chip is styled. The syllabus is the focus: a chip always keeps its course's colour
// (personal events: their own colour + 📌), including on Campus Closed days (the day cell is tinted
// red instead) and when "Check date" is set (no warning icons). Completed events stay on the calendar,
// crossed through (`done`).
export type ChipVariant = 'personal' | 'course';
export function chipStyle(e: { completed?: boolean }, o: { personal: boolean }): { variant: ChipVariant; done: boolean } {
  return { variant: o.personal ? 'personal' : 'course', done: !!e.completed };
}

// localStorage round-trip that tolerates missing or corrupted values.
export function parseHidden(raw: string | null): Set<number> {
  try {
    const v = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);
  } catch {
    return new Set();
  }
}
export const serializeHidden = (hidden: ReadonlySet<number>) => JSON.stringify([...hidden].sort((a, b) => a - b));
