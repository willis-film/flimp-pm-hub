// api/db.js — Supabase proxy. Runs ONLY on Vercel's servers. This is the one
// place SUPABASE_URL / SUPABASE_SERVICE_KEY are allowed to exist — the browser
// never sees this file's contents, only its JSON responses.
//
// Mirrors the load()/save() contract js/db.js already has, so the eventual
// cutover is: replace localStorage.getItem/setItem with fetch('/api/db').
//
//   GET  /api/db  -> { gmailClientPrefix, clickupTasks, gmailLabelDefs,
//                      gmailEmails, rows: [...] }   — same shape as SEED_DB.
//   POST /api/db  -> body is that same shape. Upserts workspace (one row) and
//                     full-replace-syncs rows: whatever's in the payload is
//                     truth, same semantics as the old localStorage.setItem
//                     of the whole blob. Anything missing from the payload
//                     gets deleted — that's how row deletion (e.g.
//                     unassignCuTaskAll) reaches the database at all, since
//                     there's no separate "delete" endpoint.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

// Every KNOWN_FIELDS entry happens to be a mechanical camelCase<->snake_case
// pair with its schema.sql column (activityLog <-> activity_log, etc.) — so
// one generic converter handles all of them; nothing needs a manual map.
const toSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const toCamel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// ── app row (camelCase) -> Postgres record (named columns + data blob) ─────
function rowToRecord(r) {
  const record = { data: {} };
  for (const key in r) {
    if (KNOWN_SET.has(key)) record[toSnake(key)] = r[key];
    else record.data[key] = r[key];
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
    if (req.method === 'GET') {
      const [{ data: ws, error: wErr }, { data: rowRecords, error: rErr }] = await Promise.all([
        supabase.from('workspace').select('*').eq('id', 1).single(),
        supabase.from('rows').select('*')
      ]);
      if (wErr) throw wErr;
      if (rErr) throw rErr;

      return res.status(200).json({
        gmailClientPrefix: ws.gmail_client_prefix || '',
        clickupTasks:      ws.clickup_tasks || [],
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

      // 1. workspace — single row, upsert in place.
      const { error: wErr } = await supabase.from('workspace').upsert({
        id: 1,
        gmail_client_prefix: body.gmailClientPrefix || '',
        clickup_tasks:       body.clickupTasks || [],
        gmail_label_defs:    body.gmailLabelDefs || [],
        gmail_emails:        body.gmailEmails || []
      });
      if (wErr) throw wErr;

      // 2. rows — one INSERT ... ON CONFLICT statement carrying every row,
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
      //    wipe the whole table.
      const incomingIds = body.rows.map(r => r.id);
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
