import Dexie, { Table } from 'dexie';
export type EventItem = { id: string; title: string; type: string; date: string | null; time: string | null; weight: number | null; source: string; needsReview: boolean };
export type Scan = { id?: number; course: string; fileName: string; semester: string; merged: boolean; events: EventItem[]; createdAt: number };
class DB extends Dexie {
  scans!: Table<Scan, number>;
  constructor() { super('syllabus2cal'); this.version(1).stores({ scans: '++id, semester, merged' }); }
}
export const db = new DB(); // scans live in the browser (IndexedDB); nothing is stored on the server
