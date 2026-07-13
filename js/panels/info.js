// info.js — Info panel.
//
// The widest field surface in the app: every variable the other bento panels
// read from or write to. Two scopes share one panel:
//
//   PROJECT scope (parent row)  — accounts, contacts, OE window, commercial links.
//   ITEM scope (subtask row)    — identity, dates, links, classification,
//                                 vendors, financials.
//
// Scope is chosen from a rail down the left. The rail lists the project, then
// its subtasks, each with a signal-code lamp — so the rail doubles as a status
// readout for the whole project, not just navigation. That is what earns it the
// horizontal space instead of a plain <select>.
//
// STORAGE: these are the same columns the Subtasks panel edits. Editing
// `designer` here and editing it there touch one record. No sync layer needed —
// save() then A.render() is enough.
//
// COMPUTED FIELDS: margin (GP / revenue) and vendor cost total are derived, not
// entered, and render as read-only wells so they cannot be mistaken for inputs.
// Gross profit IS entered (it originates outside this tool), which means it can
// disagree with revenue minus vendor costs — when it does, the panel says so
// rather than silently carrying two contradictory numbers.

import { esc } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';
import {
  AM_LIST, OWNER_LIST, LANGUAGE_LIST, PRODUCT_TOPIC_LIST,
  PRODUCT_TYPE_LIST, PRODUCT_TIER_MAP, PRODUCT_STYLE_MAP,
  DESIGNER_LIST, ANIMATOR_LIST, VO_LIST
} from '../data/constants.js';

// Which row each project's Info panel is focused on. Keyed by parent id so two
// open panels don't fight over one global.
const _infoScope = {};

function setInfoScope(parentId, rowId) {
  _infoScope[parentId] = rowId;
  save();
  A.render();
}

function currentScopeId(parent) {
  const want = _infoScope[parent.id];
  if (!want || want === parent.id) return parent.id;
  // Fall back to the project if the remembered subtask was deleted under us.
  return A.getChildren(parent.id).some(k => k.id === want) ? want : parent.id;
}

// ── FIELD PRIMITIVES ─────────────────────────────────────────────────────────
// Every input routes through ufInfo(), so the activity log stays whole.

function txt(id, field, val, ph) {
  return `<input class="info-in" value="${esc(val || '')}" placeholder="${esc(ph || '')}"
    onchange="A.ufInfo('${id}','${field}',this.value)">`;
}

function num(id, field, val, ph) {
  return `<input class="info-in" type="number" value="${esc(val || '')}" placeholder="${esc(ph || '')}"
    onchange="A.ufInfo('${id}','${field}',this.value)">`;
}

function money(id, field, val) {
  return `<div class="info-money"><span class="info-money-sig">$</span>
    <input class="info-in info-in-money" type="number" step="1" value="${esc(val || '')}" placeholder="0"
      onchange="A.ufInfo('${id}','${field}',this.value)"></div>`;
}

function date(id, field, val) {
  return `<input class="info-in" type="date" value="${esc(val || '')}"
    onchange="A.ufInfo('${id}','${field}',this.value)">`;
}

function sel(id, field, val, list) {
  const opts = ['<option value="">—</option>'].concat(
    list.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`)
  );
  return `<select class="info-in" onchange="A.ufInfo('${id}','${field}',this.value)">${opts.join('')}</select>`;
}

// Product type is the root of the cascade — its own handler, not ufInfo.
function selType(id, val) {
  const opts = ['<option value="">—</option>'].concat(
    PRODUCT_TYPE_LIST.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`)
  );
  return `<select class="info-in" onchange="A.ufInfoType('${id}',this.value)">${opts.join('')}</select>`;
}

function link(id, field, val) {
  const href = val ? (/^https?:\/\//i.test(val) ? val : 'https://' + val) : '';
  const out = val
    ? `<a class="info-link-out" href="${esc(href)}" target="_blank" rel="noopener" title="Open">↗</a>`
    : '';
  return `<div class="info-link"><input class="info-in" value="${esc(val || '')}" placeholder="https://"
    onchange="A.ufInfo('${id}','${field}',this.value)">${out}</div>`;
}

function f(label, control, note) {
  return `<div class="info-f">
    <div class="info-lbl">${esc(label)}${note ? `<span class="info-note">${esc(note)}</span>` : ''}</div>
    ${control}
  </div>`;
}

function group(title, inner, cls) {
  return `<div class="info-g${cls ? ' ' + cls : ''}">
    <div class="info-gh">${esc(title)}</div>
    <div class="info-grid">${inner}</div>
  </div>`;
}

// ── COMPUTED ─────────────────────────────────────────────────────────────────

const n = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

function vendorCostTotal(r) {
  return n(r.designerCost) + n(r.animatorCost) + n(r.voCost)
       + n(r.otherVendor1Cost) + n(r.otherVendor2Cost);
}

const usd = v => '$' + Math.round(v).toLocaleString('en-US');

const well = (val, cls) => `<div class="info-well${cls ? ' ' + cls : ''}">${esc(val)}</div>`;

// ── VENDOR TABLE ─────────────────────────────────────────────────────────────
// Five rows of one shape (role · vendor · cost) — a table, not ten loose fields.
// Three roles bind to real rosters; the two "other" slots are free text because
// no roster exists for them.

function vendorRow(r, role, nameField, costField, list) {
  const nameCtl = list
    ? sel(r.id, nameField, r[nameField], list)
    : txt(r.id, nameField, r[nameField], 'Vendor name');
  return `<tr>
    <td class="info-v-role">${esc(role)}</td>
    <td>${nameCtl}</td>
    <td class="info-v-cost">${money(r.id, costField, r[costField])}</td>
  </tr>`;
}

function vendorTable(r) {
  return `<div class="info-g">
    <div class="info-gh">Vendors</div>
    <table class="info-vt">
      <thead><tr><th>Role</th><th>Vendor</th><th>Cost</th></tr></thead>
      <tbody>
        ${vendorRow(r, 'Designer',                'designer',     'designerCost',     DESIGNER_LIST)}
        ${vendorRow(r, 'Animator',                'animator',     'animatorCost',     ANIMATOR_LIST)}
        ${vendorRow(r, 'Voice Over',              'voArtist',     'voCost',           VO_LIST)}
        ${vendorRow(r, 'Other Vendor 1',          'otherVendor1', 'otherVendor1Cost', null)}
        ${vendorRow(r, 'Writer / Other Vendor 2', 'otherVendor2', 'otherVendor2Cost', null)}
      </tbody>
      <tfoot><tr>
        <td class="info-v-role">Total</td><td></td>
        <td class="info-v-total">${esc(usd(vendorCostTotal(r)))}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

// ── ITEM SCOPE ───────────────────────────────────────────────────────────────

function itemForm(r) {
  const tiers  = PRODUCT_TIER_MAP[r.productType]  || [];
  const styles = PRODUCT_STYLE_MAP[r.productType] || [];

  // Style is genuinely inapplicable for most product types — PRODUCT_STYLE_MAP
  // only covers Video, Presentation Video, and Microsite. An empty dropdown
  // would imply a choice exists. It doesn't; say so instead.
  const styleCtl = styles.length
    ? sel(r.id, 'productStyle', r.productStyle, styles)
    : well(r.productType ? 'No styles for this product type' : 'Select a product type first', 'info-well-na');

  const tierCtl = tiers.length
    ? sel(r.id, 'productTier', r.productTier, tiers)
    : well(r.productType ? 'No tiers for this product type' : 'Select a product type first', 'info-well-na');

  const rev = n(r.totalRevenue), gp = n(r.grossProfit), costs = vendorCostTotal(r);
  const margin = rev ? (gp / rev * 100).toFixed(1) + '%' : '—';

  // GP is entered, not computed — it can disagree with revenue minus vendor
  // costs. Surface the disagreement rather than carrying it silently.
  const gap = (rev - costs) - gp;
  const drift = rev && gp && Math.abs(gap) > 1;
  const driftMsg = drift
    ? `<div class="info-drift">Gross profit doesn't reconcile. Revenue minus vendor costs is
       ${esc(usd(rev - costs))}; entered gross profit is ${esc(usd(gp))} —
       ${esc(usd(Math.abs(gap)))} apart.</div>`
    : '';

  return [
    group('Identity',
      f('Item name',       txt(r.id, 'name', r.name)) +
      f('Item owner',      sel(r.id, 'itemOwner', r.itemOwner, OWNER_LIST)) +
      f('Account manager', sel(r.id, 'am', r.am, AM_LIST))
    ),
    group('Dates',
      f('Start date',       date(r.id, 'startDate', r.startDate)) +
      f('Due date',         date(r.id, 'due', r.due)) +
      f('Distributed date', date(r.id, 'distributionDate', r.distributionDate))
    ),
    group('Links',
      f('Final product (preview)', link(r.id, 'previewLink',      r.previewLink)) +
      f('Reporting permalink',     link(r.id, 'reportingLink',    r.reportingLink)) +
      f('ReviewStudio',            link(r.id, 'reviewStudioLink', r.reviewStudioLink)) +
      f('Dropbox',                 link(r.id, 'dropboxLink',      r.dropboxLink)) +
      f('Boords',                  link(r.id, 'boordsLink',       r.boordsLink)),
      'info-g-wide'
    ),
    group('Classification',
      f('Product type',    selType(r.id, r.productType)) +
      f('Product tier',    tierCtl) +
      f('Product style',   styleCtl) +
      f('Product topic',   sel(r.id, 'productTopic', r.productTopic, PRODUCT_TOPIC_LIST)) +
      f('New / update',    sel(r.id, 'newOrUpdate', r.newOrUpdate, ['New', 'Update'])) +
      f('Language',        sel(r.id, 'language', r.language, LANGUAGE_LIST)) +
      f('Rounds of edits', num(r.id, 'roundsOfEdits', r.roundsOfEdits, '0'))
    ),
    vendorTable(r),
    `<div class="info-g">
      <div class="info-gh">Financials</div>
      <div class="info-grid">
        ${f('Total revenue', money(r.id, 'totalRevenue', r.totalRevenue))}
        ${f('Gross profit',  money(r.id, 'grossProfit',  r.grossProfit))}
        ${f('Margin',            well(margin),     'computed')}
        ${f('Vendor cost total', well(usd(costs)), 'computed')}
      </div>
      ${driftMsg}
    </div>`
  ].join('');
}

// ── PROJECT SCOPE ────────────────────────────────────────────────────────────

function projectForm(r) {
  return [
    group('Project',
      f('Flimp project name',  txt(r.id, 'name', r.name)) +
      f('Flimp project owner', sel(r.id, 'projectOwner', r.projectOwner, OWNER_LIST))
    ),
    group('Accounts',
      f('Client account',          txt(r.id, 'clientAccount', r.clientAccount)) +
      f('Client point of contact', txt(r.id, 'clientContact', r.clientContact, 'Name · email')) +
      f('Broker account',          txt(r.id, 'brokerAccount', r.brokerAccount)) +
      f('Broker point of contact', txt(r.id, 'brokerContact', r.brokerContact, 'Name · email'))
    ),
    group('Open enrollment',
      f('OE start date', date(r.id, 'oeStart', r.oeStart)) +
      f('OE end date',   date(r.id, 'oeEnd',   r.oeEnd))
    ),
    group('Commercial',
      f('HubSpot deal link', link(r.id, 'hubspotLink',  r.hubspotLink)) +
      f('Estimate',          link(r.id, 'estimateLink', r.estimateLink)) +
      f('Invoice',           txt(r.id,  'invoiceRef',   r.invoiceRef, 'INV-0000')),
      'info-g-wide'
    )
  ].join('');
}

// ── RAIL ─────────────────────────────────────────────────────────────────────

function rail(parent, activeId) {
  const kids = A.getChildren(parent.id);
  const row = (r, isProject) => `
    <div class="info-rail-row${r.id === activeId ? ' active' : ''}"
         onclick="A.setInfoScope('${parent.id}','${r.id}')"
         role="button" tabindex="0" title="${esc(r.name)}">
      <span class="info-rail-dot is-${esc(r.status)}"></span>
      <span class="info-rail-name${isProject ? ' is-project' : ''}">${esc(r.name)}</span>
    </div>`;

  const kidRows = kids.length
    ? kids.map(k => row(k, false)).join('')
    : '<div class="info-rail-empty">No subtasks yet</div>';

  return `<div class="info-rail">
    ${row(parent, true)}
    <div class="info-rail-rule"></div>
    <div class="info-rail-cap">Subtasks</div>
    ${kidRows}
  </div>`;
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────
// Called by render() to build the panel body for one project block.

function infoPanelHtml(parent) {
  const activeId = currentScopeId(parent);
  const row = activeId === parent.id
    ? parent
    : (db.rows.find(x => x.id === activeId) || parent);
  const isProject = row.id === parent.id;

  return `<div class="info-layout">
    ${rail(parent, activeId)}
    <div class="info-surface">
      <div class="info-head">
        <div class="info-head-name">${esc(row.name || 'Untitled')}</div>
        <div class="info-head-scope">${isProject ? 'Project' : 'Project item'}</div>
      </div>
      ${isProject ? projectForm(row) : itemForm(row)}
    </div>
  </div>`;
}

// ── MUTATORS ─────────────────────────────────────────────────────────────────

// Generic field write. Re-renders because the computed fields (margin, vendor
// total) and the drift warning all depend on values that just changed.
function ufInfo(id, field, value) {
  const r = db.rows.find(x => x.id === id); if (!r) return;
  const old = r[field];
  if (old === value) return;
  r[field] = value;
  A.logActivity(r, field, old, value);
  save();
  A.render();
}

// Product type is the root of the cascade. Tier is keyed by type, and style is
// ALSO keyed by type (not type+tier) — so changing type invalidates both.
// Anything else leaves a Microsite carrying a Video's tier.
function ufInfoType(id, value) {
  const r = db.rows.find(x => x.id === id); if (!r) return;
  const old = r.productType;
  if (old === value) return;
  r.productType = value;
  if (r.productTier)  { A.logActivity(r, 'productTier',  r.productTier,  ''); r.productTier  = ''; }
  if (r.productStyle) { A.logActivity(r, 'productStyle', r.productStyle, ''); r.productStyle = ''; }
  A.logActivity(r, 'productType', old, value);
  save();
  A.render();
}

register({ infoPanelHtml, setInfoScope, ufInfo, ufInfoType, vendorCostTotal });
