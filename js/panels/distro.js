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
      fields: {},              // the few confirmed/edited variables
      step: 1                  // wizard: which step is currently expanded
    };
  }
  if (parent.distro.step === undefined) parent.distro.step = 1;
  return parent.distro;
}

// Video has a methods step (3) that guide skips, so step numbers are not fixed
// to a template — they are resolved through the active step list.
function stepList(st) {
  return st.template === 'video'
    ? ['template', 'subtasks', 'options', 'fields']
    : ['template', 'subtasks', 'fields'];
}
function stepIndex(st, name) { return stepList(st).indexOf(name) + 1; }

// The six Video distribution methods. `perAsset` ones repeat for each selected
// subtask; the rest are single. `field` names the variable the user pastes in.
const VIDEO_OPTIONS = [
  { id:'url',    label:'Custom URL',            perAsset:true,  field:'distUrl',    hint:'Paste distribution URL' },
  { id:'email',  label:'Distribute by email',   perAsset:true,  field:'distUrl',    hint:'Uses the same URL · thumbnail pasted in Gmail' },
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
    // The greeting addresses the PERSON, not the account — the client point of
    // contact. Falls back to the account name, then a placeholder, so the
    // greeting is never blank.
    contact:     f.contact     ?? (parent.clientContact || parent.clientAccount || ''),
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

// ── VIEW: wizard shell ───────────────────────────────────────────────────────
// One step expanded at a time. Completed steps collapse to a one-line summary
// you can click to reopen; later steps are locked until reached. Form on the
// left, live preview sticky on the right — horizontal space, not vertical.

// A collapsed summary bar. Clicking it makes that step active again.
function summaryBar(pid, n, label, value) {
  return `<button class="ds-sum" onclick="A.dsGoStep('${pid}',${n})">
    <span class="ds-sum-check">✓</span>
    <span class="ds-sum-label">${esc(label)}</span>
    <span class="ds-sum-value">${esc(value)}</span>
    <span class="ds-sum-edit">Edit</span>
  </button>`;
}

// A step frame: renders expanded body, collapsed summary, or a locked stub,
// depending on where the wizard currently is.
function stepFrame(pid, st, name, label, n, bodyFn, summaryFn) {
  const active = stepIndex(st, name);
  const cur = st.step;
  if (active < cur)  return summaryBar(pid, active, label, summaryFn());
  if (active > cur)  return `<div class="ds-locked"><span class="ds-num ds-num-off">${active}</span>${esc(label)}</div>`;
  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">${active}</span>${esc(label)}
      ${name === 'options' ? '<span class="ds-step-note">kept methods renumber automatically</span>' : ''}</div>
    ${bodyFn()}
    ${stepAdvance(pid, st, name)}
  </div>`;
}

// Steps with no natural "done" signal (you might add another deliverable or
// method) get an explicit advance button rather than auto-collapsing on a click.
function stepAdvance(pid, st, name) {
  if (name === 'fields') return '';   // last step, nothing to advance to
  const canAdvance =
    name === 'template' ? !!st.template :
    name === 'subtasks' ? st.subtaskIds.length > 0 :
    true;                              // options can be empty (all cut)
  if (name === 'template') return '';  // template auto-advances on pick
  return `<div class="ds-advance">
    <button class="ds-next" ${canAdvance ? '' : 'disabled'} onclick="A.dsGoStep('${pid}',${stepIndex(st,name)+1})">
      Continue</button>
  </div>`;
}

function templateBody(pid, st) {
  const opt = (val, label, sub) => `
    <button class="ds-tpl${st.template === val ? ' on' : ''}"
      onclick="A.dsSet('${pid}','template','${val}')">
      <div class="ds-tpl-h">${esc(label)}</div>
      <div class="ds-tpl-s">${esc(sub)}</div>
    </button>`;
  return `<div class="ds-tpls">
    ${opt('video', 'Microsite / Video', 'Full toolkit — six delivery methods')}
    ${opt('guide', 'Benefits Guide / Companion Piece', 'Short — download links + resolution key')}
  </div>`;
}

function subtaskBody(pid, parent, st) {
  const kids = A.getChildren(parent.id);
  if (!kids.length) return `<div class="ds-empty">This project has no subtasks to distribute.</div>`;
  return `<div class="ds-checks">${kids.map(k => {
    const on = st.subtaskIds.includes(k.id);
    return `<label class="ds-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.dsToggleSub('${pid}','${k.id}')">
      <span class="ds-check-box"></span>
      <span class="ds-check-nm">${esc(k.name)}</span>
      <span class="ds-check-m">${esc(k.productTier || k.productType || '')}</span>
    </label>`;
  }).join('')}</div>`;
}

function optionBody(pid, st) {
  return `<div class="ds-checks">${VIDEO_OPTIONS.map(o => {
    const on = !!st.options[o.id];
    return `<label class="ds-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="A.dsToggleOpt('${pid}','${o.id}')">
      <span class="ds-check-box"></span>
      <span class="ds-check-nm">${esc(o.label)}</span>
      <span class="ds-check-m">${esc(o.hint)}</span>
    </label>`;
  }).join('')}</div>`;
}

function fieldBody(pid, parent, st) {
  const pf = projectFields(parent, st);
  const inp = (scope, key, label, val, ph = '') =>
    `<label class="ds-f"><span class="ds-f-l">${esc(label)}</span>
      <input class="ds-in" value="${esc(val)}" placeholder="${esc(ph)}"
        oninput="A.dsField('${pid}','${scope}','${key}',this.value)"></label>`;

  const project = `<div class="ds-fgrid">
      ${inp('_', 'contact', 'Client contact (greeting)', pf.contact, 'Name in the greeting')}
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
      // Custom URL and Email are the SAME link, shown two ways in the output —
      // written out under Custom URL, hyperlinked under Email. So one field, not
      // two. Shown if either option is kept.
      if (st.options.url || st.options.email)
        rows.push(inp(k.id, 'distUrl', 'Distribution URL', st.fields[k.id]?.distUrl ?? af.preview, 'flimp.live/…'));
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

  return project + perAsset + aiField;
}

// Summaries shown when a step is collapsed.
function subtaskSummary(parent, st) {
  const names = A.getChildren(parent.id).filter(k => st.subtaskIds.includes(k.id)).map(k => k.name);
  return names.length ? `${names.length} deliverable${names.length > 1 ? 's' : ''} · ${names.join(', ')}` : 'None selected';
}
function optionSummary(st) {
  const kept = VIDEO_OPTIONS.filter(o => st.options[o.id]).map(o => o.label);
  return kept.length ? `${kept.length} method${kept.length > 1 ? 's' : ''} · ${kept.join(', ')}` : 'No methods';
}
const TPL_LABEL = { video: 'Microsite / Video', guide: 'Benefits Guide / Companion Piece' };

function distroPanelHtml(parent) {
  const st = distroState(parent);
  const pid = parent.id;
  const ready = st.template && st.subtaskIds.length;

  // Left column — the wizard.
  const steps = [
    stepFrame(pid, st, 'template', 'Template', 1,
      () => templateBody(pid, st), () => TPL_LABEL[st.template] || ''),
    st.template ? stepFrame(pid, st, 'subtasks', 'Deliverables', 2,
      () => subtaskBody(pid, parent, st), () => subtaskSummary(parent, st)) : '',
    st.template === 'video' ? stepFrame(pid, st, 'options', 'Distribution methods', 3,
      () => optionBody(pid, st), () => optionSummary(st)) : '',
    st.template ? stepFrame(pid, st, 'fields', 'Fill & confirm', stepIndex(st, 'fields'),
      () => fieldBody(pid, parent, st), () => 'Filled') : ''
  ].join('');

  // Right column — sticky live preview.
  const email = ready ? buildEmail(parent, st) : null;
  const preview = ready
    ? `<div class="ds-pv-bar">
         <button class="ds-copy" onclick="A.dsCopy('${pid}')">Copy for Gmail</button>
         <span class="ds-copy-note">Paste into a new Gmail message.</span>
       </div>
       <div class="ds-pv-scroll">
         <div class="ds-pv-subject"><span>Subject</span>${esc(email.subject)}</div>
         <div class="ds-preview">${email.html}</div>
       </div>`
    : `<div class="ds-pv-empty">
         <div class="ds-pv-empty-h">Your email will appear here</div>
         <div class="ds-pv-empty-b">Pick a template and at least one deliverable to start building.</div>
       </div>`;

  return `<div class="ds-split">
    <div class="ds-form">${steps}</div>
    <div class="ds-preview-col">${preview}</div>
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

    // ONE email. The greeting, resolution key, and sign-off appear once; only
    // the per-deliverable line (product name + download link) repeats, listed
    // under a single Final Files heading. Repeating the whole body per
    // deliverable — the old behaviour — was wrong.
    const items = selected.map(k => {
      const af = assetFields(k, st);
      return `<p><strong>${esc(af.productName)}:</strong> ${link(af.download, 'Click here')} to download.</p>`;
    }).join('');

    const productList = selected.map(k => esc(assetFields(k, st).productName)).join(', ');
    const key = BOILER.resolutionKey.map(([abbr, name, use]) =>
      `<div><strong style="color:#67E74E">${abbr}</strong> - ${esc(name)} - <em>${esc(use)}</em></div>`
    ).join('');

    body = `<p>Hi ${esc(pf.contact || '[Client Contact]')},</p>
      <p>Good news! Your <strong>${esc(clientName)} ${productList}</strong> ${selected.length > 1 ? 'are' : 'is'} ready to be distributed.</p>
      <p><strong style="color:#67E74E">&gt;&gt;</strong> <strong>Final Files</strong></p>
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
        return `<p><strong>Option ${n}: Custom URL</strong></p>` + selected.map(k => {
          const url = st.fields[k.id]?.distUrl || assetFields(k, st).preview;
          return `<p>${esc(assetFields(k, st).productName)}: ${url ? link(url, url) : '[URL]'}</p>`;
        }).join('');
      if (o.id === 'email')
        return `<p><strong>Option ${n}: Distribute by email</strong></p>
          <p>Copy and paste the image below to send from your email account with your own messaging, including the hyperlinked text in case the recipient's email doesn't display images.</p>` +
          selected.map(k => {
            const url = st.fields[k.id]?.distUrl || assetFields(k, st).preview;
            // The thumbnail is pasted into Gmail by hand — the panel can't hold
            // the image and shouldn't try. It leaves an unmistakable marker in
            // the right spot so the step is never forgotten or misplaced.
            return `<p>${link(url, `Open the ${clientName} ${assetFields(k,st).productName}`)}</p>
              <p style="border:1px dashed #C99A2E;background:#FBF4E3;color:#8A6410;padding:8px 12px;border-radius:4px;font-size:13px">
              ⬇ Paste the ${esc(assetFields(k,st).productName)} thumbnail image here</p>`;
          }).join('');
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

    body = `<p>Hi ${esc(pf.contact || '[Client Contact]')},</p>
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
  if (key === 'template') {
    // Custom URL, Email, and Embed are on for nearly every video distribution,
    // so default them on — you deselect the rare exception rather than select
    // the common case every time. Still deselectable; a 95%-true rule should
    // not remove the 5% escape hatch.
    st.options = val === 'video' ? { url: true, email: true, embed: true } : {};
    st.step = 2;
  }
  save(); A.render();
}
function dsGoStep(pid, n) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  distroState(r).step = n;
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

// Live field edits update the PREVIEW only — never a full re-render. A full
// re-render on every keystroke would destroy and recreate the input the user is
// typing into, and the caret would jump to a fresh element. So the value is
// written to state, and only the preview subtree is patched in place.
function dsField(pid, scope, key, val) {
  const r = db.rows.find(x => x.id === pid); if (!r) return;
  const st = distroState(r);
  if (scope === '_') st.fields[key] = val;
  else { st.fields[scope] = st.fields[scope] || {}; st.fields[scope][key] = val; }
  save();
  // Patch just the preview, in place. No A.render(), so focus is preserved.
  if (st.template && st.subtaskIds.length) {
    const email = buildEmail(r, st);
    const box = document.querySelector('.ds-preview');
    const subj = document.querySelector('.ds-pv-subject');
    if (box) box.innerHTML = email.html;
    if (subj) subj.innerHTML = `<span>Subject</span>${esc(email.subject)}`;
  }
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

register({ distroPanelHtml, dsSet, dsGoStep, dsToggleSub, dsToggleOpt, dsField, dsCopy });
