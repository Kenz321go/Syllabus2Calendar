import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftPatch, toDraft } from './edit';
import { downloadBlob, downloadIcs } from './ics';
import type { EventItem } from './db';

const ev: EventItem = { id: 'e1', title: 'Midterm', type: 'exam', date: '2026-10-12', time: '14:00', weight: 25, source: 'Midterm Oct 12', needsReview: true };

describe('draftPatch', () => {
  it('returns an empty patch when nothing changed, so blur alone does not clear "Check date"', () => {
    expect(draftPatch(toDraft(ev), ev)).toEqual({});
  });

  it('returns only the changed fields', () => {
    expect(draftPatch({ ...toDraft(ev), title: '  Midterm 1 ', weight: '30' }, ev)).toEqual({ title: 'Midterm 1', weight: 30 });
  });

  it('maps cleared date, time and weight to null', () => {
    expect(draftPatch({ ...toDraft(ev), date: '', time: '', weight: ' ' }, ev)).toEqual({ date: null, time: null, weight: null });
  });

  it('ignores a blank title and a non-numeric weight instead of saving them', () => {
    expect(draftPatch({ ...toDraft(ev), title: '   ', weight: 'abc' }, ev)).toEqual({});
  });

  it('round-trips null fields through the draft', () => {
    const bare: EventItem = { ...ev, date: null, time: null, weight: null };
    expect(toDraft(bare)).toMatchObject({ date: '', time: '', weight: '' });
    expect(draftPatch(toDraft(bare), bare)).toEqual({});
  });
});

describe('downloadBlob / downloadIcs', () => {
  let click: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  let anchor: { href: string; download: string; click: () => void };

  beforeEach(() => {
    vi.useFakeTimers();
    click = vi.fn();
    revoke = vi.fn();
    anchor = { href: '', download: '', click };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('revokes the object URL after the download is triggered, not before', () => {
    downloadBlob(new Blob(['x']), 'file.json');
    expect(anchor).toMatchObject({ href: 'blob:fake-url', download: 'file.json' });
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:fake-url');
  });

  it('downloadIcs builds a calendar file and releases its URL', () => {
    downloadIcs('cs101', [{ ...ev, course: 'CS 101: Intro' }]);
    expect(anchor.download).toBe('cs101.ics');
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:fake-url');
  });
});
