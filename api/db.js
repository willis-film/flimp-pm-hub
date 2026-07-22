// api/db.js — Supabase proxy. Runs ONLY on Vercel's servers. This is the one
// place SUPABASE_URL / SUPABASE_SERVICE_KEY are allowed to exist — the browser
// never sees this file's contents, only its JSON responses.
//
// Mirrors the load()/save() contract js/db.js already has, so the eventual
// cutover is: replace localStorage.getItem/setItem with fetch('/api/db').
//
//   GET  /api/db  -> { gmailClientPrefix, clickupTasks, gmailLabelDefs,
//                      gmailEmails, rows: [...] }   — same shape as SEED_DB.
//   POST /api/db  -> body is that same shape MINUS clickupTasks. Upserts
//                     workspace's settings (currently just gmail_client_prefix)
//                     and full-replace-syncs rows: whatever's in the payload
//                     is truth, same semantics as the old localStorage.setItem
//                     of the whole blob. Anything missing from the payload
//                     gets deleted — that's how row deletion (e.g.
//                     unassignCuTaskAll) reaches the database at all, since
//                     there's no separate "delete" endpoint.
//
//   clickupTasks is read here but never WRITTEN here — it's synced
//   separately by api/sync-clickup.js, into its own table. clickup.js never
//   mutates this list client-side (see clickup_tasks table comment in
//   schema.sql), so there's nothing for the browser's save() to persist.

import { createClient } from '@supabase/supabase-js';

// Deliberately NOT created at module load. createClient() throws
// synchronously on a missing/malformed URL — if that happened up here,
// outside any try/catch, it crashes the whole function process before
// `handler` ever runs, and Vercel reports a bare FUNCTION_INVOCATION_FAILED
// instead of a real error message. Creating it inside the handler, after an
// explicit check, means a config problem is just a normal 500 with a
// message that says what's actually wrong.
function getClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error(
      `Missing env var(s): ${!SUPABASE_URL ? 'SUPABASE_URL ' : ''}${!SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : ''}`.trim()
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Every field that got its own real Postgres column — scalar columns AND the
// dedicated JSONB columns (comments, invoices, activityLog, timeline,
// closeout, distro). Anything on a row NOT in this list falls into the
// general `data` catch-all JSONB. This list is the map of schema.sql — if a
// field is ever promoted out of `data` into its own column there, add it here
// too, or this proxy will keep filing it under `data` and the column will
// silently stay empty.
const KNOWN_FIELDS = [
  'id', 'parentId', 'clickupId', 'name', 'status', 'phase',
  'collapsed', 'activePanel',
  'productType', 'productTier', 'productStyle', 'newOrUpdate', 'am',
  'startDate', 'due', 'oeStart', 'oeEnd', 'distributionDate',
  'io', 'branding',
  'totalRevenue', 'designerCost', 'animatorCost', 'voCost',
  'otherVendor1Cost', 'otherVendor2Cost',
  'comments', 'invoices', 'activityLog', 'timeline', 'closeout', 'distro'
];
const KNOWN_SET = new Set(KNOWN_FIELDS);

// Postgres `date` columns. Empty string "" is NOT a valid date to Postgres —
// it rejects the whole INSERT with `invalid input syntax for type date: ""`,
// which fails the entire save (every row, not just the offending one). The
// HTML date inputs return "" when left blank, so any project created without
// a due/OE date would send "" and torpedo the save. We coerce "" (and
// undefined) to null here, at the one choke point every write passes through,
// so no form anywhere can reproduce this. null is a real "no date" to Postgres.
const DATE_COLUMNS = new Set([
  'start_date', 'due', 'oe_start', 'oe_end', 'distribution_date'
]);

// Every KNOWN_FIELDS entry happens to be a mechanical camelCase<->snake_case
// pair with its schema.sql column (activityLog <-> activity_log, etc.) — so
// one generic converter handles all of them; nothing needs a manual map.
const toSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const toCamel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// ── app row (camelCase) -> Postgres record (named columns + data blob) ─────
function rowToRecord(r) {
  const record = { data: {} };
  for (const key in r) {
    if (KNOWN_SET.has(key)) {
      const col = toSnake(key);
      let val = r[key];
      // Blank date -> null, never "". See DATE_COLUMNS note above.
      if (DATE_COLUMNS.has(col) && (val === '' || val === undefined)) val = null;
      record[col] = val;
    } else {
      record.data[key] = r[key];
    }
  }
  if (!('parent_id' in record)) record.parent_id = null; // explicit null, not missing, for project rows
  return record;
}

// ── Postgres record -> app row (camelCase, data blob flattened back in) ────
function recordToRow(rec) {
  const row = {};
  for (const col in rec) {
    if (col === 'data' || col === 'created_at' || col === 'updated_at') continue;
    row[toCamel(col)] = rec[col];
  }
  Object.assign(row, rec.data || {});
  return row;
}

export default async function handler(req, res) {
  try {
    const supabase = getClient();

    if (req.method === 'GET') {
      const [{ data: ws, error: wErr }, { data: rowRecords, error: rErr }, { data: cuTasks, error: cuErr }] = await Promise.all([
        supabase.from('workspace').select('*').eq('id', 1).single(),
        supabase.from('rows').select('*'),
        supabase.from('clickup_tasks').select('*')
      ]);
      if (wErr) throw wErr;
      if (rErr) throw rErr;
      if (cuErr) throw cuErr;

      return res.status(200).json({
        gmailClientPrefix: ws.gmail_client_prefix || '',
        clickupTasks: (cuTasks || []).map(t => ({
          id: t.id,
          name: t.name,
          status: t.status,
          due: t.due,
          productType: t.product_type,
          productTier: t.product_tier,
          productStyle: t.product_style,
          clickupUrl: t.clickup_url
        })),
        gmailLabelDefs:    ws.gmail_label_defs || [],
        gmailEmails:       ws.gmail_emails || [],
        rows: (rowRecords || []).map(recordToRow)
      });
    }

    if (req.method === 'POST') {
      const body = req.body;
      if (!body || !Array.isArray(body.rows)) {
        return res.status(400).json({ error: 'Expected { rows: [...], gmailClientPrefix, clickupTasks, gmailLabelDefs, gmailEmails }' });
      }

      // 1. workspace settings — single row, upsert in place. clickupTasks is
      //    deliberately excluded: it's owned by api/sync-clickup.js, not by
      //    the browser's save().
      const { error: wErr } = await supabase.from('workspace').upsert({
        id: 1,
        gmail_client_prefix: body.gmailClientPrefix || '',
        gmail_label_defs:    body.gmailLabelDefs || [],
        gmail_emails:        body.gmailEmails || []
      });
      if (wErr) throw wErr;

      // 2a. Reject payloads with duplicate row ids. A duplicate id means the
      //    client generated colliding ids (the 'r'+Date.now() bug) — upserting
      //    such a payload silently collapses distinct rows into one via
      //    onConflict:'id', and then step 3 deletes the "missing" originals.
      //    Far safer to fail loudly here than to let a malformed save destroy
      //    data. The client can regenerate ids and retry.
      const allIds = body.rows.map(r => r.id);
      const seen = new Set();
      const dupes = new Set();
      for (const id of allIds) {
        if (seen.has(id)) dupes.add(id);
        seen.add(id);
      }
      if (dupes.size > 0) {
        return res.status(409).json({
          error: `Duplicate row id(s) in payload — refusing to save to avoid data loss: ${[...dupes].join(', ')}`
        });
      }

      // 2b. rows — one INSERT ... ON CONFLICT statement carrying every row,
      //    so parent/child order inside the batch doesn't matter: Postgres
      //    checks the parent_id FK at end-of-statement, not row-by-row as it
      //    goes, so a child can appear before its parent in the array.
      if (body.rows.length > 0) {
        const records = body.rows.map(rowToRecord);
        const { error: upsertErr } = await supabase.from('rows').upsert(records, { onConflict: 'id' });
        if (upsertErr) throw upsertErr;
      }

      // 3. Delete anything the client no longer has. Guarded on a non-empty
      //    incoming list — an accidental empty save should never be able to
      //    wipe the whole table. `seen` is the deduplicated id set from 2a.
      const incomingIds = [...seen];
      if (incomingIds.length > 0) {
        const list = incomingIds.map(id => `"${id}"`).join(',');
        const { error: delErr } = await supabase.from('rows').delete().not('id', 'in', `(${list})`);
        if (delErr) throw delErr;
      }

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('api/db error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
