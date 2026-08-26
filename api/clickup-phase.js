// api/clickup-phase.js — writes a subtask's phase BACK to ClickUp.
//
// Everything else in this app pulls one way: api/sync-clickup.js reads ClickUp
// into Supabase and the board renders it. This is the only outbound write.
// It exists because the phase lives in the tower, not in ClickUp — anyone
// looking at the ClickUp task itself had no way to see where the item actually
// was, so the phase is mirrored into ClickUp's own "Phase" custom field
// whenever it changes here.
//
// Server-side only, same rule as sync-clickup.js: it holds CLICKUP_API_TOKEN.
//
//   POST /api/clickup-phase
//     body: { clickupId, phase, phaseLabel }
//       phase      — the app's internal key ('design-animation'), '' to clear
//       phaseLabel — the display label ('Design/Animation'), which is what the
//                    ClickUp dropdown option is actually matched against
//     -> 200 { ok:true, field, option }        wrote (or cleared) the value
//     -> 422 { ok:false, error, ... }          the task has no matching field,
//                                              or no option matching the phase
//     -> 500 { error }                         ClickUp or config failure
//
//   GET /api/clickup-phase?taskId=<id>  — read-only. Reports the phase field
//     as ClickUp actually has it (name, type, options) next to how each option
//     would be matched. WRITES NOTHING. Use this when a write comes back 422:
//     it says whether the field is named something other than FIELD_NAME_PHASE
//     or whether the field is there but its options don't line up with the
//     app's phase labels — those fail identically from the client's side.
//
// This endpoint is deliberately NOT part of save(). save() posts the whole db
// on a debounce and owns Supabase; this owns one field on one ClickUp task and
// fires per change, so a ClickUp outage can never hold up persisting the board.

// Matched by NAME rather than a hardcoded field id, for the same reason
// sync-clickup.js matches its Product Type/Tier/Style fields by name: the id
// would need its own lookup round-trip, and the field is read straight off the
// task we already fetch. Rename the field in ClickUp -> update this string.
//
// Written with the '+' the live field actually carries, so this reads as the
// name someone sees in ClickUp — normalizeFieldName() strips that marker off
// BOTH sides before comparing, so it matches whether or not the '+' survives.
const FIELD_NAME_PHASE = 'PM Phase+';

// Same trailing-marker tolerance as sync-clickup.js — this workspace decorates
// field names with '*' and '+' ('Product Type*+', 'PM Phase+'), and those
// markers get toggled without warning. A 'PM Phase' in ClickUp still matches.
function normalizeFieldName(name) {
  return String(name || '').trim().toLowerCase().replace(/[*+\s]+$/, '');
}

// Option names are matched loosely on purpose. The app's labels carry
// punctuation that nobody retypes identically into ClickUp — 'In Review –
// W/Client' has an en dash, 'Print/Mail – Handed off' has a slash and a dash —
// and a strict === against those would fail on a plain hyphen or a double
// space. Every dash variant collapses to a space along with all other
// punctuation, so 'In Review - W/Client', 'In Review — W / Client' and the
// label itself all normalize to the same string.
//
// This is loose about FORM, not about WORDS: 'Proofing' and 'Pending Final
// Approval' stay distinct, so no phase can silently land on the wrong option.
function normalizeOptionName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findPhaseField(task) {
  const target = normalizeFieldName(FIELD_NAME_PHASE);
  return (task.custom_fields || []).find(f => normalizeFieldName(f.name) === target) || null;
}

function fieldOptions(field) {
  return field && field.type_config && Array.isArray(field.type_config.options)
    ? field.type_config.options
    : [];
}

// Resolves an app phase onto one of the ClickUp field's own options. Tries the
// display label first (that's what a human typed into ClickUp), then the
// internal key — a workspace that named its options after the keys rather than
// the labels still lands correctly instead of erroring out.
function matchOption(field, phaseLabel, phaseKey) {
  const options = fieldOptions(field);
  const wantedLabel = normalizeOptionName(phaseLabel);
  const wantedKey = normalizeOptionName(phaseKey);
  return (
    options.find(o => normalizeOptionName(o.name) === wantedLabel) ||
    (wantedKey ? options.find(o => normalizeOptionName(o.name) === wantedKey) : null) ||
    null
  );
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
    // Trimmed on read. A token pasted into the Vercel dashboard picks up a
    // trailing newline or a stray space more often than anyone expects, and
    // ClickUp answers that with the same "Token invalid" (OAUTH_025) it gives a
    // genuinely revoked token — indistinguishable from the outside. Trimming
    // removes that possibility rather than leaving it to be diagnosed twice.
    const CLICKUP_API_TOKEN = (process.env.CLICKUP_API_TOKEN || '').trim();
    if (!CLICKUP_API_TOKEN) throw new Error('Missing env var: CLICKUP_API_TOKEN');

    // ?diag=1 — reports WHICH deployment answered and what SHAPE of token it
    // holds. Never the token itself: only its length and first three
    // characters, which is enough to tell a ClickUp personal token ('pk_')
    // from an OAuth token or a pasted-in wrong value, and nowhere near enough
    // to use. Nothing here calls ClickUp, so it answers even when auth is
    // broken — which is the entire point.
    //
    // Exists because a 401 from this endpoint alongside a WORKING pull sync
    // has two very different causes that look identical from a browser: the
    // two endpoints are on different deployments (an alias pointing at an old
    // build, which carries that build's snapshot of the env vars), or they're
    // on the same one and the token is genuinely bad. commit + env below
    // settle which — compare them against the deployment your app is served
    // from.
    if (req.query && (req.query.diag === '1' || req.query.diag === 'true')) {
      const raw = process.env.CLICKUP_API_TOKEN || '';
      return res.status(200).json({
        ok: true,
        mode: 'diag — no ClickUp call, no token disclosed',
        deployment: {
          env: process.env.VERCEL_ENV || null,
          url: process.env.VERCEL_URL || null,
          commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
          branch: process.env.VERCEL_GIT_COMMIT_REF || null
        },
        token: {
          present: !!raw,
          length: raw.length,
          prefix: raw.slice(0, 3),
          hadSurroundingWhitespace: raw !== raw.trim()
        },
        // Whether THIS build carries the corrected field name. A deployment
        // still reporting 'Phase' is running code from before that fix.
        lookingForField: FIELD_NAME_PHASE
      });
    }

    // ── Read-only diagnostic ────────────────────────────────────────────────
    if (req.method === 'GET') {
      const taskId = req.query && req.query.taskId;
      if (!taskId) return res.status(400).json({ error: 'GET requires ?taskId=<clickup task id>' });
      const task = await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(taskId)}`);
      const field = findPhaseField(task);
      return res.status(200).json({
        ok: true,
        mode: 'debug — nothing written to ClickUp',
        taskId,
        taskName: task.name,
        lookingFor: FIELD_NAME_PHASE,
        fieldNamesSeen: (task.custom_fields || []).map(f => f.name).sort(),
        phaseField: field
          ? {
              id: field.id,
              clickupFieldName: field.name,
              type: field.type,
              currentValue: field.value === undefined ? null : field.value,
              // Both the raw option names and what they normalize to — a pair
              // that looks identical raw but differs normalized (or vice versa)
              // is exactly the case that's invisible from the error alone.
              options: fieldOptions(field).map(o => ({ id: o.id, name: o.name, normalized: normalizeOptionName(o.name) }))
            }
          : null
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { clickupId, phase = '', phaseLabel = '' } = body;
    if (!clickupId) return res.status(400).json({ error: 'Missing clickupId' });

    const task = await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}`);
    const field = findPhaseField(task);
    if (!field) {
      // 422, not 500: nothing is broken — this task simply doesn't carry the
      // field. Separated from a real failure so the client can tell a
      // misconfiguration from an outage in the console.
      return res.status(422).json({
        ok: false,
        error: `ClickUp task ${clickupId} has no "${FIELD_NAME_PHASE}" custom field`,
        fieldNamesSeen: (task.custom_fields || []).map(f => f.name).sort()
      });
    }

    // Clearing the phase in the tower clears it in ClickUp too, rather than
    // leaving a stale option sitting there — a wrong phase reads worse than
    // no phase.
    if (!phase) {
      await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}/field/${field.id}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true, cleared: true, field: field.name });
    }

    const options = fieldOptions(field);
    let value;

    if (options.length) {
      const opt = matchOption(field, phaseLabel, phase);
      if (!opt) {
        return res.status(422).json({
          ok: false,
          error: `No option on ClickUp's "${field.name}" field matches phase "${phaseLabel || phase}"`,
          optionsAvailable: options.map(o => o.name)
        });
      }
      // drop_down takes the option's own uuid. labels is ClickUp's
      // multi-select and takes an array — sending a single-element array
      // REPLACES the selection, which is what mirroring one phase should do.
      value = field.type === 'labels' ? [opt.id] : opt.id;
    } else {
      // No options at all — a plain text field. Write the label as typed here;
      // there's nothing to match against.
      value = phaseLabel || phase;
    }

    await clickup(CLICKUP_API_TOKEN, `/task/${encodeURIComponent(clickupId)}/field/${field.id}`, {
      method: 'POST',
      body: JSON.stringify({ value })
    });

    return res.status(200).json({ ok: true, field: field.name, phase, value });
  } catch (err) {
    console.error('api/clickup-phase error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
