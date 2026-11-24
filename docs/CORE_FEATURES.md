# User and Feature Guide

Syllabus2Calendar combines syllabus-derived course events, personal tasks, and built-in academic dates in a local semester calendar. This guide explains setup, scanning, date scheduling, reviewing, and backing up your data.

## Contents

- [Typical workflow](#typical-workflow)
- [Set up a semester and course schedule](#set-up-a-semester-and-course-schedule)
- [Scan and merge syllabi](#scan-and-merge-syllabi)
- [How dates and sessions are scheduled](#how-dates-and-sessions-are-scheduled)
- [Use the calendar](#use-the-calendar)
- [Manage courses and progress](#manage-courses-and-progress)
- [Campus closures and Cascade Shift](#campus-closures-and-cascade-shift)
- [Export calendars and back up data](#export-calendars-and-back-up-data)
- [Storage, privacy, and limitations](#storage-privacy-and-limitations)
- [Configuration and troubleshooting](#configuration-and-troubleshooting)

## Typical workflow

1. Select or add a semester and set its start date.
2. Choose the two weekdays when the course meets (Day 1 and Day 2).
3. Upload syllabus PDFs and choose automatic or manual merging.
4. Review scanned courses and correct dates or event details.
5. Browse the calendar, add personal tasks, and track completion.
6. Export `.ics` calendars or make a JSON backup.

## Set up a semester and course schedule

### Semester

The semester selector scopes scans and calendar data. The first time the app is opened with an empty database, it creates a default **Fall 2026** semester with a start date of **August 31, 2026**. Change the selected semester's start date in the semester bar before scanning if it is different. You can also add additional semesters.

The semester start date is used to infer dates from session/week references and to supply a year when the syllabus prints a date without one. Changing the start date affects new scans only; already stored events are not recalculated automatically.

### Class meeting days

Before uploading, select **Day 1** and **Day 2**, in weekday order, from Monday through Friday. These tell the app how to place course-outline sessions when the syllabus lists a session number but no calendar date:

| Session number | Scheduled on |
| --- | --- |
| 1 | Day 1 of week 1 |
| 2 | Day 2 of week 1 |
| 3 | Day 1 of week 2 |
| 4 | Day 2 of week 2 |

The pattern continues for later sessions. These class days are also used by Cascade Shift and can be changed for an individual course later.

## Scan and merge syllabi

Drop PDFs on the upload area or choose them from the file picker. The app accepts up to eight PDFs per selection, each no larger than 10 MB. Gemini is asked to read all pages, including tables, and extract:

- Every course-outline session, including sessions without a printed date.
- Assessments such as exams, quizzes, assignments, projects, and presentations.
- Other stated deadlines, dates, times, weights, and the supporting source text.

The course name is based on the uploaded file name. Rename the file before scanning if you want a cleaner course label.

Choose a merge mode:

- **Auto-merge** adds each successful scan to the selected semester immediately.
- **Choose manually** leaves scans pending. Select the scans in the Scan view and merge them to include them in the calendar and Courses view.

Pending scans are not shown as calendar events until merged.

Scanning sends the PDF to the configured Gemini API. It requires `GEMINI_API_KEY` on the server.

## How dates and sessions are scheduled

The extractor distinguishes explicit dates from inferred dates:

- A date printed in the syllabus is extracted directly. If the year is omitted, the semester start date provides the year.
- A course-outline session number is placed on the selected class-day pattern described above.
- A stated week and weekday are resolved relative to the semester start date.
- If there is not enough information to determine a date, the event remains undated.

Inferred or uncertain dates are flagged **Check date**. Open the course in **Courses**, compare the event with the source syllabus, and edit its date. Events without a date cannot be placed on the calendar or included in an `.ics` export until a date is entered.

Changing the semester start date or class days does not update existing event dates automatically. Correct existing events in Courses or rescan the syllabus after changing those settings.

## Use the calendar

The **Calendar** tab provides three views:

- **Week:** A seven-day, Monday-to-Sunday schedule. Timed events show their time in the event label.
- **Month:** A month grid. Each day shows course and personal-event chips; if a day has more events than fit, use **+N more** to open that week.
- **Year:** A twelve-month overview with event counts. Select a month to open its month view.

Use **Previous**, **Today**, and **Next** to navigate. When the displayed period has no events, the status line offers a jump to the next upcoming event (or the first event if all are in the past).

### Filters, colors, and details

The left **Filters** panel lists merged courses and personal tasks. Use its checkboxes to show or hide their events, **Select all/Deselect all** to change visibility together, and the color swatch to choose a course color. Filter and panel preferences are remembered in the current browser.

The **Details** panel shows the built-in academic calendar. Academic dates appear as tags on week and month grids while the panel is open. Select a tag or an event for details.

### Personal events

Use **+ Add Event** or click an empty calendar day to create a personal event. A clicked day is preselected in the form. Personal events are stored separately under **My Personal Tasks**, can be edited or deleted from Courses or the event details, and can be included in calendar exports. They do not count toward course progress.

## Manage courses and progress

In **Courses**, expand a course to see its tasks. You can:

- Edit titles, event types, dates, times, and grade weights.
- Mark tasks complete or incomplete.
- Delete individual tasks or an entire scanned course.
- Change or confirm the two class days used by Cascade Shift.
- Export a course calendar.

Course and overall progress counts completed syllabus tasks. Personal events are excluded. Course summaries show the next upcoming task and call out undated or date-review items.

## Campus closures and Cascade Shift

The app includes campus-closure dates in its source data. Closed days are highlighted on the calendar. Select a closure or an event on a closed day to open the corresponding details.

For a course event on a closed day, **Cascade Shift** can move that session forward or backward by one week, keeping the weekday. When class days are set, later sessions on those class days can shift with it so the schedule remains in order. Closed-day conflicts are skipped; a backward shift that would overwrite an earlier session is refused. The last shift can be undone from that course.

Cascade Shift is a manual action; events are not moved automatically just because they fall on a closure. Verify the resulting schedule with the instructor.

The academic-calendar and closure dates are currently maintained in source code and are specific to the configured academic calendar. Verify them against official institutional dates before relying on them.

## Export calendars and back up data

### `.ics` export

- **Upcoming:** Export dated events for the selected semester.
- **Courses:** Export dated events for an individual course or My Personal Tasks.

The generated `.ics` file can be imported into calendar applications that support the iCalendar format. Timed events are exported with a one-hour duration; events without a time are exported as all-day events. Exported events include a display reminder one day before. Undated events are omitted.

The application does not currently sync directly with Google Calendar, Outlook, or another calendar account; export and import the `.ics` file manually.

### JSON backup and restore

Use **Export backup** to download a JSON file containing semesters and scans. **Import backup** replaces the semesters and scans currently stored in this browser with the contents of the selected backup. Export a backup first if you need to preserve current data.

## Storage, privacy, and limitations

- IndexedDB stores semesters, scans, event edits, completion status, course colors, and related scan metadata in the current browser on the current device.
- Some interface preferences are stored in browser `localStorage`.
- There are no user accounts or cloud synchronization. Clearing browser site data may delete local records.
- PDF files are sent to Gemini for extraction. The app stores extracted event data locally; it does not provide server-side document storage.
- Extraction quality depends on syllabus structure and scan quality. Check all dates, particularly inferred session dates.
- Built-in academic dates and campus closures require maintenance when institutional calendars change.

## Configuration and troubleshooting

### Required for scanning

Set these server-side environment variables:

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash
```

The `GEMINI_MODEL` entry is optional; the route has a default. Use a model supported by your Gemini API account. Restart the server after changing environment variables.

### Optional production rate limiting

For a shared rate limit across server instances, configure both:

```env
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
```

Without both values, the API falls back to in-memory per-process rate limiting. This is suitable for local development but not as a reliable shared production limit.

### Common checks

- **Upload area is disabled:** Choose both class weekdays in order before uploading.
- **Scan says configuration is missing:** Confirm `GEMINI_API_KEY` is set in the server environment and restart the app. Never expose the key in client code or commit it.
- **No event appears on the calendar:** Confirm the scan is merged, the course is visible in Filters, the event has a date, and the calendar is showing the correct week/month/year. Use the status-line jump when the period is empty.
- **An event has no date:** Review it in Courses. The syllabus may not state a date, or the model may not have been able to resolve it.
- **Scan fails:** Check the browser's displayed error and the server terminal. Confirm the PDF is valid and under 10 MB, and check model access, API quota, and network availability.
- **Rate limit response:** The extraction API allows 20 requests per hour per IP.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

The stack is Next.js, React, TypeScript, Tailwind CSS, Dexie/IndexedDB, Zod, the Gemini generateContent API, and the `ics` package. Tests are run with Vitest.
