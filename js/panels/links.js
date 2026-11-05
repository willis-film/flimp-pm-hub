// links.js — Links panel.
//
// WHY THIS PANEL EXISTS
// A project's URLs are scattered across seven edit surfaces: the strip (Zoho,
// Dropbox, Estimate), the Info panel at project scope (HubSpot, Estimate,
// Invoice ref), the Info panel at item scope (Preview, Reporting, Review,
// Dropbox, Boords), the detail modal (Zoho, Dropbox, on BOTH the parent and
// item branches), the Distro wizard (what was actually sent to the client) and
// Closeout. Because no one surface shows them all, "did that link ever get
// recorded?" could not be answered without opening five things. This panel is
// the one place every link for a project is visible at once.
//
// NO SCOPE RAIL. The Info panel has one because it edits one record at a time.
// Here, seeing every item side by side IS the value — a hole is only obvious
// next to the rows that don't have one.
//
// THE READING RULE
// A cell shows a WORD only when the word is telling you something:
//   set            → a link glyph. The column header already named the field.
//   empty          → the field's name, grey under a dotted underline.
//   gap            → the field's name in red: empty when it should not be.
//   does not apply → a faint dash.
// So a healthy row goes quiet, and every word on screen is a hole.
//
// STORAGE: no migration. None of these fields are in KNOWN_FIELDS (api/db.js),
// so they all persist in the `data` JSONB catch-all — including the two new
// ones, apStoryboardLink and renewalStoryboardLink.

import { esc } from '../utils.js';
import { db, save } from '../store.js';
import { A, register } from '../bus.js';
import { isDetached } from '../utils.js';
import { PRODUCT_TYPE_LIST } from '../data/constants.js';

// ── WHICH COLUMNS APPLY TO WHICH PRODUCT TYPE ────────────────────────────────
// Keyed by product_type EXACTLY as Supabase lists it. PRODUCT_TYPE_LIST is the
// live list — api/db.js reads the `product_types` reference table and
// applyReference() in js/data/constants.js replaces the hardcoded fallback with
// it at load, so these names must match the table, not a label invented here.
//
// EDIT THIS MAP if a column shows a dash where it should show a hole. A column
// with no entry applies to everything.
//
// SAFE BY DEFAULT: a product type that is not named in a column's list still
// gets the cell if that type isn't in PRODUCT_TYPE_LIST at all — i.e. anything
// added or renamed in Supabase since this map was written, plus items with no
// product type set. An extra dash costs nothing; a hidden cell costs a missed
// link, and that is the one failure this panel must not have.
const APPLIES = {
  // Storyboards are a video artifact.
  boords:  ['Presentation Video', 'Video', 'Library Videos'],
  ap:      ['Presentation Video', 'Video', 'Library Videos'],
  renewal: ['Presentation Video', 'Video', 'Library Videos'],
  // Anything with a hosted page the client can look at and we can measure.
  preview: ['Presentation Video', 'Video', 'Library Videos', 'Microsite - Single Page', 'Microsite - Multi Page',
            'Flimp Decisions', 'Flimp Connect', 'Flimp Canvas',
            'Web Development', 'AI Chatbot Agent'],
  report:  ['Presentation Video', 'Video', 'Library Videos', 'Microsite - Single Page', 'Microsite - Multi Page',
            'Flimp Decisions', 'Flimp Connect', 'Flimp Canvas',
            'Web Development', 'AI Chatbot Agent'],
  disturl: ['Presentation Video', 'Video', 'Library Videos', 'Microsite - Single Page', 'Microsite - Multi Page',
            'Flimp Decisions', 'Flimp Connect', 'Flimp Canvas',
            'Web Development', 'AI Chatbot Agent'],
  // "Final Files" is the heading the Distro wizard puts over a guide's
  // downloads — see the guide template in js/panels/distro.js.
  files:   ['Benefit Guide', 'Companion Piece'],
  // Embed code is a Video distribution method (VIDEO_OPTIONS in distro.js).
  embed:   ['Presentation Video', 'Video', 'Library Videos'],
};

// A type Supabase doesn't list is a type this map cannot have an opinion about.
const isKnownType = t => PRODUCT_TYPE_LIST.includes(t);

function appliesTo(row, colKey) {
  const list = APPLIES[colKey];
  if (!list) return true;                      // column applies everywhere
  const t = row.productType;
  if (!t || !isKnownType(t)) return true;      // unset, or new/renamed in Supabase
  return list.includes(t);
}

// Said once, not per render. If a name here no longer matches the Supabase
// table — a type renamed or deactivated — the entry is dead and the column
// quietly stops applying to it. This is the only warning you get.
let _typesChecked = false;
function checkTypeNames() {
  if (_typesChecked || !PRODUCT_TYPE_LIST.length) return;
  _typesChecked = true;
  const unknown = [...new Set(Object.values(APPLIES).flat())].filter(t => !isKnownType(t));
  if (unknown.length) console.warn(
    'links.js APPLIES names product types that are not in Supabase\'s product_types ' +
    'table — rename them there or here, or those columns will not apply: ' + unknown.join(', '));
}

// ── WHEN IS AN EMPTY CELL A GAP? ─────────────────────────────────────────────
// Empty is only a gap once the thing that makes the link REQUIRED has already
// happened. Before that the slot is simply not due yet, and the panel stays
// quiet about it.

// Distribution has gone out: a distribution date that is set and not in the
// future. Status alone is not enough — an item can be done without shipping.
function isDistributed(row) {
  const d = row.distributionDate;
  if (!d) return false;
  const when = new Date(d);
  if (isNaN(when)) return false;
  const today = new Date(); today.setHours(23, 59, 59, 999);
  return when <= today;
}

// The item is finished, which is when closeout artifacts become due.
const isFinished = row => row.status === 'done' || row.status === 'closed';

// ── COLUMN SPEC ──────────────────────────────────────────────────────────────
// Four groups of three. `read` pulls the value, `field` names the row column to
// write (absent = read-only). `requiredOnce` decides when empty becomes a gap.
//
// The three "as sent to client" columns are READ-ONLY here on purpose. They
// live in the Distro wizard's own state, and giving distro.fields a second
// editor is exactly how dropboxLink ended up with four of them. Click one to
// jump to Distro instead.
const GROUPS = [
  { label: 'Systems', cols: [
    { key: 'clickup',  label: 'ClickUp',  cell: 'ClickUp',
      read: r => A.cuTaskUrl(r), note: 'Synced from ClickUp — assign the task to change it' },
    { key: 'zoho',     label: 'Zoho',     cell: 'Zoho',    field: 'zohoLink' },
    { key: 'dropbox',  label: 'Dropbox',  cell: 'Dropbox', field: 'dropboxLink' },
  ]},
  { label: 'Storyboards', cols: [
    { key: 'boords',   label: 'Working',     cell: 'Boords',
      field: 'boordsLink' },
    { key: 'ap',       label: 'As-produced', cell: 'AP',
      field: 'apStoryboardLink',
      requiredOnce: isFinished, dueNote: 'Due at closeout' },
    { key: 'renewal',  label: 'Renewal',     cell: 'Renewal',
      field: 'renewalStoryboardLink',
      requiredOnce: isFinished, dueNote: 'Due at closeout' },
  ]},
  { label: 'Delivery', cols: [
    { key: 'review',   label: 'Review',    cell: 'Review',
      field: 'reviewStudioLink' },
    { key: 'preview',  label: 'Preview',   cell: 'Preview',
      field: 'previewLink' },
    // TWO PLACES HOLD THIS ONE LINK. The Distro wizard's reporting field
    // pre-fills from the item's reportingLink (assetFields' `report`), so the
    // wizard's `reportLink` and the row's `reportingLink` are the SAME link —
    // unlike Dist. URL and Final Files below, which are genuinely different
    // links from the item's own and therefore get no fallback. The wizard
    // never writes back, so a link typed only there left the row empty and
    // every distributed item read as a gap: 30 of 52 flags were false.
    //
    // Resolution order is buildEmail()'s own — distro.js's reportUrl() reads
    // `st.fields[k.id]?.reportLink || assetFields(k, st).report` — so the cell
    // and the email that went to the client can never disagree about which
    // link exists. Editing still writes the row (`field` below), which
    // promotes a wizard-only link onto the item.
    { key: 'report',   label: 'Reporting', cell: 'Report',
      field: 'reportingLink',
      read: (r, st) => st.fields[r.id]?.reportLink || r.reportingLink || '',
      requiredOnce: isDistributed, dueNote: 'Due once distributed' },
  ]},
  { label: 'As sent to client', cols: [
    // Like the distribution URL below: the Final Files link the client is sent
    // is NOT the item's Dropbox link, so it neither falls back to it nor is
    // compared against it. Empty here means nothing was sent, not "look in
    // Dropbox instead".
    { key: 'files',    label: 'Final Files', cell: 'Files',
      read: (r, st) => st.fields[r.id]?.download || '',
      note: 'Sent under the "Final Files" heading — edit in Distro' },
    // The distribution URL and the item's preview link are two DIFFERENT links
    // — a preview is ours to look at, a distribution URL is what the client is
    // sent — so they are never equal and must never stand in for each other.
    // No fallback to previewLink: an item with nothing in the wizard has no
    // distribution URL, and saying otherwise would show a filled cell for a
    // link that was never sent. No `differs` either: comparing two links that
    // are supposed to differ would mark every distributed item.
    { key: 'disturl',  label: 'Dist. URL',   cell: 'URL',
      read: (r, st) => st.fields[r.id]?.distUrl || '',
      note: 'What actually went out — edit in Distro' },
    { key: 'embed',    label: 'Embed',       cell: 'Embed',
      read: (r, st) => st.fields[r.id]?.embedCode ?? '',
      note: 'Embed code — stored only in the Distro wizard' },
  ]},
];
const ALL_COLS = GROUPS.flatMap(g => g.cols);

// ── PROJECT ROW ──────────────────────────────────────────────────────────────
// Project-scope links, which are not per-item and so cannot be columns. `src`
// names the surface that owns the field, so the panel never pretends to be the
// only place a value lives.
const PROJECT_FIELDS = [
  { label: 'Zoho',        field: 'zohoLink',     src: 'strip' },
  { label: 'Dropbox',     field: 'dropboxLink',  src: 'strip' },
  { label: 'Estimate',    field: 'estimateLink', src: 'strip · info' },
  { label: 'Invoice ref', field: 'invoiceRef',   src: 'info' },
  { label: 'AI agent',    distro: 'aiLink',      src: 'distro' },
  { label: 'AI report',   distro: 'aiReport',    src: 'distro' },
];

// ── CELL STATE ───────────────────────────────────────────────────────────────
// One place decides what a cell is, so the grid, the counts and the alerts can
// never disagree about it.
function cellState(row, col, st) {
  if (!appliesTo(row, col.key)) return { kind: 'na' };

  const val = (col.read ? col.read(row, st) : row[col.field]) || '';
  if (val) {
    return { kind: 'has', val };
  }
  // Empty. A gap only once the thing that requires it has happened.
  if (col.requiredOnce && col.requiredOnce(row)) return { kind: 'gap' };
  // Not due yet — stay silent rather than showing a word that means nothing.
  if (col.requiredOnce) return { kind: 'na', note: col.dueNote };
  return { kind: 'none' };
}

// ── VIEW: one cell ───────────────────────────────────────────────────────────
function cellHtml(row, col, st) {
  const s = cellState(row, col, st);
  const editable = !!col.field;
  const inpId = `lk-inp-${row.id}-${col.key}`;
  const lnkId = `lk-lnk-${row.id}-${col.key}`;
  const input = editable
    ? `<input class="fps-input" value="${esc(s.val || '')}" placeholder="URL"
         onblur="A.uf('${row.id}','${col.field}',this.value)" style="display:none" id="${inpId}">`
    : '';
  const edit = editable
    ? `<span class="lk-ed" role="button" tabindex="0" id="${lnkId}" title="Edit"
         onclick="A.toggleLinkEdit('${inpId}','${lnkId}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();A.toggleLinkEdit('${inpId}','${lnkId}')}">&#9998;</span>`
    : '';

  if (s.kind === 'na') {
    const t = s.note || (col.note ? '' : 'Does not apply to this product type');
    return `<span class="lk-na"${t ? ` title="${esc(t)}"` : ''}>&ndash;</span>`;
  }

  if (s.kind === 'has') {
    const href = (s.val.startsWith('http') ? '' : 'https://') + esc(s.val);
    const tip = col.note ? `${esc(s.val)} — ${esc(col.note)}` : esc(s.val);
    return `<span class="lk-c has">
      <a class="lk-a" href="${href}" target="_blank" rel="noopener" title="${tip}">${col.cell}</a>
      ${input}${edit}</span>`;
  }

  // empty or gap — the word, clickable straight into an input where we own the
  // field, and a pointer to the owning surface where we don't.
  const kind = s.kind === 'gap' ? 'gap' : 'none';
  const why = s.kind === 'gap'
    ? (col.requiredOnce === isFinished
        ? `Item is finished with no ${col.label.toLowerCase()} link — a closeout artifact`
        : `Distributed with no ${col.label.toLowerCase()} link`)
    : (col.note || `No ${col.label} link`);
  if (!editable) {
    return `<span class="lk-c ${kind}"><span class="lk-a" title="${esc(why)}">${col.cell}</span></span>`;
  }
  return `<span class="lk-c ${kind}">
    <span class="lk-a" role="button" tabindex="0" id="${lnkId}" title="${esc(why)}"
      onclick="A.toggleLinkEdit('${inpId}','${lnkId}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();A.toggleLinkEdit('${inpId}','${lnkId}')}"
      >${col.cell}</span>${input}</span>`;
}

// ── VIEW: project row ────────────────────────────────────────────────────────
function projectRow(parent, st) {
  const tiles = PROJECT_FIELDS.map(f => {
    const val = (f.distro ? st.fields[f.distro] : parent[f.field]) || '';
    const inpId = `lk-pinp-${parent.id}-${f.field || f.distro}`;
    const lnkId = `lk-plnk-${parent.id}-${f.field || f.distro}`;
    const editable = !!f.field;
    const input = editable
      ? `<input class="fps-input" value="${esc(val)}" placeholder="URL"
           onblur="A.uf('${parent.id}','${f.field}',this.value)" style="display:none" id="${inpId}">`
      : '';
    let body;
    if (val) {
      const href = (val.startsWith('http') ? '' : 'https://') + esc(val);
      // invoiceRef is a reference string, not a URL — never linkify it.
      body = f.field === 'invoiceRef'
        ? `<span class="lk-pv has">${esc(val)}</span>${input}`
        : `<a class="lk-pv has" href="${href}" target="_blank" rel="noopener" title="${esc(val)}">${esc(val)}</a>${input}`;
    } else if (editable) {
      body = `<span class="lk-pv none"><span class="lk-a" role="button" tabindex="0" id="${lnkId}"
          onclick="A.toggleLinkEdit('${inpId}','${lnkId}')"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();A.toggleLinkEdit('${inpId}','${lnkId}')}"
          >not set</span></span>${input}`;
    } else {
      body = `<span class="lk-pv none"><span class="lk-a" title="Set in the Distro wizard">not set</span></span>`;
    }
    const ed = editable && val
      ? `<span class="lk-ed" role="button" tabindex="0" id="${lnkId}" title="Edit"
           onclick="A.toggleLinkEdit('${inpId}','${lnkId}')">&#9998;</span>`
      : '';
    return `<div class="lk-pcell${val ? '' : ' empty'}">
      <div class="lk-pk"><span>${f.label}</span><span class="lk-src">${f.src}${ed}</span></div>
      ${body}</div>`;
  }).join('');
  return `<div class="lk-sec-k">Project</div><div class="lk-proj">${tiles}</div>`;
}

// ── ALERTS ───────────────────────────────────────────────────────────────────
// Only the readings that are exceptions. A count of empty slots is not an
// alert; a link that should exist and doesn't is.
function alerts(parent, kids, st) {
  const out = [];
  const name = r => esc(r.name || 'Untitled');

  kids.forEach(k => {
    const gaps = ALL_COLS.filter(c => cellState(k, c, st).kind === 'gap');
    const closeout = gaps.filter(c => c.requiredOnce === isFinished);
    const shipped  = gaps.filter(c => c.requiredOnce === isDistributed);
    if (shipped.length) out.push({ crit: true, html:
      `<strong>${name(k)} distributed with no ${shipped.map(c => c.label.toLowerCase()).join(' or ')} link</strong> — the client has no metrics link and closeout can't record one.` });
    if (closeout.length) out.push({ crit: true, html:
      `<strong>${name(k)} finished without its closeout storyboards</strong> — no ${closeout.map(c => c.label.toLowerCase()).join(' and no ')} link. Both are checkboxes in Closeout today, so nothing records the URL.` });
  });

  const noZoho = kids.filter(k => !k.zohoLink);
  if (noZoho.length) out.push({ html:
    `<strong>${noZoho.length} item${noZoho.length > 1 ? 's have' : ' has'} no Zoho Project Item link</strong> — ${noZoho.map(name).join(', ')}.` });

  return out.map(a => `<div class="lk-alert${a.crit ? ' crit' : ''}">
    <span class="lk-alert-sig">!</span><span>${a.html}</span></div>`).join('');
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────
function linksPanelHtml(parent) {
  checkTypeNames();
  const kids = (A.getChildren(parent.id) || []).filter(k => !isDetached(k));
  const st = parent.distro && typeof parent.distro === 'object' ? parent.distro : {};
  if (!st.fields || typeof st.fields !== 'object') st.fields = {};

  // Counts are computed from the same cellState() the cells use, so the
  // headline can never drift from what is on screen.
  let applicable = 0, filled = 0, gaps = 0;
  kids.forEach(k => ALL_COLS.forEach(c => {
    const s = cellState(k, c, st);
    if (s.kind === 'na') return;
    applicable++;
    if (s.kind === 'has') filled++;
    if (s.kind === 'gap') gaps++;
  }));
  PROJECT_FIELDS.forEach(f => {
    applicable++;
    if ((f.distro ? st.fields[f.distro] : parent[f.field])) filled++;
  });

  const colgroup = `<colgroup><col class="lk-col-name">` +
    GROUPS.map(g => `<col span="${g.cols.length}">`).join('') + `</colgroup>`;

  // table-layout:fixed takes its widths from the FIRST row, and the first row
  // here is the group spanner with colspan — so widths MUST live on the
  // colgroup above, not on the header cells.
  const head = `<thead>
    <tr><th class="lk-th-name"></th>${
      GROUPS.map((g, i) => `<th class="lk-th-grp${i ? ' lk-sep' : ''}" colspan="${g.cols.length}">${g.label}</th>`).join('')
    }</tr>
    <tr><th class="lk-th-name">Item</th>${
      GROUPS.map((g, i) => g.cols.map((c, j) =>
        `<th${i && !j ? ' class="lk-sep"' : ''}>${c.label}</th>`).join('')).join('')
    }</tr></thead>`;

  const body = `<tbody>${kids.map(k => `<tr>
    <td><div class="lk-name">
      <span class="lk-dot"${A.itemDotStyle ? A.itemDotStyle(k) : ''}></span>
      <span class="lk-nm" title="${esc(k.name || '')}">${esc(k.name || 'Untitled')}</span>
    </div></td>${
      GROUPS.map((g, i) => g.cols.map((c, j) =>
        `<td${i && !j ? ' class="lk-sep"' : ''}>${cellHtml(k, c, st)}</td>`).join('')).join('')
    }</tr>`).join('')}</tbody>`;

  // "gap" has two causes — distributed, and finished — so the headline names
  // neither. What they share is that the link is already due.
  const gapNote = gaps ? ` &middot; ${gaps} gap${gaps > 1 ? 's' : ''} already due` : '';

  return `<div class="lk-wrap" id="lk-wrap-${parent.id}">
    <div class="lk-head">
      <div class="lk-head-name">${esc(parent.name || 'Untitled')}</div>
      <div class="lk-head-count">${filled} of ${applicable} applicable links filled${gapNote}</div>
    </div>
    ${projectRow(parent, st)}
    <div class="lk-sec-k lk-sec-items">Items<span class="lk-sec-hint">Click any slot to paste &middot; ClickUp is synced and read-only</span></div>
    ${kids.length
      ? `<table class="lk-table">${colgroup}${head}${body}</table>`
      : `<div class="lk-none">No project items yet.</div>`}
    <div class="lk-foot">
      <div class="lk-key">
        <span class="lk-key-i"><span class="lk-c has"><span class="lk-a">Set</span></span> set &mdash; click to open</span>
        <span class="lk-key-i"><span class="lk-c none"><span class="lk-a">Dropbox</span></span> empty &mdash; click to paste</span>
        <span class="lk-key-i"><span class="lk-c gap"><span class="lk-a">Report</span></span> missing on an item that is already done or distributed</span>
        <span class="lk-key-i"><span class="lk-na">&ndash;</span> does not apply, or not due yet</span>
      </div>
      ${alerts(parent, kids, st)}
    </div>
  </div>`;
}

// ── PUSH ─────────────────────────────────────────────────────────────────────
// How many real gaps this project has, for the dot on the Links tool button.
// Counts ONLY gaps — an empty slot on an unfinished item is not something to
// chase, and a badge that lights up for every project is a badge nobody reads.
function linksGapCount(parent) {
  const st = parent.distro && typeof parent.distro === 'object' ? parent.distro : {};
  if (!st.fields || typeof st.fields !== 'object') st.fields = {};
  return (A.getChildren(parent.id) || [])
    .filter(k => !isDetached(k))
    .reduce((n, k) => n + ALL_COLS.filter(c => cellState(k, c, st).kind === 'gap').length, 0);
}

register({ linksPanelHtml, linksGapCount });
