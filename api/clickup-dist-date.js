// api/clickup-dist-date.js — writes a subtask's Dist. Date BACK to ClickUp.
//
// Second outbound write, modelled on api/clickup-phase.js: the distribution
// date is authored in the tower, and this mirrors it into a date custom field
// on the linked ClickUp task whenever it changes here.
//
// Server-side only: it holds CLICKUP_API_TOKEN.
//
//   POST /api/clickup-dist-date
//     body: { clickupId, date }        date is 'YYYY-MM-DD', or '' to clear
//     -> 200 { ok:true, field, value }  wrote (or cleared) the value
//     -> 422 { ok:false, error, ... }   the task has no matching date field
//     -> 500 { error }                  ClickUp or config failure
//
//   GET /api/clickup-dist-date?taskId=<id> — read-only. Lists the task's
//     custom field names and which one (if any) this endpoint would write to.
//     WRITES NOTHING. Use this when a write comes back 422.

// Matched by NAME, like every other ClickUp field in this app. The live field
// is 'Distribution Date*+' (a Date-type field) and comes first; the others are
// spellings it could plausibly be renamed to, accepted rather than 422ing.
// Rename the field in ClickUp to something else -> add it here.
const FIELD_NAMES_DIST_DATE = ['Distribution Date*+', 'Dist. Date', 'Dist Date', 'Distributed Date'];

// Compares on letters and digits only, so '*'/'+' markers, dots, spacing and
// case never matter — 'Dist. Date+' and 'dist date' are the same field.
function normalizeFieldName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const TARGETS = new Set(FIELD_NAMES_DIST_DATE.map(normalizeFieldName));

function findDistDateField(task) {
  return (task.custom_fields || []).find(f => TARGETS.has(normalizeFieldName(f.name))) || null;
}

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

export default async function handler(req, res) {
  try {
    const CLICKUP_API_TOKEN = (process.env.CLICKUP_API_TOKEN || '').trim();
    if (!CLICKUP_API_TOKEN) throw new Error('Missing env var: CLICKUP_API_TOKEN');

    // ── Read-only diagnostic ────────────────────────────────────────────────
    if (req.method === 'GET') {
      const taskId = req.query && req.query.taskId;
      if (!taskId) return res.status(400).json({ error: 'GET requires ?taskId=<clickup task id>' });
      const task = await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(taskId)}`);
      const field = findDistDateField(task);
      return res.status(200).json({
        ok: true,
        mode: 'debug — nothing written to ClickUp',
        taskId,
        taskName: task.name,
        lookingFor: FIELD_NAMES_DIST_DATE,
        fieldNamesSeen: (task.custom_fields || []).map(f => f.name).sort(),
        distDateField: field
          ? { id: field.id, clickupFieldName: field.name, type: field.type, currentValue: field.value === undefined ? null : field.value }
          : null
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { clickupId, date = '' } = body;
    if (!clickupId) return res.status(400).json({ error: 'Missing clickupId' });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: `Expected date as YYYY-MM-DD, got "${date}"` });
    }

    const task = await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}`);
    const field = findDistDateField(task);
    if (!field) {
      return res.status(422).json({
        ok: false,
        error: `ClickUp task ${clickupId} has no distribution date field (looked for ${FIELD_NAMES_DIST_DATE.map(n => `"${n}"`).join(', ')})`,
        fieldNamesSeen: (task.custom_fields || []).map(f => f.name).sort()
      });
    }

    // Clearing the date here clears it in ClickUp too — a stale date there
    // reads worse than none.
    if (!date) {
      await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}/field/${field.id}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true, cleared: true, field: field.name });
    }

    // ClickUp date fields take Unix milliseconds. Noon UTC, not midnight:
    // ClickUp shows the date in each viewer's own timezone, and midnight UTC
    // is the PREVIOUS evening anywhere in the Americas — the date would land
    // one day early. Noon UTC is the same calendar day from Hawaii to NZ.
    //
    // A plain text field (no date type) gets the date as typed instead.
    const value = field.type === 'date' ? Date.parse(`${date}T12:00:00Z`) : date;
    const payload = field.type === 'date' ? { value, value_options: { time: false } } : { value };

    await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}/field/${field.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ ok: true, field: field.name, date, value });
  } catch (err) {
    console.error('api/clickup-dist-date error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
