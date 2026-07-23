// db.js — application state + persistence layer.
//
// This wraps the single `db` state object and all read/write persistence.
// Persists via the /api/db Supabase proxy (see api/db.js) — every caller
// throughout the app still just calls save() and load() the same way; that
// contract hasn't changed, only what's behind it.

import { SEED_DB } from './data/seed.js';
import { applyReference } from './data/constants.js';

const LAST_OPEN_KEY = 'flimp_last_open'; // per-device marker, not project data — stays local, see dailyIOReset() below.
const API = '/api/db';

// Live, mutable state singleton. Imported by every module; mutated in place,
// then persisted via save(). Deep-cloned from SEED_DB so the seed stays
// pristine — this clone now also serves as the offline/fetch-failure
// fallback (see load()).
export const db = structuredClone(SEED_DB);

// ── PERSISTENCE ──────────────────────────────────────────────────────────────
// save(): POSTs the whole `db` object to the Supabase proxy. All ~48 call
// sites across the app call this fire-and-forget (`save(); render();`) and
// none of them await it — that contract is preserved here on purpose, so
// none of those call sites needed to change. Failures are logged, not
// thrown; a network hiccup shouldn't break the UI someone's actively
// working in.
//
// Debounced (400ms trailing): rapid edits — typing, drag-reordering,
// repeated toggles — would otherwise fire one full-table POST per
// keystroke. Collapsing bursts into one call after things settle also
// narrows (doesn't eliminate) the window where two in-flight POSTs could
// resolve out of order and let an older save clobber a newer one.
let saveTimer = null;

function flushSave() {
  saveTimer = null;
  fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(db)
  }).catch(e => console.error('db.js save() failed:', e));
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

// Catches a pending debounced save if the tab closes before the 400ms timer
// fires. sendBeacon is used instead of fetch specifically because it's
// designed to survive page unload — a normal fetch can get cancelled
// mid-flight when the tab actually closes.
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    navigator.sendBeacon(API, new Blob([JSON.stringify(db)], { type: 'application/json' }));
  }
});

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
  totalRevenue:'',
  // Pasted Timeline Tool export. Null until imported. Project scope only —
  // the plan is authored per project, not per item.
  timeline: null,
  // Closeout checklist state. Null until the Closeout panel is opened once —
  // closeout.js lazily creates { [itemIndex]: boolean } on first toggle.
  // Backfilled here so a Supabase row always has the key, even untouched.
  closeout: null,
  // Distribution panel draft state. Null until the Distro panel is opened —
  // distro.js lazily creates { template, subtaskIds, options, fields, step }.
  // Working state for the current draft, not a record of what was sent.
  distro: null
};

function backfillInfoFields() {
  (db.rows || []).forEach(r => {
    const defaults = r.parentId ? ITEM_FIELD_DEFAULTS : PROJECT_FIELD_DEFAULTS;
    for (const k in defaults) {
      if (!(k in r)) r[k] = defaults[k];
    }
  });
}

// load(): fetches the whole db shape from the Supabase proxy. Mirrors the
// original Object.assign merge, so a missing/unreachable server falls back
// to the SEED_DB clone already sitting in `db` rather than crashing —
// logged loudly, though, so a real outage is visible in the console instead
// of quietly looking like an empty board.
//
// NOTE — first call after cutover: an empty `rows` table is a valid, real
// response (shape-wise identical to "nothing saved yet"), so it WILL
// replace the seed demo rows with an empty board. That's expected, not data
// loss — the seed data was always just local demo content, and it's now
// only the offline fallback rather than the first-run default.
export async function load() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`GET ${API} -> ${res.status}`);
    const saved = await res.json();
    // Mutate the existing object in place so the exported reference stays valid.
    Object.assign(db, saved);
    // Overwrite the hardcoded option lists with the Supabase reference tables
    // (falls back to the hardcoded defaults if the reference block is absent).
    applyReference(saved.reference);
  } catch (e) {
    console.error('db.js load() failed, falling back to seed data:', e);
  }
  // Runs unconditionally — covers both the fresh-seed and hydrated-load paths.
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
