'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EventItem, Scan, Semester } from '@/lib/db';
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

const midnight = () => new Date(new Date().toDateString()).getTime();
const daysUntil = (d: string) => Math.round((new Date(`${d}T00:00:00`).getTime() - midnight()) / 864e5);
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const when = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);
const WEEKDAYS = [{ value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' }, { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' }];
const MONTH_NAMES = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: 'long' }));
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Full class names (Tailwind only generates classes it can see literally in the source).
const AC_CLASS: Record<AcademicColor, string> = {
  green: 'bg-ac-green text-ac-green-ink border-ac-green-ink',
  orange: 'bg-ac-orange text-ac-orange-ink border-ac-orange-ink',
  yellow: 'bg-ac-yellow text-ac-yellow-ink border-ac-yellow-ink',
  red: 'bg-ac-red text-ac-red-ink border-ac-red-ink',
  blue: 'bg-ac-blue text-ac-blue-ink border-ac-blue-ink',
  gray: 'bg-ac-gray text-ac-gray-ink border-ac-gray-ink',
};
// Course colours (keys from lib/courseFilter.ts): soft fill + dark text for chips, solid dot for swatches.
const CC_CHIP: Record<CourseColor, string> = {
  red: 'bg-cc-red text-cc-red-ink', blue: 'bg-cc-blue text-cc-blue-ink', green: 'bg-cc-green text-cc-green-ink', purple: 'bg-cc-purple text-cc-purple-ink',
  orange: 'bg-cc-orange text-cc-orange-ink', teal: 'bg-cc-teal text-cc-teal-ink', amber: 'bg-cc-amber text-cc-amber-ink', pink: 'bg-cc-pink text-cc-pink-ink',
};
const CC_SWATCH: Record<CourseColor, string> = {
  red: 'bg-cc-red-ink', blue: 'bg-cc-blue-ink', green: 'bg-cc-green-ink', purple: 'bg-cc-purple-ink',
  orange: 'bg-cc-orange-ink', teal: 'bg-cc-teal-ink', amber: 'bg-cc-amber-ink', pink: 'bg-cc-pink-ink',
};
// Academic events as subtle text tags: a coloured dot + coloured text, no fill.
const AC_DOT: Record<AcademicColor, string> = {
  green: 'bg-ac-green-ink', orange: 'bg-ac-orange-ink', yellow: 'bg-ac-yellow-ink', red: 'bg-ac-red-ink', blue: 'bg-ac-blue-ink', gray: 'bg-ac-gray-ink',
};
const AC_TEXT: Record<AcademicColor, string> = {
  green: 'text-ac-green-ink', orange: 'text-ac-orange-ink', yellow: 'text-ac-yellow-ink', red: 'text-ac-red-ink', blue: 'text-ac-blue-ink', gray: 'text-ac-gray-ink',
};
const fmtRange = (from: string, to: string) => (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`);

// Native <dialog> wrapper: showModal() gives the backdrop, Esc-to-close and focus containment
// without any extra library. Clicking the backdrop also closes it.
function Dialog({ onClose, labelledBy, className = 'w-[min(32rem,calc(100vw-2rem))]', children }: { onClose: () => void; labelledBy: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(ev) => { if (ev.target === ref.current) onClose(); }} aria-labelledby={labelledBy}
      className={`${className} rounded-2xl border border-line bg-surface p-0 text-inherit backdrop:bg-black/40`}>
      {children}
    </dialog>
  );
}

// Create a personal event. Opened from "+ Add Event" or by clicking empty space in a day cell
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
  const input = 'min-h-[44px] rounded-lg border border-line bg-surface px-2';
  return (
    <Dialog onClose={onClose} labelledBy="add-event-title">
      <form onSubmit={submit} className="grid gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="add-event-title" className="font-display text-xl font-bold">📌 Add personal event</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="text-sm text-muted">Saved on this device under “My Personal Tasks”, separate from your scanned courses.</p>
        <label className="grid gap-1 text-sm font-medium">Title<input required autoFocus maxLength={300} value={form.title} onChange={set('title')} className={input} placeholder="e.g. Study group" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium">Date<input required type="date" value={form.date} onChange={set('date')} className={input} /></label>
          <label className="grid gap-1 text-sm font-medium">Time<input type="time" value={form.time} onChange={set('time')} className={input} /></label>
          <label className="grid gap-1 text-sm font-medium">Type
            <select value={form.type} onChange={set('type')} className={input}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Note (optional)<textarea rows={3} maxLength={2000} value={form.note} onChange={set('note')} className="rounded-lg border border-line bg-surface p-2" /></label>
        {closed && <p className="rounded-xl bg-closedbg p-2 text-sm text-closedink">{fmt(form.date)} is a Campus Closed day ({closed.name}).</p>}
        {error && <p role="alert" className="rounded-xl bg-warnbg p-2 text-sm text-warnink">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>Add event</button>
        </div>
      </form>
    </Dialog>
  );
}

// Small popup for a Campus Closed day.
function ClosureModal({ closure, date, onClose, onAddEvent }: { closure: Closure; date: string; onClose: () => void; onAddEvent: () => void }) {
  return (
    <Dialog onClose={onClose} labelledBy="closure-title" className="w-[min(22rem,calc(100vw-2rem))]">
      <div className="grid gap-3 p-5">
        <span className="chip justify-self-start bg-closedbg text-xs font-bold uppercase text-closedink">Campus Closed</span>
        <h2 id="closure-title" className="font-display text-xl font-bold">{closure.name}</h2>
        <p className="text-sm text-muted">{fmt(date)}{closure.from !== closure.to ? ` (closed ${fmtRange(closure.from, closure.to)})` : ''}</p>
        <p className="text-sm">The campus is closed and no classes are held. Sessions on this day can be shifted from their details.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onAddEvent}>+ Add event on this day</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Dialog>
  );
}

function Row({ e }: { e: CalEvent }) {
  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 ${e.completed ? 'opacity-60' : ''}`}>
      <div className="w-28 text-sm font-medium text-accent">{fmt(e.date!)}</div>
      <div className="flex-1">
        <div className={`font-medium ${e.completed ? 'line-through' : ''}`}>{e.title}</div>
        <div className="text-sm text-muted">{when(daysUntil(e.date!))}{e.weight != null ? `, ${e.weight}% of grade` : ''}</div>
      </div>
      {e.needsReview && <span className="chip bg-warnbg text-warnink">Check date</span>}
      <span className="chip bg-soft text-accent">{e.course.split(':')[0]}</span>
    </li>
  );
}

// Event chip used by every calendar view. The syllabus is the focus, so a chip always shows its
// course's colour (chosen in the Courses sidebar), even on a Campus Closed day, with no warning icons.
// Completed events stay on the calendar, crossed through. Fixed height, so cells never resize.
// (Style rules: chipStyle() in lib/courseFilter.ts. Notes such as "check date" stay in the tooltip.)
function EventChip({ e, onOpen, label, personal = false, colorClass = 'bg-soft text-accent' }: { e: CalEvent; onOpen: () => void; label?: string; personal?: boolean; colorClass?: string }) {
  const closed = e.date ? closureOn(e.date) : undefined;
  const { done } = chipStyle(e, { personal });
  const notes = [personal ? 'personal' : e.course, e.completed && 'completed', e.needsReview && !e.completed && 'check date', closed && `Campus Closed: ${closed.name}`].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} title={`${e.title} (${notes})`}
      className={`flex h-6 w-full min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-left text-xs leading-none transition-colors duration-150 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${colorClass} ${done ? 'line-through opacity-60' : ''}`}>
      {personal && <><span aria-hidden="true">📌</span><span className="sr-only">Personal: </span></>}
      <span className="min-w-0 flex-1 truncate">{label ?? e.title}</span>
      {done && <span className="sr-only">(completed)</span>}
    </button>
  );
}

// Day number in the Week/Month grids; today's date gets a filled circle.
function DayNumber({ date, isToday }: { date: Date; isToday: boolean }) {
  return (
    <span aria-current={isToday ? 'date' : undefined}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? 'bg-accent font-bold text-onaccent' : ''}`}>
      {date.getDate()}
    </span>
  );
}

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
  const input = 'h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm transition-colors focus:border-accent';
  const field = { onBlur: () => commit(), onKeyDown: enterSaves, className: input };
  return (
    <li className={`grid items-center gap-2 rounded-xl border border-line bg-surface p-2 md:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] ${e.completed ? 'opacity-70' : ''}`}>
      {/* Completion is a single click, so it saves immediately (and leaves "Check date" alone). */}
      <label className="flex h-10 items-center gap-2 px-1 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={!!e.completed} onChange={(ev) => onToggleCompleted(ev.target.checked)} aria-label={`Mark "${e.title}" as completed`} />
        <span className="md:sr-only">Done</span>
      </label>
      <input aria-label="Task title" value={draft.title} onChange={edit('title')} {...field} className={`${input} ${e.completed ? 'line-through' : ''}`} />
      {/* A select change is a single deliberate action, so it saves immediately. */}
      <select aria-label="Task type" value={draft.type} onChange={(ev) => { const next = { ...draft, type: ev.target.value }; setDraft(next); commit(next); }} className={input}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      {/* Fix a wrong scanned date here: change it, then click away or press Enter. Saving clears "Check date". */}
      <label className="relative block">
        <span className="sr-only">Date</span>
        <input aria-label="Task date" type="date" value={draft.date} onChange={edit('date')} {...field}
          className={`${input} ${e.needsReview && !e.completed ? 'border-warnink' : ''}`} title={e.needsReview ? 'Check this date against the syllabus' : undefined} />
      </label>
      <input aria-label="Task time" type="time" value={draft.time} onChange={edit('time')} {...field} />
      <input aria-label="Grade weight %" type="number" min="0" max="100" value={draft.weight} onChange={edit('weight')} placeholder="Weight %" {...field} />
      <div className="flex h-10 items-center justify-end gap-2">
        {/* Fixed-width status slot so the row never shifts. */}
        <span className="w-20 text-right text-xs" aria-live="polite">
          {saved ? <span className="text-okink">Saved</span> : e.needsReview && !e.completed ? <span className="text-warnink">Check date</span> : null}
        </span>
        <button className="btn h-10 px-3 text-muted" onClick={onDelete} aria-label={`Delete "${e.title}"`}>Delete</button>
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
  const select = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
  return (
    <div className="grid gap-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Class days</span>
        <span className="text-muted">{current.length ? current.map(name).join(' & ') : 'unknown'}{inferred ? ' (guessed from the scan)' : ''}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">Day 1
          <select value={d1} onChange={(e) => { setD1(e.target.value); setNote(''); if (Number(d2) <= Number(e.target.value)) setD2(''); }} className={select}>
            <option value="" disabled>Choose</option>
            {WEEKDAYS.slice(0, 4).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Day 2
          <select value={d2} disabled={!d1} onChange={(e) => { setD2(e.target.value); setNote(''); }} className={`${select} disabled:opacity-60`}>
            <option value="" disabled>Choose</option>
            {WEEKDAYS.filter((d) => Number(d.value) > Number(d1)).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <button className="btn-primary h-9" disabled={!changed}
          onClick={async () => { const moved = await onApply(next); setNote(`Done: ${moved} ${moved === 1 ? 'session' : 'sessions'} moved to ${next.map(name).join(' & ')}.`); }}>
          Apply
        </button>
        <span className="min-w-0 text-xs text-muted" aria-live="polite">
          {note || (changed ? `${current.map((d, i) => `${name(d)} → ${name(next[i])}`).join(', ')} · moves ${preview} ${preview === 1 ? 'session' : 'sessions'} on the calendar` : '')}
        </span>
      </div>
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
  const input = 'min-h-[44px] rounded-lg border border-line bg-surface px-2';
  return (
    <Dialog onClose={onClose} labelledBy="event-modal-title">
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="event-modal-title" className={`font-display text-xl font-bold ${e.completed ? 'line-through opacity-60' : ''}`}>{personal && '📌 '}{e.title}</h2>
            <p className="text-sm text-muted">{personal ? 'Personal event' : e.course}</p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Date</dt><dd>{e.date ? fmt(e.date) : 'No date'}{e.time ? `, ${e.time}` : ''}{e.needsReview && <span className="chip ml-2 bg-warnbg text-warnink">Check date</span>}</dd>
          <dt className="text-muted">Type</dt><dd className="capitalize">{e.type}</dd>
          {e.weight != null && <><dt className="text-muted">Weight</dt><dd>{e.weight}% of grade</dd></>}
          <dt className="text-muted">{personal ? 'Note' : 'Source'}</dt><dd className="whitespace-pre-wrap break-words">{e.source || 'None'}</dd>
        </dl>
        {closed && (
          <div role="alert" className="grid gap-2 rounded-xl border border-closedink bg-closedbg p-3 text-sm text-closedink">
            <p><b>This event falls on a Campus Closed day</b> ({closed.name}).</p>
            <p>Shifting moves this session to the next class day that isn’t closed, and every later session of this course slides one class meeting with it, so nothing is overwritten. Later tasks on other days (e.g. a Friday deadline) move one week.</p>
            <p className="text-ink">
              Class days used: <b>{classDays.length ? classDays.map((d) => DAY_SHORT[d]).join(' & ') : 'unknown'}</b>
              {daysGuessed && ' (guessed from the scan)'}
            </p>
            {/* With fewer than two known class days the next class day is a week away, so say so plainly. */}
            {(classDays.length < 2 || daysGuessed) && (
              <p className="rounded-lg bg-surface p-2 text-ink">
                {classDays.length < 2 ? 'Only one class day is known for this course, so a shift moves a whole week. ' : 'These days are a guess. '}
                Set the real class days (e.g. Tue &amp; Thu) under <b>Courses → this course → Class days</b>, then shift.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={busy || !!preview?.backwardBlockedBy} onClick={() => shift(-1)}
                title={preview?.backwardBlockedBy ? `Blocked: the previous class day already has "${preview.backwardBlockedBy}"` : undefined}>
                ← Shift Backward{preview?.backward ? ` (to ${fmt(preview.backward)})` : ''}
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => shift(1)}>
                Shift Forward{preview?.forward ? ` → ${fmt(preview.forward)}` : ' →'}
              </button>
            </div>
          </div>
        )}
        {shiftNote && <p role="status" className={`rounded-xl p-3 text-sm ${shiftNote.ok ? 'bg-okbg text-okink' : 'bg-warnbg text-warnink'}`}>{shiftNote.text}</p>}
        {undoLabel && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
            <span className="text-muted">Last shift in this course: {undoLabel}</span>
            <button type="button" className="btn" disabled={busy} onClick={undo}>Undo last shift</button>
          </div>
        )}
        {/* Saves immediately; the modal stays open and reflects the stored value. */}
        <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5" checked={!!e.completed}
            onChange={(ev) => onToggleCompleted(ev.target.checked).catch((err) => alert((err as Error).message))} />
          Completed
        </label>
        <form onSubmit={save} className="grid gap-3 border-t border-line pt-4">
          <h3 className="font-display font-bold">Edit</h3>
          <label className="grid gap-1 text-sm font-medium">Title<input required value={draft.title} onChange={edit('title')} className={input} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">Type
              <select value={draft.type} onChange={edit('type')} className={input}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-medium">Weight %<input type="number" min="0" max="100" step="any" value={draft.weight} onChange={edit('weight')} className={input} /></label>
            <label className="grid gap-1 text-sm font-medium">Date<input type="date" value={draft.date} onChange={edit('date')} className={input} /></label>
            <label className="grid gap-1 text-sm font-medium">Time<input type="time" value={draft.time} onChange={edit('time')} className={input} /></label>
          </div>
          {personal && <label className="grid gap-1 text-sm font-medium">Note<textarea rows={3} maxLength={2000} value={note} onChange={(ev) => setNote(ev.target.value)} className="rounded-lg border border-line bg-surface p-2" /></label>}
          <div className="flex flex-wrap justify-between gap-2 pt-1">
            <button type="button" className="btn text-warnink" disabled={busy} onClick={() => run(onDelete)}>Delete event</button>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
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
  // Course whose colour picker is open in the Courses sidebar. The chosen colour is saved on the scan.
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const setCourseColor = (id: number, color: CourseColor) => db.scans.update(id, { color });
  // Calendar "Shifts" toggle: on (default) shows dates after Cascade Shifts; off shows each event's original date.
  const [showShifts, setShowShifts] = useState(true);
  useEffect(() => { setShowShifts(localStorage.getItem('syllabus2cal-show-shifts') !== 'false'); }, []);
  const toggleShifts = (v: boolean) => { setShowShifts(v); localStorage.setItem('syllabus2cal-show-shifts', String(v)); };
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
  // Event open in the Month view's modal. Looked up from the live scans so it reflects saved edits.
  const [selected, setSelected] = useState<{ scanId: number; eventId: string } | null>(null);
  const selectedScan = selected ? scans.find((s) => s.id === selected.scanId) : undefined;
  const selectedItem = selectedScan?.events.find((e) => e.id === selected?.eventId);
  const selectedEvent: CalEvent | undefined = selectedScan && selectedItem ? { ...selectedItem, course: selectedScan.course } : undefined;
  const upcoming = all.filter((e) => daysUntil(e.date!) >= 0);
  const counts = upcoming.reduce<Record<string, number>>((m, e) => ({ ...m, [e.date!]: (m[e.date!] ?? 0) + 1 }), {});
  const busy = Object.entries(counts).filter(([, n]) => n >= 3);
  const review = merged.flatMap((s) => s.events).filter((e) => e.needsReview).length;
  const week = upcoming.filter((e) => daysUntil(e.date!) <= 7);
  const later = upcoming.filter((e) => daysUntil(e.date!) > 7);

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

  const stat = (label: string, value: string | number, warn = false) => (
    <div className={`flex-1 min-w-[140px] rounded-2xl border p-4 ${warn ? 'border-warnink bg-warnbg text-warnink' : 'border-line bg-surface'}`}>
      <div className="text-sm">{label}</div><div className="font-display text-3xl font-bold">{value}</div>
    </div>
  );

  // ---- Calendar (Week / Month / Year) ----
  const todayKey = localDateKey(today());
  // Course filter first, then the completed filter. Colours come from each course's position.
  const filterList = [...courses, ...merged.filter(isPersonalScan)]; // courses, then "My Personal Tasks"
  const colorOf = courseColors(filterList);
  const chipColor = (e: MonthEvent) => CC_CHIP[colorOf.get(e.scanId) ?? 'blue'];
  const filterIds = filterList.map((s) => s.id!);
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
    // Academic tags only while Details is on; Month shows at most 2 to keep the cell's layout fixed.
    const academic = sidebarOpen ? academicOn(key) : [];
    const tags = mode === 'month' ? academic.slice(0, 2) : academic;
    const slots = mode === 'week' ? Infinity : tags.length ? 2 : 3; // chip rows that fit in a Month cell
    const shown = events.length > slots ? events.slice(0, slots - 1) : events;
    const openClosure = () => closure && setSelectedClosure({ closure, date: key });
    return (
      // Clicking empty space in a cell (anything that isn't a button) opens Add Event for that date;
      // on a Campus Closed day it opens the closure popup instead, which has its own "Add event" button.
      // The "+" and "Closed" buttons are the keyboard-accessible equivalents.
      <div key={key} onClick={(ev) => { if ((ev.target as HTMLElement).closest('button')) return; if (closure) openClosure(); else setAddDate(key); }}
        // Campus Closed: a light red fill only (no border), never dimmed, even outside the month.
        className={`group flex cursor-pointer flex-col overflow-hidden border-b border-r border-line p-1.5 transition-colors duration-150 sm:p-2 ${mode === 'week' ? 'h-[480px]' : 'h-[140px]'} ${
          closure ? 'bg-closedbg' : `hover:bg-soft ${outside ? 'text-muted opacity-60' : ''}`}`}>
        <div className="flex h-7 shrink-0 items-center justify-between gap-1">
          <DayNumber date={date} isToday={isToday} />
          <span className="flex items-center gap-1">
            {closure && (
              <button type="button" onClick={openClosure} title={`Campus closed: ${closure.name}`} aria-label={`Campus closed: ${closure.name}. Show details`}
                className="chip bg-surface px-1.5 py-0 text-[10px] font-bold uppercase text-closedink hover:underline">Closed</button>
            )}
            <button type="button" onClick={() => setAddDate(key)} aria-label={`Add event on ${fmt(key)}`} title="Add event"
              className="h-6 w-6 rounded-full text-sm leading-none text-muted opacity-0 hover:bg-surface hover:text-accent focus-visible:opacity-100 group-hover:opacity-100">+</button>
          </span>
        </div>
        {closure && mode === 'week' && <p className="mt-1 shrink-0 truncate text-xs text-closedink">{closure.name}</p>}
        {/* Academic events are a subtle layer tied to the Details sidebar: small text tags (dot + text, no fill)
            so course sessions stay the focus; hidden entirely when Details is off. */}
        {tags.length > 0 && (
          <div className="mt-1 grid shrink-0 gap-0.5">
            {tags.map((a) => (
              <button key={a.id} type="button" onClick={() => showAcademic(a)} title={`${a.title} (${ACADEMIC_CATEGORIES[a.color]})`}
                className={`flex h-3.5 w-full min-w-0 items-center gap-1 rounded px-0.5 text-left text-[11px] leading-none hover:underline ${AC_TEXT[a.color]} ${selectedAcademic?.id === a.id ? 'bg-soft' : ''}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${AC_DOT[a.color]}`} />
                <span className="truncate">{a.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`mt-1.5 flex min-h-0 flex-1 flex-col gap-1 ${mode === 'week' ? 'overflow-y-auto pr-0.5' : ''}`}>
          {shown.map((e) => <EventChip key={e.id} e={e} personal={e.personal} colorClass={chipColor(e)} onOpen={() => openEvent(e)} label={mode === 'week' && e.time ? `${e.time} ${e.title}` : undefined} />)}
          {events.length > shown.length && (
            <button type="button" className="h-4 shrink-0 px-1 text-left text-xs leading-none text-muted hover:text-accent hover:underline" onClick={() => { setView('week'); setCursor(date); }}>+{events.length - shown.length} more</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-screen-2xl px-6 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-2 py-5">
        <b className="font-display text-lg">Syllabus2Cal</b>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          {(['scan', 'upcoming', 'month', 'courses'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`btn border-0 ${tab === t ? 'bg-soft text-accent' : 'text-muted'}`}>
              {t === 'scan' ? 'Scan and merge' : t === 'upcoming' ? 'Upcoming' : t === 'month' ? 'Calendar' : 'Courses'}
            </button>
          ))}
          <button className="btn" onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button>
        </nav>
      </header>

      {semesters.length > 0 && (
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-3">
          <label className="grid gap-1 text-sm font-medium">Semester
            <select value={semesterName} onChange={(e) => selectSemester(e.target.value)} className="min-h-[44px] rounded-xl border border-line bg-surface px-3">
              {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Semester start date
            <input aria-label="Semester start date" type="date" value={semesterStartDraft} onChange={(e) => setSemesterStartDraft(e.target.value)} className="min-h-[44px] rounded-xl border border-line bg-surface px-3" />
          </label>
          <button className="btn" onClick={saveSemesterStart} disabled={!semester || semesterStartDraft === start}>Save start date</button>
          <label className="grid gap-1 text-sm font-medium">Add semester
            <input value={newSemesterName} onChange={(e) => setNewSemesterName(e.target.value)} placeholder="Spring 2027" className="min-h-[44px] rounded-xl border border-line bg-surface px-3" />
          </label>
          <input aria-label="New semester start date" type="date" value={newSemesterStart} onChange={(e) => setNewSemesterStart(e.target.value)} className="min-h-[44px] rounded-xl border border-line bg-surface px-3" />
          <button className="btn" onClick={addSemester}>Add</button>
          <button className="btn" onClick={exportBackup}>Export backup</button>
          <label className="btn cursor-pointer">Import backup<input type="file" accept="application/json" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) try { await importBackup(file); } catch (err) { alert((err as Error).message); }
          }} /></label>
        </div>
      )}

      {tab === 'scan' && (
        <section className="mx-auto grid w-full max-w-5xl gap-6">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">{semesterName || 'Semester'} semester box</h1>
            <p className="mt-1 text-muted">Drop all your syllabi at once. Week-based dates use the semester start date above; check extracted dates against the syllabus. Changing the start date affects new scans only, so review or rescan existing week-based events. {auto ? 'They merge into the box automatically.' : 'They wait here until you choose what to merge.'}</p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div role="group" aria-label="Merge mode" className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
              <button className={`btn border-0 ${auto ? 'bg-accent text-onaccent' : ''}`} aria-pressed={auto} onClick={() => setAuto(true)}>Auto-merge</button>
              <button className={`btn border-0 ${!auto ? 'bg-accent text-onaccent' : ''}`} aria-pressed={!auto} onClick={() => setAuto(false)}>Choose manually</button>
            </div>
            <label className="grid gap-1 text-sm font-medium">Day 1 (class meets)
              <select aria-label="Class day 1" required value={day1} onChange={(e) => { setDay1(e.target.value); if (day2 && Number(day2) <= Number(e.target.value)) setDay2(''); }} className="min-h-[44px] rounded-xl border border-line bg-surface px-3">
                <option value="" disabled>Choose a day</option>
                {WEEKDAYS.slice(0, 4).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">Day 2 (class meets)
              <select aria-label="Class day 2" required value={day2} disabled={!day1} onChange={(e) => setDay2(e.target.value)} className="min-h-[44px] rounded-xl border border-line bg-surface px-3 disabled:opacity-60">
                <option value="" disabled>{day1 ? 'Choose a day' : 'Pick Day 1 first'}</option>
                {WEEKDAYS.filter((d) => Number(d.value) > Number(day1)).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          </div>
          <div {...getRootProps()} aria-disabled={!daysChosen} className={`card border-2 border-dashed py-10 text-center ${daysChosen ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${isDragActive ? 'border-accent bg-soft' : ''}`}>
            <input {...getInputProps()} />
            <p className="font-display text-xl font-bold">{!daysChosen ? 'Choose the two class days first' : isDragActive ? 'Release to add your syllabi' : 'Drop your syllabus PDFs here'}</p>
            <p className="text-sm text-muted">Session 1 is placed on Day 1, session 2 on Day 2, session 3 on Day 1 of the next week, and so on. The course name comes from the file name.</p>
            <p className="text-sm text-muted">Up to 8 PDFs, 10 MB each. Scanned PDFs may require a clearer or higher-resolution scan.</p>
          </div>
          {jobs.length > 0 && <ul className="grid gap-2">{jobs.map((j) => (
            <li key={j.name} className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
              <span className="font-medium">{j.name}</span>
              <span className={`chip ${j.status === 'done' ? 'bg-okbg text-okink' : j.status === 'error' ? 'bg-warnbg text-warnink' : 'bg-soft text-accent'}`}>{j.status === 'scanning' ? 'Scanning' : j.status === 'done' ? 'Scanned' : j.msg}</span>
            </li>
          ))}</ul>}
          {!auto && pending.length > 0 && <div className="card grid gap-3">
            <h2 className="font-display text-xl font-bold">Choose what to merge</h2>
            {pending.map((s) => <label key={s.id} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line px-4">
              <input type="checkbox" className="h-5 w-5" checked={picked.includes(s.id!)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id!] : picked.filter((i) => i !== s.id))} />
              <span className="flex-1 font-medium">{s.course}</span><span className="text-sm text-muted">{s.events.length} events</span>
            </label>)}
            <button className="btn-primary" disabled={!picked.length} onClick={mergePicked}>Merge {picked.length || ''} selected into {semesterName}</button>
          </div>}
          {merged.length > 0 && <button className="btn-primary justify-self-start" onClick={() => setTab('upcoming')}>See {upcoming.length} upcoming events</button>}
        </section>
      )}

      {tab === 'upcoming' && (
        <section className="mx-auto grid w-full max-w-5xl gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 className="font-display text-4xl font-bold tracking-tight">Upcoming events</h1><p className="mt-1 text-muted">Everything due across your {courses.length} merged {courses.length === 1 ? 'course' : 'courses'}{merged.length > courses.length ? ' and your personal events' : ''}.</p></div>
            <button className="btn-primary" disabled={!all.length} onClick={() => downloadIcs(semesterName.replace(/\s/g, '-').toLowerCase(), all)}>Export merged .ics</button>
          </div>
          {!all.length ? <p className="card text-muted">Nothing merged yet. Scan your syllabi first.</p> : <>
            <div className="flex flex-wrap gap-3">{stat('Upcoming', upcoming.length)}{stat('Next 7 days', week.length)}{stat('Courses', courses.length)}{stat('Need review', review, review > 0)}</div>
            {busy.map(([d, n]) => <p key={d} className="rounded-xl border border-warnink bg-warnbg p-4 text-warnink"><b>Busy day ahead.</b> {n} deadlines land on {fmt(d)}. Start one early.</p>)}
            {[['Next 7 days', week], ['Later', later]].map(([label, list]) => Array.isArray(list) && list.length > 0 && <div key={label as string} className="grid gap-2"><h2 className="font-display text-lg font-bold">{label as string}</h2><ul className="grid gap-2">{(list as CalEvent[]).map((e) => <Row key={e.id} e={e} />)}</ul></div>)}
          </>}
        </section>
      )}

      {tab === 'month' && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Fixed minimum width so the controls don't jump as the title length changes between periods. */}
            <h1 className="min-w-[15ch] font-display text-4xl font-bold tabular-nums tracking-tight">{viewLabel(cursor, view)}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Calendar view" className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
                {(['week', 'month', 'year'] as CalendarView[]).map((v) => (
                  <button key={v} className={`btn border-0 capitalize ${view === v ? 'bg-accent text-onaccent' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>
                ))}
              </div>
              <button className="btn" onClick={() => setCursor((c) => shiftCursor(c, view, -1))} aria-label={`Previous ${view}`}>Previous</button>
              <button className="btn" onClick={() => setCursor(today())}>Today</button>
              <button className="btn" onClick={() => setCursor((c) => shiftCursor(c, view, 1))} aria-label={`Next ${view}`}>Next</button>
              <button className="btn-primary" onClick={() => setAddDate(todayKey >= rangeFrom && todayKey <= rangeTo ? todayKey : rangeFrom)}>+ Add Event</button>
              {/* Panel toggles keep the same label (state shown by the pressed style), so the header never reflows. */}
              <button className={`btn w-24 justify-center ${filterOpen ? 'bg-soft text-accent' : ''}`} aria-pressed={filterOpen} aria-controls="course-filter" onClick={() => toggleFilter(!filterOpen)} title={filterOpen ? 'Hide course filter' : 'Show course filter'}>Filters</button>
              <button className={`btn w-24 justify-center ${showShifts ? 'bg-soft text-accent' : ''}`} aria-pressed={showShifts} onClick={() => toggleShifts(!showShifts)}
                title={showShifts ? 'Showing dates after your shifts. Click to show original dates.' : 'Showing original dates (no shifts). Click to show your shifts.'}>Shifts</button>
              <button className={`btn w-24 justify-center ${sidebarOpen ? 'bg-soft text-accent' : ''}`} aria-pressed={sidebarOpen} aria-controls="calendar-sidebar" onClick={() => toggleSidebar(!sidebarOpen)} title={sidebarOpen ? 'Hide details and academic events' : 'Show details and academic events'}>Details</button>
            </div>
          </div>

          {/* One fixed-height status line instead of notices that appear and push the calendar down. */}
          <div role="status" className="flex h-9 items-center justify-between gap-3 overflow-hidden rounded-xl border border-line bg-surface px-3 text-sm text-muted">
            <span className="min-w-0 truncate">
              {all.length === 0 ? 'No merged events yet. Scan a syllabus and merge it to add events to the calendar.'
                : courseVisible.length === 0 ? <>All courses are hidden by the filter. <button className="font-medium text-accent hover:underline" onClick={() => saveHidden(toggleAll(hiddenCourses, filterIds))}>Select all</button></>
                : eventsInView.length === 0 ? <>No events in {periodName}. <button className="font-medium text-accent hover:underline" onClick={jumpToNextEvent}>Jump to the {calendarEvents.some((e) => e.date! >= todayKey) ? 'next upcoming' : 'first'} event</button></>
                : `${eventsInView.length} ${eventsInView.length === 1 ? 'event' : 'events'} in ${periodName}${hiddenByFilter ? ` · ${hiddenByFilter} hidden by filter` : ''}${showShifts ? '' : ' · original dates (shifts off)'}`}
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
            filterOpen && sidebarOpen ? 'lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_18rem]'
            : filterOpen ? 'lg:grid-cols-[15rem_minmax(0,1fr)]'
            : sidebarOpen ? 'lg:grid-cols-[minmax(0,1fr)_18rem]' : ''}`}>
          {filterOpen && (
            <aside id="course-filter" aria-label="Course filter" className="grid gap-3 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold">Courses</h2>
                <button className="btn px-3" onClick={() => toggleFilter(false)} aria-label="Hide course filter">✕</button>
              </div>
              {filterList.length === 0 ? (
                <p className="text-sm text-muted">No merged courses in {semesterName || 'this semester'} yet.</p>
              ) : (
                <>
                  <button className="btn justify-self-start text-sm" onClick={() => saveHidden(toggleAll(hiddenCourses, filterIds))}>
                    {allVisible(hiddenCourses, filterIds) ? 'Deselect all' : 'Select all'}
                  </button>
                  <ul className="flex flex-wrap gap-1.5 lg:grid lg:gap-1">
                    {filterList.map((s) => {
                      const personal = isPersonalScan(s);
                      const visible = !hiddenCourses.has(s.id!);
                      const color = colorOf.get(s.id!) ?? 'blue';
                      const picking = colorPickerFor === s.id;
                      return (
                        <li key={s.id} className="grid gap-1">
                          <div className={`flex min-h-[40px] max-w-[18rem] items-center gap-2 rounded-full border border-line pl-1.5 pr-3 text-sm hover:bg-soft lg:max-w-none lg:rounded-lg lg:border-0 lg:pl-1 lg:pr-2 ${visible ? '' : 'text-muted'}`}>
                            {/* Swatch = colour picker button. */}
                            <button type="button" onClick={() => setColorPickerFor(picking ? null : s.id!)} aria-expanded={picking} aria-label={`Change colour for ${s.course} (now ${color})`} title="Change colour"
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-surface ${picking ? 'ring-2 ring-accent' : ''}`}>
                              <span aria-hidden="true" className={`h-4 w-4 rounded-full ${CC_SWATCH[color]} ${visible ? '' : 'opacity-40'}`} />
                            </button>
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input type="checkbox" className="h-4 w-4 shrink-0" checked={visible} onChange={(e) => saveHidden(toggleCourse(hiddenCourses, s.id!, e.target.checked))} />
                              <span className="min-w-0 flex-1 truncate" title={s.course}>{personal && '📌 '}{s.course}</span>
                              <span className="shrink-0 text-xs text-muted">{s.events.filter((e) => e.date).length}</span>
                            </label>
                          </div>
                          {picking && (
                            <div role="radiogroup" aria-label={`Colour for ${s.course}`} className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-bg p-2">
                              {COURSE_COLORS.map((c) => (
                                <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} title={c}
                                  onClick={() => { setCourseColor(s.id!, c); setColorPickerFor(null); }}
                                  className={`h-7 w-7 rounded-full ${CC_SWATCH[c]} ${c === color ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:ring-2 hover:ring-line hover:ring-offset-2 hover:ring-offset-surface'} transition-shadow`} />
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {hiddenByFilter > 0 && <p className="text-xs text-muted">{hiddenByFilter} {hiddenByFilter === 1 ? 'event' : 'events'} hidden by this filter.</p>}
                </>
              )}
              {pending.length > 0 && <p className="text-xs text-muted">{pending.length} scanned {pending.length === 1 ? 'course is' : 'courses are'} not merged yet, so not listed.</p>}
            </aside>
          )}
          <div className="grid min-w-0 gap-4">
          {view !== 'year' && (
            <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-surface">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="border-b border-line p-2 text-center text-xs font-bold text-muted">{day}</div>)}
              {view === 'week'
                ? weekDays(cursor).map((date) => dayCell(date, 'week'))
                : monthGrid(cursor).map((date) => dayCell(date, 'month', date.getMonth() !== cursor.getMonth()))}
            </div>
          )}

          {view === 'year' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MONTH_NAMES.map((name, m) => {
                const prefix = `${cursor.getFullYear()}-${String(m + 1).padStart(2, '0')}-`;
                const events = calendarEvents.filter((e) => e.date!.startsWith(prefix));
                const isCurrentMonth = todayKey.startsWith(prefix);
                return (
                  <div key={name} className={`flex h-[248px] flex-col gap-1.5 overflow-hidden rounded-2xl border bg-surface p-3 ${isCurrentMonth ? 'border-accent' : 'border-line'}`}>
                    <button type="button" className="flex items-center justify-between text-left font-display font-bold hover:underline" onClick={() => { setView('month'); setCursor(new Date(cursor.getFullYear(), m, 1)); }}>
                      <span>{name}{isCurrentMonth && <span className="chip ml-2 bg-accent text-onaccent">Now</span>}</span>
                      <span className="text-sm font-normal text-muted">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
                    </button>
                    {events.slice(0, events.length > 6 ? 5 : 6).map((e) => <EventChip key={e.id} e={e} personal={e.personal} colorClass={chipColor(e)} onOpen={() => openEvent(e)} label={`${Number(e.date!.slice(8))} · ${e.title}`} />)}
                    {events.length > 6 && (
                      <button type="button" className="h-4 shrink-0 text-left text-xs leading-none text-muted hover:text-accent hover:underline" onClick={() => { setView('month'); setCursor(new Date(cursor.getFullYear(), m, 1)); }}>+{events.length - 5} more</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>

          {sidebarOpen && (
            <aside id="calendar-sidebar" aria-label="Details"
              className={`grid gap-4 rounded-2xl border border-line bg-surface p-4 ${filterOpen ? 'lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1' : 'lg:sticky lg:top-4'}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold">Details</h2>
                <button className="btn px-3" onClick={() => toggleSidebar(false)} aria-label="Hide details sidebar">✕</button>
              </div>
              {selectedAcademic ? (
                <div className="grid gap-2">
                  <span className={`chip justify-self-start border-l-4 text-xs font-bold ${AC_CLASS[selectedAcademic.color]}`}>{ACADEMIC_CATEGORIES[selectedAcademic.color]} · {selectedAcademic.term}</span>
                  <h3 className="font-display text-xl font-bold">{selectedAcademic.title}</h3>
                  <p className="text-sm font-medium text-accent">{fmtRange(selectedAcademic.from, selectedAcademic.to)}</p>
                  <p className="text-sm">{selectedAcademic.description}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button className="btn" onClick={() => setCursor(new Date(`${selectedAcademic.from}T00:00:00`))}>Show on calendar</button>
                    <button className="btn text-muted" onClick={() => setSelectedAcademic(null)}>Clear</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">Click an academic event on the calendar to see its details here.</p>
              )}
              <div className="grid gap-2 border-t border-line pt-3">
                <h3 className="text-sm font-bold">Academic calendar</h3>
                {/* One collapsible list per term; the term being viewed (or the selected event's) starts open.
                    The key includes it so the open state follows navigation. */}
                {(() => {
                  const activeTerm = selectedAcademic?.term ?? termOn(localDateKey(cursor)) ?? termOn(todayKey);
                  return ACADEMIC_TERMS.map((t) => (
                    <details key={`${t}-${activeTerm}`} open={t === activeTerm} className="group">
                      <summary className="cursor-pointer text-sm font-semibold">{t}</summary>
                      <ul className="mt-1 grid gap-1">
                        {ACADEMIC_EVENTS.filter((a) => a.term === t).map((a) => (
                          <li key={a.id}>
                            <button type="button" onClick={() => { showAcademic(a); setCursor(new Date(`${a.from}T00:00:00`)); }}
                              className={`w-full rounded border-l-4 px-2 py-1 text-left text-xs hover:underline ${AC_CLASS[a.color]} ${selectedAcademic?.id === a.id ? 'ring-2 ring-accent' : ''}`}>
                              <span className="font-semibold">{a.title}</span><span className="block opacity-80">{fmtRange(a.from, a.to)}</span>
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
        </section>
      )}

      {tab === 'courses' && (
        <section className="mx-auto grid w-full max-w-5xl gap-5">
          {/* Overview: overall completion across syllabus courses only (personal tasks never count). */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">Your courses</h1>
              <p className="mt-1 text-muted">{courses.length} {courses.length === 1 ? 'course' : 'courses'} in {semesterName || 'this semester'}. Open a course to review its tasks and fix any dates the scan got wrong.</p>
            </div>
            {filterList.length > 0 && (
              <button className="btn" onClick={() => saveExpanded(expandedCourses.size >= filterList.length ? new Set() : new Set(filterIds))}>
                {expandedCourses.size >= filterList.length ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {courses.length > 0 && (() => {
            const o = overallProgress(courses);
            return (
              <div className="card grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">Overall progress</span>
                    <span className="text-sm text-muted">{o.done} of {o.total} assessments done</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-soft" role="progressbar" aria-label="Overall course progress" aria-valuenow={o.percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${o.percent}%` }} />
                  </div>
                  <p className="text-xs text-muted">Counts graded assessments (exams, quizzes, assignments, projects, weighted work). Class sessions and personal tasks are not counted.</p>
                </div>
                <div className="font-display text-4xl font-bold tabular-nums sm:pl-4">{o.percent}%</div>
              </div>
            );
          })()}
          {!courses.length && <p className="card text-muted">No courses yet. Scan a syllabus to add one.</p>}

          {/* One compact card per course (then "My Personal Tasks"); click to open its task list. */}
          {filterList.map((s) => {
            const personal = isPersonalScan(s);
            const open = expandedCourses.has(s.id!);
            const color = colorOf.get(s.id!) ?? 'blue';
            // Courses list and count their assessments only; the personal list shows all of its events.
            const listed = personal ? s.events : s.events.filter(isAssessment);
            const p = courseProgress(listed, todayKey);
            const noun = personal ? 'events' : 'assessments';
            return (
            <div key={s.id} className="card grid gap-0 p-0">
              <button type="button" onClick={() => saveExpanded(toggleCourse(expandedCourses, s.id!, !open))} aria-expanded={open} aria-controls={`course-${s.id}`}
                className="grid w-full gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-soft sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-center">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 rounded-full ${CC_SWATCH[color]}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg font-bold">{personal && '📌 '}{s.course}</span>
                    <span className="block truncate text-sm text-muted">
                      {p.next ? `Next: ${p.next.title} · ${fmt(p.next.date!)}` : p.total ? `No upcoming ${noun}` : `No ${noun}`}
                      {p.review > 0 && <span className="text-warnink"> · {p.review} to check</span>}
                      {p.undated > 0 && <span className="text-warnink"> · {p.undated} without a date</span>}
                    </span>
                  </span>
                </span>
                {/* Progress (courses only). Personal tasks just show a count. */}
                {personal ? (
                  <span className="text-sm text-muted sm:text-right">{p.done} of {p.total} done · not counted</span>
                ) : (
                  <span className="grid gap-1">
                    <span className="flex justify-between text-xs text-muted"><span>{p.done} of {p.total} assessments done</span><span className="font-semibold tabular-nums text-ink">{p.percent}%</span></span>
                    <span className="h-2 overflow-hidden rounded-full bg-soft" role="progressbar" aria-label={`${s.course} progress`} aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
                      <span className={`block h-full rounded-full transition-[width] duration-300 ${CC_SWATCH[color]}`} style={{ width: `${p.percent}%` }} />
                    </span>
                  </span>
                )}
                <span aria-hidden="true" className={`hidden h-8 w-8 items-center justify-center rounded-full text-muted transition-transform duration-200 sm:flex ${open ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {open && (
              <div id={`course-${s.id}`} className="grid gap-3 border-t border-line p-4">
                {/* Class days: change them (e.g. Tue/Thu -> Mon/Wed) and the course's sessions move on the calendar. */}
                {!personal && (
                  <ClassDaysEditor current={classDaysFor(s)} inferred={!s.classDays?.length} events={s.events}
                    onApply={(days) => applyClassDays(s.id!, days)} />
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">{personal ? 'Personal events added on the calendar' : `Assessments from ${s.fileName} · class sessions are on the calendar`}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {s.lastShift && <button className="btn" title={`Last shift: ${s.lastShift.label}`} onClick={() => undoLastShift(s.id!)}>Undo last shift</button>}
                  <button className="btn" onClick={() => downloadIcs(s.course.split(':')[0].replace(/\s/g, ''), s.events.map((e) => ({ ...e, course: s.course })))}>Export .ics</button>
                  <button className="btn text-muted" onClick={() => db.scans.delete(s.id!)}>{personal ? 'Delete all personal events' : 'Delete course'}</button>
                </div>
                </div>
                {listed.length === 0 ? <p className="text-sm text-muted">{personal ? 'No personal events.' : 'No assessments found in this syllabus. Its class sessions are on the calendar.'}</p> : (
                  <>
                    {/* Column labels for the task rows (wide screens). */}
                    <div className="hidden px-2 text-xs font-medium text-muted md:grid md:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] md:gap-2">
                      <span className="w-7">Done</span><span>Task</span><span>Type</span><span>Date</span><span>Time</span><span>Weight</span><span className="w-[10.5rem]" />
                    </div>
                    <ul className="grid gap-2">{sortTasks(listed).map((e) => (
                      <EventRow key={e.id} e={e} onSave={(patch) => updateEvent(s.id!, e.id, patch)} onDelete={() => deleteEvent(s.id!, e.id)} onToggleCompleted={(completed) => setEventCompleted(s.id!, e.id, completed)} />
                    ))}</ul>
                  </>
                )}
              </div>
              )}
            </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
