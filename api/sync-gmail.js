// api/sync-gmail.js — pulls the Gmail label list for the account and writes it
// into the workspace singleton's gmail_label_defs column. Runs server-side
// only: it holds the Google OAuth refresh token, same rule as
// CLICKUP_API_TOKEN in api/sync-clickup.js and SUPABASE_SERVICE_KEY in
// api/db.js. The browser never sees a Google credential.
//
// Why a refresh token rather than an interactive OAuth flow: this hub is a
// single-operator tool with no build step and no session layer. A one-time
// consent, done once out-of-band, exchanged here for short-lived access
// tokens, avoids standing up login/callback routes and a token store for a
// single user. Consent is granted once with scope
// https://www.googleapis.com/auth/gmail.readonly — read-only on purpose;
// nothing in this hub writes to Gmail.
//
// This is a FULL replace-sync, like sync-clickup: gmail_label_defs should
// always be "the labels that exist in Gmail right now." Dropping a label in
// Gmail does NOT unassign it from a project — rows.gmail_labels keeps the
// stale id, and emails.js already renders that case as a "label moved" pill
// with a remove affordance. That's deliberate: a label vanishing upstream
// shouldn't silently rewrite project history.
//
// Trigger: on-demand — the Sync button in the Gmail sidebar hits this URL.
// Layering a schedule on top later (Vercel Cron, or any external cron hitting
// this same URL) needs no change here.

import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';

// Gmail's built-in system labels (INBOX, SENT, SPAM, CATEGORY_*, etc.) come
// back from the same endpoint as user labels but are noise here — the hub
// only ever assigns client/workflow labels to projects. Filtered by the
// API's own `type` discriminator rather than a name blocklist, so it stays
// correct if Google adds new system labels.
const USER_LABEL_TYPE = 'user';

// Fallback palette for labels with no color set in Gmail. Gmail only returns
// a `color` object for labels whose color was explicitly chosen; the rest
// have none at all. The sidebar and pills both expect a bgColor, so an
// unset label gets the neutral hub grey rather than rendering colorless.
const DEFAULT_BG = '#9FB1BC';
const DEFAULT_TEXT = '#08212D';

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Exchanges the long-lived refresh token for a short-lived access token.
// Access tokens last ~1 hour; since this handler is request-scoped and does
// its work in one pass, there's no need to cache or persist the result —
// each sync gets a fresh one and discards it.
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
    // A 400 here almost always means the refresh token was revoked or
    // expired (Google expires them after ~6 months of disuse, and on
    // password change). Surfaced explicitly because the fix is re-consent,
    // not a retry.
    throw new Error(`Google token exchange ${res.status}: ${body || res.statusText}`);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error('Google token response contained no access_token');
  return json.access_token;
}

async function fetchLabels(accessToken) {
  const res = await fetch(LABELS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${body || res.statusText}`);
  }
  const json = await res.json();
  // labels.list is not paginated — Gmail returns the full set in one call.
  return json.labels || [];
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const accessToken = await getAccessToken();
    const rawLabels = await fetchLabels(accessToken);

    // Keep Gmail's own label id as the hub id. That's what makes this sync
    // idempotent: rows.gmail_labels stores these ids, so re-syncing never
    // orphans an assignment the way regenerated local ids ('lbl1', 'lbl2'
    // from seed.js) would. Sorted by name so the sidebar ordering is stable
    // between syncs rather than tracking Gmail's arbitrary return order.
    const labelDefs = rawLabels
      .filter(l => l.type === USER_LABEL_TYPE)
      .map(l => ({
        id: l.id,
        name: l.name,
        bgColor: (l.color && l.color.backgroundColor) || DEFAULT_BG,
        textColor: (l.color && l.color.textColor) || DEFAULT_TEXT
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Guard: an empty result would blank every label in the sidebar and turn
    // every assigned pill into "label moved". That's a plausible symptom of
    // a scope/permission problem (a readonly token on the wrong account
    // returns 200 with no user labels), not a real "you deleted all your
    // labels" event. Refuse rather than destroy, same spirit as the
    // malformed-payload guard in api/db.js.
    if (labelDefs.length === 0) {
      return res.status(409).json({
        error: 'Gmail returned no user labels — refusing to clear gmail_label_defs. '
             + 'Check that GOOGLE_REFRESH_TOKEN belongs to the right account.'
      });
    }

    // Targeted column update on the workspace singleton. Deliberately NOT an
    // upsert of the whole workspace object: api/db.js owns that shape, and a
    // full upsert from here would race the client's own save() and could
    // blank gmail_client_prefix or gmail_emails. Only the one column this
    // endpoint is responsible for gets written.
    const { error: wErr } = await supabase
      .from('workspace')
      .update({ gmail_label_defs: labelDefs })
      .eq('id', 1);
    if (wErr) throw wErr;

    return res.status(200).json({ ok: true, synced: labelDefs.length });
  } catch (err) {
    console.error('api/sync-gmail error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
