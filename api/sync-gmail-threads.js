// api/sync-gmail-threads.js — pulls Gmail threads for every label currently
// assigned to a project and writes them into workspace.gmail_emails. Runs
// server-side only; holds the Google OAuth refresh token, same rule as
// api/sync-gmail.js.
//
// SHAPE: writes the *message-ish* shape render.js already expects —
//   { threadId, labelIds, from, subject, date }
// one entry per THREAD (not per message), where:
//   - labelIds is the union of label ids across all messages in the thread,
//     including the synthetic 'UNREAD' marker if any message is unread.
//     render.js keys unread styling off labelIds.includes('UNREAD') and the
//     strip's tg-unread dot off the same, so that marker is load-bearing.
//   - from/subject come from the NEWEST message in the thread
//   - date is ISO 8601; render.js formats it for display
//
// A normalized gmail_threads table with a real boolean is_unread would be the
// cleaner schema, but at this volume (a few hundred threads across active
// projects) a JSON array on the workspace singleton costs nothing and keeps
// load() as the only read path. The sync endpoint is the sole writer, so
// normalizing later stays a contained migration.
//
// SYNC STRATEGY: full backfill once, then history deltas.
//   - No stored historyId  -> full pull, bounded by LOOKBACK_DAYS
//   - Stored historyId     -> history.list deltas, cheap and near-free
//   - Expired historyId    -> Gmail 404s it; fall back to a full pull
// Gmail retains roughly a week of history, so a cron outage longer than that
// forces a rebuild. That path has to exist from day one or it surfaces as a
// mystery failure after a quiet stretch.
//
// Trigger: Vercel Cron every 15 minutes (see vercel.json). NOTE: Hobby plans
// are only guaranteed hourly granularity and capped at 2 cron jobs — the
// schedule may be coerced. Nothing here depends on the interval; deltas are
// the same call whether the gap is 15 minutes or a day.

import { createClient } from '@supabase/supabase-js';

const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE  = 'https://gmail.googleapis.com/gmail/v1/users/me';

const LOOKBACK_DAYS = 90;

// Gmail's own system labels. These ride along on every thread and carry no
// project meaning, so they're stripped before storage — otherwise every row
// in the panel shows the same handful of chips and the Labels column becomes
// noise. UNREAD is the deliberate exception: it's re-added below as the
// unread marker render.js reads.
//
// Filtered by explicit list + CATEGORY_ prefix rather than the `type`
// discriminator from labels.list, because threads.get returns bare label id
// strings with no type field attached.
const SYSTEM_LABELS = new Set([
  'INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'UNREAD', 'STARRED',
  'IMPORTANT', 'CHAT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'
]);

const isSystemLabel = id => SYSTEM_LABELS.has(id) || id.startsWith('CATEGORY_');

// Ceiling on how many threads a single full backfill pass will fetch before
// saving progress and returning. Vercel Hobby caps function execution at 10s;
// a 90-day pull across several active client labels can exceed that. Rather
// than time out and lose the whole pass, the backfill is resumable: it stores
// a page token, does what it can, and picks up on the next cron tick. A large
// archive self-completes over a few cycles instead of failing forever.
const BACKFILL_BATCH = 40;

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google token exchange ${res.status}: ${body || res.statusText}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('Google token response contained no access_token');
  return json.access_token;
}

// Thin wrapper that surfaces Gmail's status code on the thrown error, so the
// caller can distinguish an expired historyId (404) from a real failure.
async function gmail(path, accessToken) {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gmail API ${res.status}: ${body || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── LABEL REFRESH ────────────────────────────────────────────────────────────
// Folded into this cron rather than left to the manual Sync Labels button.
// Labels are authored in Gmail, not in the hub, so a label created there
// should appear without anyone remembering to press anything. Without this,
// a brand-new Gmail label arrives on a thread as a raw id that
// gmailLabelDefs doesn't know, and render.js drops the chip entirely.
//
// Same zero-result guard as api/sync-gmail.js, but softer: a bad response
// SKIPS the label update and lets the thread sync proceed, rather than
// failing the whole run. A scheduled job shouldn't blank the sidebar.
async function refreshLabelDefs(supabase, accessToken) {
  const DEFAULT_BG = '#9FB1BC';
  const DEFAULT_TEXT = '#08212D';
  try {
    const json = await gmail('/labels', accessToken);
    const defs = (json.labels || [])
      .filter(l => l.type === 'user')
      .map(l => ({
        id: l.id,
        name: l.name,
        bgColor: (l.color && l.color.backgroundColor) || DEFAULT_BG,
        textColor: (l.color && l.color.textColor) || DEFAULT_TEXT
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (defs.length === 0) {
      console.warn('sync-gmail-threads: labels.list returned no user labels — skipping label refresh');
      return null;
    }
    const { error } = await supabase.from('workspace')
      .update({ gmail_label_defs: defs }).eq('id', 1);
    if (error) throw error;
    return defs;
  } catch (e) {
    console.error('sync-gmail-threads: label refresh failed, continuing:', e.message);
    return null;
  }
}

// ── THREAD NORMALIZATION ─────────────────────────────────────────────────────

// Gmail returns headers as an array of {name, value}; names are not
// case-normalized across senders, so match case-insensitively.
function header(msg, name) {
  const h = ((msg.payload && msg.payload.headers) || [])
    .find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// "Andrew Willis <andrew@flimp.net>" -> "Andrew Willis"
// "andrew@flimp.net"                 -> "andrew@flimp.net"
// Display name preferred: the panel's From column is narrow, and a real name
// scans faster than an address.
function parseFrom(raw) {
  if (!raw) return '';
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  const name = m && m[1] ? m[1].trim() : '';
  return name || raw.trim();
}

// Collapses a full threads.get response into the single flat entry render.js
// consumes. The union-of-labels and newest-message rules are what make a
// thread (rather than a message) the unit of display.
function normalizeThread(thread) {
  const msgs = thread.messages || [];
  if (!msgs.length) return null;

  // Gmail returns messages in thread order; internalDate is epoch ms as a
  // string. Sorted explicitly rather than trusting order.
  const sorted = [...msgs].sort(
    (a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0)
  );
  const newest = sorted[sorted.length - 1];

  // Union across every message: a thread carries a label even if only one
  // message in it was tagged. Same for unread — one unread message makes the
  // whole conversation unread, which is how Gmail's own UI reads.
  const union = new Set();
  let anyUnread = false;
  for (const m of msgs) {
    for (const id of (m.labelIds || [])) {
      if (id === 'UNREAD') { anyUnread = true; continue; }
      if (!isSystemLabel(id)) union.add(id);
    }
  }

  const labelIds = [...union];
  // Re-attached as the synthetic marker render.js keys unread styling off.
  if (anyUnread) labelIds.push('UNREAD');

  return {
    threadId: thread.id,
    labelIds,
    from: parseFrom(header(newest, 'From')),
    subject: header(newest, 'Subject') || '(no subject)',
    // ISO rather than a preformatted string, so the panel can sort and
    // reformat without reparsing a display value.
    date: new Date(Number(newest.internalDate || 0)).toISOString()
  };
}

async function fetchThread(id, accessToken) {
  // metadata format + an explicit header allowlist: enough for From/Subject
  // without transferring message bodies. Bodies are deliberately never
  // fetched or stored — Gmail remains the system of record for content.
  const path = `/threads/${id}?format=metadata`
    + '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
  return gmail(path, accessToken);
}

// ── FULL BACKFILL ────────────────────────────────────────────────────────────
// Scoped to labels actually assigned to a project — no reason to pull a label
// nothing points at. Resumable via a stored page token (see BACKFILL_BATCH).
async function backfill(supabase, accessToken, assignedLabelIds, state) {
  const existing = new Map((state.emails || []).map(e => [e.threadId, e]));
  let pageToken = state.backfillToken || null;
  let labelIdx = state.backfillLabelIdx || 0;
  let fetched = 0;

  while (labelIdx < assignedLabelIds.length && fetched < BACKFILL_BATCH) {
    const labelId = assignedLabelIds[labelIdx];
    const q = encodeURIComponent(`newer_than:${LOOKBACK_DAYS}d`);
    const path = `/threads?labelIds=${encodeURIComponent(labelId)}&q=${q}&maxResults=50`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const page = await gmail(path, accessToken);
    const ids = (page.threads || []).map(t => t.id);

    for (const id of ids) {
      if (fetched >= BACKFILL_BATCH) break;
      // Threads can carry several assigned labels; skip ones already built
      // this pass so a shared thread isn't fetched once per label.
      if (existing.has(id) && !state.backfillToken) continue;
      try {
        const norm = normalizeThread(await fetchThread(id, accessToken));
        if (norm) existing.set(norm.threadId, norm);
        fetched++;
      } catch (e) {
        console.error(`sync-gmail-threads: thread ${id} failed:`, e.message);
      }
    }

    if (page.nextPageToken && fetched < BACKFILL_BATCH) {
      pageToken = page.nextPageToken;
    } else if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      break;                       // batch ceiling hit mid-label; resume here
    } else {
      labelIdx++;
      pageToken = null;            // label exhausted; advance to the next
    }
  }

  const done = labelIdx >= assignedLabelIds.length;
  return {
    emails: [...existing.values()],
    backfillToken: done ? null : pageToken,
    backfillLabelIdx: done ? 0 : labelIdx,
    complete: done
  };
}

// ── DELTA SYNC ───────────────────────────────────────────────────────────────
// history.list returns changed message ids; those resolve up to thread ids,
// and only the affected threads get re-fetched. Steady-state cost on a quiet
// interval is a single call returning nothing.
async function delta(supabase, accessToken, assignedSet, state) {
  const byId = new Map((state.emails || []).map(e => [e.threadId, e]));
  const touched = new Set();
  let pageToken = null;
  let newHistoryId = state.historyId;

  do {
    const path = `/history?startHistoryId=${encodeURIComponent(state.historyId)}`
      + '&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved'
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await gmail(path, accessToken);

    for (const h of (page.history || [])) {
      for (const key of ['messagesAdded', 'labelsAdded', 'labelsRemoved']) {
        for (const item of (h[key] || [])) {
          const msg = item.message || item;
          if (msg && msg.threadId) touched.add(msg.threadId);
        }
      }
    }
    if (page.historyId) newHistoryId = page.historyId;
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  for (const id of touched) {
    try {
      const norm = normalizeThread(await fetchThread(id, accessToken));
      if (!norm) continue;
      // A thread that no longer carries any assigned label has been moved
      // out of a client's bucket — drop it rather than letting it linger in
      // a project it no longer belongs to.
      const stillAssigned = norm.labelIds.some(l => assignedSet.has(l));
      if (stillAssigned) byId.set(norm.threadId, norm);
      else byId.delete(norm.threadId);
    } catch (e) {
      // 404 = deleted/purged upstream. Drop it locally too.
      if (e.status === 404) byId.delete(id);
      else console.error(`sync-gmail-threads: thread ${id} failed:`, e.message);
    }
  }

  return { emails: [...byId.values()], historyId: newHistoryId, changed: touched.size };
}

// ── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const accessToken = await getAccessToken();

    // Labels come first: a thread synced before its label is known would
    // render with a missing chip until the next run.
    await refreshLabelDefs(supabase, accessToken);

    const { data: ws, error: wsErr } = await supabase
      .from('workspace').select('*').eq('id', 1).single();
    if (wsErr) throw wsErr;

    const { data: rows, error: rErr } = await supabase.from('rows').select('data');
    if (rErr) throw rErr;

    // gmailLabels is NOT a named column on `rows`. api/db.js maps only the
    // fields in its KNOWN_FIELDS list to real columns; everything else —
    // gmailLabels included — lands in the catch-all `data` JSONB blob,
    // camelCase preserved. So it's read from data->gmailLabels here rather
    // than a snake_case column that doesn't exist.
    const assignedLabelIds = [...new Set(
      (rows || []).flatMap(r => (r.data && r.data.gmailLabels) || [])
    )];
    if (!assignedLabelIds.length) {
      return res.status(200).json({ ok: true, skipped: 'no labels assigned to any project' });
    }
    const assignedSet = new Set(assignedLabelIds);

    const state = {
      emails:           ws.gmail_emails || [],
      historyId:        ws.gmail_history_id || null,
      backfillToken:    ws.gmail_backfill_token || null,
      backfillLabelIdx: ws.gmail_backfill_label_idx || 0
    };

    let emails, historyId, mode, extra = {};

    // Backfill runs when there's no history marker at all, or when a previous
    // backfill was interrupted mid-way and left a resume token.
    const needsBackfill = !state.historyId || state.backfillToken;

    if (needsBackfill) {
      mode = 'backfill';
      const out = await backfill(supabase, accessToken, assignedLabelIds, state);
      emails = out.emails;
      extra = { backfillToken: out.backfillToken, backfillLabelIdx: out.backfillLabelIdx };
      // Only stamp a history marker once the backfill has fully finished.
      // Stamping early would let the next run take the delta path having
      // never pulled the older half of the archive.
      historyId = out.complete
        ? (await gmail('/profile', accessToken)).historyId
        : null;
      extra.complete = out.complete;
    } else {
      mode = 'delta';
      try {
        const out = await delta(supabase, accessToken, assignedSet, state);
        emails = out.emails;
        historyId = out.historyId;
        extra = { changed: out.changed };
      } catch (e) {
        // Gmail expires history ids after roughly a week. 404 here means the
        // marker is too old to serve — clear it and let the next run rebuild
        // from scratch rather than silently syncing nothing forever.
        if (e.status === 404) {
          console.warn('sync-gmail-threads: historyId expired, resetting for full rebuild');
          await supabase.from('workspace')
            .update({ gmail_history_id: null, gmail_backfill_token: null, gmail_backfill_label_idx: 0 })
            .eq('id', 1);
          return res.status(200).json({ ok: true, mode: 'history-expired', note: 'full rebuild next run' });
        }
        throw e;
      }
    }

    // Newest first — matches the panel's own sort, so an unsorted read still
    // looks right, and keeps the array stable between runs.
    emails.sort((a, b) => new Date(b.date) - new Date(a.date));

    const update = { gmail_emails: emails };
    if (historyId) update.gmail_history_id = historyId;
    if ('backfillToken' in extra)    update.gmail_backfill_token = extra.backfillToken;
    if ('backfillLabelIdx' in extra) update.gmail_backfill_label_idx = extra.backfillLabelIdx;

    const { error: uErr } = await supabase.from('workspace').update(update).eq('id', 1);
    if (uErr) throw uErr;

    return res.status(200).json({ ok: true, mode, threads: emails.length, ...extra });
  } catch (err) {
    console.error('api/sync-gmail-threads error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
