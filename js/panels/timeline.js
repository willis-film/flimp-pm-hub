// timeline.js — Timeline panel.
//
// A RECEIVER, not a builder. The Timeline Tool is a separate, complete app with
// its own scheduling engine; reimplementing that engine here would guarantee two
// diverging sources of truth for the same dates. So this panel takes the Tool's
// final copyable export, parses it, and displays it.
//
// WHAT THIS IS NOT: it does not write dates onto subtasks. The export is the
// PLAN — generated at kickoff, hypothetical. The dates on the rows are the
// RECORD — filled in as things get confirmed. Those are different facts and must
// not overwrite one another. The panel therefore compares them and shows the gap
// rather than resolving it.
//
// A pasted export is also frozen at paste time. The Tool moves on; this does
// not. The panel timestamps every paste and says so, because presenting a stale
// plan as current would be the dishonest move.

import { esc, fmtDate } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

// ── PARSER ───────────────────────────────────────────────────────────────────
//
// The export is tab-delimited, four columns: PARTY · DELIVERABLE · TASK · DUE.
// Three things in it defeat a naive line-by-line split, all verified against a
// real clipboard capture:
//
//   1. MERGED CELLS. When two tasks share a date the exporter merges them into
//      one visual row, stacking values inside the DELIVERABLE and TASK cells
//      with a raw \n. That newline is INSIDE the cell, so one logical record
//      spills across three physical lines with the tabs scattered:
//
//        Flimp<TAB>Customized Explainer
//        Digital Postcard<TAB>Animation Revisions Rd 2
//        Design Updates Rd 2<TAB>Oct 15
//
//      Lines are therefore NOT record boundaries. Tab count is: every record has
//      exactly 4 fields = 3 tabs. Accumulate physical lines until 3 tabs.
//
//   2. TITLE AND FOOTER HAVE NO TABS. Feed them to that accumulator and they get
//      absorbed into the neighbouring record — the title silently merges with
//      the column header and disappears. Peel them off by position FIRST.
//
//   3. THE FOOTER USES NBSP (U+00A0) AND · (U+00B7), not plain spaces. Splitting
//      on / +/ fails. Normalise before touching it.

const NBSP = /\u00a0/g;
const clean = s => (s || '').replace(NBSP, ' ').trim();

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

// Export dates carry no year ("Aug 27"). Anchor on the project start and walk
// forward: when a date goes BACKWARDS relative to the previous one, the year has
// rolled. Matters for OE work, which routinely runs Nov → Jan.
function resolveDates(list, startYear) {
  let year = startYear, prev = -1;
  return list.map(d => {
    const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(clean(d));
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return null;
    const ord = mo * 31 + (+m[2]);
    if (prev >= 0 && ord < prev) year++;   // wrapped into the next year
    prev = ord;
    return new Date(Date.UTC(year, mo, +m[2]));
  });
}

const iso = d => d ? d.toISOString().slice(0, 10) : '';

function parseExport(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');

  // Peel the untabbed title and footer off the ends BEFORE reassembling.
  let title = null, summary = null, a = 0, b = lines.length;
  while (a < b && !lines[a].includes('\t')) { const t = clean(lines[a]); if (t && !title) title = t; a++; }
  while (b > a && !lines[b-1].includes('\t')) { const t = clean(lines[b-1]); if (t && !summary) summary = t; b--; }

  // Reassemble records by tab count, not by line.
  const recs = []; let buf = '';
  for (const line of lines.slice(a, b)) {
    buf = buf ? buf + '\n' + line : line;
    if ((buf.match(/\t/g) || []).length >= 3) { recs.push(buf); buf = ''; }
  }

  const tasks = [];
  for (const rec of recs) {
    const fld = rec.split('\t');
    if (fld.length < 4) continue;
    if (/^party$/i.test(clean(fld[0]))) continue;              // column header

    const party = clean(fld[0]), deliv = clean(fld[1]),
          task  = clean(fld[2]), due   = clean(fld[3]);
    const dl = deliv.split('\n').map(s => s.trim()).filter(Boolean);
    const tl = task .split('\n').map(s => s.trim()).filter(Boolean);

    if (dl.length > 1 || tl.length > 1) {
      // STACKED — distinct tasks that happened to land the same day. Zip
      // positionally: deliverable[i] belongs to task[i]. Unpack into real,
      // separate tasks; they are not one thing.
      const n = Math.max(dl.length, tl.length);
      for (let i = 0; i < n; i++)
        tasks.push({ party, deliverables: [dl[i] ?? dl[0]], task: tl[i] ?? tl[0], due, shape: 'stacked' });
    } else if (deliv.includes(',')) {
      // JOINED — ONE task spanning every deliverable. Kickoff and Distribution
      // only, and both have an empty PARTY cell.
      tasks.push({ party, deliverables: deliv.split(',').map(s => s.trim()).filter(Boolean), task, due, shape: 'joined' });
    } else {
      tasks.push({ party, deliverables: [deliv], task, due, shape: 'simple' });
    }
  }

  // Footer → { 'Project Start':'Jul 13', 'Working Days':'69', ... }
  const meta = {};
  if (summary) for (const part of summary.split('·')) {
    const i = part.indexOf(':');
    if (i > 0) meta[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }

  // Year-resolve every date, anchored on the title's year if it has one.
  const ty = title && /\b(20\d{2})\b/.exec(title);
  const startYear = ty ? +ty[1] : new Date().getUTCFullYear();
  const resolved = resolveDates(tasks.map(t => t.due), startYear);
  tasks.forEach((t, i) => { t.date = iso(resolved[i]); });

  return { title, tasks, meta, pastedAt: new Date().toISOString() };
}

// ── DERIVED ──────────────────────────────────────────────────────────────────
// The point of the readout: facts the pasted table does not state.

const todayISO = () => new Date().toISOString().slice(0, 10);

function analyse(tl, parent) {
  const t = tl.tasks || [];
  const today = todayISO();

  const parties = {};
  t.forEach(x => { const k = x.party || 'Shared'; parties[k] = (parties[k] || 0) + 1; });

  const delivs = {};
  t.forEach(x => x.deliverables.forEach(d => {
    (delivs[d] = delivs[d] || { name: d, tasks: [] }).tasks.push(x);
  }));
  Object.values(delivs).forEach(d => {
    const ds = d.tasks.map(x => x.date).filter(Boolean).sort();
    d.first = ds[0]; d.last = ds[ds.length - 1]; d.count = d.tasks.length;
  });

  const dated = t.filter(x => x.date).sort((p, q) => p.date < q.date ? -1 : 1);
  const past  = dated.filter(x => x.date <  today);
  const next  = dated.find(x  => x.date >= today);

  // The plan's end vs. the project's actual due field. Two different facts —
  // one hypothetical, one committed. If they disagree, that IS the finding.
  const planEnd = dated.length ? dated[dated.length - 1].date : '';
  const realDue = parent.due || '';
  let slip = null;
  if (planEnd && realDue) {
    const d = Math.round((new Date(planEnd) - new Date(realDue)) / 864e5);
    if (d !== 0) slip = d;   // + = plan runs past the committed due date
  }

  return { parties, delivs: Object.values(delivs), dated, past, next, planEnd, realDue, slip, today };
}

// ── VIEW ─────────────────────────────────────────────────────────────────────

const stat = (label, val, cls) =>
  `<div class="tl-stat"><div class="tl-stat-l">${esc(label)}</div>
   <div class="tl-stat-v${cls ? ' ' + cls : ''}">${esc(val)}</div></div>`;

function emptyView(pid) {
  return `<div class="tl-empty">
    <div class="tl-empty-h">Paste the Timeline Tool export</div>
    <div class="tl-empty-b">Copy the final table out of the Timeline Tool and paste it below.
      This panel reads that plan — it does not write dates back onto subtasks.</div>
    <textarea class="tl-paste" id="tl-paste-${pid}"
      placeholder="PARTY&#9;DELIVERABLE&#9;TASK&#9;DUE DATE&#10;…"></textarea>
    <button class="tl-btn" onclick="A.tlImport('${pid}')">Import timeline</button>
  </div>`;
}

function timelinePanelHtml(parent) {
  const tl = parent.timeline;
  if (!tl || !tl.tasks || !tl.tasks.length) return emptyView(parent.id);

  const an = analyse(tl, parent);

  // A pasted plan is a snapshot. Say when it was taken — presenting a stale plan
  // as current is the one genuinely dishonest thing this panel could do.
  const stamp = tl.pastedAt ? fmtDate(tl.pastedAt.slice(0, 10)) : '—';

  const partyRow = Object.entries(an.parties)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `<span class="tl-party"><span class="tl-party-n">${n}</span>${esc(p)}</span>`)
    .join('');

  const slipCell = an.slip === null
    ? stat('Vs. project due', an.realDue ? 'On the day' : 'No due date set')
    : stat('Vs. project due',
        (an.slip > 0 ? '+' : '') + an.slip + ' day' + (Math.abs(an.slip) === 1 ? '' : 's'),
        an.slip > 0 ? 'tl-bad' : 'tl-good');

  const rows = an.dated.map(x => {
    const overdue = x.date < an.today;
    const isNext  = x === an.next;
    return `<tr class="${overdue ? 'tl-r-past' : ''}${isNext ? ' tl-r-next' : ''}">
      <td class="tl-c-party">${x.party ? esc(x.party) : '<span class="tl-shared">Shared</span>'}</td>
      <td class="tl-c-deliv">${x.deliverables.map(d => `<span class="tl-chip">${esc(d)}</span>`).join('')}</td>
      <td class="tl-c-task">${esc(x.task)}</td>
      <td class="tl-c-due">${esc(fmtDate(x.date) || x.due)}</td>
    </tr>`;
  }).join('');

  return `<div class="tl-body">
    <div class="tl-head">
      <div>
        <div class="tl-title">${esc(tl.title || 'Timeline')}</div>
        <div class="tl-stamp">Plan as pasted ${esc(stamp)} · not linked to the Timeline Tool</div>
      </div>
      <button class="tl-btn tl-btn-ghost" onclick="A.tlClear('${parent.id}')">Replace</button>
    </div>

    <div class="tl-stats">
      ${stat('Tasks', String(an.dated.length))}
      ${stat('Working days', tl.meta['Working Days'] || '—')}
      ${stat('Plan start', an.dated.length ? fmtDate(an.dated[0].date) : '—')}
      ${stat('Plan end', an.planEnd ? fmtDate(an.planEnd) : '—')}
      ${slipCell}
      ${stat('Next up', an.next ? fmtDate(an.next.date) : 'Complete')}
    </div>

    <div class="tl-split">
      <div class="tl-sub">Who owes what</div>
      <div class="tl-parties">${partyRow}</div>
    </div>

    <div class="tl-split">
      <div class="tl-sub">Deliverables</div>
      <div class="tl-delivs">${an.delivs.map(d => `
        <div class="tl-deliv">
          <span class="tl-chip">${esc(d.name)}</span>
          <span class="tl-deliv-m">${d.count} tasks · ${esc(fmtDate(d.first))} → ${esc(fmtDate(d.last))}</span>
        </div>`).join('')}</div>
    </div>

    <table class="tl-table">
      <thead><tr><th>Party</th><th>Deliverable</th><th>Task</th><th>Due</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
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
    // Fail loudly. A silent no-op here would look like the paste worked.
    ta.classList.add('tl-paste-err');
    ta.placeholder = "Couldn't find any task rows — is this the tab-delimited export?";
    return;
  }
  r.timeline = parsed;
  A.logActivity(r, 'timeline', '', `${parsed.tasks.length} tasks`);
  save(); A.render();
}

function tlClear(pid) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  r.timeline = null;
  save(); A.render();
}

register({ timelinePanelHtml, tlImport, tlClear, parseTimelineExport: parseExport });
