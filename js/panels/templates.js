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
// Every region is DRAWN onto the template's artwork — nothing is filled as an
// AcroForm field. The formed PDFs supply two things: the background art, and the
// rectangles that say where each region sits. See the LAYOUT BOXES block below
// for why field-fill was dropped.
//
// This panel owns none of the drawing. It resolves every value the document
// needs into finished strings and hands them to /api/kickoff-pdf.js. Keeping the
// panel purely about inputs is what lets the generator be tested from a JSON
// fixture, with no database and no knowledge of the row schema.
//
// The preview column is therefore a REGION-BY-REGION readout, not a rendered
// page — which is the part actually worth checking before generating, and is
// honest about being a readout rather than faking a page render. It is also the
// editing surface: see the OVERRIDES block.
//
// STATUS: input collection is complete for page 1 + First Steps. Generation is
// stubbed — /api/kickoff-pdf.js does not exist yet, and the button says so
// rather than firing a request at a 404.

import { esc } from '../utils.js';
import { db, save } from '../store.js';
import { A, register } from '../bus.js';
import { PEOPLE_DIRECTORY, KICKOFF_ALWAYS, KICKOFF_TEAM_ROLES, KICKOFF_ROLE_LABEL,
         KICKOFF_CONTENT } from '../data/constants.js';

// ── KINDS ────────────────────────────────────────────────────────────────────
const KINDS = [
  { id: 'email',   label: 'Email',   sub: 'A client-facing email draft, pre-filled from the project record.' },
  { id: 'kickoff', label: 'Kickoff', sub: 'The kickoff PDF — client, deliverables, team, and the production timeline.' }
];
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.id, k.label]));

// ── LAYOUT BOXES ─────────────────────────────────────────────────────────────
// Rectangles read off the AcroForm in `Flimp Kickoff Template Formed.pdf`, and
// the design sizes from each field's default appearance. If the template is ever
// re-formed with different geometry, correct it HERE and the whole panel follows.
//
// NOTE WHAT THESE ARE NOW. The generator does NOT fill these as form fields —
// it draws into them as coordinate boxes, the same way the timeline table
// already treats the `Timeline` rect. Two things forced that:
//
//   1. An AcroForm text field carries ONE default appearance for the whole
//      field: one font, one size, one colour. Process and First Steps are headed
//      lists — a per-type heading has to read differently from the numbered
//      lines beneath it — and a single-format field simply cannot express that.
//      (Rich-text fields nominally can; they're an Acrobat-only corner of the
//      spec with no pdf-lib support.)
//   2. Half the document was already being drawn. Keeping field-fill for the
//      other half meant two text paths, two font resolutions, and two ways for
//      text to fail, in one document.
//
// Dropping the fields costs nothing visually: the page art is four placed
// XObjects positioned by a 358-byte content stream, and the fields are widget
// annotations floating on top. Strip them and the page is unchanged.
//
// The upshot for this panel is that overflow is no longer silent truncation —
// the generator can set text smaller to fit. So `font` is the size the design
// asks for, and `minFont` is how far it may be reduced before the result stops
// being worth printing.
const LEADING = 1.4;
const FIELD = {
  // rect [35.3, 61.8, 369.3, 308.9] → 334.0 × 247.1pt, design size 15pt
  process:    { w: 334.0, h: 247.1, font: 15, minFont: 10 },
  // rect [212.1, 582.8, 567.6, 682.7] → 355.5 × 99.9pt, design size 12pt
  firstSteps: { w: 355.5, h: 99.9, font: 12, minFont: 8 }
};
const capacityAt = (f, size) => Math.floor(f.h / (size * LEADING));
const capacity   = f => capacityAt(f, f.font);
// Character budget per line, approximating average glyph width at 0.5em. Rough
// on purpose — enough to warn on, and the generator does the authoritative
// measurement with real font metrics.
const charsPerLine = f => Math.max(1, Math.floor(f.w / (f.font * 0.5)));

const LIMITS = {
  // The team box is ~150pt wide and four lines tall per person. Three fits
  // comfortably; beyond that the text has to be set smaller to stay inside.
  teamComfortable: 3
};

// NOTE: the team block no longer reads the project's assignment fields at all
// (designer, animator, voArtist, otherVendor1/2, itemOwner, projectOwner). Two
// changes retired them: candidates are now restricted to AMs and PMs, and the
// title line comes from the person's own `job_title` rather than from whichever
// slot they were found in. Both facts about a person — who they are and what
// they're called — now come from one place, their `people` row.

// ── PER-TYPE CONTENT ─────────────────────────────────────────────────────────
// What the Process and First Steps sections SAY comes from KICKOFF_CONTENT,
// loaded from the `kickoff_content` table. Keyed on product type (not tier)
// deliberately: 13 types against many dozens of tiers, and a newly added tier
// inherits its type's content rather than needing its own entry.
//
// Assembly rule: a project's SELECTED deliverables are grouped by type, and each
// type present emits its own headed list — Process numbered and restarting at 1
// per type, First Steps bulleted. A type with no rows contributes nothing and is
// reported in the panel as unauthored, so a silent gap is impossible.
//
// Each line is { id, text, url }. A url makes the whole line a hyperlink in the
// generated PDF — possible only because the generator draws these regions rather
// than filling AcroForm fields, whose values are plain text with one appearance
// and cannot carry a link at all.
function typeContent(type, which) {
  const entry = KICKOFF_CONTENT[type];
  return (entry && entry[which]) || [];
}

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
  if (!t.teamOn      || typeof t.teamOn      !== 'object') t.teamOn      = {};  // people opted IN beyond the pinned two
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

// ── TEAM ─────────────────────────────────────────────────────────────────────
// Two tiers, because "who is on this kickoff" is two different questions:
//
//   PINNED    — production lead and the project's account manager. On every
//               kickoff by definition, so the panel states them rather than
//               asking.
//   SELECTED  — additional account managers and project managers, chosen from a
//               dropdown.
//
// Candidates are restricted to KICKOFF_TEAM_ROLES. The block introduces the
// client's Flimp contacts, and designers, animators and VO artists are neither
// client-facing nor, in several cases, Flimp staff — so being assigned to the
// project no longer puts someone in this list. That also keeps the list short
// enough to pick from, which a full vendor roster was not.
//
// Membership is opt-IN, deliberately diverging from the Campaign list, which
// tracks EXCLUSIONS so a newly added deliverable appears automatically. The
// constraint here runs the other way: the box comfortably holds three, so
// defaulting people in would guarantee an overflow warning on every project.

// Everything the team block prints about a person, all of it from the directory
// row rather than from the assignment. These are facts about the PERSON, so they
// are identical on every kickoff they appear on and belong in one place.
//
// A name with no matching row still renders — with blank lines — rather than
// vanishing from the team block. The panel names anyone in that state, since it
// almost always means a spelling mismatch rather than a genuinely absent person.
function personFor(name) {
  const rec = PEOPLE_DIRECTORY.find(p => p.name === name);
  return {
    found:    !!rec,
    role:     (rec && rec.role)     || '',
    jobTitle: (rec && rec.jobTitle) || '',
    email:    (rec && rec.email)    || '',
    phone:    (rec && rec.phone)    || ''
  };
}
const eligibleRole = role => KICKOFF_TEAM_ROLES.includes(role);

// Everyone the dropdown may offer: the AMs and PMs in the directory.
function eligiblePeople() {
  return PEOPLE_DIRECTORY.filter(p => eligibleRole(p.role));
}

// The full candidate list, in the order the document prints them: pinned first,
// then everyone selected. `pinned` members cannot be switched off.
//
// Anyone already in `teamOn` is included even if they'd no longer qualify —
// tightening the eligible roles should never silently drop a name from a kickoff
// someone had already assembled. They can still be removed by hand.
function teamCandidates(parent, st) {
  const am = (parent.am || '').trim();
  const out = [];
  const seen = new Set();
  const add = (name, pinned, why) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, pinned, why });
  };

  add(KICKOFF_ALWAYS, true, 'Always on every kickoff');
  add(am, true, 'Account manager on this project');
  for (const p of eligiblePeople()) if (st.teamOn[p.name]) add(p.name, false, '');
  for (const name in st.teamOn) add(name, false, '');   // kept selections, whatever their role
  return out;
}

// The title line, in order of preference:
//
//   1. `job_title` from the directory — the person's actual title. Several
//      account managers hold variations ("Senior Account Manager", "Account
//      Director") and this is the only source that carries them.
//   2. A generic label derived from their `role`, so an unfilled title still
//      prints something sensible.
//   3. Their raw role, then nothing.
//
// Deliberately NOT derived from the project assignment. That produced internal
// jargon — "Flimp Project Owner" — in a document the client reads, and it can't
// express a title variation at all. It also means nobody is special-cased here:
// everyone's title comes from their own row.
function roleTextFor(c) {
  const p = personFor(c.name);
  return p.jobTitle || KICKOFF_ROLE_LABEL[p.role] || p.role || '';
}

function isTeamOn(st, c) { return c.pinned || !!st.teamOn[c.name]; }

// Selection keys on the ROW name, never the displayed one — otherwise renaming
// someone in the document would orphan their toggle.
function selectedTeam(parent, st) {
  return teamCandidates(parent, st)
    .filter(c => isTeamOn(st, c))
    .map(c => {
      const p = personFor(c.name);
      return {
        name:      c.name,
        pinned:    c.pinned,
        nameKey:   'team:' + c.name,
        roleKey:   'teamrole:' + c.name,
        emailKey:  'teamemail:' + c.name,
        phoneKey:  'teamphone:' + c.name,
        label:     ov(st, 'team:' + c.name, c.name),
        roleText:  ov(st, 'teamrole:' + c.name, roleTextFor(c)),
        emailText: ov(st, 'teamemail:' + c.name, p.email),
        phoneText: ov(st, 'teamphone:' + c.name, p.phone)
      };
    });
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
// Ordering follows the deliverables rather than KICKOFF_CONTENT's key order, so
// the document reads in the same sequence as the Campaign list above it.
//
// `which` is 'process' (numbered, restarting per type) or 'firstSteps'
// (bulleted). Individual lines can be switched off per project — a standard step
// that doesn't apply this time shouldn't require a code change.
//
// KEYED ON THE SUPABASE ROW ID, never on position. Per-project state — a line
// switched off, its wording changed, its link replaced — persists on the project
// row, while the copy itself lives in a table someone reorders and edits.
// Position would silently repoint a saved tweak at a different line the moment a
// row moved; the id survives both reordering and other lines being hidden.
function lineKey(id)    { return `line:${id}`; }
function lineUrlKey(id) { return `lineurl:${id}`; }

function contentGroups(parent, st, which) {
  const order = [];
  for (const k of campaignItems(parent, st)) {
    if (!order.includes(k.type)) order.push(k.type);
  }
  return order.map(type => {
    const all = typeContent(type, which);
    const headKey = `head:${which}:${type}`;
    return {
      type,
      headKey,
      heading: ov(st, headKey, type),
      authored: all.length > 0,
      lines: all.map(row => {
        const key = lineKey(row.id), urlKey = lineUrlKey(row.id);
        return {
          key, urlKey, id: row.id,
          text:   ov(st, key, row.text),
          url:    ov(st, urlKey, row.url || ''),
          on:     !st.lineOff[key],
          edited: isEdited(st, key) || isEdited(st, urlKey)
        };
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

// Overflow is now a decision rather than an accident: the generator draws these
// boxes, so it can set text smaller to fit. Two thresholds follow — over the
// design size means "this will be reduced", over the minimum means "this will
// not fit at a size worth reading". Only the second is a real problem.
function fitWarning(section, label, f) {
  if (section.lines <= section.cap) return null;
  const hard = capacityAt(f, f.minFont);
  return section.lines > hard
    ? `${label} is about ${section.lines} lines. Even at ${f.minFont}pt — the smallest worth printing — the box holds ~${hard}. Cut some lines or move content elsewhere.`
    : `${label} is about ${section.lines} lines against ~${section.cap} at the design size of ${f.font}pt, so it will be set smaller to fit.`;
}

function warnings(parent, st) {
  const out = [];
  const d = derived(parent, st);

  const pw = fitWarning(d.process, 'Process', FIELD.process);
  if (pw) out.push(pw);
  const fw = fitWarning(d.firstSteps, 'First Steps', FIELD.firstSteps);
  if (fw) out.push(fw);

  // A URL the PDF can't turn into a working link. Caught here rather than at
  // generation because by then the document is already made, and a dead link in
  // a client-facing kickoff is worse than a missing one.
  const badLinks = [];
  for (const section of [d.process, d.firstSteps]) {
    for (const g of section.groups) {
      for (const l of g.lines) {
        if (l.on && l.url && !/^https?:\/\/\S+$/i.test(l.url)) badLinks.push(l.text);
      }
    }
  }
  if (badLinks.length) {
    out.push(`Link doesn't look like a URL on: ${badLinks.join('; ')}. Links need the full address including https://.`);
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
//
// Pinned people are shown as settled rather than as ticked checkboxes, because a
// control that can't be switched off shouldn't look like one that can. Everyone
// else is added through a dropdown and shown as a removable chip: the eligible
// list runs to every AM and PM at Flimp, which is far too many rows to scan as
// checkboxes for the two or three that actually apply.
function teamBody(pid, parent, st) {
  const all = teamCandidates(parent, st);
  const pinned   = all.filter(c => c.pinned);
  const selected = all.filter(c => !c.pinned);

  // Two different problems, so they read differently. A name absent from
  // `people` entirely is almost always a spelling mismatch between an assignment
  // field and the directory, and prints with every line but the name blank. A
  // name that's present but thin just needs a column filling in.
  const on = all.filter(c => isTeamOn(st, c));
  const unknown = on.filter(c => !personFor(c.name).found).map(c => c.name);
  const thin = on
    .filter(c => personFor(c.name).found)
    .filter(c => { const p = personFor(c.name); return !p.email || !p.phone || !p.jobTitle; })
    .map(c => {
      const p = personFor(c.name);
      const gaps = [!p.jobTitle && 'title', !p.email && 'email', !p.phone && 'phone'].filter(Boolean);
      return `${c.name} (${gaps.join(', ')})`;
    });

  const pinnedRows = pinned.map(c => `<div class="tp-pinned">
      <span class="tp-pinned-lock" title="${esc(c.why)}">◆</span>
      <span class="tp-check-nm">${esc(c.name)}</span>
      <span class="tp-check-m">${esc(c.why)}</span>
    </div>`).join('');

  // Already-pinned and already-selected names are left out of the options
  // rather than shown disabled — a menu of things you can't pick is noise.
  const taken = new Set(all.map(c => c.name));
  const options = eligiblePeople()
    .filter(p => !taken.has(p.name))
    .map(p => `<option value="${esc(p.name)}">${esc(p.name)}${p.role ? ' · ' + esc(KICKOFF_ROLE_LABEL[p.role] || p.role) : ''}</option>`)
    .join('');

  // Distinguish "nothing loaded" from "loaded, but nobody qualifies" — the
  // second usually means the role values in Supabase aren't what's expected, so
  // name the ones actually present rather than showing an empty menu.
  let picker;
  if (options) {
    picker = `<select class="tp-select" onchange="A.tpToggleTeam('${pid}',this.value); this.value='';">
        <option value="" disabled selected>Add an account manager or project manager…</option>
        ${options}
      </select>`;
  } else if (!PEOPLE_DIRECTORY.length) {
    picker = `<div class="tp-empty">The <code>people</code> table hasn't loaded — no one to add.</div>`;
  } else if (!eligiblePeople().length) {
    const found = [...new Set(PEOPLE_DIRECTORY.map(p => p.role).filter(Boolean))];
    picker = `<div class="tp-empty">No one in <code>people</code> has an eligible role. Looking for ${esc(KICKOFF_TEAM_ROLES.join(', '))}; the table has ${found.length ? esc(found.join(', ')) : 'no roles set'}.</div>`;
  } else {
    picker = `<div class="tp-empty">Everyone eligible is already on this kickoff.</div>`;
  }

  const chips = selected.length
    ? `<div class="tp-chips">${selected.map(c => `<span class="tp-chip">
        <span class="tp-chip-nm">${esc(c.name)}</span>
        <button class="tp-chip-x" title="Remove"
          onclick="A.tpToggleTeam('${pid}',this.dataset.nm)" data-nm="${esc(c.name)}">×</button>
      </span>`).join('')}</div>`
    : '';

  return `<div class="tp-subh">Always included</div>
    <div class="tp-checks">${pinnedRows || '<div class="tp-empty">No account manager set on this project.</div>'}</div>
    <div class="tp-subh">Add others</div>
    ${picker}
    ${chips}
    ${unknown.length
      ? `<div class="tp-note">Not in the <code>people</code> table: ${esc(unknown.join(', '))}. Everything but the name will print blank — usually this is a spelling difference between the project's assignment and the directory row.</div>`
      : ''}
    ${thin.length
      ? `<div class="tp-note">Missing details — ${esc(thin.join('; '))}. Fill them in on the <code>people</code> table in Supabase, or type them straight into the preview for this document only.</div>`
      : ''}`;
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
              <span class="tp-line-t">${esc(l.text)}${
                l.url ? ` <span class="tp-line-link" title="${esc(l.url)}">↗</span>` : ''}${
                l.edited ? ' <span class="tp-edited-dot" title="Edited for this project">•</span>' : ''}</span>
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
      `Numbered per product type, restarting at 1. Drawn at ${FIELD.process.font}pt, reduced toward ${FIELD.process.minFont}pt if it runs long.`,
      d.process.groups, d.process.lines, d.process.cap)}
    ${derivedBlock(pid, 'firstSteps', 'First Steps — page 2',
      `Bulleted per product type. Drawn at ${FIELD.firstSteps.font}pt, reduced toward ${FIELD.firstSteps.minFont}pt if it runs long.`,
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
// A line's URL sits under its text as a second, quieter row. It is always shown
// rather than revealed on demand — the same choice as the team block's blank
// contact lines. A step that SHOULD link somewhere and doesn't is exactly the
// kind of gap worth seeing before generating, and hiding empty ones would make
// the absence invisible.
function previewGroups(pid, st, groups, which) {
  const live = groups.filter(g => g.lines.some(l => l.on));
  if (!live.length) return '';
  return live.map(g => {
    const kept = g.lines.filter(l => l.on);
    const items = kept.map(l => `<li>
        <span class="${l.url ? 'tp-pv-linked' : ''}">${editable(pid, l.key, l.text)}</span>${revert(pid, st, l.key)}
        <div class="tp-pv-url">${editable(pid, l.urlKey, l.url, '', 'no link')}${revert(pid, st, l.urlKey)}</div>
      </li>`).join('');
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

  // Four lines per person, exactly as the block prints them. A missing email or
  // phone shows as an empty editable rather than being skipped — the gap is
  // visible, and can be filled for this document without a trip to Supabase.
  const teamBlock = team.length
    ? team.map(p => `<div class="tp-pv-person">
        <div class="tp-pv-person-n">${editable(parent.id, p.nameKey, p.label)}${revert(parent.id, st, p.nameKey)}</div>
        <div class="tp-pv-person-r">${editable(parent.id, p.roleKey, p.roleText, '', 'no role')}${revert(parent.id, st, p.roleKey)}</div>
        <div class="tp-pv-person-c">${editable(parent.id, p.emailKey, p.emailText, '', 'no email')}${revert(parent.id, st, p.emailKey)}</div>
        <div class="tp-pv-person-c">${editable(parent.id, p.phoneKey, p.phoneText, '', 'no phone')}${revert(parent.id, st, p.phoneKey)}</div>
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
  st.teamOn = {};
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

// Pinned members have no toggle, so this only ever reaches the opt-in list.
function tpToggleTeam(pid, name) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = tplState(r);
  if (st.teamOn[name]) delete st.teamOn[name]; else st.teamOn[name] = true;
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
  if (key.startsWith('teamemail:') || key.startsWith('teamphone:')) {
    const p = selectedTeam(parent, bare).find(x => x.emailKey === key || x.phoneKey === key);
    if (!p) return undefined;
    return key.startsWith('teamemail:') ? p.emailText : p.phoneText;
  }
  if (key.startsWith('head:')) {
    const [, which, type] = key.split(':');
    const g = contentGroups(parent, bare, which).find(x => x.type === type);
    return g ? g.heading : undefined;
  }
  // Copy lines are keyed on the Supabase row id alone, so which section they
  // belong to isn't in the key — search both rather than parsing it out.
  if (key.startsWith('line:') || key.startsWith('lineurl:')) {
    for (const which of ['process', 'firstSteps']) {
      for (const g of contentGroups(parent, bare, which)) {
        const line = g.lines.find(l => l.key === key || l.urlKey === key);
        if (line) return key.startsWith('lineurl:') ? line.url : line.text;
      }
    }
  }
  return undefined;
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
