// db.js — application state + persistence layer.
//
// This wraps the single `db` state object and all read/write persistence.
// Today it persists to localStorage (key `flimp_pm14`), exactly as the
// original single-file build did. When the Supabase migration happens, only
// the bodies of save()/load() need to change — every caller already goes
// through these functions, so the rest of the app is storage-agnostic.

import { SEED_DB } from './data/seed.js';

const STORAGE_KEY = 'flimp_pm14';
const LAST_OPEN_KEY = 'flimp_last_open';

// Live, mutable state singleton. Imported by every module; mutated in place,
// then persisted via save(). Deep-cloned from SEED_DB so the seed stays pristine.
export const db = structuredClone(SEED_DB);

// ── PERSISTENCE ──────────────────────────────────────────────────────────────
// save(): currently localStorage. Swap this body for a Supabase upsert later.
export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) {}
}

// load(): currently localStorage. Swap this body for a Supabase select later.
// Mirrors the original Object.assign merge so missing keys fall back to seed.
export function load() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const saved = JSON.parse(s);
      // Mutate the existing object in place so the exported reference stays valid.
      Object.assign(db, saved);
    }
  } catch (e) {}
}

// Resets every row's daily I/O flag the first time the app opens on a new day.
export function dailyIOReset() {
  const today = new Date().toDateString();
  const lastOpen = localStorage.getItem(LAST_OPEN_KEY);
  if (lastOpen !== today) {
    db.rows.forEach(r => { r.io = false; });
    localStorage.setItem(LAST_OPEN_KEY, today);
    save();
  }
}
