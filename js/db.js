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

// ── INFO PANEL FIELD DEFAULTS ────────────────────────────────────────────────
// The Info panel introduced columns that predate no row in seed.js and exist in
// nobody's saved localStorage. Because load() does an Object.assign merge of the
// SAVED state over the seed, a saved db wholesale replaces `rows` — so seeding
// these keys in seed.js alone would not reach an existing user's data. They are
// backfilled here instead, after the merge, on every load.
//
// Item scope (subtask rows) and project scope (parent rows) take different sets.
// Missing keys are added; existing values are never overwritten.

const ITEM_FIELD_DEFAULTS = {
  itemOwner:'', startDate:'', distributionDate:'',
  previewLink:'', reportingLink:'', reviewStudioLink:'', boordsLink:'',
  roundsOfEdits:'', language:'', productTopic:'',
  totalRevenue:'',
  designerCost:'', animatorCost:'', voCost:'',
  otherVendor1:'', otherVendor1Cost:'',
  otherVendor2:'', otherVendor2Cost:''
};

const PROJECT_FIELD_DEFAULTS = {
  projectOwner:'', clientAccount:'', clientContact:'',
  brokerAccount:'', brokerContact:'',
  oeEnd:'', hubspotLink:'', estimateLink:'', invoiceRef:'',
  totalRevenue:''
};

function backfillInfoFields() {
  (db.rows || []).forEach(r => {
    const defaults = r.parentId ? ITEM_FIELD_DEFAULTS : PROJECT_FIELD_DEFAULTS;
    for (const k in defaults) {
      if (!(k in r)) r[k] = defaults[k];
    }
  });
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
  // Runs unconditionally — covers both the fresh-seed and hydrated-save paths.
  backfillInfoFields();
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
