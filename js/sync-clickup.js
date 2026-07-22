// api/sync-clickup.js — pulls ClickUp tasks assigned to Willis (PM+ field)
// from one specific List, and upserts them into Supabase's clickup_tasks
// table. Runs server-side only — holds the ClickUp token, same rule as
// SUPABASE_SERVICE_KEY in api/db.js.
//
// This is a FULL replace-sync (upsert everything fetched, delete anything in
// the table that's no longer in the result): clickup_tasks should always
// reflect "tasks currently assigned to me in ClickUp, right now." That's
// safe even for already-assigned tasks — clickup.js links a project row to
// a ClickUp task via clickup_id, not by keeping the source entry alive here;
// if a task drops off this list (reassigned, completed), its already-created
// row is untouched, it just stops showing up in the "unassigned" review list.
//
// Trigger: on-demand for now — call this URL whenever you want a fresh pull.
// Layering a schedule on top later (Vercel Cron, or any external cron hitting
// this same URL) is a one-line addition whenever that's wanted; nothing here
// needs to change for that.

import { createClient } from '@supabase/supabase-js';

// Not secrets — just identifiers for which List/field/user this sync targets.
// Kept as constants rather than env vars since there's nothing here that
// needs hiding, only configuring. Change these three lines if the target
// List or the "assigned to me" field ever changes.
const LIST_ID = '901112620629';
const PM_FIELD_ID = '72e2a795-f507-4d5d-b16a-11d95bb788a9'; // "PM+" custom field, type: users
const MY_USER_ID = '30042982';

// ClickUp custom fields matched by NAME rather than a hardcoded field id —
// unlike PM_FIELD_ID above (needed up front, to build the filter query),
// these are only read back out of each task's own custom_fields array, so
// matching by name avoids a second round of field-id lookups. If a field
// ever gets renamed in ClickUp, update the string here to match.
const FIELD_NAME_PRODUCT_TYPE = 'Product Type';
const FIELD_NAME_PRODUCT_TIER = 'Product Tier';
const FIELD_NAME_PRODUCT_STYLE = 'Product Style';

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Reads a named custom field's display value off a ClickUp task. Handles the
// common shapes: dropdown fields carry their value as an option index into
// type_config.options, not the display string, so that's resolved here too.
// Returns '' if the field isn't present on this task at all.
function customFieldValue(task, fieldName) {
  const field = (task.custom_fields || []).find(
    f => f.name.toLowerCase() === fieldName.toLowerCase()
  );
  if (!field || field.value === undefined || field.value === null) return '';
  if (field.type === 'drop_down' && field.type_config && Array.isArray(field.type_config.options)) {
    const opt = field.type_config.options.find(o => o.orderindex === field.value);
    return opt ? opt.name : '';
  }
  return typeof field.value === 'string' ? field.value : '';
}

// ClickUp date fields (due_date included) come back as a string of Unix
// milliseconds, or null. Converts to a plain YYYY-MM-DD for the `due date`
// column. Note: ClickUp's own docs flag that date-only fields can land at
// 4am in the account's timezone rather than midnight UTC — for a due DATE
// (not a timestamp) that's not expected to shift the calendar day in
// practice, but it's a known simplification, not something deeply verified.
function toDateOnly(unixMsString) {
  if (!unixMsString) return null;
  return new Date(Number(unixMsString)).toISOString().slice(0, 10);
}

async function fetchAssignedTasks(token) {
  const filter = JSON.stringify([{ field_id: PM_FIELD_ID, operator: 'ANY', value: [MY_USER_ID] }]);
  const tasks = [];
  let page = 0;

  // ClickUp caps each page at 100 tasks. Loop until a page comes back short.
  while (true) {
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`
      + `?custom_fields=${encodeURIComponent(filter)}`
      + `&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ClickUp API ${res.status}: ${body || res.statusText}`);
    }
    const json = await res.json();
    tasks.push(...(json.tasks || []));
    if (!json.tasks || json.tasks.length < 100) break;
    page++;
  }
  return tasks;
}

export default async function handler(req, res) {
  try {
    const { CLICKUP_API_TOKEN } = process.env;
    if (!CLICKUP_API_TOKEN) throw new Error('Missing env var: CLICKUP_API_TOKEN');

    const supabase = getSupabase();
    const rawTasks = await fetchAssignedTasks(CLICKUP_API_TOKEN);

    const records = rawTasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status ? t.status.status : null,
      due: toDateOnly(t.due_date),
      product_type: customFieldValue(t, FIELD_NAME_PRODUCT_TYPE),
      product_tier: customFieldValue(t, FIELD_NAME_PRODUCT_TIER),
      product_style: customFieldValue(t, FIELD_NAME_PRODUCT_STYLE),
      clickup_url: t.url,
      synced_at: new Date().toISOString()
    }));

    if (records.length > 0) {
      const { error: upsertErr } = await supabase.from('clickup_tasks').upsert(records, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
    }

    // Full replace-sync: remove anything no longer in the filtered result.
    const currentIds = records.map(r => r.id);
    if (currentIds.length > 0) {
      const list = currentIds.map(id => `"${id}"`).join(',');
      const { error: delErr } = await supabase.from('clickup_tasks').delete().not('id', 'in', `(${list})`);
      if (delErr) throw delErr;
    } else {
      // Nothing came back at all (e.g. every task got reassigned away from
      // you) — safe to clear the table entirely in that case, unlike the
      // guard in api/db.js, because this sync's own source of truth (the
      // ClickUp filter) is what said "empty," not a malformed client payload.
      const { error: delErr } = await supabase.from('clickup_tasks').delete().neq('id', '');
      if (delErr) throw delErr;
    }

    return res.status(200).json({ ok: true, synced: records.length });
  } catch (err) {
    console.error('api/sync-clickup error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
