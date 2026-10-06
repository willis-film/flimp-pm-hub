// api/clickup-status.js — live status check and status write-back for one
// ClickUp task, behind the dot menu on a linked item (js/components/strip.js).
//
// Why a status write needs more care than Phase or Dist. Date (the other two
// write-backs): a status decides which team's view a task shows up in, so a
// wrong one puts work in front of the wrong people. Two rules keep it safe:
//
//   1. NEVER WRITE OVER SOMETHING UNSEEN. Every write carries `expected` — the
//      status the person was looking at when they picked. It is compared with
//      what ClickUp has at that moment, and if they differ nothing is written:
//      the response says what ClickUp has now, and the menu shows it. No
//      timestamps, no guessing which change is newer — just "is ClickUp still
//      where you think it is?"
//
//   2. A SWITCH DECIDES WHO CAN BE WRITTEN TO. workspace.clickup_status_write
//      in Supabase, read on every request, and flipped from the toggle in the
//      hub's sidebar (PUT below):
//        null / '' / 'off'  — no writes (menus are view-only, as before)
//        'all'              — every task
//        '868ja4y38,...'    — only these task ids (for testing)
//      A change takes effect on the next click — no deploy. Missing column =
//      off.
//
//   GET  /api/clickup-status?taskId=<id>
//     -> 200 { ok, status, writable }       ClickUp's status right now
//   POST /api/clickup-status
//     body: { clickupId, expected, status }  status = the name to set
//     -> 200 { ok, status }                  written; status as ClickUp has it
//     -> 409 { ok:false, conflict, status }  ClickUp isn't at `expected` —
//                                            nothing written; status is what it is
//     -> 403 { ok:false, error }             writes switched off for this task
//     -> 422 { ok:false, error, available }  the task's List has no such status
//     -> 500 { error }                       ClickUp or config failure
//   PUT  /api/clickup-status
//     body: { write: 'off' | 'all' }         flips the switch (the hub's
//     -> 200 { ok, write }                   sidebar toggle)
//
// Server-side only: holds CLICKUP_API_TOKEN and SUPABASE_SERVICE_KEY.

import { createClient } from '@supabase/supabase-js';

async function clickup(token, path, init) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: { Authorization: token, 'Content-Type': 'application/json', ...(init && init.headers) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp API ${res.status}: ${body || res.statusText}`);
  }
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

// Whether status writes are allowed for this task — rule 2 above. Any failure
// reading the setting counts as off.
async function writeAllowed(taskId) {
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.from('workspace').select('*').eq('id', 1).single();
    if (error || !data) return false;
    const setting = String(data.clickup_status_write || '').trim().toLowerCase();
    if (!setting || setting === 'off') return false;
    if (setting === 'all') return true;
    return setting.split(/[\s,]+/).includes(String(taskId).toLowerCase());
  } catch (e) {
    console.error('api/clickup-status: reading workspace.clickup_status_write failed:', e);
    return false;
  }
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export default async function handler(req, res) {
  try {
    const token = (process.env.CLICKUP_API_TOKEN || '').trim();
    if (!token) throw new Error('Missing env var: CLICKUP_API_TOKEN');

    if (req.method === 'GET') {
      const taskId = req.query && req.query.taskId;
      if (!taskId) return res.status(400).json({ error: 'GET requires ?taskId=<clickup task id>' });
      const [task, writable] = await Promise.all([
        clickup(token, `/task/${encodeURIComponent(taskId)}`),
        writeAllowed(taskId)
      ]);
      return res.status(200).json({ ok: true, status: task.status ? task.status.status : null, writable });
    }

    // The sidebar toggle. Only 'off' and 'all' are accepted from the page —
    // a list of test task ids is set in Supabase directly.
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const write = body.write;
      if (write !== 'off' && write !== 'all') return res.status(400).json({ error: "write must be 'off' or 'all'" });
      const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { error } = await supabase.from('workspace').update({ clickup_status_write: write }).eq('id', 1);
      if (error) throw error;
      return res.status(200).json({ ok: true, write });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, PUT');
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { clickupId, expected, status } = body;
    if (!clickupId || !status) return res.status(400).json({ error: 'Missing clickupId or status' });
    if (!expected) return res.status(400).json({ error: 'Missing expected — every write must say what status it expects to replace' });

    if (!(await writeAllowed(clickupId))) {
      return res.status(403).json({ ok: false, error: 'Status changes from the hub are switched off for this task' });
    }

    // Rule 1: read what ClickUp has right now, and stop if it isn't what the
    // person was looking at.
    const task = await clickup(token, `/task/${encodeURIComponent(clickupId)}`);
    const current = task.status ? task.status.status : null;
    if (!same(current, expected)) {
      return res.status(409).json({ ok: false, conflict: true, status: current });
    }
    if (same(current, status)) {
      return res.status(200).json({ ok: true, status: current, unchanged: true });
    }

    // Resolve the name against the task's own List, so a task moved to a List
    // with different statuses gets a clear 422 instead of ClickUp's raw error.
    const list = task.list && task.list.id ? await clickup(token, `/list/${encodeURIComponent(task.list.id)}`) : null;
    const available = (list && Array.isArray(list.statuses)) ? list.statuses.map(s => s.status) : [];
    const target = available.find(s => same(s, status));
    if (available.length && !target) {
      return res.status(422).json({ ok: false, error: `This task's ClickUp List has no "${status}" status`, available });
    }

    const updated = await clickup(token, `/task/${encodeURIComponent(clickupId)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: target || status })
    });
    return res.status(200).json({ ok: true, status: updated.status ? updated.status.status : (target || status) });
  } catch (err) {
    console.error('api/clickup-status error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
