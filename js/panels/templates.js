// templates.js — Templates panel.
//
// Generates pre-filled documents from the project record. Two kinds, and they
// are genuinely different outputs rather than variants of one body:
//
//   • email    — a client-facing email draft            (not built yet)
//   • kickoff  — the kickoff PDF                        (this module's focus)
//
// Structurally this follows the Distro panel: a stepped form on the left, a live
// preview on the right, with panel state parked on the parent row so a half-built
// draft survives a panel switch.
//
// ── WHAT THE KICKOFF PDF ACTUALLY IS ─────────────────────────────────────────
// A hybrid. Page 1 is filled through real AcroForm fields; the page-2 timeline
// table is DRAWN programmatically (variable row count, must paginate), using a
// field's rectangle only as a coordinate boundary. This panel owns neither
// mechanism — it collects and confirms the inputs, then hands them to
// /api/kickoff-pdf.js. Keeping the panel purely about inputs is what lets the
// generator change (Python prototype → pdf-lib in Node) without touching it.
//
// The preview column therefore shows FIELD CONTENT, not a rendered page. It is
// a "here is exactly what will land in each field" readout — which is the part
// that's actually worth checking before generating, and is honest about being a
// readout rather than faking a page render.
//
// STATUS: the form is complete for page 1 + First Steps. Generation is stubbed —
// /api/kickoff-pdf.js does not exist yet, and the button says so rather than
// firing a request at a 404.

import { esc } from '../utils.js';
import { db, save } from '../store.js';
import { A, register } from '../bus.js';

// ── KINDS ────────────────────────────────────────────────────────────────────
const KINDS = [
  { id: 'email',   label: 'Email',   sub: 'A client-facing email draft, pre-filled from the project record.' },
  { id: 'kickoff', label: 'Kickoff', sub: 'The kickoff PDF — client, deliverables, team, and the production timeline.' }
];
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.id, k.label]));

// ── TEMPLATE FACTS ───────────────────────────────────────────────────────────
// Read off the real AcroForm in `Flimp Kickoff Template Formed.pdf`, not guessed.
// These drive the warnings below, so if the template is ever re-formed with
// different rects or default appearances, correct them HERE and the whole panel
// follows.
//
//   Process     rect [35.3, 61.8, 369.3, 308.9]  DA /RundDisplay-Medium 15 Tf
//   Flimp Team  rect [425.5, 266.0, 575.5, 525.6] DA /RundDisplay-Medium 12 Tf
//   First Steps rect [212.1, 582.8, 567.6, 682.7] DA /Helv 12 Tf, NOT multiline
//
// `Process` is the sharp edge: 15pt is HARDCODED, not auto-sizing (`0 Tf` would
// mean auto), so the field cannot shrink text to fit. At ~21pt line spacing in a
// 247pt-tall rect, roughly 11 lines fit before the field's own clipping
// rectangle silently cuts off the rest. Hence the warning rather than a surprise
// on the generated PDF.
// Line capacity is derived from the real rect height and font size rather than
// hardcoded, so correcting a measurement corrects every warning at once.
// Leading of 1.4× is the usual PDF text-field default.
const LEADING = 1.4;
const FIELD = {
  // rect [35.3, 61.8, 369.3, 308.9] → 334.0 × 247.1pt, DA fixed at 15pt
  process:    { w: 334.0, h: 247.1, font: 15 },
  // rect [212.1, 582.8, 567.6, 682.7] → 355.5 × 99.9pt, DA /Helv 12
  // NOTE: built with Ff=0 — NOT multiline. A bulleted list needs the generator
  // to flip that flag at fill time (pdf-lib: field.enableMultiline()), or only
  // the first line will ever render.
  firstSteps: { w: 355.5, h: 99.9, font: 12 }
};
const capacity = f => Math.floor(f.h / (f.font * LEADING));
// Character budget per line, approximating average glyph width at 0.5em. Rough
// on purpose — enough to warn on, and the generator does the authoritative
// measurement with real font metrics.
const charsPerLine = f => Math.max(1, Math.floor(f.w / (f.font * 0.5)));

const LIMITS = {
  // The team box is ~150pt wide. Three people at four lines each was tested and
  // fits, with the font auto-shrinking to stay inside. Beyond that it keeps
  // shrinking rather than overflowing, so this is a legibility warning, not a
  // clipping one.
  teamComfortable: 3
};

// Every field on the project or its items that names a human. Order here is the
// order they appear in the Flimp Team block. `scope` says which row to read:
// 'project' reads the parent, 'item' reads every subtask.
const TEAM_ROLES = [
  { field: 'projectOwner', label: 'Flimp Project Owner', scope: 'project' },
  { field: 'am',           label: 'Account Manager',     scope: 'project' },
  { field: 'itemOwner',    label: 'Item Owner',          scope: 'item'    },
  { field: 'designer',     label: 'Designer',            scope: 'item'    },
  { field: 'animator',     label: 'Animator',            scope: 'item'    },
  { field: 'voArtist',     label: 'Voice Over',          scope: 'item'    },
  { field: 'otherVendor1', label: 'Other Vendor',        scope: 'item'    },
  { field: 'otherVendor2', label: 'Writer / Other Vendor', scope: 'item'  }
];

// ── PER-TYPE CONTENT ─────────────────────────────────────────────────────────
// What the Process and First Steps sections SAY, keyed by product type. This is
// the one place to edit them — the panel and the generator both read from here,
// so there is no second copy to keep in sync.
//
// Keyed on product type (not tier) deliberately: 13 types against many dozens of
// tiers, and a newly added tier inherits its type's content rather than needing
// its own entry.
//
// Assembly rule: a project's SELECTED deliverables are grouped by type, and each
// type present emits its own headed list — Process numbered and restarting at 1
// per type, First Steps bulleted. A type with no entry here contributes nothing
// and is reported in the panel as unauthored, so a silent gap is impossible.
//
// EMPTY BY DESIGN, FOR NOW. The real copy hasn't been written yet; leaving these
// blank makes every unauthored type visible in the panel rather than shipping
// invented steps that read as if they were approved.
const TYPE_CONTENT = {
  'Presentation Video': { process: [], firstSteps: [] },
  'Video':              { process: [], firstSteps: [] },
  'Library Videos':     { process: [], firstSteps: [] },
  'Microsite':          { process: [], firstSteps: [] },
  'Benefit Guide':      { process: [], firstSteps: [] },
  'Companion Piece':    { process: [], firstSteps: [] },
  'Print & Mail':       { process: [], firstSteps: [] },
  'Flimp Decisions':    { process: [], firstSteps: [] },
  'Flimp Connect':      { process: [], firstSteps: [] },
  'Web Development':    { process: [], firstSteps: [] },
  'AI Chatbot Agent':   { process: [], firstSteps: [] },
  'Flimp Canvas':       { process: [], firstSteps: [] },
  'Other':              { process: [], firstSteps: [] }
};

// Deliverables with no product type set still need somewhere to go, rather than
// vanishing from a document that is supposed to list the whole project.
const UNTYPED = 'Untyped';

// ── PANEL STATE ──────────────────────────────────────────────────────────────
// Held on the parent row under `templates`.
//
// Each key is filled in individually rather than only handling a wholly-missing
// object — rows from Supabase carry `templates: {}` once the key exists, and an
// empty object is truthy, so a `if (!parent.templates)` guard would skip
// initialisation and leave the sub-keys undefined. (Distro learned this the hard
// way; see the same note in distro.js.)
//
// NOTE the two "off" maps. Distro tracks what's INCLUDED, which is right for a
// distribution email where you opt methods in. A kickoff document is the
// opposite: it should list everything by default, and assigning a new designer
// or adding a deliverable should make them appear WITHOUT anyone remembering to
// tick a box. Tracking EXCLUSIONS gets that for free; tracking inclusions would
// silently drop late additions off the document.
function tplState(parent) {
  if (!parent.templates || typeof parent.templates !== 'object') parent.templates = {};
  const t = parent.templates;
  if (t.kind === undefined) t.kind = '';                                        // '' | 'email' | 'kickoff'
  if (!t.campaignOff || typeof t.campaignOff !== 'object') t.campaignOff = {};  // deliverables left OFF the Campaign list
  if (!t.teamOff     || typeof t.teamOff     !== 'object') t.teamOff     = {};  // people left OFF the Flimp Team block
  if (!t.fields      || typeof t.fields      !== 'object') t.fields      = {};  // confirmed/edited page-1 values
  if (!t.lineOff     || typeof t.lineOff     !== 'object') t.lineOff     = {};  // Process/First Steps lines switched off
  if (t.step === undefined) t.step = 1;
  return t;
}

// Resolved per kind, not fixed — email and kickoff do not share steps. Email has
// none beyond the picker yet.
function stepList(st) {
  return st.kind === 'kickoff'
    ? ['kind', 'campaign', 'team', 'fields']
    : ['kind'];
}
function stepIndex(st, name) { return stepList(st).indexOf(name) + 1; }

// ── SOURCE DATA ──────────────────────────────────────────────────────────────

// Deliverables that will become Campaign bullets — every subtask except the
// ones explicitly switched off.
function campaignItems(parent, st) {
  return A.getChildren(parent.id).filter(k => !st.campaignOff[k.id]);
}

// Everyone named anywhere on the project or its items, deduped by name, each
// carrying every role they hold. One person is often two roles (designer on one
// item, animator on another); the document should name them once.
//
// Title, email and phone are NOT here because they do not exist in the schema —
// they are person-level facts and the rows only store names. They come from the
// `people` reference table once it gains `email` / `phone` columns.
function gatherTeam(parent) {
  const kids = A.getChildren(parent.id);
  const byName = new Map();
  for (const role of TEAM_ROLES) {
    const rows = role.scope === 'project' ? [parent] : kids;
    for (const row of rows) {
      const name = (row[role.field] || '').trim();
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, { name, roles: [] });
      const rec = byName.get(name);
      if (!rec.roles.includes(role.label)) rec.roles.push(role.label);
    }
  }
  return [...byName.values()];
}

function selectedTeam(parent, st) {
  return gatherTeam(parent).filter(p => !st.teamOff[p.name]);
}

// Page-1 values that are genuinely single values. Process and First Steps are
// NOT here — they are assembled from product types, not typed in.
function pageFields(parent, st) {
  const f = st.fields;
  return {
    clientName:  f.clientName  ?? (parent.clientAccount || parent.name || ''),
    projectName: f.projectName ?? (parent.name || '')
  };
}

// ── PROCESS / FIRST STEPS ASSEMBLY ───────────────────────────────────────────
// Both sections are derived: group the selected deliverables by product type, in
// order of first appearance, and emit one headed list per type present.
//
// Ordering follows the deliverables rather than TYPE_CONTENT's key order, so the
// document reads in the same sequence as the Campaign list above it.
//
// `which` is 'process' (numbered, restarting per type) or 'firstSteps'
// (bulleted). Individual lines can be switched off per project — a standard step
// that doesn't apply this time shouldn't require a code change.
function lineKey(which, type, i) { return `${which}:${type}:${i}`; }

function contentGroups(parent, st, which) {
  const items = campaignItems(parent, st);
  const order = [];
  for (const k of items) {
    const t = (k.productType || '').trim() || UNTYPED;
    if (!order.includes(t)) order.push(t);
  }
  return order.map(type => {
    const all = (TYPE_CONTENT[type] || {})[which] || [];
    return {
      type,
      authored: all.length > 0,
      // Keep the original index so a line's identity (and therefore its off
      // toggle) survives other lines being switched off.
      lines: all.map((text, i) => ({ text, i, on: !st.lineOff[lineKey(which, type, i)] }))
    };
  });
}

// The literal text that goes into the field. Blank line between type blocks —
// this is what the generator writes, so what the panel counts is what the PDF
// gets.
function renderContent(groups, which) {
  return groups
    .filter(g => g.lines.some(l => l.on))
    .map(g => {
      const kept = g.lines.filter(l => l.on);
      const body = which === 'process'
        ? kept.map((l, n) => `${n + 1}. ${l.text}`)   // restarts at 1 per type
        : kept.map(l => `• ${l.text}`);
      return [g.type, ...body].join('\n');
    })
    .join('\n\n');
}

// Wrapped line count for a rendered block, including the blank separators.
function countLines(text, f) {
  const per = charsPerLine(f);
  return (text || '').split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / per)), 0);
}

// Everything the two derived sections need, in one call — the panel, the
// warnings and the preview all read the same numbers.
function derived(parent, st) {
  const pg = contentGroups(parent, st, 'process');
  const fg = contentGroups(parent, st, 'firstSteps');
  const pText = renderContent(pg, 'process');
  const fText = renderContent(fg, 'firstSteps');
  return {
    process:    { groups: pg, text: pText, lines: countLines(pText, FIELD.process),    cap: capacity(FIELD.process) },
    firstSteps: { groups: fg, text: fText, lines: countLines(fText, FIELD.firstSteps), cap: capacity(FIELD.firstSteps) }
  };
}

// ── TIMELINE READINESS ───────────────────────────────────────────────────────
// The page-2 table is drawn from `parent.timeline`, which the Timeline panel
// stores as a FLAT task list — there is no week grouping in it. The real
// reshaper (flat tasks → { week, range, tasks[] }) belongs with the generator;
// this is only enough grouping to report what's there before generating.
//
// Deliberately does NOT estimate a page count: that needs the continuation
// page's content rect, which is not known until the page-3 design lands.
function isoWeekKey(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d)) return null;
  // Shift to the Thursday of this week — ISO weeks are numbered by the week
  // containing Thursday, which is what makes the count stable across year ends.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function timelineSummary(parent) {
  const tl = parent.timeline;
  if (!tl || !Array.isArray(tl.tasks) || !tl.tasks.length) {
    return { ok: false, note: 'No plan pasted — the Timeline panel is empty, so page 2 would generate with an empty table.' };
  }
  const weeks = new Set();
  let undated = 0;
  for (const t of tl.tasks) {
    const k = t.date ? isoWeekKey(t.date) : null;
    if (k) weeks.add(k); else undated++;
  }
  return {
    ok: true,
    tasks: tl.tasks.length,
    weeks: weeks.size,
    undated,
    meta: tl.meta || {}
  };
}

// ── CONTENT LIMIT CHECKS ─────────────────────────────────────────────────────

function warnings(parent, st) {
  const out = [];
  const d = derived(parent, st);

  if (d.process.lines > d.process.cap) {
    out.push(`Process is about ${d.process.lines} lines and the field holds ~${d.process.cap}. Its font size is hardcoded at ${FIELD.process.font}pt, so the overflow is clipped by the field — not shrunk to fit.`);
  }
  if (d.firstSteps.lines > d.firstSteps.cap) {
    out.push(`First Steps is about ${d.firstSteps.lines} lines and the field holds ~${d.firstSteps.cap} at ${FIELD.firstSteps.font}pt.`);
  }
  // Structural, not a content-length problem — worth stating separately because
  // the fix is in the generator rather than in what's written here.
  if (d.firstSteps.text.includes('\n')) {
    out.push('First Steps is built single-line (Ff=0). Any list needs the generator to enable multiline on the field, or only the first bullet will render.');
  }
  const unauthored = [...new Set(
    [...d.process.groups, ...d.firstSteps.groups].filter(g => !g.authored).map(g => g.type)
  )];
  if (unauthored.length) {
    out.push(`No Process or First Steps content written yet for: ${unauthored.join(', ')}. Those deliverables contribute nothing to either section.`);
  }

  const team = selectedTeam(parent, st);
  if (team.length > LIMITS.teamComfortable) {
    out.push(`${team.length} people in the Flimp Team block. It is only ~150pt wide, so the text auto-shrinks — tested comfortable at ${LIMITS.teamComfortable}.`);
  }
  if (team.length && !team.some(p => p.roles.length)) out.push('No roles resolved for the team block.');
  if (!campaignItems(parent, st).length) {
    out.push('No deliverables selected, so the Campaign block will be empty.');
  }
  return out;
}

// ── VIEW: wizard shell ───────────────────────────────────────────────────────

function summaryBar(pid, n, label, value) {
  return `<button class="tp-sum" onclick="A.tpGoStep('${pid}',${n})">
    <span class="tp-sum-check">✓</span>
    <span class="tp-sum-label">${esc(label)}</span>
    <span class="tp-sum-value">${esc(value)}</span>
    <span class="tp-sum-edit">Edit</span>
  </button>`;
}

function stepFrame(pid, st, name, label, bodyFn, summaryFn) {
  const n = stepIndex(st, name);
  if (n < st.step) return summaryBar(pid, n, label, summaryFn());
  if (n > st.step) return `<div class="tp-locked"><span class="tp-num tp-num-off">${n}</span>${esc(label)}</div>`;
  return `<div class="tp-step">
    <div class="tp-step-h"><span class="tp-num">${n}</span>${esc(label)}</div>
    ${bodyFn()}
    ${advance(pid, st, name)}
  </div>`;
}

// Steps with no natural "done" signal get an explicit Continue. The picker
// auto-advances on pick, and the last step has nowhere to go.
function advance(pid, st, name) {
  const list = stepList(st);
  const n = stepIndex(st, name);
  if (name === 'kind' || n === list.length) return '';
  return `<div class="tp-advance">
    <button class="tp-next" onclick="A.tpGoStep('${pid}',${n + 1})">Continue</button>
  </div>`;
}

// Step 1 — the kind toggle. Clicking the selected card does NOT deselect it:
// there is no meaningful "neither" state, and clearing it would discard whatever
// the later steps have collected.
function kindBody(pid, st) {
  return `<div class="tp-kinds">${KINDS.map(k => `
    <button class="tp-kind${st.kind === k.id ? ' on' : ''}"
      onclick="A.tpSetKind('${pid}','${k.id}')">
      <div class="tp-kind-h">${esc(k.label)}</div>
      <div class="tp-kind-s">${esc(k.sub)}</div>
    </button>`).join('')}</div>`;
}

// Step 2 — which deliverables become Campaign bullets.
function campaignBody(pid, parent, st) {
  const kids = A.getChildren(parent.id);
  if (!kids.length) return `<div class="tp-empty">This project has no subtasks, so there is nothing to list under Campaign.</div>`;
  return `<div class="tp-checks">${kids.map(k => {
    const on = !st.campaignOff[k.id];
    return `<label class="tp-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.tpToggleCampaign('${pid}','${k.id}')">
      <span class="tp-check-box"></span>
      <span class="tp-check-nm">${esc(k.name)}</span>
      <span class="tp-check-m">${esc(k.productTier || k.productType || '')}</span>
    </label>`;
  }).join('')}</div>`;
}

// Step 3 — who appears in the Flimp Team block.
function teamBody(pid, parent, st) {
  const people = gatherTeam(parent);
  if (!people.length) {
    return `<div class="tp-empty">Nobody is assigned on this project yet — set an owner, account manager or vendor in the Info panel and they will appear here.</div>`;
  }
  const rows = people.map(p => {
    const on = !st.teamOff[p.name];
    return `<label class="tp-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.tpToggleTeam('${pid}',this.dataset.nm)" data-nm="${esc(p.name)}">
      <span class="tp-check-box"></span>
      <span class="tp-check-nm">${esc(p.name)}</span>
      <span class="tp-check-m">${esc(p.roles.join(' · '))}</span>
    </label>`;
  }).join('');
  return `<div class="tp-checks">${rows}</div>
    <div class="tp-note">Title, email and phone are not stored anywhere yet — the rows only hold names. They will fill in once the <code>people</code> reference table gains <code>email</code> and <code>phone</code> columns.</div>`;
}

// Step 4 — the two typed-in values, then the two derived sections.
//
// Process and First Steps are NOT text inputs: their content is decided by the
// product types in the project. What the form offers instead is line-level
// review — switch off a standard step that doesn't apply this time — plus a live
// count against the field's real capacity.
function derivedBlock(pid, which, label, note, group, lines, cap) {
  const over = lines > cap;
  const body = group.length
    ? group.map(g => {
        if (!g.authored) {
          return `<div class="tp-grp">
            <div class="tp-grp-h">${esc(g.type)}</div>
            <div class="tp-grp-none">No content written for this product type yet.</div>
          </div>`;
        }
        let n = 0;
        return `<div class="tp-grp">
          <div class="tp-grp-h">${esc(g.type)}</div>
          ${g.lines.map(l => {
            if (l.on) n++;
            const marker = which === 'process' ? `${l.on ? n : '–'}.` : '•';
            return `<label class="tp-line${l.on ? ' on' : ''}">
              <input type="checkbox" ${l.on ? 'checked' : ''}
                onchange="A.tpToggleLine('${pid}','${which}','${esc(g.type)}',${l.i})">
              <span class="tp-check-box"></span>
              <span class="tp-line-n">${marker}</span>
              <span class="tp-line-t">${esc(l.text)}</span>
            </label>`;
          }).join('')}
        </div>`;
      }).join('')
    : `<div class="tp-empty">No deliverables selected, so there is nothing to assemble.</div>`;

  return `<div class="tp-derived">
    <div class="tp-derived-h">${esc(label)}
      <span class="tp-derived-c${over ? ' tp-over' : ''}">~${lines} of ~${cap} lines</span>
    </div>
    <div class="tp-derived-note">${note}</div>
    ${body}
  </div>`;
}

function fieldBody(pid, parent, st) {
  const pf = pageFields(parent, st);
  const d = derived(parent, st);
  const inp = (key, label, val, ph = '') =>
    `<label class="tp-f"><span class="tp-f-l">${esc(label)}</span>
      <input class="tp-in" value="${esc(val)}" placeholder="${esc(ph)}"
        oninput="A.tpField('${pid}','${key}',this.value)"></label>`;

  return `<div class="tp-fgrid">
      ${inp('clientName', 'Client name', pf.clientName)}
      ${inp('projectName', 'Project name', pf.projectName)}
    </div>
    ${derivedBlock(pid, 'process', 'Process — page 1',
      `Numbered per product type, restarting at 1. Font is hardcoded at ${FIELD.process.font}pt, so overflow is clipped rather than shrunk.`,
      d.process.groups, d.process.lines, d.process.cap)}
    ${derivedBlock(pid, 'firstSteps', 'First Steps — page 2',
      `Bulleted per product type. The field is built single-line, so the generator must enable multiline for any list to show.`,
      d.firstSteps.groups, d.firstSteps.lines, d.firstSteps.cap)}`;
}

// ── VIEW: preview column ─────────────────────────────────────────────────────
// A field-by-field readout of what will be written, NOT a page render. Grouped
// by page so it reads against the actual document.

function fieldRow(name, value, extra = '') {
  return `<div class="tp-pv-row">
    <div class="tp-pv-k">${esc(name)}</div>
    <div class="tp-pv-v">${value || '<span class="tp-pv-blank">empty</span>'}${extra}</div>
  </div>`;
}

// Renders an assembled section the way it will sit in the field — type heading,
// then its numbered or bulleted lines.
function previewGroups(groups, which) {
  const live = groups.filter(g => g.lines.some(l => l.on));
  if (!live.length) return '';
  return live.map(g => {
    const kept = g.lines.filter(l => l.on);
    const list = which === 'process'
      ? `<ol class="tp-pv-ol">${kept.map(l => `<li>${esc(l.text)}</li>`).join('')}</ol>`
      : `<ul class="tp-pv-bullets">${kept.map(l => `<li>${esc(l.text)}</li>`).join('')}</ul>`;
    return `<div class="tp-pv-grp"><div class="tp-pv-grp-h">${esc(g.type)}</div>${list}</div>`;
  }).join('');
}

function previewBody(parent, st) {
  const pf = pageFields(parent, st);
  const items = campaignItems(parent, st);
  const team = selectedTeam(parent, st);
  const tl = timelineSummary(parent);
  const d = derived(parent, st);

  const campaign = items.length
    ? `<ul class="tp-pv-bullets">${items.map(k => `<li>${esc(k.name)}</li>`).join('')}</ul>`
    : '';

  // Show the missing person-level fields explicitly rather than omitting them —
  // the gap is the point, and hiding it would make the block look finished.
  const teamBlock = team.length
    ? team.map(p => `<div class="tp-pv-person">
        <div class="tp-pv-person-n">${esc(p.name)}</div>
        <div class="tp-pv-person-r">${esc(p.roles.join(' · '))}</div>
        <div class="tp-pv-person-x">Title · Email · Phone — not in schema yet</div>
      </div>`).join('')
    : '';

  const warn = warnings(parent, st);
  const warnBlock = warn.length
    ? `<div class="tp-pv-warn"><div class="tp-pv-warn-h">Before you generate</div>
        <ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';

  const tlBlock = tl.ok
    ? `<div class="tp-pv-v">${tl.tasks} task${tl.tasks === 1 ? '' : 's'} across ${tl.weeks} week${tl.weeks === 1 ? '' : 's'}${tl.undated ? ` · ${tl.undated} with no resolved date` : ''}
        <div class="tp-pv-sub">Drawn, not field-filled. Page count is decided at generation.</div></div>`
    : `<div class="tp-pv-v"><span class="tp-pv-blank">${esc(tl.note)}</span></div>`;

  return `<div class="tp-pv-page">Page 1 — Kickoff Info</div>
    ${fieldRow('Client Name', esc(pf.clientName))}
    ${fieldRow('Project Name', esc(pf.projectName))}
    ${fieldRow('Campaign', campaign)}
    ${fieldRow('Flimp Team', teamBlock)}
    ${fieldRow('Process', previewGroups(d.process.groups, 'process'))}
    <div class="tp-pv-page">Page 2 — First Steps + Timeline</div>
    ${fieldRow('First Steps', previewGroups(d.firstSteps.groups, 'firstSteps'))}
    <div class="tp-pv-row"><div class="tp-pv-k">Timeline</div>${tlBlock}</div>
    ${warnBlock}`;
}

function templatesPanelHtml(parent) {
  const st = tplState(parent);
  const pid = parent.id;

  if (st.kind !== 'kickoff') {
    // Email is still just the picker.
    const steps = stepFrame(pid, st, 'kind', 'Template', () => kindBody(pid, st), () => KIND_LABEL[st.kind] || '');
    const pending = st.kind === 'email'
      ? `<div class="tp-pending">
           <div class="tp-pending-h">Email fields</div>
           <div class="tp-pending-b">The remaining steps for this template are not built yet.</div>
         </div>`
      : '';
    const empty = st.kind
      ? `<div class="tp-pv-empty">
           <div class="tp-pv-empty-h">Email preview</div>
           <div class="tp-pv-empty-b">Nothing to preview yet — this template has no content steps.</div>
         </div>`
      : `<div class="tp-pv-empty">
           <div class="tp-pv-empty-h">Your document will appear here</div>
           <div class="tp-pv-empty-b">Pick a template to start.</div>
         </div>`;
    return `<div class="tp-split">
      <div class="tp-form">${steps}${pending}</div>
      <div class="tp-preview-col">${empty}</div>
    </div>`;
  }

  const steps = [
    stepFrame(pid, st, 'kind', 'Template',
      () => kindBody(pid, st), () => KIND_LABEL[st.kind] || ''),
    stepFrame(pid, st, 'campaign', 'Deliverables',
      () => campaignBody(pid, parent, st), () => campaignSummary(parent, st)),
    stepFrame(pid, st, 'team', 'Flimp Team',
      () => teamBody(pid, parent, st), () => teamSummary(parent, st)),
    stepFrame(pid, st, 'fields', 'Fill & confirm',
      () => fieldBody(pid, parent, st), () => 'Filled')
  ].join('');

  return `<div class="tp-split">
    <div class="tp-form">${steps}</div>
    <div class="tp-preview-col">
      <div class="tp-pv-bar">
        <button class="tp-gen" onclick="A.tpGenerate('${pid}')">Generate PDF</button>
        <span class="tp-gen-note" id="tp-gen-note-${pid}">Field readout — not a page render.</span>
      </div>
      <div class="tp-pv-scroll"><div class="tp-pv" id="tp-pv-${pid}">${previewBody(parent, st)}</div></div>
    </div>
  </div>`;
}

function campaignSummary(parent, st) {
  const items = campaignItems(parent, st);
  const total = A.getChildren(parent.id).length;
  if (!total) return 'No subtasks';
  return items.length === total
    ? `All ${total} deliverable${total === 1 ? '' : 's'}`
    : `${items.length} of ${total} · ${items.map(k => k.name).join(', ')}`;
}

function teamSummary(parent, st) {
  const team = selectedTeam(parent, st);
  return team.length ? `${team.length} · ${team.map(p => p.name).join(', ')}` : 'Nobody selected';
}

// ── MUTATORS ─────────────────────────────────────────────────────────────────

function tpSetKind(pid, kind) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  if (st.kind === kind) return;
  st.kind = kind;
  // Answers are collected per kind and don't carry across; switching starts
  // clean rather than leaving an email's answers on a kickoff.
  st.fields = {};
  st.campaignOff = {};
  st.teamOff = {};
  st.lineOff = {};
  st.step = kind === 'kickoff' ? 2 : 1;   // kickoff has steps to advance into
  save(); A.render();
}

function tpGoStep(pid, n) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  tplState(r).step = n;
  save(); A.render();
}

function tpToggleCampaign(pid, kidId) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  if (st.campaignOff[kidId]) delete st.campaignOff[kidId]; else st.campaignOff[kidId] = true;
  save(); A.render();
}

function tpToggleTeam(pid, name) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  if (st.teamOff[name]) delete st.teamOff[name]; else st.teamOff[name] = true;
  save(); A.render();
}

function tpToggleLine(pid, which, type, i) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  const k = lineKey(which, type, i);
  if (st.lineOff[k]) delete st.lineOff[k]; else st.lineOff[k] = true;
  save(); A.render();
}

// Live field edits patch the PREVIEW ONLY — never a full re-render. Re-rendering
// on every keystroke destroys and recreates the input being typed into, and the
// caret jumps to a fresh element. Same reason as distro's dsField.
function tpField(pid, key, val) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  st.fields[key] = val;
  save();
  const box = document.getElementById('tp-pv-' + pid);
  if (box) box.innerHTML = previewBody(r, st);
}

// Generation is not built. Rather than POST at an endpoint that doesn't exist
// and surface a raw 404, say so plainly and leave the collected state intact.
function tpGenerate(pid) {
  const note = document.getElementById('tp-gen-note-' + pid);
  if (note) {
    note.textContent = 'Not built yet — /api/kickoff-pdf.js does not exist. Inputs above are ready for it.';
    note.classList.add('tp-gen-note-warn');
  }
  A.toast && A.toast('PDF generation is not built yet');
}

register({
  templatesPanelHtml,
  tpSetKind, tpGoStep, tpToggleCampaign, tpToggleTeam, tpToggleLine, tpField, tpGenerate
});
