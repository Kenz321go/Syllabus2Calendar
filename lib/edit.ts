import type { EventItem } from './db';

export type EventDraft = { title: string; type: string; date: string; time: string; weight: string };

export const toDraft = (e: EventItem): EventDraft => ({
  title: e.title,
  type: e.type,
  date: e.date ?? '',
  time: e.time ?? '',
  weight: e.weight == null ? '' : String(e.weight),
});

// Turn the form draft into a patch holding only the fields that really changed.
// Invalid input (blank title, non-numeric weight) is ignored so the saved value stays as it was.
export function draftPatch(draft: EventDraft, e: EventItem): Partial<EventItem> {
  const patch: Partial<EventItem> = {};
  const title = draft.title.trim();
  if (title && title !== e.title) patch.title = title;
  if (draft.type !== e.type) patch.type = draft.type;
  const date = draft.date || null;
  if (date !== e.date) patch.date = date;
  const time = draft.time || null;
  if (time !== e.time) patch.time = time;
  const weight = draft.weight.trim() === '' ? null : Number(draft.weight);
  if (weight === null || Number.isFinite(weight)) {
    if (weight !== e.weight) patch.weight = weight;
  }
  return patch;
}
