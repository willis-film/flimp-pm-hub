// distro.js — Distribution panel.
//
// Assembles a client-ready distribution email from a template kit, fills the few
// real variables from project + subtask data, and emits clean copy for Gmail.
//
// The templates are not flat merges. They carry THREE kinds of content, and the
// panel's real job is telling them apart:
//
//   1. MERGE FIELDS — the few things that vary per send (client, product, links).
//   2. OPTIONAL BLOCKS — the Video template's six distribution methods; each is
//      independently kept or cut, and the kept ones RENUMBER so the client never
//      sees "Option 1, Option 4".
//   3. INSTRUCTIONS-TO-SELF — "REPLACE THIS HYPERLINK", "REMOVE IF NOT NEEDED".
//      These must NEVER reach the client. Stripping them is the whole value over
//      pasting the raw template.
//
// Two templates, genuinely different shapes — not variants of one body:
//   • video      — the option kit (six methods, embed codes, per-asset links)
//   • guide      — short: greeting, "ready", a download link per deliverable,
//                  the static HR/LR/PR resolution key, sign-off.
//
// Both select subtasks, both repeat per deliverable:
//   • guide → each deliverable gets its own named download link
//   • video → each deliverable's per-asset fields (URL, embed, report) repeat
//
// COPY PATH ONLY. No Gmail auth. Emits rich HTML to the clipboard; a "create
// Gmail draft" button slots in later beside Copy when OAuth lands. The template
// work done here carries straight over.

import { esc } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

// ── STATIC BOILERPLATE ───────────────────────────────────────────────────────
// The strings that never change per-send live here, in one block, so they can be
// edited without hunting through render logic. These carry real URLs that drift
// over time (Resource Center, Reporting Metrics) — when they change, change them
// HERE, once.
const BOILER = {
  resourceCenter: 'https://flimp.live/Distribution-Resource-Center',
  metricsExplained: 'https://flimp.live/ReportingMetricsExplained',
  resolutionKey: [
    ['HR', 'High Resolution', 'Office Printing and Online viewing'],
    ['LR', 'Low Resolution',  'Sending in emails, and quick site uploads'],
    ['PR', 'Print Ready',     'For professional printing']
  ],
  signoffTeam: 'and The Flimp Team'
};

// ── PANEL STATE ──────────────────────────────────────────────────────────────
// Held on the parent row under `distro`, so a half-built email survives a panel
// switch. Not a stored artifact — just working state for the current draft.
function distroState(parent) {
  if (!parent.distro) {
    parent.distro = {
      template: '',            // 'video' | 'guide'
      subtaskIds: [],          // which deliverables are in this send
      options: {},             // video only: which of the 6 methods are kept
      fields: {}               // the few confirmed/edited variables
    };
  }
  return parent.distro;
}

// The six Video distribution methods. `perAsset` ones repeat for each selected
// subtask; the rest are single. `field` names the variable the user pastes in.
const VIDEO_OPTIONS = [
  { id:'url',    label:'Custom URL',            perAsset:true,  field:'customUrl',  hint:'Paste distribution URL' },
  { id:'email',  label:'Distribute by email',   perAsset:true,  field:'emailUrl',   hint:'Paste URL + thumbnail' },
  { id:'embed',  label:'Embed (iFrame)',        perAsset:true,  field:'embedCode',  hint:'Paste embed code' },
  { id:'qr',     label:'QR Code',               perAsset:false, field:null,         hint:'Attached to the email' },
  { id:'mp4',    label:'MP4 download',          perAsset:true,  field:'mp4Link',    hint:'Paste MP4 link' },
  { id:'ai',     label:'Benefits AI Agent',     perAsset:false, field:'aiLink',     hint:'Paste chatbot + report links' }
];

// ── FIELD RESOLUTION ─────────────────────────────────────────────────────────
// Pull what we can from the project + subtask rows; the user confirms/overrides.
// Anything already on the row pre-fills so the form is mostly a double-check, not
// data entry — exactly the "few fields" the panel promises.

function projectFields(parent, st) {
  const f = st.fields;
  return {
    clientName:  f.clientName  ?? (parent.clientAccount || parent.name || ''),
    yourName:    f.yourName    ?? (parent.projectOwner || ''),
    reportLink:  f.reportLink  ?? (parent.reportingLink || '')
  };
}

function assetFields(kid, st) {
  const f = st.fields[kid.id] || {};
  return {
    productName: f.productName ?? kid.name,
    download:    f.download    ?? (kid.dropboxLink || ''),
    preview:     f.preview     ?? (kid.previewLink || ''),
    report:      f.report      ?? (kid.reportingLink || '')
  };
}

// ── VIEW: the builder ────────────────────────────────────────────────────────

function templatePick(pid, st) {
  const opt = (val, label, sub) => `
    <button class="ds-tpl${st.template === val ? ' on' : ''}"
      onclick="A.dsSet('${pid}','template','${val}')">
      <div class="ds-tpl-h">${esc(label)}</div>
      <div class="ds-tpl-s">${esc(sub)}</div>
    </button>`;
  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">1</span>Template</div>
    <div class="ds-tpls">
      ${opt('video', 'Microsite / Video', 'Full distribution toolkit — six delivery methods')}
      ${opt('guide', 'Benefits Guide / Companion Piece', 'Short — download links and resolution key')}
    </div>
  </div>`;
}

function subtaskPick(pid, parent, st) {
  const kids = A.getChildren(parent.id);
  if (!kids.length) {
    return `<div class="ds-step"><div class="ds-step-h"><span class="ds-num">2</span>Deliverables</div>
      <div class="ds-empty">This project has no subtasks to distribute.</div></div>`;
  }
  const rows = kids.map(k => {
    const on = st.subtaskIds.includes(k.id);
    return `<label class="ds-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.dsToggleSub('${pid}','${k.id}')">
      <span class="ds-check-box"></span>
      <span class="ds-check-nm">${esc(k.name)}</span>
      <span class="ds-check-m">${esc(k.productTier || k.productType || '')}</span>
    </label>`;
  }).join('');
  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">2</span>Deliverables in this email</div>
    <div class="ds-checks">${rows}</div>
  </div>`;
}

function optionPick(pid, st) {
  if (st.template !== 'video') return '';   // guide has no options
  const rows = VIDEO_OPTIONS.map(o => {
    const on = !!st.options[o.id];
    return `<label class="ds-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.dsToggleOpt('${pid}','${o.id}')">
      <span class="ds-check-box"></span>
      <span class="ds-check-nm">${esc(o.label)}</span>
      <span class="ds-check-m">${esc(o.hint)}</span>
    </label>`;
  }).join('');
  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">3</span>Distribution methods
      <span class="ds-step-note">kept methods renumber automatically</span></div>
    <div class="ds-checks">${rows}</div>
  </div>`;
}

// The few real variables. Project-level first, then per-asset for each selected
// subtask (that is where the "repeat per deliverable" lives).
function fieldFill(pid, parent, st) {
  const stepNo = st.template === 'video' ? 4 : 3;
  const pf = projectFields(parent, st);
  const inp = (scope, key, label, val, ph = '') =>
    `<label class="ds-f"><span class="ds-f-l">${esc(label)}</span>
      <input class="ds-in" value="${esc(val)}" placeholder="${esc(ph)}"
        onchange="A.dsField('${pid}','${scope}','${key}',this.value)"></label>`;

  const project = `
    <div class="ds-fgrid">
      ${inp('_', 'clientName', 'Client name', pf.clientName)}
      ${inp('_', 'yourName', 'Your name', pf.yourName)}
      ${inp('_', 'reportLink', 'Reporting link', pf.reportLink, 'https://flimp.cloud/…')}
    </div>`;

  const selected = A.getChildren(parent.id).filter(k => st.subtaskIds.includes(k.id));
  const perAsset = selected.map(k => {
    const af = assetFields(k, st);
    const rows = [inp(k.id, 'productName', 'Product name', af.productName)];
    if (st.template === 'guide') {
      rows.push(inp(k.id, 'download', 'Download link', af.download, 'Dropbox / files URL'));
    } else {
      // Video: only show the fields the KEPT options actually need.
      if (st.options.url)   rows.push(inp(k.id, 'customUrl', 'Custom URL', st.fields[k.id]?.customUrl ?? af.preview));
      if (st.options.email) rows.push(inp(k.id, 'emailUrl', 'Email URL', st.fields[k.id]?.emailUrl ?? af.preview));
      if (st.options.embed) rows.push(inp(k.id, 'embedCode', 'Embed code', st.fields[k.id]?.embedCode ?? ''));
      if (st.options.mp4)   rows.push(inp(k.id, 'mp4Link', 'MP4 link', st.fields[k.id]?.mp4Link ?? ''));
    }
    return `<div class="ds-asset"><div class="ds-asset-h">${esc(k.name)}</div>
      <div class="ds-fgrid">${rows.join('')}</div></div>`;
  }).join('');

  const aiField = (st.template === 'video' && st.options.ai)
    ? `<div class="ds-asset"><div class="ds-asset-h">Benefits AI Agent</div>
        <div class="ds-fgrid">
          ${inp('_', 'aiLink', 'AI agent link', st.fields.aiLink ?? '', 'https://flimp.live/…-chatbot')}
          ${inp('_', 'aiReport', 'AI report link', st.fields.aiReport ?? '', 'https://flimp.cloud/…')}
        </div></div>`
    : '';

  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">${stepNo}</span>Fill &amp; confirm</div>
    ${project}
    ${perAsset}
    ${aiField}
  </div>`;
}

function distroPanelHtml(parent) {
  const st = distroState(parent);
  const ready = st.template && st.subtaskIds.length;

  return `<div class="ds-panel">
    ${templatePick(parent.id, st)}
    ${st.template ? subtaskPick(parent.id, parent, st) : ''}
    ${st.template ? optionPick(parent.id, st) : ''}
    ${ready ? fieldFill(parent.id, parent, st) : ''}
    ${ready ? `<div class="ds-actions">
      <button class="ds-copy" onclick="A.dsCopy('${parent.id}')">Copy for Gmail</button>
      <span class="ds-copy-note">Paste into a new Gmail message. Formatting and links carry over.</span>
    </div>
    <div class="ds-preview-wrap">
      <div class="ds-preview-h">Preview</div>
      <div class="ds-preview" id="ds-preview-${parent.id}">${buildEmail(parent, st).html}</div>
    </div>` : `<div class="ds-hint">Pick a template and at least one deliverable to build the email.</div>`}
  </div>`;
}

// ── EMAIL ASSEMBLY ───────────────────────────────────────────────────────────
// Produces the final HTML. Every instruction-to-self is gone by construction —
// they exist nowhere in this builder, only in the original template doc. Options
// are renumbered from the KEPT set, so numbering is always 1..n with no gaps.

function link(href, text) {
  const h = href && !/^https?:\/\//i.test(href) ? 'https://' + href : href;
  return h ? `<a href="${esc(h)}">${esc(text)}</a>` : esc(text);
}

function buildEmail(parent, st) {
  const pf = projectFields(parent, st);
  const selected = A.getChildren(parent.id).filter(k => st.subtaskIds.includes(k.id));
  const clientName = pf.clientName || '[Client Name]';

  let subject, body;

  if (st.template === 'guide') {
    subject = `${clientName} Distribution Toolkit`;
    const items = selected.map(k => {
      const af = assetFields(k, st);
      // Each deliverable gets its OWN named download link — the repeat rule for
      // this template.
      return `<p>Good news! Your <strong>${esc(clientName)} ${esc(af.productName)}</strong> is ready to be distributed.</p>
        <p><strong style="color:#67E74E">&gt;&gt;</strong> <strong>Final Files</strong></p>
        <p>${link(af.download, 'Click here')} to download your files.</p>`;
    }).join('');

    const key = BOILER.resolutionKey.map(([abbr, name, use]) =>
      `<div><strong style="color:#67E74E">${abbr}</strong> - ${esc(name)} - <em>${esc(use)}</em></div>`
    ).join('');

    body = `<p>Hi ${esc(clientName)},</p>
      ${items}
      <p>${key}</p>
      <p>Please let us know if you have any questions or need anything else.</p>
      <p>Thank you!<br>${esc(pf.yourName || '[Your Name]')} ${BOILER.signoffTeam}</p>`;
  } else {
    // VIDEO — the option kit.
    const productList = selected.map(k => esc(assetFields(k, st).productName)).join(', ');
    subject = `${clientName} ${productList} Distribution Toolkit`;

    const H = t => `<p><strong style="color:#67E74E">&gt;&gt;</strong> <strong>${t}</strong></p>`;

    // Kept options only, renumbered 1..n.
    const kept = VIDEO_OPTIONS.filter(o => st.options[o.id]);
    let n = 0;
    const optionBlocks = kept.map(o => {
      n++;
      if (o.id === 'url')
        return `<p><strong>Option ${n}: Custom URL</strong></p>` + selected.map(k =>
          `<p>${esc(assetFields(k, st).productName)}: ${link(st.fields[k.id]?.customUrl || assetFields(k, st).preview, st.fields[k.id]?.customUrl || assetFields(k, st).preview || '[URL]')}</p>`).join('');
      if (o.id === 'email')
        return `<p><strong>Option ${n}: Distribute by email</strong></p>
          <p>Copy and paste the image below to send from your email account with your own messaging, including the hyperlinked text in case the recipient's email doesn't display images.</p>` +
          selected.map(k => `<p>${link(st.fields[k.id]?.emailUrl || assetFields(k,st).preview, `Open the ${clientName} ${assetFields(k,st).productName}`)}</p>`).join('');
      if (o.id === 'embed')
        return `<p><strong>Option ${n}: Embed into a website, intranet or portal</strong></p>
          <p>Send the iFrame code below to your IT team to embed the content directly within a web page, intranet or portal.</p>` +
          selected.map(k => `<pre style="background:#f4f6f8;padding:8px;border-radius:4px">${esc(st.fields[k.id]?.embedCode || '[Embed code]')}</pre>`).join('') +
          `<p><em>Note on Resizing: You can adjust the height and width of the content in the code but be sure to maintain proportions to avoid distortion.</em></p>`;
      if (o.id === 'qr')
        return `<p><strong>Option ${n}: QR Code</strong> (attached to this email)</p>`;
      if (o.id === 'mp4')
        return `<p><strong>Option ${n}: Download the MP4 file</strong></p>` +
          selected.map(k => `<p>${link(st.fields[k.id]?.mp4Link, 'Click here')} to download.</p>`).join('') +
          `<p><em>Please note that by using the MP4 file, you forgo the engagement metrics tracked by the Flimp URL and embed code.</em></p>`;
      if (o.id === 'ai')
        return `<p><strong>Option ${n}: Employee Benefits AI Agent</strong></p>
          <p>Here is the external link to your Employee Benefits AI Agent: ${link(st.fields.aiLink, st.fields.aiLink || '[AI link]')}</p>
          ${H('AI Agent Reporting')}
          <p>Here's your ${link(st.fields.aiReport, 'shareable, real-time tracking report to monitor engagement')}.</p>`;
      return '';
    }).join('');

    body = `<p>Hi ${esc(clientName)},</p>
      <p>Good news! Your <strong>${esc(clientName)} ${productList}</strong> is ready to be distributed.</p>
      ${H('Reporting')}
      <p>Here's your ${link(pf.reportLink, 'shareable, real-time tracking report to monitor engagement')}.</p>
      ${H('Distribution Resource Center &amp; Reporting Metrics Explained')}
      <p>Visit our ${link(BOILER.resourceCenter, 'Distribution Resource Center')} and ${link(BOILER.metricsExplained, 'Reporting Metrics Explained')} for best practices, distribution methods, FAQs, and reporting dashboard explanations.</p>
      ${H('Distribution Options')}
      ${optionBlocks || '<p><em>No distribution methods selected.</em></p>'}
      ${H('Real-Time Updates')}
      <p>All updates made to your content after sending will automatically update, so you do not have to resend. This includes videos and linked documents.</p>
      ${H('Questions')}
      <p>For distribution or reporting questions, please contact me. For project-specific needs or to scope a new project, contact your account manager directly.</p>
      <p>Thank you!<br>${esc(pf.yourName || '[Your Name]')} ${BOILER.signoffTeam}</p>`;
  }

  return { subject, html: body };
}

// ── MUTATORS ─────────────────────────────────────────────────────────────────

function dsSet(pid, key, val) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = distroState(r);
  st[key] = val;
  // Switching template invalidates option/field choices tied to the old one.
  if (key === 'template') { st.options = {}; }
  save(); A.render();
}
function dsToggleSub(pid, kidId) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = distroState(r);
  const i = st.subtaskIds.indexOf(kidId);
  if (i >= 0) st.subtaskIds.splice(i, 1); else st.subtaskIds.push(kidId);
  save(); A.render();
}
function dsToggleOpt(pid, optId) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = distroState(r);
  st.options[optId] = !st.options[optId];
  save(); A.render();
}
function dsField(pid, scope, key, val) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = distroState(r);
  if (scope === '_') st.fields[key] = val;
  else { st.fields[scope] = st.fields[scope] || {}; st.fields[scope][key] = val; }
  // Re-render so the preview tracks the edit.
  save(); A.render();
}

function dsCopy(pid) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const { subject, html } = buildEmail(r, distroState(r));
  // Rich copy: write HTML so Gmail keeps links and formatting on paste.
  const full = `<p><strong>Subject:</strong> ${esc(subject)}</p><hr>${html}`;
  try {
    const blob = new Blob([full], { type: 'text/html' });
    const plain = new Blob([full.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
    navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': plain })]);
    A.toast && A.toast('Email copied — paste into Gmail');
  } catch (e) {
    // Fallback for browsers without ClipboardItem.
    navigator.clipboard.writeText(full.replace(/<[^>]+>/g, ''));
  }
}

register({ distroPanelHtml, dsSet, dsToggleSub, dsToggleOpt, dsField, dsCopy });
