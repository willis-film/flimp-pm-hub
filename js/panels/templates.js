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
  if (!t.overrides   || typeof t.overrides   !== 'object') t.overrides   = {};  // per-project wording tweaks
  if (t.step === undefined) t.step = 1;
  return t;
}

// ── OVERRIDES ────────────────────────────────────────────────────────────────
// Everything in the preview is derived from somewhere — the project row, the
// subtask rows, the per-type copy. Derivation gets it right most of the time,
// but a specific project always has nuances the general rule can't know, so any
// derived value can be edited in place for this document only.
//
// Overrides are stored SEPARATELY from the source rather than written back over
// it. That keeps three things true at once: the source stays canonical (editing
// the kickoff never mutates a subtask's real name), untouched values keep
// tracking their source, and every edit is reversible.
//
// An override that matches what the derivation already produces is deleted
// rather than stored — otherwise a value would silently freeze the moment
// someone clicked into it and clicked out again, and would stop following its
// source without anything on screen saying so.
function ov(st, key, derivedValue) {
  const o = st.overrides[key];
  return o === undefined ? derivedValue : o;
}
function isEdited(st, key) { return st.overrides[key] !== undefined; }

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
// ones explicitly switched off. `label` is what the document says, which is the
// subtask's own name unless it's been overridden for this kickoff; `type` stays
// the real product type, so renaming a bullet never changes which copy block it
// pulls.
function campaignItems(parent, st) {
  return A.getChildren(parent.id)
    .filter(k => !st.campaignOff[k.id])
    .map(k => ({
      id:    k.id,
      row:   k,
      key:   'campaign:' + k.id,
      label: ov(st, 'campaign:' + k.id, k.name),
      type:  (k.productType || '').trim() || UNTYPED,
      meta:  k.productTier || k.productType || ''
    }));
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

// Selection and exclusion still key on the ROW name, not the displayed one —
// otherwise renaming someone in the document would orphan their off-toggle.
function selectedTeam(parent, st) {
  return gatherTeam(parent)
    .filter(p => !st.teamOff[p.name])
    .map(p => ({
      name:     p.name,
      nameKey:  'team:' + p.name,
      roleKey:  'teamrole:' + p.name,
      label:    ov(st, 'team:' + p.name, p.name),
      roleText: ov(st, 'teamrole:' + p.name, p.roles.join(' · '))
    }));
}

// Page-1 values that are genuinely single values. Process and First Steps are
// NOT here — they are assembled from product types, not typed in.
function pageFields(parent, st) {
  return {
    clientName:  ov(st, 'clientName',  parent.clientAccount || parent.name || ''),
    projectName: ov(st, 'projectName', parent.name || '')
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
  const order = [];
  for (const k of campaignItems(parent, st)) {
    if (!order.includes(k.type)) order.push(k.type);
  }
  return order.map(type => {
    const all = (TYPE_CONTENT[type] || {})[which] || [];
    const headKey = `head:${which}:${type}`;
    return {
      type,
      headKey,
      heading: ov(st, headKey, type),
      authored: all.length > 0,
      // Keep the original index so a line's identity — its off toggle AND its
      // override — survives other lines being switched off.
      lines: all.map((text, i) => {
        const key = lineKey(which, type, i);
        return { key, i, text: ov(st, key, text), on: !st.lineOff[key], edited: isEdited(st, key) };
      })
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
      return [g.heading, ...body].join('\n');
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
  if (team.length && !team.some(p => p.roleText.trim())) out.push('No roles resolved for the team block.');
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
                onchange="A.tpToggleLine('${pid}',this.dataset.k)" data-k="${esc(l.key)}">
              <span class="tp-check-box"></span>
              <span class="tp-line-n">${marker}</span>
              <span class="tp-line-t">${esc(l.text)}${l.edited ? ' <span class="tp-edited-dot" title="Edited for this project">•</span>' : ''}</span>
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

// The form column decides what is INCLUDED; the preview column decides how it
// is WORDED. Client and project name used to have inputs here, but they are
// edited directly in the preview now — two places to change the same value is
// how they drift apart.
function fieldBody(pid, parent, st) {
  const d = derived(parent, st);

  return `<div class="tp-note">Wording is edited in the preview on the right — click any value to change it for this document. Switch lines off here to leave them out entirely.</div>
    ${derivedBlock(pid, 'process', 'Process — page 1',
      `Numbered per product type, restarting at 1. Font is hardcoded at ${FIELD.process.font}pt, so overflow is clipped rather than shrunk.`,
      d.process.groups, d.process.lines, d.process.cap)}
    ${derivedBlock(pid, 'firstSteps', 'First Steps — page 2',
      `Bulleted per product type. The field is built single-line, so the generator must enable multiline for any list to show.`,
      d.firstSteps.groups, d.firstSteps.lines, d.firstSteps.cap)}`;
}

// ── VIEW: preview column ─────────────────────────────────────────────────────
// A field-by-field readout of what will be written, NOT a page render — grouped
// by page so it reads against the actual document. It is also the EDITING
// surface: every derived value here can be clicked and rewritten for this
// document, because the wording is worth checking exactly where you see it.
//
// Edits commit on blur rather than per keystroke. That means a full re-render is
// safe (the element being typed into is no longer focused by the time it
// happens), which is why this needs none of distro's in-place patching.
//
// Values are read back with textContent, never innerHTML — whatever gets pasted
// in, only its text survives, so no markup can reach the state or the PDF.
function editable(pid, key, text, cls = '', placeholder = 'empty') {
  const empty = !String(text || '').trim();
  return `<span class="tp-ed ${cls}${empty ? ' tp-ed-empty' : ''}"
    contenteditable="plaintext-only" spellcheck="false" data-k="${esc(key)}"
    data-ph="${esc(placeholder)}"
    onblur="A.tpEdit('${pid}',this.dataset.k,this.textContent)"
    onkeydown="A.tpEditKey(event,this)">${esc(text || '')}</span>`;
}

// A revert control, shown only where an override actually exists. Without this
// an edit would be a one-way door — you could never get back to what the source
// says without knowing what it used to say.
function revert(pid, st, key) {
  return isEdited(st, key)
    ? ` <button class="tp-revert" title="Revert to the value from the project record"
        onclick="A.tpRevert('${pid}',this.dataset.k)" data-k="${esc(key)}">↺</button>`
    : '';
}

function fieldRow(name, value, extra = '') {
  return `<div class="tp-pv-row">
    <div class="tp-pv-k">${esc(name)}</div>
    <div class="tp-pv-v">${value || '<span class="tp-pv-blank">empty</span>'}${extra}</div>
  </div>`;
}

// An assembled section as it will sit in the field — heading, then its numbered
// or bulleted lines. Headings are editable too: they are printed into the PDF
// verbatim, so "Companion Piece" may well want to read differently to a client.
function previewGroups(pid, st, groups, which) {
  const live = groups.filter(g => g.lines.some(l => l.on));
  if (!live.length) return '';
  return live.map(g => {
    const kept = g.lines.filter(l => l.on);
    const items = kept.map(l =>
      `<li>${editable(pid, l.key, l.text)}${revert(pid, st, l.key)}</li>`).join('');
    const list = which === 'process'
      ? `<ol class="tp-pv-ol">${items}</ol>`
      : `<ul class="tp-pv-bullets">${items}</ul>`;
    return `<div class="tp-pv-grp">
      <div class="tp-pv-grp-h">${editable(pid, g.headKey, g.heading)}${revert(pid, st, g.headKey)}</div>
      ${list}
    </div>`;
  }).join('');
}

function previewBody(parent, st) {
  const pf = pageFields(parent, st);
  const items = campaignItems(parent, st);
  const team = selectedTeam(parent, st);
  const tl = timelineSummary(parent);
  const d = derived(parent, st);

  const campaign = items.length
    ? `<ul class="tp-pv-bullets">${items.map(k =>
        `<li>${editable(parent.id, k.key, k.label)}${revert(parent.id, st, k.key)}</li>`).join('')}</ul>`
    : '';

  // Show the missing person-level fields explicitly rather than omitting them —
  // the gap is the point, and hiding it would make the block look finished.
  const teamBlock = team.length
    ? team.map(p => `<div class="tp-pv-person">
        <div class="tp-pv-person-n">${editable(parent.id, p.nameKey, p.label)}${revert(parent.id, st, p.nameKey)}</div>
        <div class="tp-pv-person-r">${editable(parent.id, p.roleKey, p.roleText, '', 'no role')}${revert(parent.id, st, p.roleKey)}</div>
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
    ${fieldRow('Client Name', editable(parent.id, 'clientName', pf.clientName) + revert(parent.id, st, 'clientName'))}
    ${fieldRow('Project Name', editable(parent.id, 'projectName', pf.projectName) + revert(parent.id, st, 'projectName'))}
    ${fieldRow('Campaign', campaign)}
    ${fieldRow('Flimp Team', teamBlock)}
    ${fieldRow('Process', previewGroups(parent.id, st, d.process.groups, 'process'))}
    <div class="tp-pv-page">Page 2 — First Steps + Timeline</div>
    ${fieldRow('First Steps', previewGroups(parent.id, st, d.firstSteps.groups, 'firstSteps'))}
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
    : `${items.length} of ${total} · ${items.map(k => k.label).join(', ')}`;
}

function teamSummary(parent, st) {
  const team = selectedTeam(parent, st);
  return team.length ? `${team.length} · ${team.map(p => p.label).join(', ')}` : 'Nobody selected';
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
  st.overrides = {};
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

function tpToggleLine(pid, key) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  if (st.lineOff[key]) delete st.lineOff[key]; else st.lineOff[key] = true;
  save(); A.render();
}

// ── EDITING ──────────────────────────────────────────────────────────────────

// Recomputes what a key WOULD say with no override in place, so an edit can be
// compared against it. Storing an override identical to the derived value would
// silently detach that value from its source — it would stop following a renamed
// subtask or revised copy, with nothing on screen to say why.
function derivedValue(parent, st, key) {
  const bare = { ...st, overrides: {} };
  if (key === 'clientName' || key === 'projectName') return pageFields(parent, bare)[key];
  if (key.startsWith('campaign:')) {
    const item = campaignItems(parent, bare).find(k => k.key === key);
    return item ? item.label : undefined;
  }
  if (key.startsWith('team:') || key.startsWith('teamrole:')) {
    const p = selectedTeam(parent, bare).find(x => x.nameKey === key || x.roleKey === key);
    if (!p) return undefined;
    return key.startsWith('teamrole:') ? p.roleText : p.label;
  }
  if (key.startsWith('head:')) {
    const [, which, type] = key.split(':');
    const g = contentGroups(parent, bare, which).find(x => x.type === type);
    return g ? g.heading : undefined;
  }
  const [which, type] = key.split(':');
  const g = contentGroups(parent, bare, which).find(x => x.type === type);
  const line = g && g.lines.find(l => l.key === key);
  return line ? line.text : undefined;
}

// Commits an in-place edit from the preview. Fires on blur, not per keystroke,
// so a full re-render here is safe — the edited element is already unfocused.
function tpEdit(pid, key, raw) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  // contenteditable yields non-breaking spaces and stray newlines; normalise so
  // an edit that only differs by whitespace reads as unchanged.
  const val = String(raw || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const base = derivedValue(r, st, key);
  if (base !== undefined && val === String(base).trim()) delete st.overrides[key];
  else st.overrides[key] = val;
  save(); A.render();
}

// Enter commits rather than inserting a line break — every editable here is a
// single line in the PDF, and a break would be invisible in the preview but real
// in the output. Escape abandons the edit.
function tpEditKey(ev, el) {
  if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
  if (ev.key === 'Escape') { ev.preventDefault(); A.render(); }
}

function tpRevert(pid, key) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  delete tplState(r).overrides[key];
  save(); A.render();
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
  tpSetKind, tpGoStep, tpToggleCampaign, tpToggleTeam, tpToggleLine,
  tpEdit, tpEditKey, tpRevert, tpGenerate
});
