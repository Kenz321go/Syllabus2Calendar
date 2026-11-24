'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EventItem, Scan } from '@/lib/db';
import { downloadBlob, downloadIcs, CalEvent } from '@/lib/ics';
import { draftPatch, toDraft, EventDraft } from '@/lib/edit';
import { cascadeShift, CascadeResult, Closure, closureOn, displayDate, inferClassDays, remapClassDays, undoShift } from '@/lib/closures';
import { ACADEMIC_CATEGORIES, ACADEMIC_EVENTS, ACADEMIC_TERMS, AcademicColor, AcademicEvent, academicOn, termOn } from '@/lib/academic';
import { isPersonalScan, makePersonalEvent, PERSONAL_TYPE, PersonalInput, personalScanFor, withPersonalEvent } from '@/lib/personal';
import { allVisible, chipStyle, COURSE_COLORS, CourseColor, courseColors, filterByCourse, parseHidden, serializeHidden, toggleAll, toggleCourse } from '@/lib/courseFilter';
import { courseProgress, isAssessment, overallProgress, sortTasks } from '@/lib/progress';
import { CalendarView, localDateKey, monthGrid, shiftCursor, today, viewLabel, viewRange, weekDays, withCompleted } from '@/lib/calendar';

type Job = { name: string; status: 'scanning' | 'done' | 'error'; msg?: string };
type Tab = 'scan' | 'upcoming' | 'month' | 'courses';
// A merged event plus the id of the scan (course) it is stored in, so views can edit it in place.
type MonthEvent = CalEvent & { scanId: number; personal: boolean };
const EVENT_TYPES = ['exam', 'quiz', 'assignment', 'project', 'reading', 'personal', 'other'];
const TAB_LABELS: Record<Tab, string> = { scan: 'Scan', upcoming: 'Upcoming', month: 'Calendar', courses: 'Courses' };

const midnight = () => new Date(new Date().toDateString()).getTime();
const daysUntil = (d: string) => Math.round((new Date(`${d}T00:00:00`).getTime() - midnight()) / 864e5);
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const WEEKDAYS = [{ value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' }, { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' }];
const MONTH_NAMES = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: 'long' }));
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Full class names (Tailwind only generates classes it can see literally in the source).
const AC_CLASS: Record<AcademicColor, string> = {
  green: 'bg-ac-green text-ac-green-ink', orange: 'bg-ac-orange text-ac-orange-ink', yellow: 'bg-ac-yellow text-ac-yellow-ink',
  red: 'bg-ac-red text-ac-red-ink', blue: 'bg-ac-blue text-ac-blue-ink', gray: 'bg-ac-gray text-ac-gray-ink',
};
// Solid course colours (keys from lib/courseFilter.ts): calendar chips, dots, swatches and weight bars.
const CC_SOLID: Record<CourseColor, string> = {
  red: 'bg-cc-red-solid', blue: 'bg-cc-blue-solid', green: 'bg-cc-green-solid', purple: 'bg-cc-purple-solid',
  orange: 'bg-cc-orange-solid', teal: 'bg-cc-teal-solid', amber: 'bg-cc-amber-solid', pink: 'bg-cc-pink-solid',
};
// Academic events as subtle text tags: a coloured dot + coloured text, no fill.
const AC_DOT: Record<AcademicColor, string> = {
  green: 'bg-ac-green-ink', orange: 'bg-ac-orange-ink', yellow: 'bg-ac-yellow-ink', red: 'bg-ac-red-ink', blue: 'bg-ac-blue-ink', gray: 'bg-ac-gray-ink',
};
const AC_TEXT: Record<AcademicColor, string> = {
  green: 'text-ac-green-ink', orange: 'text-ac-orange-ink', yellow: 'text-ac-yellow-ink', red: 'text-ac-red-ink', blue: 'text-ac-blue-ink', gray: 'text-ac-gray-ink',
};
const fmtRange = (from: string, to: string) => (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`);

// Minimal line icons (decorative; every icon button carries its own aria-label).
const ICONS = {
  left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', down: 'M6 9l6 6 6-6', menu: 'M4 7h16M4 12h16M4 17h16', close: 'M6 6l12 12M18 6L6 18',
  panel: 'M4 5h16v14H4zM15 5v14', upload: 'M12 15V4M7 9l5-5 5 5M5 20h14', plus: 'M12 5v14M5 12h14',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
};
function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// iOS-style on/off switch. `label` is the accessible name; the visible text sits beside it in the caller.
function Switch({ checked, onChange, label, colorClass = 'bg-accent', small = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; colorClass?: string; small?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative inline-flex ${small ? 'h-4 w-7' : 'h-5 w-9'} shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? colorClass : 'bg-line'}`}>
      <span aria-hidden="true" className={`inline-block rounded-full bg-white shadow transition-transform duration-150 ${small ? 'h-3 w-3' : 'h-4 w-4'} ${checked ? (small ? 'translate-x-[14px]' : 'translate-x-[18px]') : 'translate-x-0.5'}`} />
    </button>
  );
}

// Native <dialog> wrapper: showModal() gives the backdrop, Esc-to-close and focus containment
// without any extra library. Clicking the backdrop also closes it.
function Dialog({ onClose, labelledBy, className = 'w-[min(32rem,calc(100vw-2rem))]', children }: { onClose: () => void; labelledBy: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(ev) => { if (ev.target === ref.current) onClose(); }} aria-labelledby={labelledBy}
      className={`${className} rounded-2xl border-0 bg-surface p-0 text-inherit shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-sm`}>
      {children}
    </dialog>
  );
}

function DialogHeader({ id, title, subtitle, onClose, strike = false }: { id: string; title: string; subtitle?: string; onClose: () => void; strike?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className={`text-xl font-semibold tracking-tight ${strike ? 'line-through opacity-60' : ''}`}>{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <button type="button" className="icon-btn -mr-2 -mt-1 text-muted" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
    </div>
  );
}

// Create a personal event. Opened from "Add event" or by clicking empty space in a day cell
// (which pre-fills the date). Validation lives in lib/personal.ts.
function AddEventModal({ initialDate, onClose, onAdd }: { initialDate: string; onClose: () => void; onAdd: (input: PersonalInput) => Promise<string | undefined> }) {
  const [form, setForm] = useState<PersonalInput>({ title: '', date: initialDate, time: '', type: PERSONAL_TYPE, note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field: keyof PersonalInput) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [field]: ev.target.value }));
  const closed = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? closureOn(form.date) : undefined;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    try {
      const err = await onAdd(form);
      if (err) { setError(err); setBusy(false); } else onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog onClose={onClose} labelledBy="add-event-title">
      <form onSubmit={submit} className="grid gap-4 p-6">
        <DialogHeader id="add-event-title" title="New personal event" subtitle="Saved on this device under “My Personal Tasks”." onClose={onClose} />
        <label className="label">Title<input required autoFocus maxLength={300} value={form.title} onChange={set('title')} className="field" placeholder="e.g. Study group" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="label">Date<input required type="date" value={form.date} onChange={set('date')} className="field" /></label>
          <label className="label">Time<input type="time" value={form.time} onChange={set('time')} className="field" /></label>
          <label className="label">Type
            <select value={form.type} onChange={set('type')} className="field capitalize">{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
        </div>
        <label className="label">Note (optional)<textarea rows={3} maxLength={2000} value={form.note} onChange={set('note')} className="field py-2" /></label>
        {closed && <p className="rounded-xl bg-closedbg px-3 py-2 text-sm text-closedink">{fmt(form.date)} is a Campus Closed day ({closed.name}).</p>}
        {error && <p role="alert" className="rounded-xl bg-warnbg px-3 py-2 text-sm text-warnink">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>Add event</button>
        </div>
      </form>
    </Dialog>
  );
}

// Small popup for a Campus Closed day.
function ClosureModal({ closure, date, onClose, onAddEvent }: { closure: Closure; date: string; onClose: () => void; onAddEvent: () => void }) {
  return (
    <Dialog onClose={onClose} labelledBy="closure-title" className="w-[min(24rem,calc(100vw-2rem))]">
      <div className="grid gap-3 p-6">
        <span className="chip justify-self-start bg-closedbg font-semibold text-closedink">Campus closed</span>
        <DialogHeader id="closure-title" title={closure.name} subtitle={`${fmt(date)}${closure.from !== closure.to ? ` · closed ${fmtRange(closure.from, closure.to)}` : ''}`} onClose={onClose} />
        <p className="text-sm text-muted">No classes are held. Sessions on this day can be shifted from their details.</p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn" onClick={onAddEvent}>Add event on this day</button>
        </div>
      </div>
    </Dialog>
  );
}

// One line in the Upcoming list. Clicking it opens the same details modal as the calendar.
function Row({ e, dot, dateLabel, onOpen }: { e: MonthEvent; dot: string; dateLabel: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen}
        className={`flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none ${e.completed ? 'opacity-50' : ''}`}>
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${e.completed ? 'line-through' : ''}`}>{e.title}</span>
          <span className="block truncate text-sm text-muted">{e.personal ? 'Personal' : e.course.split(':')[0]}{e.weight != null ? ` · ${e.weight}% of grade` : ''}</span>
        </span>
        {e.needsReview && !e.completed && <span className="shrink-0 text-xs font-medium text-warnink">Check date</span>}
        <span className="shrink-0 text-right text-sm tabular-nums text-muted">{dateLabel}</span>
      </button>
    </li>
  );
}

// Multi-select course filter shown as a compact dropdown (Upcoming tab). Shares its hidden set with the calendar.
function CourseFilterMenu({ scans, hidden, colorOf, onChange }: { scans: Scan[]; hidden: Set<number>; colorOf: Map<number, CourseColor>; onChange: (next: Set<number>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const ids = scans.map((s) => s.id!);
  const shown = ids.filter((id) => !hidden.has(id)).length;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} disabled={!scans.length}>
        {shown === ids.length ? 'All courses' : `${shown} of ${ids.length} courses`}
        <Icon name="down" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 grid w-72 gap-1 rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-line">
          <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-medium text-accent hover:bg-fill" onClick={() => onChange(toggleAll(hidden, ids))}>
            {allVisible(hidden, ids) ? 'Hide all' : 'Show all'}
          </button>
          {scans.map((s) => (
            <label key={s.id} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-fill">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!hidden.has(s.id!)} onChange={(e) => onChange(toggleCourse(hidden, s.id!, e.target.checked))} />
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${CC_SOLID[colorOf.get(s.id!) ?? 'blue']}`} />
              <span className="min-w-0 flex-1 truncate" title={s.course}>{s.course}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Event chip used by every calendar view: a solid block in its course's colour (chosen in the course filter),
// even on a Campus Closed day, with no icons. Completed events stay on the calendar, crossed through.
// Fixed height, so cells never resize. (Style rules: chipStyle() in lib/courseFilter.ts. Notes such as
// "check date" stay in the tooltip.)
function EventChip({ e, onOpen, label, personal = false, colorClass = 'bg-accent' }: { e: CalEvent; onOpen: () => void; label?: string; personal?: boolean; colorClass?: string }) {
  const closed = e.date ? closureOn(e.date) : undefined;
  const { done } = chipStyle(e, { personal });
  const notes = [personal ? 'personal' : e.course, e.completed && 'completed', e.needsReview && !e.completed && 'check date', closed && `Campus Closed: ${closed.name}`].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} title={`${e.title} (${notes})`}
      className={`flex h-6 w-full min-w-0 shrink-0 items-center rounded-md px-2 text-left text-xs font-medium leading-none text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${colorClass} ${done ? 'line-through opacity-50' : ''}`}>
      {personal && <span className="sr-only">Personal: </span>}
      <span className="min-w-0 flex-1 truncate">{label ?? e.title}</span>
      {done && <span className="sr-only">(completed)</span>}
    </button>
  );
}

// Day number in the Week/Month grids; today's date gets a filled circle.
function DayNumber({ date, isToday, outside = false }: { date: Date; isToday: boolean; outside?: boolean }) {
  return (
    <span aria-current={isToday ? 'date' : undefined}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${isToday ? 'bg-accent text-onaccent' : outside ? 'text-muted' : 'text-ink'}`}>
      {date.getDate()}
    </span>
  );
}

const ROW_GRID = 'md:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto]';

// Editable event row. Typing only updates local state; the change is saved to IndexedDB on blur
// (or Enter), so fast typing never races with database writes.
function EventRow({ e, onSave, onDelete, onToggleCompleted }: { e: EventItem; onSave: (patch: Partial<EventItem>) => void; onDelete: () => void; onToggleCompleted: (completed: boolean) => void }) {
  const [draft, setDraft] = useState<EventDraft>(() => toDraft(e));
  // Resync only when this event's stored values change. useLiveQuery returns new objects after every
  // write, so depending on `e` itself would wipe an in-progress edit whenever another row saves.
  useEffect(() => { setDraft(toDraft(e)); }, [e.title, e.type, e.date, e.time, e.weight]);
  const edit = (field: keyof EventDraft) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [field]: ev.target.value }));
  // Brief "Saved" confirmation after an edit is written (e.g. fixing a date the scan got wrong).
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1500); return () => clearTimeout(t); }, [saved]);
  const commit = (next: EventDraft = draft) => {
    const patch = draftPatch(next, e);
    if (Object.keys(patch).length) { onSave(patch); setSaved(true); }
    else setDraft(toDraft(e)); // revert invalid input such as a blank title
  };
  const enterSaves = (ev: React.KeyboardEvent<HTMLInputElement>) => { if (ev.key === 'Enter') ev.currentTarget.blur(); };
  // Inline, spreadsheet-like inputs: invisible until hovered or focused.
  const input = 'h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors hover:bg-fill focus:border-accent focus:bg-surface';
  const field = { onBlur: () => commit(), onKeyDown: enterSaves, className: input };
  return (
    <li className={`grid items-center gap-1 py-1.5 ${ROW_GRID} ${e.completed ? 'opacity-60' : ''}`}>
      {/* Completion is a single click, so it saves immediately (and leaves "Check date" alone). */}
      <label className="flex h-9 items-center gap-2 px-1 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!e.completed} onChange={(ev) => onToggleCompleted(ev.target.checked)} aria-label={`Mark "${e.title}" as completed`} />
        <span className="text-muted md:sr-only">Done</span>
      </label>
      <input aria-label="Task title" value={draft.title} onChange={edit('title')} {...field} className={`${input} font-medium ${e.completed ? 'line-through' : ''}`} />
      {/* A select change is a single deliberate action, so it saves immediately. */}
      <select aria-label="Task type" value={draft.type} onChange={(ev) => { const next = { ...draft, type: ev.target.value }; setDraft(next); commit(next); }} className={`${input} capitalize text-muted`}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      {/* Fix a wrong scanned date here: change it, then click away or press Enter. Saving clears "Check date". */}
      <label className="relative block">
        <span className="sr-only">Date</span>
        <input aria-label="Task date" type="date" value={draft.date} onChange={edit('date')} {...field}
          className={`${input} ${e.needsReview && !e.completed ? 'bg-warnbg text-warnink' : ''}`} title={e.needsReview ? 'Check this date against the syllabus' : undefined} />
      </label>
      <input aria-label="Task time" type="time" value={draft.time} onChange={edit('time')} {...field} />
      <input aria-label="Grade weight %" type="number" min="0" max="100" value={draft.weight} onChange={edit('weight')} placeholder="—" {...field} />
      <div className="flex h-9 items-center justify-end gap-1">
        {/* Fixed-width status slot so the row never shifts. */}
        <span className="w-16 text-right text-xs" aria-live="polite">
          {saved ? <span className="text-okink">Saved</span> : e.needsReview && !e.completed ? <span className="text-warnink">Check date</span> : null}
        </span>
        <button className="h-9 rounded-md px-2 text-sm text-muted transition-colors hover:bg-closedbg hover:text-closedink" onClick={onDelete} aria-label={`Delete "${e.title}"`}>Delete</button>
      </div>
    </li>
  );
}

// Change a course's class days (e.g. Tue/Thu -> Mon/Wed). Applying moves every session to the matching new
// day of the same week (Day 1 -> Day 1, Day 2 -> Day 2); the calendar follows. Changing back restores it.
function ClassDaysEditor({ current, inferred, events, onApply }: { current: number[]; inferred: boolean; events: EventItem[]; onApply: (days: number[]) => Promise<number> }) {
  const [d1, setD1] = useState(String(current[0] ?? ''));
  const [d2, setD2] = useState(String(current[1] ?? ''));
  const [note, setNote] = useState('');
  useEffect(() => { setD1(String(current[0] ?? '')); setD2(String(current[1] ?? '')); }, [current.join(',')]);
  const next = [Number(d1), Number(d2)].filter(Boolean);
  const valid = next.length === 2 && next[0] < next[1];
  const changed = valid && next.join(',') !== current.join(',');
  const preview = changed ? remapClassDays(events, current, next).moved : 0;
  const name = (d: number) => DAY_SHORT[d] ?? '?';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-fill px-4 py-3 text-sm">
      <span>
        <span className="font-medium">Class days</span>
        <span className="ml-2 text-muted">{current.length ? current.map(name).join(' & ') : 'unknown'}{inferred ? ' (guessed)' : ''}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <select aria-label="Day 1" value={d1} onChange={(e) => { setD1(e.target.value); setNote(''); if (Number(d2) <= Number(e.target.value)) setD2(''); }} className="h-8 rounded-md bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent">
          <option value="" disabled>Day 1</option>
          {WEEKDAYS.slice(0, 4).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <select aria-label="Day 2" value={d2} disabled={!d1} onChange={(e) => { setD2(e.target.value); setNote(''); }} className="h-8 rounded-md bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent disabled:opacity-50">
          <option value="" disabled>Day 2</option>
          {WEEKDAYS.filter((d) => Number(d.value) > Number(d1)).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <button className="btn-primary min-h-[32px] px-3" disabled={!changed}
          onClick={async () => { const moved = await onApply(next); setNote(`Done: ${plural(moved, 'session')} moved to ${next.map(name).join(' & ')}.`); }}>
          Apply
        </button>
      </span>
      <span className="min-w-0 text-xs text-muted" aria-live="polite">
        {note || (changed ? `${current.map((d, i) => `${name(d)} → ${name(next[i])}`).join(', ')} · moves ${plural(preview, 'session')}` : '')}
      </span>
    </div>
  );
}

// Event details + edit form, plus Cascade Shift controls for events on Campus Closed days.
function EventModal({ e, personal = false, classDays, daysGuessed = false, preview, undoLabel, onClose, onSave, onDelete, onToggleCompleted, onShift, onUndo }: {
  e: CalEvent; personal?: boolean; classDays: number[]; daysGuessed?: boolean; undoLabel?: string; onClose: () => void;
  // Where each shift would put this event (dry run), shown on the buttons before clicking.
  preview?: { forward?: string; backward?: string; backwardBlockedBy?: string };
  onSave: (patch: Partial<EventItem>) => Promise<unknown>; onDelete: () => Promise<unknown>;
  onToggleCompleted: (completed: boolean) => Promise<unknown>; onShift: (dir: 1 | -1) => Promise<CascadeResult | undefined>; onUndo: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<EventDraft>(() => toDraft(e));
  // Personal events keep their note in `source`; it is editable for them (syllabus sources are not).
  const [note, setNote] = useState(e.source);
  const [busy, setBusy] = useState(false);
  const [shiftNote, setShiftNote] = useState<{ ok: boolean; text: string } | null>(null);
  const closed = e.date ? closureOn(e.date) : undefined;
  // The edit form is a draft; keep its date in step when a shift changes the stored date.
  useEffect(() => { setDraft((d) => ({ ...d, date: e.date ?? '' })); }, [e.date]);
  const shift = async (dir: 1 | -1) => {
    setBusy(true);
    try {
      const r = await onShift(dir);
      if (!r) return;
      if (r.blocked) setShiftNote({ ok: false, text: `Not shifted: moving back would land on or before the earlier session "${r.blocked.title}" (${fmt(r.blocked.date)}).` });
      else if (!r.changes.length) setShiftNote({ ok: false, text: 'Nothing to shift.' });
      else {
        const mine = r.changes.find((c) => c.id === e.id);
        const others = r.changes.length - (mine ? 1 : 0);
        setShiftNote({ ok: true, text: `Moved to ${mine ? fmt(mine.to) : 'a new date'}${others ? `; ${others} later ${others === 1 ? 'task' : 'tasks'} of this course moved with it` : ''}.` });
      }
    } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true);
    try { await onUndo(); setShiftNote({ ok: true, text: 'Last shift undone.' }); } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  };
  const edit = (field: keyof EventDraft) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [field]: ev.target.value }));
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); onClose(); } catch (err) { alert((err as Error).message); setBusy(false); }
  };
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    const patch = draftPatch(draft, e);
    if (personal && note.trim() !== e.source) patch.source = note.trim().slice(0, 2000);
    if (Object.keys(patch).length) run(() => onSave(patch));
    else onClose();
  };
  return (
    <Dialog onClose={onClose} labelledBy="event-modal-title">
      <div className="grid gap-5 p-6">
        <div className="grid gap-1">
          <DialogHeader id="event-modal-title" title={e.title} subtitle={personal ? 'Personal event' : e.course} onClose={onClose} strike={!!e.completed} />
          {/* The days a shift moves between, always visible for courses. */}
          {!personal && (
            <p className="text-sm">
              <span className="text-muted">Class Days: </span>
              <span className="font-medium">{classDays.length ? classDays.map((d) => DAY_SHORT[d]).join(' & ') : 'Not set'}</span>
              {daysGuessed && <span className="text-muted"> (guessed)</span>}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">Date</dt><dd>{e.date ? fmt(e.date) : 'No date'}{e.time ? `, ${e.time}` : ''}{e.needsReview && <span className="chip ml-2 bg-warnbg text-warnink">Check date</span>}</dd>
          <dt className="text-muted">Type</dt><dd className="capitalize">{e.type}</dd>
          {e.weight != null && <><dt className="text-muted">Weight</dt><dd>{e.weight}% of grade</dd></>}
          <dt className="text-muted">{personal ? 'Note' : 'Source'}</dt><dd className="whitespace-pre-wrap break-words">{e.source || 'None'}</dd>
        </dl>
        {closed && (
          <div role="alert" className="grid gap-2 rounded-xl bg-closedbg p-4 text-sm text-closedink">
            <p><b>This event falls on a Campus Closed day</b> ({closed.name}).</p>
            <p>Shifting moves this session to the next class day that isn’t closed (weekends and closures are skipped), and every later session of this course slides one class meeting with it, so nothing is overwritten. Later tasks on other days (e.g. a Friday deadline) move one week.</p>
            {/* With fewer than two known class days the next class day is a week away, so say so plainly. */}
            {(classDays.length < 2 || daysGuessed) && (
              <p className="rounded-lg bg-surface p-2 text-ink">
                {classDays.length < 2 ? 'Only one class day is known for this course, so a shift moves a whole week. ' : 'These days are a guess. '}
                Set the real class days (e.g. Tue &amp; Thu) under <b>Courses → this course → Class days</b>, then shift.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className="btn bg-surface" disabled={busy || !!preview?.backwardBlockedBy} onClick={() => shift(-1)}
                title={preview?.backwardBlockedBy ? `Blocked: the previous class day already has "${preview.backwardBlockedBy}"` : undefined}>
                ← Shift Backward{preview?.backward ? ` to ${fmt(preview.backward)}` : ''}
              </button>
              {/* The label is the dry-run result, so it names exactly the date the class will land on. */}
              <button type="button" className="btn-primary" disabled={busy} onClick={() => shift(1)}>
                {preview?.forward ? `Shift Forward to ${fmt(preview.forward)} →` : 'Shift Forward →'}
              </button>
            </div>
          </div>
        )}
        {shiftNote && <p role="status" className={`rounded-xl px-4 py-3 text-sm ${shiftNote.ok ? 'bg-okbg text-okink' : 'bg-warnbg text-warnink'}`}>{shiftNote.text}</p>}
        {undoLabel && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fill px-4 py-2 text-sm">
            <span className="text-muted">Last shift in this course: {undoLabel}</span>
            <button type="button" className="btn-ghost min-h-[32px]" disabled={busy} onClick={undo}>Undo last shift</button>
          </div>
        )}
        {/* Saves immediately; the modal stays open and reflects the stored value. */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl bg-fill px-4 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!e.completed}
            onChange={(ev) => onToggleCompleted(ev.target.checked).catch((err) => alert((err as Error).message))} />
          Completed
        </label>
        <form onSubmit={save} className="grid gap-3 border-t border-line pt-5">
          <h3 className="eyebrow">Edit</h3>
          <label className="label">Title<input required value={draft.title} onChange={edit('title')} className="field" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label">Type
              <select value={draft.type} onChange={edit('type')} className="field capitalize">{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label className="label">Weight %<input type="number" min="0" max="100" step="any" value={draft.weight} onChange={edit('weight')} className="field" /></label>
            <label className="label">Date<input type="date" value={draft.date} onChange={edit('date')} className="field" /></label>
            <label className="label">Time<input type="time" value={draft.time} onChange={edit('time')} className="field" /></label>
          </div>
          {personal && <label className="label">Note<textarea rows={3} maxLength={2000} value={note} onChange={(ev) => setNote(ev.target.value)} className="field py-2" /></label>}
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <button type="button" className="btn-ghost text-closedink hover:bg-closedbg" disabled={busy} onClick={() => run(onDelete)}>Delete event</button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>Save</button>
            </div>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('scan');
  const [auto, setAuto] = useState(true);
  const [dark, setDark] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [newSemesterName, setNewSemesterName] = useState('');
  const [newSemesterStart, setNewSemesterStart] = useState('');
  const [semesterStartDraft, setSemesterStartDraft] = useState('');
  // Calendar: which view is shown, and a date inside the period being shown.
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState<Date>(() => today());
  // Completed events always stay on the calendar (crossed through), so there is no hide-completed filter.
  // Clear the old setting so it can't hide anything.
  useEffect(() => { localStorage.removeItem('syllabus2cal-show-completed'); }, []);
  // Right-hand details sidebar (remembered on this device) and what it shows.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => { setSidebarOpen(localStorage.getItem('syllabus2cal-sidebar') !== 'false'); }, []);
  const toggleSidebar = (v: boolean) => { setSidebarOpen(v); localStorage.setItem('syllabus2cal-sidebar', String(v)); };
  // Left course-filter sidebar (open/closed) and which courses are hidden, both remembered on this device.
  const [filterOpen, setFilterOpen] = useState(true);
  const [hiddenCourses, setHiddenCourses] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setFilterOpen(localStorage.getItem('syllabus2cal-filter') !== 'false');
    setHiddenCourses(parseHidden(localStorage.getItem('syllabus2cal-hidden-courses')));
  }, []);
  const toggleFilter = (v: boolean) => { setFilterOpen(v); localStorage.setItem('syllabus2cal-filter', String(v)); };
  const saveHidden = (next: Set<number>) => { setHiddenCourses(next); localStorage.setItem('syllabus2cal-hidden-courses', serializeHidden(next)); };
  // Courses tab: which course cards are open (remembered on this device; same id-set format as the filter).
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(() => new Set());
  useEffect(() => { setExpandedCourses(parseHidden(localStorage.getItem('syllabus2cal-expanded-courses'))); }, []);
  const saveExpanded = (next: Set<number>) => { setExpandedCourses(next); localStorage.setItem('syllabus2cal-expanded-courses', serializeHidden(next)); };
  // Open or close one course card; the others keep their state. (Not toggleCourse: that helper's flag means
  // "visible = remove from the hidden set", the opposite of what an expanded set needs.)
  const toggleExpanded = (id: number) => {
    const next = new Set(expandedCourses);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveExpanded(next);
  };
  // Course whose colour picker is open in the calendar's course filter. The chosen colour is saved on the scan.
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const setCourseColor = (id: number, color: CourseColor) => db.scans.update(id, { color });
  // Calendar "Shifts" toggle: on (default) shows dates after Cascade Shifts; off shows each event's original date.
  const [showShifts, setShowShifts] = useState(true);
  useEffect(() => { setShowShifts(localStorage.getItem('syllabus2cal-show-shifts') !== 'false'); }, []);
  const toggleShifts = (v: boolean) => { setShowShifts(v); localStorage.setItem('syllabus2cal-show-shifts', String(v)); };
  // Academic dates (holidays, exam periods...) drawn on the calendar grid: their own switch, independent of
  // the Details sidebar, remembered on this device.
  const [showAcademicTags, setShowAcademicTags] = useState(true);
  useEffect(() => { setShowAcademicTags(localStorage.getItem('syllabus2cal-show-academic') !== 'false'); }, []);
  const toggleAcademicTags = (v: boolean) => { setShowAcademicTags(v); localStorage.setItem('syllabus2cal-show-academic', String(v)); };
  const [selectedAcademic, setSelectedAcademic] = useState<AcademicEvent | null>(null);
  const showAcademic = (a: AcademicEvent) => { setSelectedAcademic(a); toggleSidebar(true); };
  // Campus Closed day open in its own popup.
  const [selectedClosure, setSelectedClosure] = useState<{ closure: Closure; date: string } | null>(null);
  // Add Event modal: the date to pre-fill, or null when closed.
  const [addDate, setAddDate] = useState<string | null>(null);
  // Class meeting days (Mon=1 ... Fri=5). Deliberately blank until the user picks both.
  const [day1, setDay1] = useState('');
  const [day2, setDay2] = useState('');
  const daysChosen = day1 !== '' && day2 !== '' && Number(day1) < Number(day2);

  const semesters = useLiveQuery(async () => {
    const list = await db.semesters.toArray();
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, []) ?? [];
  const [semesterName, setSemesterName] = useState('');

  useEffect(() => {
    (async () => {
      if (await db.semesters.count() === 0) {
        const name = 'Fall 2026';
        await db.semesters.add({ name, startDate: '2026-08-31', createdAt: Date.now() });
        setSemesterName(name);
        localStorage.setItem('syllabus2cal-semester', name);
      } else {
        const saved = localStorage.getItem('syllabus2cal-semester');
        const all = await db.semesters.toArray();
        setSemesterName(saved && all.some((s) => s.name === saved) ? saved : all[0].name);
      }
    })();
  }, []);

  const semester = semesters.find((s) => s.name === semesterName) ?? semesters[0];
  const start = semester?.startDate ?? '';
  useEffect(() => { setSemesterStartDraft(start); }, [semester?.id, start]);
  const scans = useLiveQuery(
    async (): Promise<Scan[]> => semesterName ? db.scans.where('semester').equals(semesterName).toArray() : [],
    [semesterName],
  ) ?? [];
  const merged = scans.filter((s) => s.merged);
  const pending = scans.filter((s) => !s.merged);
  // Syllabus courses only (the personal-events scan is not a course).
  const courses = merged.filter((s) => !isPersonalScan(s));
  const undated = merged.flatMap((s) => s.events.map((e) => ({ ...e, course: s.course }))).filter((e) => !e.date);
  const all: MonthEvent[] = useMemo(() => merged.flatMap((s) => s.events.map((e) => ({ ...e, course: s.course, scanId: s.id!, personal: isPersonalScan(s) }))).filter((e) => e.date).sort((a, b) => a.date!.localeCompare(b.date!)), [merged]);
  // Event open in the details modal. Looked up from the live scans so it reflects saved edits.
  const [selected, setSelected] = useState<{ scanId: number; eventId: string } | null>(null);
  const selectedScan = selected ? scans.find((s) => s.id === selected.scanId) : undefined;
  const selectedItem = selectedScan?.events.find((e) => e.id === selected?.eventId);
  const selectedEvent: CalEvent | undefined = selectedScan && selectedItem ? { ...selectedItem, course: selectedScan.course } : undefined;
  const upcoming = all.filter((e) => daysUntil(e.date!) >= 0);
  const review = merged.flatMap((s) => s.events).filter((e) => e.needsReview).length;

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const selectSemester = (name: string) => {
    setSemesterName(name);
    setPicked([]);
    localStorage.setItem('syllabus2cal-semester', name);
  };

  const onDrop = useCallback((files: File[]) => {
    if (!semesterName || !start) {
      setJobs((j) => [...j, { name: 'Semester', status: 'error', msg: 'Create a semester first' }]);
      return;
    }
    if (!daysChosen) {
      setJobs((j) => [...j.filter((x) => x.name !== 'Class days'), { name: 'Class days', status: 'error', msg: 'Choose Day 1 and Day 2 first' }]);
      return;
    }
    setJobs((j) => j.filter((x) => x.name !== 'Class days'));
    files.forEach(async (f) => {
      const set = (p: Partial<Job>) => setJobs((j) => j.map((x) => (x.name === f.name ? { ...x, ...p } : x)));
      setJobs((j) => [...j.filter((x) => x.name !== f.name), { name: f.name, status: 'scanning' }]);
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('start', start);
        fd.append('day1', day1);
        fd.append('day2', day2);
        const res = await fetch('/api/extract', { method: 'POST', body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Scan failed (HTTP ${res.status}). Please try again.`);
        if (!data || !Array.isArray(data.events)) throw new Error('The server returned an unreadable response. Please try again.');
        await db.scans.add({ course: data.course, fileName: f.name, semester: semesterName, merged: auto, events: data.events, classDays: [Number(day1), Number(day2)], createdAt: Date.now() });
        set({ status: 'done' });
      } catch (e) { set({ status: 'error', msg: (e as Error).message }); }
    });
  }, [start, auto, semesterName, daysChosen, day1, day2]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 8, maxSize: 10 * 1024 * 1024, disabled: !daysChosen });

  const mergePicked = () => db.scans.where('id').anyOf(picked).modify({ merged: true }).then(() => setPicked([]));

  // Read the latest stored events inside a transaction (not the render-time snapshot), so
  // back-to-back saves to different events in the same course can't overwrite each other.
  const updateEvent = (id: number, eventId: string, patch: Partial<EventItem>) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (scan) await db.scans.update(id, { events: scan.events.map((e) => {
        if (e.id !== eventId) return e;
        // A date typed by hand (e.g. fixing a wrong scan) becomes the new original date, so "Shifts off" shows it too.
        const { originalDate, ...rest } = e;
        return { ...('date' in patch ? rest : e), ...patch, needsReview: false };
      }) });
    });

  // Separate from updateEvent on purpose: ticking an event done must not clear its "Check date" flag.
  const setEventCompleted = (id: number, eventId: string, completed: boolean) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (scan) await db.scans.update(id, { events: withCompleted(scan.events, eventId, completed) });
    });

  // A course's class weekdays: stored at scan time; inferred from its events for older scans.
  const classDaysFor = (scan: Scan) => (scan.classDays?.length ? scan.classDays : inferClassDays(scan.events));

  // Manual Cascade Shift (see lib/closures.ts). One transaction, so the course's events move together.
  // The dates before the shift are saved on the scan so "Undo last shift" can restore them exactly.
  const shiftEvent = (id: number, eventId: string, dir: 1 | -1) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (!scan) return undefined;
      const result = cascadeShift(scan.events, eventId, dir, classDaysFor(scan));
      if (result.changes.length) {
        const title = scan.events.find((e) => e.id === eventId)?.title ?? 'event';
        const label = `"${title}" ${dir === 1 ? 'forward' : 'backward'} (${result.changes.length} moved)`;
        const previous = Object.fromEntries(result.changes.map((c) => [c.id, c.from]));
        await db.scans.update(id, { events: result.events, lastShift: { at: Date.now(), label, previous } });
      }
      return result;
    });

  const undoLastShift = (id: number) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (scan?.lastShift) await db.scans.update(id, { events: undoShift(scan.events, scan.lastShift.previous), lastShift: undefined });
    });


  // Change a course's class days and move its sessions to match (see remapClassDays). The saved shift
  // snapshot is dropped, since its dates belong to the old days. Returns how many sessions moved.
  const applyClassDays = (id: number, days: number[]) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (!scan) return 0;
      const r = remapClassDays(scan.events, classDaysFor(scan), days);
      await db.scans.update(id, { events: r.events, classDays: days, lastShift: undefined });
      return r.moved;
    });

  // Add a personal event to this semester's "My Personal Tasks" scan, creating it on first use.
  // Returns a validation message, or undefined on success.
  const addPersonalEvent = async (input: PersonalInput) => {
    if (!semesterName) return 'Create a semester first.';
    const made = makePersonalEvent(input, crypto.randomUUID());
    if ('error' in made) return made.error;
    await db.transaction('rw', db.scans, async () => {
      const existing = personalScanFor(await db.scans.where('semester').equals(semesterName).toArray(), semesterName);
      const next = withPersonalEvent(existing, made.event, semesterName);
      if (existing?.id != null) await db.scans.update(existing.id, { events: next.events });
      else await db.scans.add(next);
    });
    return undefined;
  };

  const deleteEvent = (id: number, eventId: string) =>
    db.transaction('rw', db.scans, async () => {
      const scan = await db.scans.get(id);
      if (scan) await db.scans.update(id, { events: scan.events.filter((e) => e.id !== eventId) });
    });

  const addSemester = async () => {
    if (!newSemesterName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(newSemesterStart)) return;
    await db.semesters.add({ name: newSemesterName.trim(), startDate: newSemesterStart, createdAt: Date.now() });
    selectSemester(newSemesterName.trim());
    setNewSemesterName('');
    setNewSemesterStart('');
  };

  const saveSemesterStart = async () => {
    if (!semester?.id || !/^\d{4}-\d{2}-\d{2}$/.test(semesterStartDraft) || Number.isNaN(Date.parse(`${semesterStartDraft}T00:00:00Z`))) return;
    await db.semesters.update(semester.id, { startDate: semesterStartDraft });
  };

  const exportBackup = async () => {
    const data = { version: 2, exportedAt: new Date().toISOString(), semesters: await db.semesters.toArray(), scans: await db.scans.toArray() };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `syllabus2cal-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importBackup = async (file: File) => {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.semesters) || !Array.isArray(data.scans)) throw new Error('Invalid backup file');
    await db.transaction('rw', db.semesters, db.scans, async () => {
      await db.semesters.clear();
      await db.scans.clear();
      await db.semesters.bulkAdd(data.semesters);
      await db.scans.bulkAdd(data.scans);
    });
  };

  // ---- Shared course colours + filter ----
  const todayKey = localDateKey(today());
  const filterList = [...courses, ...merged.filter(isPersonalScan)]; // courses, then "My Personal Tasks"
  const colorOf = courseColors(filterList);
  const solidOf = (scanId: number) => CC_SOLID[colorOf.get(scanId) ?? 'blue'];
  const filterIds = filterList.map((s) => s.id!);

  // ---- Upcoming ----
  const upcomingVisible = filterByCourse(upcoming, hiddenCourses);
  const upcomingGroups: [string, MonthEvent[]][] = [
    ['Today', upcomingVisible.filter((e) => daysUntil(e.date!) === 0)],
    ['Tomorrow', upcomingVisible.filter((e) => daysUntil(e.date!) === 1)],
    ['This week', upcomingVisible.filter((e) => { const d = daysUntil(e.date!); return d >= 2 && d <= 7; })],
    ['Later', upcomingVisible.filter((e) => daysUntil(e.date!) > 7)],
  ];
  const dueThisWeek = upcomingVisible.filter((e) => !e.completed && daysUntil(e.date!) <= 7).length;
  const busyDays = Object.entries(upcomingVisible.reduce<Record<string, number>>((m, e) => ({ ...m, [e.date!]: (m[e.date!] ?? 0) + 1 }), {})).filter(([, n]) => n >= 3);

  // ---- Calendar (Week / Month / Year) ----
  // "Shifts" toggle: off shows every event on its original (pre-shift) date, ignoring Campus Closed shifts.
  const calendarAll: MonthEvent[] = showShifts ? all
    : all.map((e) => ({ ...e, date: displayDate(e, false) })).sort((a, b) => a.date!.localeCompare(b.date!));
  const courseVisible = filterByCourse(calendarAll, hiddenCourses);
  const hiddenByFilter = all.length - courseVisible.length;
  const calendarEvents = courseVisible; // completed events stay visible
  const [rangeFrom, rangeTo] = viewRange(cursor, view);
  const eventsInView = calendarEvents.filter((e) => e.date! >= rangeFrom && e.date! <= rangeTo);
  const eventsOn = (date: Date) => calendarEvents.filter((e) => e.date === localDateKey(date));
  const nextEventDate = calendarEvents.find((e) => e.date! >= todayKey)?.date ?? calendarEvents[0]?.date;
  const jumpToNextEvent = () => { if (nextEventDate) setCursor(new Date(`${nextEventDate}T00:00:00`)); };
  const openEvent = (e: MonthEvent) => setSelected({ scanId: e.scanId, eventId: e.id });
  const periodName = view === 'year' ? String(cursor.getFullYear()) : viewLabel(cursor, view);
  // Day cell for the Week and Month grids. Every cell has a FIXED height, so the grid never resizes as you
  // navigate or as events change: Month cells show as many chips as fit (then "+N more"), Week cells scroll.
  const dayCell = (date: Date, mode: 'week' | 'month', outside = false) => {
    const events = eventsOn(date);
    const isToday = localDateKey(date) === todayKey;
    const key = localDateKey(date);
    const closure = closureOn(key);
    // Academic tags only while their switch is on; Month shows at most 2 to keep the cell's layout fixed.
    const academic = showAcademicTags ? academicOn(key) : [];
    const tags = mode === 'month' ? academic.slice(0, 2) : academic;
    const slots = mode === 'week' ? Infinity : tags.length ? 2 : 3; // chip rows that fit in a Month cell
    const shown = events.length > slots ? events.slice(0, slots - 1) : events;
    const openClosure = () => closure && setSelectedClosure({ closure, date: key });
    return (
      // Clicking empty space in a cell (anything that isn't a button) opens Add Event for that date;
      // on a Campus Closed day it opens the closure popup instead, which has its own "Add event" button.
      // The "+" and "Closed" buttons are the keyboard-accessible equivalents.
      <div key={key} onClick={(ev) => { if ((ev.target as HTMLElement).closest('button')) return; if (closure) openClosure(); else setAddDate(key); }}
        // Campus Closed: a light red fill only, never dimmed, even outside the month.
        className={`group flex cursor-pointer flex-col overflow-hidden border-b border-r border-line p-1.5 transition-colors duration-150 ${mode === 'week' ? 'h-[440px]' : 'h-[128px]'} ${
          closure ? 'bg-closedbg' : outside ? 'bg-bg hover:bg-fill' : 'hover:bg-fill'}`}>
        <div className="flex h-7 shrink-0 items-center justify-between gap-1">
          <DayNumber date={date} isToday={isToday} outside={outside} />
          <span className="flex items-center gap-1">
            {closure && (
              <button type="button" onClick={openClosure} title={`Campus closed: ${closure.name}`} aria-label={`Campus closed: ${closure.name}. Show details`}
                className="px-1 text-[10px] font-semibold uppercase tracking-wide text-closedink hover:underline">Closed</button>
            )}
            <button type="button" onClick={() => setAddDate(key)} aria-label={`Add event on ${fmt(key)}`} title="Add event"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted opacity-0 hover:bg-surface hover:text-accent focus-visible:opacity-100 group-hover:opacity-100">
              <Icon name="plus" className="h-4 w-4" />
            </button>
          </span>
        </div>
        {closure && mode === 'week' && <p className="mt-1 shrink-0 truncate text-xs text-closedink">{closure.name}</p>}
        {/* Academic events are a subtle layer: small text tags (dot + text, no fill) so course sessions stay
            the focus; hidden entirely when the "Academic dates" switch is off. */}
        {tags.length > 0 && (
          <div className="mt-0.5 grid shrink-0 gap-0.5">
            {tags.map((a) => (
              <button key={a.id} type="button" onClick={() => showAcademic(a)} title={`${a.title} (${ACADEMIC_CATEGORIES[a.color]})`}
                className={`flex h-3.5 w-full min-w-0 items-center gap-1 rounded px-0.5 text-left text-[11px] leading-none hover:underline ${AC_TEXT[a.color]} ${selectedAcademic?.id === a.id ? 'bg-soft' : ''}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${AC_DOT[a.color]}`} />
                <span className="truncate">{a.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`mt-1 flex min-h-0 flex-1 flex-col gap-1 ${mode === 'week' ? 'overflow-y-auto pr-0.5' : ''}`}>
          {shown.map((e) => <EventChip key={e.id} e={e} personal={e.personal} colorClass={solidOf(e.scanId)} onOpen={() => openEvent(e)} label={mode === 'week' && e.time ? `${e.time} ${e.title}` : undefined} />)}
          {events.length > shown.length && (
            <button type="button" className="h-4 shrink-0 px-1 text-left text-xs font-medium leading-none text-muted hover:text-ink" onClick={() => { setView('week'); setCursor(date); }}>+{events.length - shown.length} more</button>
          )}
        </div>
      </div>
    );
  };

  const pageTitle = (title: string, subtitle?: React.ReactNode) => (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
    </div>
  );
  // Toolbar toggle style: pressed = soft accent fill.
  const toggleClass = (on: boolean) => `btn-ghost ${on ? 'bg-soft text-accent hover:bg-soft' : 'text-muted'}`;

  return (
    <main className="mx-auto max-w-screen-2xl px-4 pb-20 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 bg-bg px-4 py-3 sm:-mx-6 sm:px-6">
        <span className="flex items-center gap-4">
          <b className="text-base font-semibold tracking-tight">Syllabus2Cal</b>
          {/* Compact semester switch on every tab but Scan (which has the full setup). */}
          {tab !== 'scan' && semesters.length > 0 && (
            <select aria-label="Semester" value={semesterName} onChange={(e) => selectSemester(e.target.value)}
              className="h-8 rounded-full bg-transparent px-2 text-sm text-muted outline-none hover:bg-fill focus:ring-2 focus:ring-accent">
              {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </span>
        <nav className="segmented" aria-label="Main">
          {(['scan', 'upcoming', 'month', 'courses'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`seg ${tab === t ? 'seg-on' : ''}`}>{TAB_LABELS[t]}</button>
          ))}
        </nav>
        <button className="icon-btn text-muted" onClick={() => setDark(!dark)} aria-pressed={dark} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
      </header>

      {tab === 'scan' && (
        <section className="mx-auto grid w-full max-w-3xl gap-8">
          {pageTitle('Scan syllabi', 'Set up your semester, then drop in your syllabus PDFs.')}

          {/* Setup: everything a scan depends on, in one group. */}
          <div className="card grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="label">Semester
                <select value={semesterName} onChange={(e) => selectSemester(e.target.value)} className="field" disabled={!semesters.length}>
                  {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </label>
              <div className="label">
                <label htmlFor="semester-start">Start date</label>
                <div className="flex gap-2">
                  <input id="semester-start" aria-label="Semester start date" type="date" value={semesterStartDraft} onChange={(e) => setSemesterStartDraft(e.target.value)} className="field" />
                  {semester && semesterStartDraft !== start && <button className="btn-primary shrink-0" onClick={saveSemesterStart}>Save</button>}
                </div>
              </div>
              <label className="label">Day 1 (class meets)
                <select aria-label="Class day 1" required value={day1} onChange={(e) => { setDay1(e.target.value); if (day2 && Number(day2) <= Number(e.target.value)) setDay2(''); }} className="field">
                  <option value="" disabled>Choose a day</option>
                  {WEEKDAYS.slice(0, 4).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>
              <label className="label">Day 2 (class meets)
                <select aria-label="Class day 2" required value={day2} disabled={!day1} onChange={(e) => setDay2(e.target.value)} className="field">
                  <option value="" disabled>{day1 ? 'Choose a day' : 'Pick Day 1 first'}</option>
                  {WEEKDAYS.filter((d) => Number(d.value) > Number(day1)).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <p className="max-w-md text-sm text-muted">
                {auto ? 'New scans merge into the semester automatically.' : 'New scans wait here until you choose what to merge.'} Week-based dates use the start date; changing it affects new scans only.
              </p>
              <div role="group" aria-label="Merge mode" className="segmented">
                <button className={`seg ${auto ? 'seg-on' : ''}`} aria-pressed={auto} onClick={() => setAuto(true)}>Auto-merge</button>
                <button className={`seg ${!auto ? 'seg-on' : ''}`} aria-pressed={!auto} onClick={() => setAuto(false)}>Manual</button>
              </div>
            </div>
          </div>

          <div {...getRootProps()} aria-disabled={!daysChosen}
            className={`grid justify-items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors duration-150 ${
              isDragActive ? 'border-accent bg-soft' : 'border-line bg-surface'} ${daysChosen ? 'cursor-pointer hover:border-accent' : 'cursor-not-allowed opacity-60'}`}>
            <input {...getInputProps()} />
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fill text-muted"><Icon name="upload" className="h-6 w-6" /></span>
            <p className="text-lg font-semibold">{!daysChosen ? 'Choose the two class days first' : isDragActive ? 'Release to add your syllabi' : 'Drop syllabus PDFs here'}</p>
            <p className="max-w-md text-sm text-muted">Session 1 lands on Day 1, session 2 on Day 2, and so on each week. The course name comes from the file name. Up to 8 PDFs, 10 MB each.</p>
          </div>

          {jobs.length > 0 && <ul className="card divide-y divide-line p-0">{jobs.map((j) => (
            <li key={j.name} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="min-w-0 truncate text-sm font-medium">{j.name}</span>
              <span className={`chip shrink-0 ${j.status === 'done' ? 'bg-okbg text-okink' : j.status === 'error' ? 'bg-warnbg text-warnink' : 'bg-soft text-accent'}`}>{j.status === 'scanning' ? 'Scanning…' : j.status === 'done' ? 'Scanned' : j.msg}</span>
            </li>
          ))}</ul>}

          {!auto && pending.length > 0 && <div className="card grid gap-4">
            <h2 className="text-lg font-semibold">Choose what to merge</h2>
            <div className="grid gap-1">
              {pending.map((s) => <label key={s.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-fill">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={picked.includes(s.id!)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id!] : picked.filter((i) => i !== s.id))} />
                <span className="flex-1 font-medium">{s.course}</span><span className="text-sm text-muted">{plural(s.events.length, 'event')}</span>
              </label>)}
            </div>
            <button className="btn-primary justify-self-end" disabled={!picked.length} onClick={mergePicked}>Merge {picked.length || ''} selected into {semesterName}</button>
          </div>}

          {merged.length > 0 && <button className="btn-primary justify-self-center" onClick={() => setTab('upcoming')}>See {plural(upcoming.length, 'upcoming event')}</button>}

          <details className="group card p-0">
            <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-medium">
              Semesters &amp; backup
              <Icon name="down" className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-5 border-t border-line px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="label">New semester<input value={newSemesterName} onChange={(e) => setNewSemesterName(e.target.value)} placeholder="Spring 2027" className="field" /></label>
                <label className="label">Start date<input aria-label="New semester start date" type="date" value={newSemesterStart} onChange={(e) => setNewSemesterStart(e.target.value)} className="field" /></label>
                <button className="btn" onClick={addSemester}>Add semester</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={exportBackup}>Export backup</button>
                <label className="btn cursor-pointer">Import backup<input type="file" accept="application/json" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) try { await importBackup(file); } catch (err) { alert((err as Error).message); }
                }} /></label>
              </div>
            </div>
          </details>
        </section>
      )}

      {tab === 'upcoming' && (
        <section className="mx-auto grid w-full max-w-3xl gap-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            {pageTitle('Upcoming', all.length ? <>
              {plural(dueThisWeek, 'task')} due this week
              {review > 0 && <span className="text-warnink"> · {review} to check</span>}
              {hiddenByFilter > 0 && <> · {hiddenByFilter} hidden by filter</>}
            </> : undefined)}
            <div className="flex flex-wrap items-center gap-2">
              <CourseFilterMenu scans={filterList} hidden={hiddenCourses} colorOf={colorOf} onChange={saveHidden} />
              <button className="btn-primary" disabled={!all.length} onClick={() => downloadIcs(semesterName.replace(/\s/g, '-').toLowerCase(), all)}>Export .ics</button>
            </div>
          </div>
          {!all.length ? <p className="card text-center text-muted">Nothing merged yet. Scan your syllabi first.</p>
            : !upcomingVisible.length ? <p className="card text-center text-muted">{upcoming.length ? 'All upcoming tasks are hidden by the course filter.' : 'Nothing upcoming. You are all caught up.'}</p>
            : <>
              {busyDays.map(([d, n]) => <p key={d} className="-mt-4 text-sm text-warnink">Busy day ahead: {n} deadlines on {fmt(d)}.</p>)}
              {upcomingGroups.map(([label, list]) => list.length > 0 && (
                <div key={label} className="grid gap-3">
                  <h2 className="eyebrow px-1">{label} <span className="ml-1 font-normal normal-case tracking-normal">{list.length}</span></h2>
                  <ul className="card divide-y divide-line overflow-hidden p-0">
                    {list.map((e) => <Row key={`${e.scanId}:${e.id}`} e={e} dot={solidOf(e.scanId)} onOpen={() => openEvent(e)}
                      dateLabel={label === 'Today' || label === 'Tomorrow' ? (e.time ?? 'All day') : fmt(e.date!)} />)}
                  </ul>
                </div>
              ))}
            </>}
        </section>
      )}

      {tab === 'month' && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button className={`icon-btn ${filterOpen ? 'text-accent' : 'text-muted'}`} aria-pressed={filterOpen} aria-controls="course-filter" onClick={() => toggleFilter(!filterOpen)}
                aria-label={filterOpen ? 'Hide calendar filters' : 'Show calendar filters'} title={filterOpen ? 'Hide calendar filters' : 'Show calendar filters'}><Icon name="menu" /></button>
              <button className="btn ml-1 mr-2" onClick={() => setCursor(today())}>Today</button>
              <button className="icon-btn text-muted" onClick={() => setCursor((c) => shiftCursor(c, view, -1))} aria-label={`Previous ${view}`}><Icon name="left" /></button>
              <button className="icon-btn text-muted" onClick={() => setCursor((c) => shiftCursor(c, view, 1))} aria-label={`Next ${view}`}><Icon name="right" /></button>
              {/* Fixed minimum width so the controls don't jump as the title length changes between periods. */}
              <h1 className="ml-2 min-w-[12ch] text-xl font-semibold tabular-nums tracking-tight">{viewLabel(cursor, view)}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Calendar view" className="segmented">
                {(['week', 'month', 'year'] as CalendarView[]).map((v) => (
                  <button key={v} className={`seg ${view === v ? 'seg-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>
                ))}
              </div>
              {/* Panel toggles keep the same label (state shown by the pressed style), so the header never reflows. */}
              <button className={toggleClass(showShifts)} aria-pressed={showShifts} onClick={() => toggleShifts(!showShifts)}
                title={showShifts ? 'Showing dates after your shifts. Click to show original dates.' : 'Showing original dates (no shifts). Click to show your shifts.'}>Shifts</button>
              <button className={toggleClass(sidebarOpen)} aria-pressed={sidebarOpen} aria-controls="calendar-sidebar" onClick={() => toggleSidebar(!sidebarOpen)}
                title={sidebarOpen ? 'Hide the details panel' : 'Show the details panel'}><Icon name="panel" className="h-4 w-4" />Details</button>
              <button className="btn-primary" onClick={() => setAddDate(todayKey >= rangeFrom && todayKey <= rangeTo ? todayKey : rangeFrom)}><Icon name="plus" className="h-4 w-4" />Add event</button>
            </div>
          </div>

          {/* One fixed-height status line instead of notices that appear and push the calendar down. */}
          <div role="status" className="flex h-6 items-center justify-between gap-3 overflow-hidden px-1 text-sm text-muted">
            <span className="min-w-0 truncate">
              {all.length === 0 ? 'No merged events yet. Scan a syllabus and merge it to add events to the calendar.'
                : courseVisible.length === 0 ? <>All courses are hidden by the filter. <button className="font-medium text-accent hover:underline" onClick={() => saveHidden(toggleAll(hiddenCourses, filterIds))}>Show all</button></>
                : eventsInView.length === 0 ? <>No events in {periodName}. <button className="font-medium text-accent hover:underline" onClick={jumpToNextEvent}>Jump to the {calendarEvents.some((e) => e.date! >= todayKey) ? 'next upcoming' : 'first'} event</button></>
                : `${plural(eventsInView.length, 'event')} in ${periodName}${hiddenByFilter ? ` · ${hiddenByFilter} hidden by filter` : ''}${showShifts ? '' : ' · original dates (shifts off)'}`}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {pending.length > 0 && <button className="text-warnink hover:underline" onClick={() => setTab('scan')}>{pending.length} waiting to merge</button>}
              {undated.length > 0 && <button className="text-warnink hover:underline" onClick={() => setTab('courses')}>{undated.length} without a date</button>}
            </span>
          </div>

          {/* Three-column layout: course filter | calendar | details.
              xl: all three side by side. lg: filter + calendar, details full-width below.
              Smaller: stacked in reading order (filters, calendar, details). */}
          <div className={`grid items-start gap-4 ${
            filterOpen && sidebarOpen ? 'lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_16rem]'
            : filterOpen ? 'lg:grid-cols-[12rem_minmax(0,1fr)]'
            : sidebarOpen ? 'lg:grid-cols-[minmax(0,1fr)_16rem]' : ''}`}>
          {filterOpen && (
            <aside id="course-filter" aria-label="Show on calendar"
              className="grid min-w-0 gap-2 overflow-hidden rounded-2xl bg-surface p-3 shadow-card lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
              {/* Layers drawn on the grid that aren't courses. */}
              <h2 className="eyebrow px-1">Show on calendar</h2>
              <div className="flex min-h-[32px] items-center gap-2 rounded-lg px-1 text-[13px]" title="Holidays, exam periods and deadlines">
                <span className="min-w-0 flex-1 truncate">Academic dates</span>
                <Switch small checked={showAcademicTags} onChange={toggleAcademicTags} label="Show academic dates on the calendar" />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-3">
                <h2 className="eyebrow">My courses</h2>
                {filterList.length > 0 && (
                  <button className="text-xs font-medium text-accent hover:underline" onClick={() => saveHidden(toggleAll(hiddenCourses, filterIds))}>
                    {allVisible(hiddenCourses, filterIds) ? 'Hide all' : 'Show all'}
                  </button>
                )}
              </div>
              {filterList.length === 0 ? (
                <p className="px-1 text-xs text-muted">No merged courses in {semesterName || 'this semester'} yet.</p>
              ) : (
                <ul className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
                  {filterList.map((s) => {
                    const visible = !hiddenCourses.has(s.id!);
                    const color = colorOf.get(s.id!) ?? 'blue';
                    const picking = colorPickerFor === s.id;
                    return (
                      <li key={s.id} className="grid min-w-0 gap-1">
                        <div className={`flex min-h-[32px] min-w-0 items-center gap-1.5 rounded-lg pr-1 text-[13px] hover:bg-fill ${visible ? '' : 'text-muted'}`}>
                          {/* Swatch = colour picker button. */}
                          <button type="button" onClick={() => setColorPickerFor(picking ? null : s.id!)} aria-expanded={picking} aria-label={`Change colour for ${s.course} (now ${color})`} title="Change colour"
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-surface ${picking ? 'ring-2 ring-accent' : ''}`}>
                            <span aria-hidden="true" className={`h-3 w-3 rounded ${CC_SOLID[color]} ${visible ? '' : 'opacity-30'}`} />
                          </button>
                          {/* Clicking the name toggles too; the switch shows the state (in the course's colour). */}
                          <button type="button" className="min-w-0 flex-1 truncate text-left" title={s.course} aria-hidden="true" tabIndex={-1}
                            onClick={() => saveHidden(toggleCourse(hiddenCourses, s.id!, !visible))}>{s.course}</button>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted">{s.events.filter((e) => e.date).length}</span>
                          <Switch small checked={visible} colorClass={CC_SOLID[color]} label={`Show ${s.course} on the calendar`}
                            onChange={(v) => saveHidden(toggleCourse(hiddenCourses, s.id!, v))} />
                        </div>
                        {picking && (
                          <div role="radiogroup" aria-label={`Colour for ${s.course}`} className="flex flex-wrap gap-1.5 rounded-xl bg-fill p-2">
                            {COURSE_COLORS.map((c) => (
                              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} title={c}
                                onClick={() => { setCourseColor(s.id!, c); setColorPickerFor(null); }}
                                className={`h-5 w-5 rounded-full ${CC_SOLID[c]} ${c === color ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:ring-2 hover:ring-line hover:ring-offset-2 hover:ring-offset-surface'} transition-shadow`} />
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {pending.length > 0 && <p className="px-1 text-xs text-muted">{pending.length} scanned {pending.length === 1 ? 'course is' : 'courses are'} not merged yet, so not listed.</p>}
            </aside>
          )}
          <div className="grid min-w-0 gap-4">
          {view !== 'year' && (
            // Hairline grid: outer border + right/bottom cell borders; the last column / row drop theirs.
            <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-surface [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="border-b border-r border-line py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted">{day}</div>)}
              {view === 'week'
                ? weekDays(cursor).map((date) => dayCell(date, 'week'))
                : monthGrid(cursor).map((date) => dayCell(date, 'month', date.getMonth() !== cursor.getMonth()))}
            </div>
          )}

          {view === 'year' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MONTH_NAMES.map((name, m) => {
                const prefix = `${cursor.getFullYear()}-${String(m + 1).padStart(2, '0')}-`;
                const events = calendarEvents.filter((e) => e.date!.startsWith(prefix));
                const isCurrentMonth = todayKey.startsWith(prefix);
                return (
                  <div key={name} className={`flex h-[248px] flex-col gap-1.5 overflow-hidden rounded-2xl bg-surface p-4 shadow-card ${isCurrentMonth ? 'ring-2 ring-accent' : ''}`}>
                    <button type="button" className="mb-1 flex items-center justify-between text-left font-semibold hover:text-accent" onClick={() => { setView('month'); setCursor(new Date(cursor.getFullYear(), m, 1)); }}>
                      <span>{name}</span>
                      <span className="text-xs font-normal text-muted">{plural(events.length, 'event')}</span>
                    </button>
                    {events.slice(0, events.length > 6 ? 5 : 6).map((e) => <EventChip key={e.id} e={e} personal={e.personal} colorClass={solidOf(e.scanId)} onOpen={() => openEvent(e)} label={`${Number(e.date!.slice(8))} · ${e.title}`} />)}
                    {events.length > 6 && (
                      <button type="button" className="h-4 shrink-0 text-left text-xs font-medium leading-none text-muted hover:text-ink" onClick={() => { setView('month'); setCursor(new Date(cursor.getFullYear(), m, 1)); }}>+{events.length - 5} more</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>

          {sidebarOpen && (
            <aside id="calendar-sidebar" aria-label="Details"
              className={`grid min-w-0 gap-4 rounded-2xl bg-surface p-4 shadow-card ${filterOpen ? 'lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto' : 'lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto'}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="eyebrow">Details</h2>
                <button className="icon-btn -my-2 -mr-2 h-8 w-8 text-muted" onClick={() => toggleSidebar(false)} aria-label="Hide details sidebar"><Icon name="close" className="h-4 w-4" /></button>
              </div>
              {selectedAcademic ? (
                <div className="grid gap-2">
                  <span className={`chip justify-self-start ${AC_CLASS[selectedAcademic.color]}`}>{ACADEMIC_CATEGORIES[selectedAcademic.color]} · {selectedAcademic.term}</span>
                  <h3 className="text-lg font-semibold tracking-tight">{selectedAcademic.title}</h3>
                  <p className="text-sm font-medium text-accent">{fmtRange(selectedAcademic.from, selectedAcademic.to)}</p>
                  <p className="text-sm text-muted">{selectedAcademic.description}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button className="btn min-h-[32px]" onClick={() => setCursor(new Date(`${selectedAcademic.from}T00:00:00`))}>Show on calendar</button>
                    <button className="btn-ghost min-h-[32px] text-muted" onClick={() => setSelectedAcademic(null)}>Clear</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">Click an academic event on the calendar to see its details here.</p>
              )}
              <div className="grid gap-2 border-t border-line pt-4">
                <h3 className="eyebrow">Academic calendar</h3>
                {/* One collapsible list per term; the term being viewed (or the selected event's) starts open.
                    The key includes it so the open state follows navigation. */}
                {(() => {
                  const activeTerm = selectedAcademic?.term ?? termOn(localDateKey(cursor)) ?? termOn(todayKey);
                  return ACADEMIC_TERMS.map((t) => (
                    <details key={`${t}-${activeTerm}`} open={t === activeTerm} className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm font-medium">
                        {t}<Icon name="down" className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
                      </summary>
                      <ul className="mt-1 grid gap-0.5">
                        {ACADEMIC_EVENTS.filter((a) => a.term === t).map((a) => (
                          <li key={a.id}>
                            <button type="button" onClick={() => { showAcademic(a); setCursor(new Date(`${a.from}T00:00:00`)); }}
                              className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-fill ${selectedAcademic?.id === a.id ? 'bg-soft' : ''}`}>
                              <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${AC_DOT[a.color]}`} />
                              <span className="min-w-0"><span className="block font-medium">{a.title}</span><span className="block text-muted">{fmtRange(a.from, a.to)}</span></span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ));
                })()}
              </div>
            </aside>
          )}
          </div>
        </section>
      )}

      {tab === 'courses' && (
        <section className="mx-auto grid w-full max-w-5xl gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            {pageTitle('Courses', `${plural(courses.length, 'course')} in ${semesterName || 'this semester'}`)}
            {filterList.length > 0 && (
              <button className="btn-ghost text-muted" onClick={() => { const allOpen = filterIds.every((id) => expandedCourses.has(id)); const next = new Set(expandedCourses); for (const id of filterIds) if (allOpen) next.delete(id); else next.add(id); saveExpanded(next); }}>
                {filterIds.every((id) => expandedCourses.has(id)) ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {/* Overview: overall completion across syllabus courses only (personal tasks never count). */}
          {courses.length > 0 && (() => {
            const o = overallProgress(courses);
            return (
              <div className="card flex flex-wrap items-center gap-x-8 gap-y-3">
                <div className="text-4xl font-semibold tabular-nums tracking-tight">{o.percent}%</div>
                <div className="grid min-w-[14rem] flex-1 gap-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">Overall progress</span>
                    <span className="text-muted">{o.done} of {o.total} assessments done</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-fill" role="progressbar" aria-label="Overall course progress" aria-valuenow={o.percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${o.percent}%` }} />
                  </div>
                </div>
              </div>
            );
          })()}
          {!courses.length && <p className="card text-center text-muted">No courses yet. Scan a syllabus to add one.</p>}

          {/* One card per course (then "My Personal Tasks"). Export sits in the card header; open it for
              (A) the grading breakdown and (B) the editable schedule. */}
          {filterList.map((s) => {
            const personal = isPersonalScan(s);
            const open = expandedCourses.has(s.id!);
            const color = colorOf.get(s.id!) ?? 'blue';
            // Progress counts assessments only; the personal list counts all of its events.
            const listed = personal ? s.events : s.events.filter(isAssessment);
            const p = courseProgress(listed, todayKey);
            const noun = personal ? 'events' : 'assessments';
            const weighted = s.events.filter((e) => e.weight != null && e.weight > 0).sort((a, b) => b.weight! - a.weight! || a.title.localeCompare(b.title));
            const weightTotal = Math.round(weighted.reduce((sum, e) => sum + e.weight!, 0) * 10) / 10;
            return (
            <div key={s.id} className="card overflow-hidden p-0">
              <div className="flex items-center gap-2 p-3 sm:p-4">
                <button type="button" onClick={() => toggleExpanded(s.id!)} aria-expanded={open} aria-controls={`course-${s.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2 text-left transition-colors hover:bg-fill">
                  <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${CC_SOLID[color]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">{s.course}</span>
                    <span className="block truncate text-sm text-muted">
                      {p.next ? `Next: ${p.next.title} · ${fmt(p.next.date!)}` : p.total ? `No upcoming ${noun}` : `No ${noun}`}
                      {p.review > 0 && <span className="text-warnink"> · {p.review} to check</span>}
                      {p.undated > 0 && <span className="text-warnink"> · {p.undated} without a date</span>}
                    </span>
                  </span>
                  {!personal && (
                    <span className="hidden w-36 shrink-0 gap-1.5 sm:grid">
                      <span className="flex justify-between text-xs text-muted"><span>{p.done}/{p.total} done</span><span className="font-medium tabular-nums text-ink">{p.percent}%</span></span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-fill" role="progressbar" aria-label={`${s.course} progress`} aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
                        <span className={`block h-full rounded-full transition-[width] duration-300 ${CC_SOLID[color]}`} style={{ width: `${p.percent}%` }} />
                      </span>
                    </span>
                  )}
                  <Icon name="down" className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
                <button className="btn shrink-0" onClick={() => downloadIcs(s.course.split(':')[0].replace(/\s/g, ''), s.events.map((e) => ({ ...e, course: s.course })))}>Export .ics</button>
              </div>

              {open && (
              <div id={`course-${s.id}`} className="grid gap-8 border-t border-line px-5 py-6 sm:px-6">
                {/* Class days: change them (e.g. Tue/Thu -> Mon/Wed) and the course's sessions move on the calendar. */}
                {!personal && (
                  <ClassDaysEditor current={classDaysFor(s)} inferred={!s.classDays?.length} events={s.events}
                    onApply={(days) => applyClassDays(s.id!, days)} />
                )}

                {/* Section A: grading breakdown, from the weights found in the syllabus. */}
                {!personal && (
                  <div className="grid gap-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="eyebrow">Assessment weights</h3>
                      {weighted.length > 0 && <span className="text-xs text-muted">Total <span className={`font-semibold ${weightTotal === 100 ? 'text-ink' : 'text-warnink'}`}>{weightTotal}%</span></span>}
                    </div>
                    {weighted.length === 0 ? <p className="text-sm text-muted">No grade weights found in this syllabus. Add a weight to any item below.</p> : (
                      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-x-10">
                        {weighted.map((e) => (
                          <li key={e.id} className="grid gap-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate" title={e.title}>{e.title}</span>
                              <span className="shrink-0 font-medium tabular-nums">{e.weight}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                              <div className={`h-full rounded-full ${CC_SOLID[color]}`} style={{ width: `${Math.min(100, e.weight!)}%` }} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Section B: the full extracted schedule (sessions, topics, assessments), editable in place. */}
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="eyebrow">{personal ? 'Events' : 'Schedule & outline'}</h3>
                    <span className="text-xs text-muted">{personal ? 'Added on the calendar' : `${plural(s.events.length, 'item')} from ${s.fileName}`}</span>
                  </div>
                  {s.events.length === 0 ? <p className="text-sm text-muted">{personal ? 'No personal events.' : 'Nothing was extracted from this syllabus.'}</p> : (
                    <div>
                      {/* Column labels for the rows (wide screens). */}
                      <div className={`hidden gap-1 border-b border-line px-2 pb-2 text-xs font-medium text-muted md:grid ${ROW_GRID}`}>
                        <span className="w-6">Done</span><span>Title</span><span>Type</span><span>Date</span><span>Time</span><span>Weight</span><span className="w-[7.5rem]" />
                      </div>
                      <ul className="divide-y divide-line">{sortTasks(s.events).map((e) => (
                        <EventRow key={e.id} e={e} onSave={(patch) => updateEvent(s.id!, e.id, patch)} onDelete={() => deleteEvent(s.id!, e.id)} onToggleCompleted={(completed) => setEventCompleted(s.id!, e.id, completed)} />
                      ))}</ul>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5">
                  {s.lastShift && <button className="btn-ghost text-muted" title={`Last shift: ${s.lastShift.label}`} onClick={() => undoLastShift(s.id!)}>Undo last shift</button>}
                  <button className="btn-ghost text-closedink hover:bg-closedbg" onClick={() => db.scans.delete(s.id!)}>{personal ? 'Delete all personal events' : 'Delete course'}</button>
                </div>
              </div>
              )}
            </div>
            );
          })}
        </section>
      )}

      {/* Modals live at the top level so the Upcoming list and the calendar can both open event details. */}
      {selected && selectedEvent && selectedScan && (
        <EventModal key={`${selected.scanId}:${selected.eventId}`} e={selectedEvent} personal={isPersonalScan(selectedScan)} onClose={() => setSelected(null)}
          classDays={classDaysFor(selectedScan)} undoLabel={selectedScan.lastShift?.label}
          daysGuessed={!isPersonalScan(selectedScan) && !selectedScan.classDays?.length}
          preview={(() => {
            // Dry-run both directions so the buttons say exactly where this event would land.
            const days = classDaysFor(selectedScan);
            const fwd = cascadeShift(selectedScan.events, selected.eventId, 1, days);
            const back = cascadeShift(selectedScan.events, selected.eventId, -1, days);
            return {
              forward: fwd.changes.find((c) => c.id === selected.eventId)?.to,
              backward: back.changes.find((c) => c.id === selected.eventId)?.to,
              backwardBlockedBy: back.blocked?.title,
            };
          })()}
          onSave={(patch) => updateEvent(selected.scanId, selected.eventId, patch)}
          onDelete={() => deleteEvent(selected.scanId, selected.eventId)}
          onToggleCompleted={(completed) => setEventCompleted(selected.scanId, selected.eventId, completed)}
          onShift={(dir) => shiftEvent(selected.scanId, selected.eventId, dir)}
          onUndo={() => undoLastShift(selected.scanId)} />
      )}
      {selectedClosure && <ClosureModal closure={selectedClosure.closure} date={selectedClosure.date} onClose={() => setSelectedClosure(null)}
        onAddEvent={() => { const d = selectedClosure.date; setSelectedClosure(null); setAddDate(d); }} />}
      {addDate && <AddEventModal key={addDate} initialDate={addDate} onClose={() => setAddDate(null)} onAdd={addPersonalEvent} />}
    </main>
  );
}
