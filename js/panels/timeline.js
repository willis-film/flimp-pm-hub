// timeline.js — Timeline panel.
//
// A RECEIVER, not a builder. The Timeline Tool is a separate app with its own
// scheduling engine; reimplementing it here would guarantee two diverging
// sources of truth for the same dates. This panel takes the Tool's final
// copyable export, parses it, and reads it back as a per-item progress board.
//
// ── THE CENTRAL PROBLEM THIS SOLVES ──────────────────────────────────────────
// A pasted plan tells you where you are SUPPOSED to be. It cannot tell you where
// you ARE. Nothing in the export knows what has actually shipped, and the
// subtask phases are generic — they do not map 1:1 onto the plan's task list.
//
// An earlier version of this panel drew ticks left of TODAY as "past" and
// counted them as though they were done. That was a lie: a tick left of TODAY
// means the DATE passed, not that the WORK happened. Ahead-of-schedule was
// literally unrepresentable — the strip had no way to know.
//
// So the tool stops guessing and asks. Each item gets a dropdown of its own plan
// tasks; you select the one you are actually on. THAT is the fact. Health is
// then a straight comparison of two dates:
//
//     the planned date of the task you selected   vs.   today
//
//   selected task is scheduled in the FUTURE  → you are AHEAD of the plan
//   selected task is scheduled around TODAY   → ON TRACK
//   selected task is scheduled in the PAST    → BEHIND
//
// No phase mapping, no inference, no false precision. The number is real because
// you supplied the half the tool could not know.
//
// ── STORAGE ──────────────────────────────────────────────────────────────────
// Selections live on the timeline object (tl.position[subtaskId] = taskIndex),
// NOT on the subtask row. They are a claim about THIS plan, so they die with it
// on re-paste rather than dangling against a task list that no longer exists.

import { esc, fmtDate } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

// ── PARSER ───────────────────────────────────────────────────────────────────
//
// Tab-delimited: PARTY · DELIVERABLE · TASK · DUE. Three things in the real
// clipboard bytes defeat a naive line split — all verified against a capture:
//
//   1. MERGED CELLS hold a raw \n INSIDE the cell. When two tasks share a date
//      the exporter stacks them, so ONE logical record spills across THREE
//      physical lines with the tabs scattered:
//
//        Flimp<TAB>Customized Explainer
//        Digital Postcard<TAB>Animation Revisions Rd 2
//        Design Updates Rd 2<TAB>Oct 15
//
//      Lines are NOT record boundaries. Tab count is: 4 fields = 3 tabs.
//
//   2. TITLE AND FOOTER HAVE NO TABS, so feeding them to that accumulator
//      silently merges the title into the header row and it vanishes. Peel them
//      off by position first.
//
//   3. THE FOOTER USES NBSP (U+00A0) and · (U+00B7), not plain spaces.

const NBSP = /\u00a0/g;
const clean = s => (s || '').replace(NBSP, ' ').trim();
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

// Export dates carry no year ("Aug 27"). Anchor on the title's year and walk
// forward; when a date goes BACKWARDS, the year rolled. OE work routinely runs
// Nov → Jan, so this is not hypothetical.
function resolveDates(list, startYear) {
  let year = startYear, prev = -1;
  return list.map(d => {
    const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(clean(d));
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return null;
    const ord = mo * 31 + (+m[2]);
    if (prev >= 0 && ord < prev) year++;
    prev = ord;
    return new Date(Date.UTC(year, mo, +m[2]));
  });
}
const iso = d => d ? d.toISOString().slice(0, 10) : '';

function parseExport(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');

  let title = null, summary = null, a = 0, b = lines.length;
  while (a < b && !lines[a].includes('\t')) { const t = clean(lines[a]); if (t && !title) title = t; a++; }
  while (b > a && !lines[b-1].includes('\t')) { const t = clean(lines[b-1]); if (t && !summary) summary = t; b--; }

  const recs = []; let buf = '';
  for (const line of lines.slice(a, b)) {
    buf = buf ? buf + '\n' + line : line;
    if ((buf.match(/\t/g) || []).length >= 3) { recs.push(buf); buf = ''; }
  }

  const tasks = [];
  for (const rec of recs) {
    const fld = rec.split('\t');
    if (fld.length < 4) continue;
    if (/^party$/i.test(clean(fld[0]))) continue;

    const party = clean(fld[0]), deliv = clean(fld[1]),
          task  = clean(fld[2]), due   = clean(fld[3]);
    const dl = deliv.split('\n').map(s => s.trim()).filter(Boolean);
    const tl = task .split('\n').map(s => s.trim()).filter(Boolean);

    if (dl.length > 1 || tl.length > 1) {
      // STACKED — distinct tasks that happened to share a date, merged into one
      // visual row by the exporter. Zip positionally; they are not one thing.
      const n = Math.max(dl.length, tl.length);
      for (let i = 0; i < n; i++)
        tasks.push({ party, deliverables: [dl[i] ?? dl[0]], task: tl[i] ?? tl[0], due });
    } else if (deliv.includes(',')) {
      // JOINED — ONE task spanning every deliverable. Kickoff and Distribution.
      tasks.push({ party, deliverables: deliv.split(',').map(s => s.trim()).filter(Boolean), task, due });
    } else {
      tasks.push({ party, deliverables: [deliv], task, due });
    }
  }

  const meta = {};
  if (summary) for (const part of summary.split('·')) {
    const i = part.indexOf(':');
    if (i > 0) meta[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }

  const ty = title && /\b(20\d{2})\b/.exec(title);
  const resolved = resolveDates(tasks.map(t => t.due), ty ? +ty[1] : new Date().getUTCFullYear());
  tasks.forEach((t, i) => { t.date = iso(resolved[i]); });

  return { title, tasks, meta, position: {}, pastedAt: new Date().toISOString() };
}

// ── HEALTH ───────────────────────────────────────────────────────────────────
// The whole point. Two dates, one subtraction.

const todayISO = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
const norm = s => (s || '').toLowerCase().trim();

// Thresholds. Deliberately asymmetric: being a few days behind on a 54-day plan
// is noise, so "on track" absorbs a small slip. Real trouble is a week-plus.
function healthOf(drift) {
  if (drift === null)  return { key:'none',    label:'No position set', cls:'tl-h-none' };
  if (drift >=  3)     return { key:'ahead',   label:`${drift}d ahead`,  cls:'tl-h-ahead' };
  if (drift >= -2)     return { key:'ontrack', label:'On track',         cls:'tl-h-ontrack' };
  if (drift >= -7)     return { key:'slipping',label:`${-drift}d behind`,cls:'tl-h-slipping' };
  return                      { key:'behind',  label:`${-drift}d behind`,cls:'tl-h-behind' };
}

// Build one strip per SUBTASK. Tasks are matched to a subtask by NAME — the
// export's deliverables are the item names ~99% of the time. Kickoff and
// Distribution name every deliverable, so they land on every strip, correctly.
function buildStrips(parent, tl) {
  const today = todayISO();
  const dated = tl.tasks.filter(t => t.date);
  const all   = dated.map(t => t.date).sort();
  const t0 = all[0], t1 = all[all.length - 1];
  const span = Math.max(1, days(t1, t0));
  const pct = d => Math.max(0, Math.min(100, days(d, t0) / span * 100));

  // ── THE JOIN ───────────────────────────────────────────────────────────────
  // The export's DELIVERABLE column holds PRODUCT NAMES, so `productTier` is the
  // dependable key. Subtask NAMES are client-prefixed free text ("Universal –
  // PPT Conversion") and will essentially never equal a product name — an
  // earlier version matched on name and every strip read "Not in this plan".
  //
  // Order matters. A manual override always wins, because it is the one signal
  // that is certainly correct: a human said so. Then tier. Then name, purely as
  // a courtesy for the case where an item happens to be named after its product.
  const deliverables = [...new Set(dated.flatMap(t => t.deliverables))];

  const strips = A.getChildren(parent.id).map(kid => {
    const override = tl.link ? tl.link[kid.id] : undefined;

    let key = null, how = null;
    if (override === '\u0000none') {
      key = null; how = 'unlinked';        // user explicitly broke the link
    } else if (override !== undefined && override !== '') {
      key = norm(override); how = 'manual';
    } else if (kid.productTier && deliverables.some(d => norm(d) === norm(kid.productTier))) {
      key = norm(kid.productTier); how = 'tier';
    } else if (kid.name && deliverables.some(d => norm(d) === norm(kid.name))) {
      key = norm(kid.name); how = 'name';
    }

    const mine = key ? dated.filter(t => t.deliverables.some(d => norm(d) === key)) : [];

    // The selected task — the fact the tool cannot infer and had to ask for.
    const selIdx = tl.position ? tl.position[kid.id] : undefined;
    const sel = (selIdx !== undefined && mine[selIdx]) ? mine[selIdx] : null;

    // Drift: is the task you are ON scheduled ahead of today, or behind it?
    // Positive = the plan did not expect you here yet = you are ahead.
    const drift = sel ? days(sel.date, today) : null;
    const nextIdx = sel ? selIdx + 1 : mine.findIndex(t => t.date >= today);
    const next = (nextIdx >= 0 && mine[nextIdx]) ? mine[nextIdx] : null;

    return {
      kid, tasks: mine, selIdx: sel ? selIdx : null, sel, next, nextIdx,
      // How this strip found its tasks — surfaced in the UI, because a silently
      // wrong join is the worst outcome here.
      how, matchedOn: key, deliverables,
      // The bubble points at the next tick, so it needs that tick's position on
      // the track — not just the task.
      nextPct: next ? pct(next.date) : null,
      drift, health: healthOf(drift),
      ticks: mine.map((t, i) => ({
        i, pct: pct(t.date), task: t.task, date: t.date,
        party: t.party || '',
        shared: !t.party,
        done: sel ? i < selIdx : false,   // DONE means before your selection —
        cur:  sel ? i === selIdx : false  // not "the date passed". That distinction
      }))                                  // is the entire point of the selector.
    };
  });

  return { strips, t0, t1, span, todayPct: pct(today), today };
}

// ── VIEW ─────────────────────────────────────────────────────────────────────

function emptyView(pid) {
  return `<div class="tl-empty">
    <div class="tl-empty-h">Paste the Timeline Tool export</div>
    <div class="tl-empty-b">Copy the final table out of the Timeline Tool and paste it here.
      This panel reads the plan — it never writes dates back onto items.</div>
    <textarea class="tl-paste" id="tl-paste-${pid}"
      placeholder="PARTY&#9;DELIVERABLE&#9;TASK&#9;DUE DATE&#10;…"></textarea>
    <button class="tl-btn" onclick="A.tlImport('${pid}')">Import timeline</button>
  </div>`;
}

function stripRow(pid, s, todayPct) {
  const kid = s.kid;

  if (!s.tasks.length) {
    // No match. Rather than a dead end, offer the fix: pick the deliverable this
    // item corresponds to. The tool cannot reliably guess when the tier is blank
    // or spelled differently — so it asks, and the answer is authoritative.
    const opts = s.deliverables.map(d =>
      `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    return `<div class="tl-row tl-row-empty">
      <div class="tl-lbl"><div class="tl-nm">
        <span class="tl-dot is-${esc(kid.status)}"></span>
        <span class="tl-nmt">${esc(kid.name)}</span></div>
        <div class="tl-meta">${esc(kid.productType || '—')}${kid.productTier ? ' · ' + esc(kid.productTier) : ''}</div>
      </div>
      <select class="tl-sel tl-sel-link" onchange="A.tlSetLink('${pid}','${kid.id}',this.value)">
        <option value="">Link to deliverable…</option>
        ${opts}
      </select>
      <div class="tl-track"><div class="tl-none">Not matched to this plan</div></div>
      <div class="tl-right"></div>
    </div>`;
  }

  const ticks = s.ticks.map(t => {
    let cls = t.shared ? 'tk-shared' : (t.party === 'Flimp' ? 'tk-flimp' : 'tk-client');
    if (t.cur) cls += ' tk-cur';
    else if (t.done) cls += ' tk-done';
    else cls += ' tk-todo';
    const who = t.party || 'Shared';
    return `<div class="tl-tick ${cls}" style="left:${t.pct.toFixed(2)}%"
      title="${esc(t.task)} · ${esc(fmtDate(t.date))} · ${esc(who)}"></div>`;
  }).join('');

  // Fill runs to where YOU are, not to today. Progress, not calendar.
  const fill = s.sel ? `<div class="tl-fill" style="width:${s.ticks[s.selIdx].pct.toFixed(2)}%"></div>` : '';

  const opts = s.tasks.map((t, i) =>
    `<option value="${i}"${i === s.selIdx ? ' selected' : ''}>${esc(t.task)} · ${esc(fmtDate(t.date))}</option>`
  ).join('');

  const nextCell = s.next
    ? `<div class="tl-next-t">${esc(s.next.task)}</div>
       <div class="tl-next-m">${esc(fmtDate(s.next.date))} · ${esc(s.next.party || 'Shared')}</div>`
    : (s.sel ? `<div class="tl-next-t tl-next-done">Complete</div>` : `<div class="tl-next-m">—</div>`);

  // The bubble names the next task's DATE only. The task NAME already lives in
  // the right-hand column — putting it in the bubble too would be the same fact
  // twice, and wide enough to collide with its neighbours on a busy track.
  //
  // CLAMPING. The wrapper is anchored ON the tick (left:%). The body is then
  // shifted by a transform. Centred (-50%) is right for the middle of the track,
  // but near either end the body would hang past the panel's edge.
  //
  // The fix: at the extremes the shift must equal the POSITION. A tick at 100%
  // needs shift -100% (body's right edge lands on the track's right edge); a
  // tick at 0% needs shift 0% (body's left edge on the track's left edge). In
  // between, ramp linearly. An earlier version clamped to a fixed -92% and the
  // body still overhung by 3px at 100% — measured, not guessed.
  //
  // The POINTER never moves. It is the part that carries meaning, so it must not
  // lie about which tick it names.
  let bubble = '';
  if (s.next && s.nextPct !== null) {
    const p = s.nextPct;
    // Ramp from 0% shift at the left edge, through -50% in the middle, to -100%
    // at the right edge — but only inside the end zones. The middle stays -50%.
    const EDGE = 12;                     // % of track treated as an end zone
    let shift = -50;
    if (p < EDGE)          shift = -(p / EDGE) * 50;
    else if (p > 100-EDGE) shift = -50 - ((p - (100-EDGE)) / EDGE) * 50;
    bubble = `<div class="tl-bub" style="left:${p.toFixed(2)}%">
      <span class="tl-bub-b" style="transform:translateX(${shift.toFixed(1)}%)">${esc(fmtDate(s.next.date))}</span>
      <i class="tl-bub-p"></i>
    </div>`;
  }

  // Show WHAT this strip is reading. A join that is silently wrong is worse than
  // one that fails — so the matched deliverable is always named, and a manual
  // link is marked as such so it never looks like the tool worked it out.
  const linked = s.tasks[0].deliverables.find(d => norm(d) === s.matchedOn) || s.matchedOn;
  const via = s.how === 'manual' ? ' · linked' : '';

  return `<div class="tl-row">
    <div class="tl-lbl">
      <div class="tl-nm">
        <span class="tl-dot is-${esc(kid.status)}"></span>
        <span class="tl-nmt">${esc(kid.name)}</span>
      </div>
      <div class="tl-meta tl-meta-link" title="Reading the plan's &quot;${esc(linked)}&quot; tasks"
           onclick="A.tlRelink('${pid}','${kid.id}')">${esc(linked)}${via}</div>
    </div>

    <select class="tl-sel" onchange="A.tlSetPos('${pid}','${kid.id}',this.value)">
      <option value="">Where are we?</option>
      ${opts}
    </select>

    <div class="tl-track">
      ${bubble}
      <div class="tl-base"></div>
      ${fill}
      ${ticks}
    </div>

    <div class="tl-right">
      <div class="tl-next">${nextCell}</div>
      <div class="tl-health ${s.health.cls}">${esc(s.health.label)}</div>
    </div>
  </div>`;
}

function timelinePanelHtml(parent) {
  const tl = parent.timeline;
  if (!tl || !tl.tasks || !tl.tasks.length) return emptyView(parent.id);

  const b = buildStrips(parent, tl);
  const stamp = tl.pastedAt ? fmtDate(tl.pastedAt.slice(0, 10)) : '—';

  // Column geometry lives in one place so the TODAY rule can be positioned
  // against the track column honestly instead of by a magic pixel offset.
  const rows = b.strips.map(s => stripRow(parent.id, s, b.todayPct)).join('');

  return `<div class="tl-panel">
    <div class="tl-head">
      <div>
        <div class="tl-title">${esc(tl.title || 'Timeline')}</div>
        <div class="tl-stamp">Plan as pasted ${esc(stamp)} · ${tl.tasks.length} tasks · not linked to the Timeline Tool</div>
      </div>
      <button class="tl-btn tl-btn-ghost" onclick="A.tlClear('${parent.id}')">Replace</button>
    </div>

    <div class="tl-grid">
      <!-- The rule's left% must resolve against the TRACK, not the whole grid.
           This span has exactly the track's geometry, so the percentage is true. -->
      <div class="tl-track-span">
        <div class="tl-now" style="left:${b.todayPct.toFixed(2)}%"><span>TODAY</span></div>
      </div>
      ${rows}
      <div class="tl-ax"><span>${esc(fmtDate(b.t0))}</span><span>${esc(fmtDate(b.t1))}</span></div>
    </div>

    <div class="tl-key">
      <span><i class="tl-k tk-flimp tk-done"></i>Flimp</span>
      <span><i class="tl-k tk-client tk-done"></i>Client</span>
      <span><i class="tl-k tk-shared tk-done"></i>Shared</span>
      <span><i class="tl-k tk-cur"></i>Current</span>
    </div>
  </div>`;
}

// ── MUTATORS ─────────────────────────────────────────────────────────────────

function tlImport(pid) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const ta = document.getElementById('tl-paste-' + pid);
  const raw = ta ? ta.value : '';
  if (!raw.trim()) return;

  const parsed = parseExport(raw);
  if (!parsed.tasks.length) {
    // Fail loudly. A silent no-op looks exactly like a successful paste.
    ta.classList.add('tl-paste-err');
    ta.placeholder = "Couldn't find any task rows — is this the tab-delimited export?";
    return;
  }
  r.timeline = parsed;                       // positions start empty, by design
  A.logActivity(r, 'timeline', '', `${parsed.tasks.length} tasks`);
  save(); A.render();
}

// The one thing the tool cannot infer: where you actually are.
function tlSetPos(pid, kidId, val) {
  const r = db.rows.find(x => x.id === pid);
  if (!r || !r.timeline) return;
  if (!r.timeline.position) r.timeline.position = {};
  if (val === '') delete r.timeline.position[kidId];
  else r.timeline.position[kidId] = +val;
  save(); A.render();
}

// Manual override for the join. Stored beside `position` on the timeline object,
// so it dies with the plan too — a link is a claim about THIS export's
// deliverable list, and would dangle against a different one.
function tlSetLink(pid, kidId, val) {
  const r = db.rows.find(x => x.id === pid);
  if (!r || !r.timeline) return;
  if (!r.timeline.link) r.timeline.link = {};
  if (val === '') delete r.timeline.link[kidId];
  else r.timeline.link[kidId] = val;
  // A link changes which task list the item reads, so any existing position now
  // points into the wrong list. Drop it rather than silently mis-indexing.
  if (r.timeline.position) delete r.timeline.position[kidId];
  save(); A.render();
}

// Clicking the matched-deliverable label clears the link, dropping the strip
// back to "unmatched" so the picker reappears.
function tlRelink(pid, kidId) {
  const r = db.rows.find(x => x.id === pid);
  if (!r || !r.timeline) return;
  if (!r.timeline.link) r.timeline.link = {};
  // Sentinel: an explicit empty link beats the tier auto-match, forcing the
  // picker. Without it, clearing would just fall back to the tier again.
  r.timeline.link[kidId] = '\u0000none';
  if (r.timeline.position) delete r.timeline.position[kidId];
  save(); A.render();
}

function tlClear(pid) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  r.timeline = null;              // positions AND links die with the plan
  save(); A.render();
}

register({ timelinePanelHtml, tlImport, tlSetPos, tlSetLink, tlRelink, tlClear,
           parseTimelineExport: parseExport });
