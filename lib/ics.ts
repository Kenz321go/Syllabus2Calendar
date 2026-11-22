import { createEvents, EventAttributes } from 'ics';
import type { EventItem } from './db';
export type CalEvent = EventItem & { course: string };
export function downloadIcs(name: string, events: CalEvent[]) {
  const list: EventAttributes[] = events.filter((e) => e.date).map((e) => {
    const [y, m, d] = e.date!.split('-').map(Number);
    const t = e.time?.match(/^(\d{2}):(\d{2})$/);
    return {
      title: `${e.course.split(':')[0]}: ${e.title}`,
      start: t ? [y, m, d, +t[1], +t[2]] : [y, m, d],
      duration: t ? { hours: 1 } : { days: 1 },
      description: `${e.type}${e.weight ? `, ${e.weight}% of grade` : ''}\nSource: ${e.source}`,
      alarms: [{ action: 'display', description: 'Reminder', trigger: { days: 1, before: true } }],
    } as EventAttributes;
  });
  const { error, value } = createEvents(list);
  if (error || !value) throw error ?? new Error('Could not build calendar');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([value], { type: 'text/calendar' }));
  a.download = `${name}.ics`;
  a.click();
}
