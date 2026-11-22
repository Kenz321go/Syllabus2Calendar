'use client';
import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { downloadIcs, CalEvent } from '@/lib/ics';

const SEMESTER = 'Fall 2026';
type Job = { name: string; status: 'scanning' | 'done' | 'error'; msg?: string };
const midnight = () => new Date(new Date().toDateString()).getTime();
const daysUntil = (d: string) => Math.round((new Date(`${d}T00:00:00`).getTime() - midnight()) / 864e5);
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const when = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);

function Row({ e }: { e: CalEvent }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="w-28 text-sm font-medium text-accent">{fmt(e.date!)}</div>
      <div className="flex-1">
        <div className="font-medium">{e.title}</div>
        <div className="text-sm text-muted">{when(daysUntil(e.date!))}{e.weight ? `, ${e.weight}% of grade` : ''}</div>
      </div>
      {e.needsReview && <span className="chip bg-warnbg text-warnink">Check date</span>}
      <span className="chip bg-soft text-accent">{e.course.split(':')[0]}</span>
    </li>
  );
}

export default function Home() {
  const [tab, setTab] = useState<'scan' | 'upcoming' | 'courses'>('scan');
  const [auto, setAuto] = useState(true);
  const [dark, setDark] = useState(false);
  const [start, setStart] = useState('2026-08-31');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const scans = useLiveQuery(() => db.scans.where('semester').equals(SEMESTER).toArray(), []) ?? [];
  const merged = scans.filter((s) => s.merged);
  const pending = scans.filter((s) => !s.merged);
  const all: CalEvent[] = merged.flatMap((s) => s.events.map((e) => ({ ...e, course: s.course }))).filter((e) => e.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const upcoming = all.filter((e) => daysUntil(e.date!) >= 0);
  const counts = upcoming.reduce<Record<string, number>>((m, e) => ({ ...m, [e.date!]: (m[e.date!] ?? 0) + 1 }), {});
  const busy = Object.entries(counts).filter(([, n]) => n >= 3);
  const review = merged.flatMap((s) => s.events).filter((e) => e.needsReview).length;
  const week = upcoming.filter((e) => daysUntil(e.date!) <= 7);
  const later = upcoming.filter((e) => daysUntil(e.date!) > 7);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const onDrop = useCallback((files: File[]) => {
    files.forEach(async (f) => {
      const set = (p: Partial<Job>) => setJobs((j) => j.map((x) => (x.name === f.name ? { ...x, ...p } : x)));
      setJobs((j) => [...j.filter((x) => x.name !== f.name), { name: f.name, status: 'scanning' }]);
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('start', start);
        const res = await fetch('/api/extract', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await db.scans.add({ course: data.course, fileName: f.name, semester: SEMESTER, merged: auto, events: data.events, createdAt: Date.now() });
        set({ status: 'done' });
      } catch (e) { set({ status: 'error', msg: (e as Error).message }); }
    });
  }, [start, auto]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 8 });

  const mergePicked = () => db.scans.where('id').anyOf(picked).modify({ merged: true }).then(() => setPicked([]));
  const editDate = (id: number, evId: string, date: string) => {
    const s = scans.find((x) => x.id === id)!;
    db.scans.update(id, { events: s.events.map((e) => (e.id === evId ? { ...e, date: date || null, needsReview: false } : e)) });
  };
  const stat = (label: string, value: string | number, warn = false) => (
    <div className={`flex-1 min-w-[140px] rounded-2xl border p-4 ${warn ? 'border-warnink bg-warnbg text-warnink' : 'border-line bg-surface'}`}>
      <div className="text-sm">{label}</div><div className="font-display text-3xl font-bold">{value}</div>
    </div>
  );

  return (
    <main className="mx-auto max-w-5xl px-6 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-2 py-5">
        <b className="font-display text-lg">Syllabus2Cal</b>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          {(['scan', 'upcoming', 'courses'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`btn border-0 ${tab === t ? 'bg-soft text-accent' : 'text-muted'}`}>
              {t === 'scan' ? 'Scan and merge' : t === 'upcoming' ? 'Upcoming' : 'Courses'}
            </button>
          ))}
          <button className="btn" onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button>
        </nav>
      </header>

      {tab === 'scan' && (
        <section className="grid gap-6">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">{SEMESTER} semester box</h1>
            <p className="mt-1 text-muted">Drop all your syllabi at once. {auto ? 'They merge into the box automatically.' : 'They wait here until you choose what to merge.'}</p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div role="group" aria-label="Merge mode" className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
              <button className={`btn border-0 ${auto ? 'bg-accent text-onaccent' : ''}`} aria-pressed={auto} onClick={() => setAuto(true)}>Auto-merge</button>
              <button className={`btn border-0 ${!auto ? 'bg-accent text-onaccent' : ''}`} aria-pressed={!auto} onClick={() => setAuto(false)}>Choose manually</button>
            </div>
            <label className="grid gap-1 text-sm font-medium">Semester start date
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-[44px] rounded-xl border border-line bg-surface px-3" />
            </label>
          </div>
          <div {...getRootProps()} className={`card cursor-pointer border-2 border-dashed py-10 text-center ${isDragActive ? 'border-accent bg-soft' : ''}`}>
            <input {...getInputProps()} />
            <p className="font-display text-xl font-bold">{isDragActive ? 'Release to add your syllabi' : 'Drop your syllabus PDFs here'}</p>
            <p className="text-sm text-muted">Up to 8 PDFs, 10 MB each. Or click to choose files.</p>
          </div>
          {jobs.length > 0 && (
            <ul className="grid gap-2">{jobs.map((j) => (
              <li key={j.name} className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
                <span className="font-medium">{j.name}</span>
                <span className={`chip ${j.status === 'done' ? 'bg-okbg text-okink' : j.status === 'error' ? 'bg-warnbg text-warnink' : 'bg-soft text-accent'}`}>
                  {j.status === 'scanning' ? 'Scanning' : j.status === 'done' ? 'Scanned' : j.msg}
                </span>
              </li>))}
            </ul>
          )}
          {!auto && pending.length > 0 && (
            <div className="card grid gap-3">
              <h2 className="font-display text-xl font-bold">Choose what to merge</h2>
              {pending.map((s) => (
                <label key={s.id} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line px-4">
                  <input type="checkbox" className="h-5 w-5" checked={picked.includes(s.id!)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id!] : picked.filter((i) => i !== s.id))} />
                  <span className="flex-1 font-medium">{s.course}</span>
                  <span className="text-sm text-muted">{s.events.length} events</span>
                </label>))}
              <button className="btn-primary" disabled={!picked.length} onClick={mergePicked}>Merge {picked.length || ''} selected into {SEMESTER}</button>
            </div>
          )}
          {merged.length > 0 && <button className="btn-primary justify-self-start" onClick={() => setTab('upcoming')}>See {upcoming.length} upcoming events</button>}
        </section>
      )}

      {tab === 'upcoming' && (
        <section className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">Upcoming events</h1>
              <p className="mt-1 text-muted">Everything due across your {merged.length} merged courses.</p>
            </div>
            <button className="btn-primary" disabled={!all.length} onClick={() => downloadIcs('fall-2026', all)}>Export merged .ics</button>
          </div>
          {!all.length ? <p className="card text-muted">Nothing merged yet. Scan your syllabi first.</p> : (<>
            <div className="flex flex-wrap gap-3">{stat('Upcoming', upcoming.length)}{stat('Next 7 days', week.length)}{stat('Courses', merged.length)}{stat('Need review', review, review > 0)}</div>
            {busy.map(([d, n]) => <p key={d} className="rounded-xl border border-warnink bg-warnbg p-4 text-warnink"><b>Busy day ahead.</b> {n} deadlines land on {fmt(d)}. Start one early.</p>)}
            {([['Next 7 days', week], ['Later', later]] as const).map(([label, list]) => list.length > 0 && (
              <div key={label} className="grid gap-2"><h2 className="font-display text-lg font-bold">{label}</h2><ul className="grid gap-2">{list.map((e) => <Row key={e.id} e={e} />)}</ul></div>))}
          </>)}
        </section>
      )}

      {tab === 'courses' && (
        <section className="grid gap-6">
          <h1 className="font-display text-4xl font-bold tracking-tight">Your courses</h1>
          {!merged.length && <p className="card text-muted">No courses yet. Scan a syllabus to add one.</p>}
          {merged.map((s) => (
            <div key={s.id} className="card grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="font-display text-xl font-bold">{s.course}</h2><p className="text-sm text-muted">{s.events.length} events from {s.fileName}</p></div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => downloadIcs(s.course.split(':')[0].replace(/\s/g, ''), s.events.map((e) => ({ ...e, course: s.course })))}>Export .ics</button>
                  <button className="btn text-muted" onClick={() => db.scans.delete(s.id!)}>Delete course</button>
                </div>
              </div>
              <ul className="grid gap-2">{s.events.map((e) => (
                <li key={e.id} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2 ${e.needsReview ? 'border-warnink bg-warnbg text-warnink' : 'border-line'}`}>
                  <span className="flex-1 font-medium">{e.title}</span>
                  {e.weight ? <span className="text-sm">{e.weight}%</span> : null}
                  <input aria-label={`Date for ${e.title}`} type="date" value={e.date ?? ''} onChange={(ev) => editDate(s.id!, e.id, ev.target.value)} className="min-h-[44px] rounded-lg border border-line bg-surface px-2 text-ink" />
                </li>))}
              </ul>
            </div>))}
        </section>
      )}
    </main>
  );
}
