# Syllabus2Cal

Drop in your syllabus PDFs, merge them into one semester box, see every upcoming event, and export a `.ics` calendar file.

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Gemini API key (free at aistudio.google.com).
3. `npm run dev`, then open http://localhost:3000

## How it works

- `app/api/extract/route.ts` sends each PDF to Gemini, checks the JSON with Zod, and turns "Week 9, Friday" into a real date using the semester start date. Items it is unsure about are flagged "Check date".
- `app/page.tsx` has three tabs: Scan and merge (auto or manual), Upcoming, and Courses (edit dates, export, delete).
- `lib/db.ts` saves scans in the browser with IndexedDB. The server stores nothing.
- `lib/ics.ts` builds the calendar file, with a reminder one day before each event.

## Before you deploy

- Model names and free-tier limits change. Check the Gemini docs and set `GEMINI_MODEL` if needed.
- The rate limit in the API route is in memory. Use a shared store such as Upstash Redis on Vercel.
- Not built yet: sign-in and sync, multiple semesters, a month-grid calendar view, and scanned-PDF fallbacks.
