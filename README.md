# Syllabus2Calendar

Syllabus2Calendar turns course syllabus PDFs into a semester planner. It uses Gemini to extract course sessions and assessments, lets you review and manage the resulting events, and displays course work alongside calendar and campus dates.

## What it does

- Scans up to eight PDF syllabi at a time (10 MB per PDF).
- Extracts course-outline sessions, assessments, dates, times, grade weights, and source text with Gemini.
- Schedules undated course-outline sessions from the semester start date and the two weekly class days you select. Inferred dates are flagged for review.
- Organizes scans by semester, with automatic or manual merging.
- Shows events in Upcoming and Week, Month, and Year calendar views.
- Adds personal events, tracks task completion, and shows course progress.
- Filters and color-codes courses in the calendar.
- Provides built-in academic dates and campus closures for the configured academic year.
- Exports course or semester events as `.ics` and backs up local data as JSON.

For detailed setup and usage, see the [User and Feature Guide](./docs/CORE_FEATURES.md).

## Requirements

- Node.js 20 or later
- npm
- A Gemini API key to scan PDFs

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` in the project root:

   ```env
   GEMINI_API_KEY=your-gemini-api-key
   GEMINI_MODEL=gemini-3.5-flash
   ```

   Use a Gemini model enabled for your account. The application defaults to `gemini-3.5-flash` if `GEMINI_MODEL` is omitted. Model availability, pricing, and quotas depend on your Google AI account.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Keep API keys on the server. Never add a real key to client-side code or commit it to Git.

## Useful commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create and type-check the production build |
| `npm start` | Run the production server after building |
| `npm test` | Run the Vitest test suite |

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For PDF scanning | Authenticates server requests to the Gemini API |
| `GEMINI_MODEL` | No | Gemini model name; defaults to `gemini-3.5-flash` |
| `UPSTASH_REDIS_REST_URL` | Recommended in production | Upstash Redis REST endpoint for shared rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended in production | Upstash Redis REST token |

The extraction API allows 20 scans per hour per IP. When both Upstash variables are configured, rate limits are shared through Redis. Otherwise, a process-local in-memory limiter is used; that fallback is intended for development and is not a reliable production-wide limit.

## Data and privacy

Semesters, scans, and event edits are stored in IndexedDB in the user's browser. The app does not currently have accounts or cloud synchronization. When a syllabus is scanned, its PDF is sent from the server to the configured Gemini API. Use the JSON backup controls to preserve or move local data.

## Important limitations

- Review extracted and inferred dates against the original syllabus.
- Relative session dates depend on the semester start date and the two selected class days. Changing those settings affects future scans; it does not automatically reschedule existing events.
- Gemini can read many image-based PDFs, but low-quality scans may need preprocessing or OCR.
- Built-in academic-calendar and campus-closure dates are maintained in source code and should be verified and updated for each academic year.
- Sign-in and cloud synchronization are not implemented.

## Deployment checklist

- Configure `GEMINI_API_KEY` and a supported `GEMINI_MODEL` in the hosting provider's server-side environment.
- Configure both Upstash variables if the deployment needs shared rate limits across instances.
- Review current Gemini model availability, billing, and quotas.
- Replace the built-in academic-calendar and campus-closure data with verified dates appropriate for the institution and academic year.
- Confirm `.env.local` and all real credentials are excluded from the commit.
