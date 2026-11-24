// Built-in university academic calendar (AUPP Fall 2026 - Summer 2027). Rendered on the Week/Month grids
// with a colour per category; details open in the calendar's right-hand sidebar. Dates are inclusive
// "YYYY-MM-DD". To add a colour, add it here and to AC_CLASS in app/page.tsx and the theme (globals.css,
// tailwind.config.ts).

export type AcademicColor = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';
export type AcademicTerm = 'Fall 2026' | 'Spring 2027' | 'Summer 2027';
export type AcademicEvent = { id: string; term: AcademicTerm; title: string; from: string; to: string; color: AcademicColor; description: string };

export const ACADEMIC_CATEGORIES: Record<AcademicColor, string> = {
  green: 'Term start & registration',
  orange: 'Course evaluation (EPP)',
  yellow: 'End of classes',
  red: 'Final exams',
  blue: 'Ceremony',
  gray: 'Administrative deadline',
};

export const ACADEMIC_TERMS: readonly AcademicTerm[] = ['Fall 2026', 'Spring 2027', 'Summer 2027'];

type Entry = [id: string, from: string, to: string, color: AcademicColor, title: string, description: string];
const term = (t: AcademicTerm, entries: Entry[]): AcademicEvent[] =>
  entries.map(([id, from, to, color, title, description]) => ({ id: `${t.replace(' ', '-').toLowerCase()}-${id}`, term: t, title, from, to, color, description }));

export const ACADEMIC_EVENTS: readonly AcademicEvent[] = [
  ...term('Fall 2026', [
    ['first-day', '2026-08-17', '2026-08-17', 'green', 'First day of classes', 'Fall 2026 classes begin.'],
    ['add-drop', '2026-08-21', '2026-08-21', 'green', 'Last day to ADD/DROP', 'Last day to add or drop courses for Fall 2026.'],
    ['refund-80', '2026-08-30', '2026-08-30', 'gray', 'Last day for 80% tuition refund', 'Last day to withdraw from a course with an 80% tuition refund.'],
    ['refund-40', '2026-09-13', '2026-09-13', 'gray', 'Last day for 40% tuition refund', 'Last day to withdraw from a course with a 40% tuition refund.'],
    ['withdraw', '2026-10-11', '2026-10-11', 'gray', 'Last day to WITHDRAW from courses with W grade', 'Last day to withdraw from a course; a W grade is recorded.'],
    ['eval-open', '2026-11-30', '2026-11-30', 'orange', 'Course Evaluation opens', 'End-of-term course evaluations (EPP) open.'],
    ['last-day', '2026-12-04', '2026-12-04', 'yellow', 'Last day of classes', 'Final day of regular class meetings.'],
    ['eval-close', '2026-12-06', '2026-12-06', 'orange', 'Course Evaluation closes', 'End-of-term course evaluations (EPP) close.'],
    ['finals', '2026-12-07', '2026-12-11', 'red', 'Final exam period', 'Final examinations. Check each course for its exam date and time.'],
    ['grades-due', '2026-12-15', '2026-12-15', 'gray', 'Faculty final grade submission deadline', 'Deadline for faculty to submit final grades.'],
    ['grades-posted', '2026-12-17', '2026-12-17', 'gray', 'Grades posted on transcripts', 'Final grades appear on student transcripts.'],
  ]),
  ...term('Spring 2027', [
    ['first-day', '2027-01-11', '2027-01-11', 'green', 'First day of classes', 'Spring 2027 classes begin.'],
    ['add-drop', '2027-01-15', '2027-01-15', 'green', 'Last day to ADD/DROP', 'Last day to add or drop courses for Spring 2027.'],
    ['refund-80', '2027-01-24', '2027-01-24', 'gray', 'Last day for 80% refund', 'Last day to withdraw from a course with an 80% tuition refund.'],
    ['refund-40', '2027-02-07', '2027-02-07', 'gray', 'Last day for 40% refund', 'Last day to withdraw from a course with a 40% tuition refund.'],
    ['withdraw', '2027-03-07', '2027-03-07', 'gray', 'Withdrawal deadline', 'Last day to withdraw from a course.'],
    ['eval-open', '2027-04-12', '2027-04-12', 'orange', 'Course Evaluation opens', 'End-of-term course evaluations (EPP) open.'],
    ['eval-close', '2027-04-23', '2027-04-23', 'orange', 'Course Evaluation closes', 'End-of-term course evaluations (EPP) close.'],
    ['last-day', '2027-04-30', '2027-04-30', 'yellow', 'Last day of classes', 'Final day of regular class meetings.'],
    ['finals', '2027-05-03', '2027-05-07', 'red', 'Final exam period', 'Final examinations. Check each course for its exam date and time.'],
    ['graduation', '2027-05-08', '2027-05-08', 'blue', 'AUPP Graduation Ceremony', 'AUPP Graduation Ceremony.'],
    ['grades-due', '2027-05-11', '2027-05-11', 'gray', 'Final grades due', 'Final grades are due.'],
    ['grades-posted', '2027-05-13', '2027-05-13', 'gray', 'Grades posted', 'Final grades are posted for students.'],
  ]),
  ...term('Summer 2027', [
    ['first-day', '2027-05-25', '2027-05-25', 'green', 'First day of classes', 'Summer 2027 classes begin.'],
    ['add-drop', '2027-05-28', '2027-05-28', 'green', 'Last day to ADD/DROP', 'Last day to add or drop courses for Summer 2027.'],
    ['refund-80', '2027-05-31', '2027-05-31', 'gray', 'Last day for 80% refund', 'Last day to withdraw from a course with an 80% tuition refund.'],
    ['refund-40', '2027-06-07', '2027-06-07', 'gray', 'Last day for 40% refund', 'Last day to withdraw from a course with a 40% tuition refund.'],
    ['withdraw', '2027-06-21', '2027-06-21', 'gray', 'Withdrawal deadline', 'Last day to withdraw from a course.'],
    ['eval-open', '2027-06-28', '2027-06-28', 'orange', 'Course Evaluation opens', 'End-of-term course evaluations (EPP) open.'],
    ['eval-close', '2027-07-09', '2027-07-09', 'orange', 'Course Evaluation closes', 'End-of-term course evaluations (EPP) close.'],
    ['last-day', '2027-07-16', '2027-07-16', 'yellow', 'Last day of classes', 'Final day of regular class meetings.'],
    ['finals', '2027-07-19', '2027-07-21', 'red', 'Final exam period', 'Final examinations. Check each course for its exam date and time.'],
    ['grades-due', '2027-07-23', '2027-07-23', 'gray', 'Final grades due', 'Final grades are due.'],
    ['grades-posted', '2027-07-27', '2027-07-27', 'gray', 'Grades posted', 'Final grades are posted for students.'],
  ]),
];

export const academicOn = (key: string, list: readonly AcademicEvent[] = ACADEMIC_EVENTS) =>
  list.filter((a) => key >= a.from && key <= a.to);

// The term whose academic events span `key` (first to last event), if any.
export function termOn(key: string, list: readonly AcademicEvent[] = ACADEMIC_EVENTS): AcademicTerm | undefined {
  return ACADEMIC_TERMS.find((t) => {
    const ev = list.filter((a) => a.term === t);
    return ev.length > 0 && key >= ev.reduce((m, a) => (a.from < m ? a.from : m), ev[0].from) && key <= ev.reduce((m, a) => (a.to > m ? a.to : m), ev[0].to);
  });
}
