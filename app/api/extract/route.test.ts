import { describe, expect, it } from 'vitest';
import { resolveDate as resolve } from '../../../lib/date';

describe('resolve', () => {
  it('uses an explicit high-confidence date', () => {
    expect(resolve({ title: 'Midterm', type: 'exam', date: '2026-10-12', week: null, weekday: null, time: null, weight: 20, source: 'Midterm October 12', confidence: 'high' }, '2026-08-31')).toEqual({ date: '2026-10-12', review: false });
  });

  it('converts Week N, weekday to a real date', () => {
    expect(resolve({ title: 'Exam', type: 'exam', date: null, week: 9, weekday: 5, time: null, weight: null, source: 'Week 9 Friday', confidence: 'medium' }, '2026-08-31')).toEqual({ date: '2026-10-30', review: true });
  });

  it('requires review when no date can be resolved', () => {
    expect(resolve({ title: 'Project', type: 'project', date: null, week: null, weekday: null, time: null, weight: null, source: 'End of semester', confidence: 'low' }, '2026-08-31')).toEqual({ date: null, review: true });
  });
});

// ---- POST /api/extract (Gemini fetch is stubbed; no real credentials or network) ----
import { afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const FAKE_KEY = 'test-key-not-real';
const FAKE_MODEL = 'gemini-test-model';
const PDF_BYTES = '%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n';
let ipCounter = 0;

// Class days default to Tuesday (2) and Thursday (4); pass null to omit a field.
function upload({ body = PDF_BYTES, type = 'application/pdf', start = '2026-08-31', name = 'syllabus.pdf', day1 = '2' as string | null, day2 = '4' as string | null } = {}) {
  const fd = new FormData();
  fd.append('file', new File([body], name, { type }));
  fd.append('start', start);
  if (day1 !== null) fd.append('day1', day1);
  if (day2 !== null) fd.append('day2', day2);
  return new NextRequest('http://localhost/api/extract', { method: 'POST', body: fd, headers: { 'x-forwarded-for': `10.0.0.${++ipCounter}` } });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const geminiText = (text: string) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const spyConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const loggedText = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.flat().map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join('\n');

describe('POST /api/extract', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof spyConsoleError>;

  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
    vi.stubEnv('GEMINI_MODEL', FAKE_MODEL);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = spyConsoleError();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
  });

  it('reports an unavailable configured model (Gemini 404 NOT_FOUND) as a config error without leaking values', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 404, status: 'NOT_FOUND', message: `models/${FAKE_MODEL} is not found for API version v1beta` } }, 404));
    const res = await POST(upload());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'The configured Gemini model is not available. Check GEMINI_MODEL on the server.' });
    const logs = loggedText(errorSpy);
    expect(logs).toContain('HTTP 404 (status: NOT_FOUND');
    expect(logs).toContain('GEMINI_MODEL is set');
    expect(logs).not.toContain(FAKE_KEY);
    expect(logs).not.toContain(FAKE_MODEL);
    expect(logs).not.toContain('is not found for API version');
  });

  it('treats a 400 API_KEY_INVALID as a server config error, not a bad PDF', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, 400));
    const res = await POST(upload());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/API key/);
    expect(loggedText(errorSpy)).toContain('reason: API_KEY_INVALID');
  });

  it('keeps a plain 400 INVALID_ARGUMENT mapped to 422 (PDF could not be processed)', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The document has no pages.' } }, 400));
    const res = await POST(upload());
    expect(res.status).toBe(422);
    expect(loggedText(errorSpy)).not.toContain('The document has no pages');
  });

  it('handles a non-JSON upstream error body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Not Found</html>', { status: 404 }));
    const res = await POST(upload());
    expect(res.status).toBe(500);
    expect(loggedText(errorSpy)).toContain('status: unknown');
  });

  it('sends the PDF to the configured model and returns resolved events', async () => {
    fetchMock.mockResolvedValue(geminiText(JSON.stringify({ course: 'CS 101: Intro', events: [
      { title: 'Midterm', type: 'exam', date: '2026-10-12', week: null, weekday: null, time: '14:00', weight: 25, source: 'Midterm Oct 12', confidence: 'high' },
      { title: 'Quiz 1', type: 'quiz', date: null, week: 3, weekday: 3, time: null, weight: null, source: 'Week 3 Wednesday', confidence: 'medium' },
    ] })));
    const res = await POST(upload());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.course).toBe('syllabus'); // from the file name, not Gemini
    expect(data.events.map((e: { date: string; needsReview: boolean }) => [e.date, e.needsReview])).toEqual([['2026-10-12', false], ['2026-09-16', true]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${FAKE_MODEL}:generateContent`);
    expect(init.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(JSON.parse(init.body).contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
  });

  it('maps an upstream timeout to 504', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const res = await POST(upload());
    expect(res.status).toBe(504);
  });

  it('rejects a file without a PDF signature before calling Gemini', async () => {
    const res = await POST(upload({ body: 'not a pdf' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a config error when GEMINI_API_KEY is missing, without calling Gemini', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const res = await POST(upload());
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/extract default model', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('falls back to a currently served model when GEMINI_MODEL is unset or blank', async () => {
    vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
    vi.stubEnv('GEMINI_MODEL', '   ');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const fetchMock = vi.fn().mockResolvedValue(geminiText('{"course":"X","events":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
  });
});

describe('POST /api/extract forgiving event parsing', () => {
  let errorSpy: ReturnType<typeof spyConsoleError>;
  const scan = async (output: unknown) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiText(JSON.stringify(output))));
    return POST(upload());
  };
  const good = { title: 'Midterm', type: 'exam', date: '2026-10-12', week: null, weekday: null, time: '14:00', weight: 25, source: 'Midterm Oct 12', confidence: 'high' };

  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
    vi.stubEnv('GEMINI_MODEL', FAKE_MODEL);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    errorSpy = spyConsoleError();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); errorSpy.mockRestore(); });

  it('pads H:MM times and nulls unparseable ones', async () => {
    const res = await scan({ course: 'C', events: [{ ...good, time: '9:30' }, { ...good, time: '7:05' }, { ...good, time: '12:00' }, { ...good, time: '25:00' }, { ...good, time: '2pm' }] });
    expect(res.status).toBe(200);
    expect((await res.json()).events.map((e: { time: string | null }) => e.time)).toEqual(['09:30', '07:05', '12:00', null, null]);
  });

  it('coerces weight strings like "20%" and nulls bad or out-of-range weights', async () => {
    const res = await scan({ course: 'C', events: ['20%', ' 12.5 % ', '30', 'abc', '', 150, -1, true].map((weight) => ({ ...good, weight })) });
    expect(res.status).toBe(200);
    expect((await res.json()).events.map((e: { weight: number | null }) => e.weight)).toEqual([20, 12.5, 30, null, null, null, null, null]);
  });

  it('falls back field by field instead of rejecting the whole PDF', async () => {
    const res = await scan({ course: 'CS 101', events: [
      good,
      { title: 'Quiz 1', type: 'Quiz', week: '3', weekday: 3, confidence: 'Medium' }, // missing fields, string week, mixed case
      { title: 'Lab report', type: 'lab', date: 'Oct 12', week: 99, weekday: 9, time: 930, weight: null, source: 42, confidence: 'certain' },
      { type: 'exam', date: '2026-12-10', confidence: 'high' }, // no title
    ] });
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ title: 'Midterm', date: '2026-10-12', time: '14:00', weight: 25, needsReview: false });
    expect(events[1]).toMatchObject({ title: 'Quiz 1', type: 'quiz', date: '2026-09-16', time: null, weight: null, source: '', needsReview: true });
    expect(events[2]).toMatchObject({ title: 'Lab report', type: 'other', date: null, time: null, source: '', needsReview: true });
    expect(events[3]).toMatchObject({ title: 'Untitled event', type: 'exam', date: '2026-12-10', needsReview: true });
  });

  it('drops non-object events', async () => {
    const res = await scan({ events: [good, 'not an event', null, [1, 2]] });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(loggedText(errorSpy)).toContain('3 event(s) dropped');
  });

  it('logs the Zod issue paths and codes without logging values, PDF text or secrets', async () => {
    const res = await scan({ course: 'C', events: [{ ...good, time: '9:30', weight: '20%', confidence: 'VeryHigh', source: 'CONFIDENTIAL syllabus sentence' }] });
    expect(res.status).toBe(200);
    const logs = loggedText(errorSpy);
    expect(logs).toContain('repaired to fit the schema');
    expect(logs).toContain('events.0.time: invalid_string');
    expect(logs).toContain('events.0.weight: invalid_type (expected number, received string)');
    expect(logs).toContain('events.0.confidence: invalid_enum_value');
    for (const secret of ['9:30', '20%', 'VeryHigh', 'CONFIDENTIAL', FAKE_KEY]) expect(logs).not.toContain(secret);
  });

  it('logs nothing extra when Gemini output is already valid', async () => {
    const res = await scan({ course: 'C', events: [good] });
    expect(res.status).toBe(200);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still rejects output with no events array, with a redacted log', async () => {
    const res = await scan({ course: 'C', events: 'Midterm on Oct 12' });
    expect(res.status).toBe(502);
    const logs = loggedText(errorSpy);
    expect(logs).toContain('events: invalid_type (expected array, received string)');
    expect(logs).not.toContain('Midterm on Oct 12');
  });
});

// ---- Course Outline sessions -> class days -> calendar date; course name from file name ----
import { parseClassDays, scheduleFor } from '../../../lib/date';

describe('parseClassDays', () => {
  it('accepts two weekdays with Day 1 before Day 2', () => {
    expect(parseClassDays('1', '3')).toEqual([1, 3]);
    expect(parseClassDays('4', '5')).toEqual([4, 5]);
  });
  it('rejects missing, weekend, equal or reversed days', () => {
    for (const [a, b] of [[null, '3'], ['', '3'], ['1', null], ['6', '7'], ['0', '2'], ['3', '3'], ['4', '2'], ['1.5', '3'], ['mon', 'wed']])
      expect(parseClassDays(a, b)).toBeNull();
  });
});

describe('scheduleFor with class days', () => {
  const tueThu = [2, 4];
  it('alternates sessions between Day 1 and Day 2, two per week', () => {
    expect([1, 2, 3, 4, 15, 16, 29, 30].map((session) => scheduleFor({ session, week: null, weekday: null }, tueThu))).toEqual([
      { week: 1, weekday: 2 }, { week: 1, weekday: 4 }, { week: 2, weekday: 2 }, { week: 2, weekday: 4 },
      { week: 8, weekday: 2 }, { week: 8, weekday: 4 }, { week: 15, weekday: 2 }, { week: 15, weekday: 4 },
    ]);
  });
  it('keeps a weekday the syllabus actually prints', () => {
    expect(scheduleFor({ session: 16, week: null, weekday: 5 }, tueThu)).toEqual({ week: 8, weekday: 5 });
  });
  it('puts a stated "Week N" with no weekday on Day 1', () => {
    expect(scheduleFor({ session: null, week: 9, weekday: null }, tueThu)).toEqual({ week: 9, weekday: 2 });
  });
  it('leaves events with no session or week unscheduled', () => {
    expect(scheduleFor({ session: null, week: null, weekday: null }, tueThu)).toEqual({ week: null, weekday: null });
  });
});

describe('POST /api/extract class days and course name', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
    vi.stubEnv('GEMINI_MODEL', FAKE_MODEL);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const row = (session: unknown, title: string) => ({ title, type: 'other', date: null, session, week: null, weekday: null, time: null, weight: null, source: 'Session ' + session, confidence: 'medium' });

  it('places sessions on the chosen class days from the semester start, flagged for review', async () => {
    fetchMock.mockResolvedValue(geminiText(JSON.stringify({ events: [
      row(1, 'Explain the course structure'),
      row(2, 'Describe the market'),
      row(3, 'Compare strategies'),
      row(16, 'Analyse competitive forces'),
      row('30', 'Present the final strategy'), // numeric string is coerced
      { title: 'Midterm Exam', type: 'exam', date: null, session: null, week: null, weekday: null, time: null, weight: 30, source: 'Midterm 30%', confidence: 'medium' },
    ] })));
    const res = await POST(upload({ start: '2026-08-31', day1: '2', day2: '4' })); // Mon start; Tue/Thu classes
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.map((e: { title: string; date: string | null; needsReview: boolean; weight: number | null }) => [e.title, e.date, e.needsReview, e.weight])).toEqual([
      ['Explain the course structure', '2026-09-01', true, null], // week 1 Tue
      ['Describe the market', '2026-09-03', true, null],          // week 1 Thu
      ['Compare strategies', '2026-09-08', true, null],           // week 2 Tue
      ['Analyse competitive forces', '2026-10-22', true, null],   // week 8 Thu
      ['Present the final strategy', '2026-12-10', true, null],   // week 15 Thu
      ['Midterm Exam', null, true, 30],                           // weight kept; no date stated
    ]);
  });

  it('uses a different pair of days when chosen (Mon/Wed)', async () => {
    fetchMock.mockResolvedValue(geminiText(JSON.stringify({ events: [row(1, 'A'), row(2, 'B'), row(3, 'C')] })));
    const res = await POST(upload({ day1: '1', day2: '3' }));
    expect((await res.json()).events.map((e: { date: string }) => e.date)).toEqual(['2026-08-31', '2026-09-02', '2026-09-07']);
  });

  it.each([
    ['missing days', { day1: null, day2: null }],
    ['only Day 1', { day2: null }],
    ['the same day twice', { day1: '3', day2: '3' }],
    ['Day 2 before Day 1', { day1: '4', day2: '2' }],
    ['a weekend day', { day1: '5', day2: '6' }],
  ])('rejects %s with 400 before calling Gemini', async (_label, days) => {
    const res = await POST(upload(days));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/class days/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Syllabus comA.pdf', 'Syllabus comA'],
    ['BUS201 Strategy.PDF', 'BUS201 Strategy'],
    ['  Intro   to  Law .pdf', 'Intro to Law'],
    ['.pdf', 'Untitled course'],
  ])('derives the course name from the file name %j', async (name, course) => {
    fetchMock.mockResolvedValue(geminiText(JSON.stringify({ course: 'Ignored AI course name', events: [] })));
    const res = await POST(upload({ name }));
    expect(res.status).toBe(200);
    expect((await res.json()).course).toBe(course);
  });

  it('no longer asks Gemini for the course, and requires session/week/weekday in the schema', async () => {
    fetchMock.mockResolvedValue(geminiText('{"events":[]}'));
    await POST(upload());
    const { generationConfig, contents } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(generationConfig.responseSchema.properties).not.toHaveProperty('course');
    expect(generationConfig.responseSchema.required).toEqual(['events']);
    const item = generationConfig.responseSchema.properties.events.items;
    expect(item.required).toEqual(expect.arrayContaining(['session', 'week', 'weekday', 'weight', 'title']));
    expect(item.properties.session).toMatchObject({ type: 'INTEGER', nullable: true });
    const prompt = contents[0].parts[1].text;
    expect(prompt).toMatch(/Course Outline/);
    expect(prompt).toMatch(/Lesson Learning Outcome/);
    expect(prompt).not.toMatch(/course code and name/);
  });
});
