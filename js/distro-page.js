// distro-page.js — the Distribution Generator, as a standalone page.
//
// This is the Distro panel (js/panels/distro.js) lifted out of the hub and made
// to stand on its own. The email assembly is the same work: a template kit, a
// handful of real variables, optional blocks that renumber when cut, and no
// instructions-to-self ever reaching the client.
//
// WHAT CHANGED IN THE MOVE — and it is only one thing, but it runs through
// everything below: THERE IS NO PROJECT. The panel version read the client
// name, contact, deliverable names, Dropbox links, preview URLs and reporting
// links off the project row and its subtasks, and asked the user only to
// confirm them. This page has no rows to read, so every one of those is typed
// in. Deliverables are added by hand rather than ticked off a subtask list.
//
// Consequences worth knowing before editing:
//   • No import from store.js, bus.js, render.js or utils.js. Nothing here
//     touches /api/db, and nothing here can write to the board. `esc` is
//     redefined locally (six lines) rather than imported, so this file has no
//     module graph at all beyond itself. That is deliberate — a standalone page
//     that quietly depends on the hub's data layer is not standalone.
//   • Because of that, distro.html loads this as a PLAIN script, not a module,
//     and it must stay loadable that way: no `import`, no `export`, no
//     top-level await. The payoff is that the page opens by double-clicking
//     the HTML file — a module would be blocked by CORS on a file:// origin
//     and the page would render as a header above nothing. See the script tag
//     in distro.html.
//   • Draft state lives in localStorage, not Supabase. It is per-browser
//     working state for the email you are building right now, exactly as the
//     panel's `parent.distro` was — not a record of what was sent.
//   • A deliverable carries its own `kind` ('video' | 'guide'). The panel
//     derived this from the subtask's productType; here you pick it, because
//     it decides whether the item gets the video option kit or a download link
//     and the resolution key.
//
// COPY PATH ONLY. No Gmail auth. Emits rich HTML to the clipboard.

// ── LOCAL ESCAPE ─────────────────────────────────────────────────────────────
// Deliberately not imported from utils.js — see the standalone note above.
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// `crypto.randomUUID` is secure-context only. file:// counts as secure in
// Chrome, but not in every browser, so this probes for the whole `crypto`
// object rather than assuming it exists — a bare `crypto.randomUUID` would
// throw a ReferenceError and take the page down before it drew anything.
function newId() {
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 6)
    : Math.random().toString(36).slice(2, 8);
  return 'd' + Date.now().toString(36) + '-' + rand;
}

// ── STATIC BOILERPLATE ───────────────────────────────────────────────────────
// The strings that never change per-send. These carry real URLs that drift over
// time (Resource Center, Reporting Metrics) — when they change, change them
// HERE, once. Kept identical to the panel version so both produce the same
// email while they coexist.
const BOILER = {
  resourceCenter: 'https://flimp.live/Distribution-Resource-Center',
  metricsExplained: 'https://flimp.live/ReportingMetricsExplained',
  resolutionKey: [
    ['HR', 'High Resolution', 'Office Printing and Online viewing'],
    ['LR', 'Low Resolution',  'Sending in emails, and quick site uploads'],
    ['PR', 'Print Ready',     'For professional printing']
  ],
  signoffTeam: 'and The Flimp Team',
  // The signature is always the same person; never ask for it.
  signoffName: 'Willis'
};

// The six Video distribution methods. `perAsset` ones repeat for each video
// deliverable; the rest are single.
const VIDEO_OPTIONS = [
  { id:'url',    label:'Custom URL',            perAsset:true,  hint:'Paste distribution URL' },
  { id:'email',  label:'Distribute by email',   perAsset:true,  hint:'Uses the same URL · thumbnail pasted in Gmail' },
  { id:'embed',  label:'Embed (iFrame)',        perAsset:true,  hint:'Paste embed code' },
  { id:'qr',     label:'QR Code',               perAsset:false, hint:'Attached to the email' },
  { id:'mp4',    label:'MP4 download',          perAsset:true,  hint:'Paste MP4 link' },
  { id:'ai',     label:'Benefits AI Agent',     perAsset:false, hint:'Paste chatbot + report links' }
];

const TPL_LABEL = {
  video: 'Microsite / Video',
  guide: 'Benefits Guide / Companion Piece'
};

const KIND_LABEL = {
  video: 'Microsite / Video',
  guide: 'Benefits Guide / Companion Piece'
};

// ── STATE ────────────────────────────────────────────────────────────────────
// One draft, held in localStorage so a half-built email survives a reload or an
// accidental tab close. Nothing here is sent anywhere.

const LS_KEY = 'flimp_distro_standalone';

function blankState() {
  return {
    template: '',      // 'video' | 'guide'
    step: 1,           // wizard: expanded step
    contact: '',       // greeting — the person, not the account
    clientName: '',
    options: {},       // video only: kept methods
    items: [],         // deliverables, entered by hand
    aiLink: '',
    aiReport: ''
  };
}

let st = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return blankState();
    const saved = JSON.parse(raw);
    // Merge over a blank rather than trusting the stored shape. A draft saved
    // by an older version of this page is missing whatever was added since,
    // and a missing `items` array would throw on first render.
    const s = Object.assign(blankState(), saved);
    if (!Array.isArray(s.items)) s.items = [];
    if (!s.options || typeof s.options !== 'object') s.options = {};
    s.items = s.items.map(it => Object.assign(blankItem(), it));
    return s;
  } catch (e) {
    console.error('distro-page: could not read saved draft, starting fresh:', e);
    return blankState();
  }
}

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(st));
  } catch (e) {
    // Quota or private-mode failure. The draft still works in memory for this
    // session; only persistence is lost, so say so once rather than silently.
    console.error('distro-page: draft could not be saved to this browser:', e);
  }
}

function blankItem() {
  return {
    id: newId(),
    name: '',
    kind: 'video',   // 'video' | 'guide' — decides the treatment in the email
    download: '',    // guide items: the file link
    distUrl: '',     // video items: the distribution URL (Custom URL + Email)
    embedCode: '',
    mp4Link: '',
    reportLink: ''
  };
}

// ── WIZARD SHELL ─────────────────────────────────────────────────────────────
// One step expanded at a time. Completed steps collapse to a one-line summary
// you can click to reopen; later steps are locked until reached. Form on the
// left, live preview sticky on the right.
//
// Video has a methods step that guide skips, so step numbers are not fixed to a
// template — they are resolved through the active step list.

function stepList() {
  return st.template === 'video'
    ? ['template', 'items', 'options', 'fields']
    : ['template', 'items', 'fields'];
}
function stepIndex(name) { return stepList().indexOf(name) + 1; }

function summaryBar(n, label, value) {
  return `<button class="ds-sum" onclick="DS.goStep(${n})">
    <span class="ds-sum-check">✓</span>
    <span class="ds-sum-label">${esc(label)}</span>
    <span class="ds-sum-value">${esc(value)}</span>
    <span class="ds-sum-edit">Edit</span>
  </button>`;
}

function stepFrame(name, label, bodyFn, summaryFn) {
  const active = stepIndex(name);
  const cur = st.step;
  if (active < cur) return summaryBar(active, label, summaryFn());
  if (active > cur) return `<div class="ds-locked"><span class="ds-num ds-num-off">${active}</span>${esc(label)}</div>`;
  const note = name === 'options'
    ? '<span class="ds-step-note">kept methods renumber automatically</span>'
    : name === 'items'
      ? '<span class="ds-step-note">add one row per thing you are sending</span>'
      : '';
  return `<div class="ds-step">
    <div class="ds-step-h"><span class="ds-num">${active}</span>${esc(label)}${note}</div>
    ${bodyFn()}
    ${stepAdvance(name)}
  </div>`;
}

// Steps with no natural "done" signal (you might add another deliverable or
// method) get an explicit advance button rather than auto-collapsing on a click.
function stepAdvance(name) {
  if (name === 'fields') return '';    // last step, nothing to advance to
  if (name === 'template') return '';  // template auto-advances on pick
  const canAdvance =
    name === 'items' ? namedItems().length > 0 :
    true;                              // options can be empty (all cut)
  return `<div class="ds-advance">
    <button class="ds-next" ${canAdvance ? '' : 'disabled'} onclick="DS.goStep(${stepIndex(name) + 1})">
      Continue</button>
  </div>`;
}

// A row with no name yet is a row you are still typing into, not a deliverable.
// Everything downstream — the preview, the Continue gate, the field list —
// counts only named ones, so an empty row never produces "[blank]: Click here".
function namedItems() { return st.items.filter(i => i.name.trim()); }

// ── STEP BODIES ──────────────────────────────────────────────────────────────

function templateBody() {
  const opt = (val, label, sub) => `
    <button class="ds-tpl${st.template === val ? ' on' : ''}" onclick="DS.setTemplate('${val}')">
      <div class="ds-tpl-h">${esc(label)}</div>
      <div class="ds-tpl-s">${esc(sub)}</div>
    </button>`;
  return `<div class="ds-tpls">
    ${opt('video', TPL_LABEL.video, 'Full toolkit — six delivery methods')}
    ${opt('guide', TPL_LABEL.guide, 'Short — download links + resolution key')}
  </div>`;
}

// The deliverables step — this is the one that has no equivalent in the panel.
// There, you ticked subtasks off the project. Here you type them.
function itemsBody() {
  const rows = st.items.map((it, i) => {
    // The guide template treats everything as a guide, so the kind picker is
    // noise there — it only appears on the video template, where the choice
    // actually changes the output (option kit vs download + resolution key).
    const kindPicker = st.template === 'video'
      ? `<select class="ds-in ds-kind" data-fk="item:${it.id}:kind"
           onchange="DS.setItem('${it.id}','kind',this.value)">
           <option value="video"${it.kind === 'video' ? ' selected' : ''}>${esc(KIND_LABEL.video)}</option>
           <option value="guide"${it.kind === 'guide' ? ' selected' : ''}>${esc(KIND_LABEL.guide)}</option>
         </select>`
      : '';
    return `<div class="ds-item-row">
      <span class="ds-item-n">${i + 1}</span>
      <input class="ds-in ds-item-nm" value="${esc(it.name)}" data-fk="item:${it.id}:name"
        placeholder="Deliverable name — e.g. 2026 Benefits Overview Video"
        oninput="DS.setItemLive('${it.id}','name',this.value)">
      ${kindPicker}
      <button class="ds-item-x" title="Remove this deliverable"
        onclick="DS.removeItem('${it.id}')">✕</button>
    </div>`;
  }).join('');

  const empty = st.items.length ? '' :
    `<div class="ds-empty">No deliverables yet — add the first one below.</div>`;

  return `<div class="ds-items">${empty}${rows}
    <button class="ds-add" onclick="DS.addItem()">+ Add deliverable</button>
  </div>`;
}

function optionBody() {
  return `<div class="ds-checks">${VIDEO_OPTIONS.map(o => {
    const on = !!st.options[o.id];
    return `<label class="ds-check${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="DS.toggleOpt('${o.id}')">
      <span class="ds-check-box"></span>
      <span class="ds-check-nm">${esc(o.label)}</span>
      <span class="ds-check-m">${esc(o.hint)}</span>
    </label>`;
  }).join('')}</div>`;
}

// Everything in this step used to be pre-filled off the project and its
// subtasks, with the user only confirming. Standalone, it is all typed — so the
// placeholders carry the shape of what belongs in each box.
function fieldBody() {
  const inp = (fk, onInput, label, val, ph = '') =>
    `<label class="ds-f"><span class="ds-f-l">${esc(label)}</span>
      <input class="ds-in" value="${esc(val)}" placeholder="${esc(ph)}"
        data-fk="${esc(fk)}" oninput="${onInput}"></label>`;

  const project = `<div class="ds-fgrid">
      ${inp('f:contact', `DS.setField('contact',this.value)`, 'Client contact (greeting)', st.contact, 'Name in the greeting')}
      ${inp('f:clientName', `DS.setField('clientName',this.value)`, 'Client name', st.clientName, 'e.g. Grange Insurance')}
    </div>`;

  const perAsset = namedItems().map(it => {
    const guideItem = st.template === 'guide' || it.kind === 'guide';
    const rows = [];
    if (guideItem) {
      rows.push(inp(`item:${it.id}:download`, `DS.setItemLive('${it.id}','download',this.value)`,
        'Download link', it.download, 'Dropbox / files URL'));
    } else {
      // Custom URL and Email are the SAME link, shown two ways in the output —
      // written out under Custom URL, hyperlinked under Email. So one field, not
      // two. Shown if either option is kept.
      if (st.options.url || st.options.email)
        rows.push(inp(`item:${it.id}:distUrl`, `DS.setItemLive('${it.id}','distUrl',this.value)`,
          'Distribution URL', it.distUrl, 'flimp.live/…'));
      if (st.options.embed)
        rows.push(inp(`item:${it.id}:embedCode`, `DS.setItemLive('${it.id}','embedCode',this.value)`,
          'Embed code', it.embedCode, '<iframe …>'));
      if (st.options.mp4)
        rows.push(inp(`item:${it.id}:mp4Link`, `DS.setItemLive('${it.id}','mp4Link',this.value)`,
          'MP4 link', it.mp4Link, 'Download URL'));
      // The output hyperlinks the item title, not the bare URL — see buildEmail.
      rows.push(inp(`item:${it.id}:reportLink`, `DS.setItemLive('${it.id}','reportLink',this.value)`,
        'Reporting link', it.reportLink, 'flimp.cloud/…'));
    }
    // The Video/Guide tag is a reminder of a choice made a step earlier — so it
    // only earns its place on the video template, where the two kinds actually
    // sit side by side. On the guide template everything is a guide and the tag
    // just repeats the word already in the heading.
    const kindTag = st.template === 'video'
      ? `<span class="ds-asset-kind">${guideItem ? 'Guide' : 'Video'}</span>` : '';
    return `<div class="ds-asset">
      <div class="ds-asset-h">${esc(it.name)}${kindTag}</div>
      <div class="ds-fgrid">${rows.join('')}</div></div>`;
  }).join('');

  const aiField = (st.template === 'video' && st.options.ai)
    ? `<div class="ds-asset"><div class="ds-asset-h">Benefits AI Agent</div>
        <div class="ds-fgrid">
          ${inp('f:aiLink', `DS.setField('aiLink',this.value)`, 'AI agent link', st.aiLink, 'https://flimp.live/…-chatbot')}
          ${inp('f:aiReport', `DS.setField('aiReport',this.value)`, 'AI report link', st.aiReport, 'https://flimp.cloud/…')}
        </div></div>`
    : '';

  return project + perAsset + aiField;
}

// Summaries shown when a step is collapsed.
function itemSummary() {
  const names = namedItems().map(i => i.name);
  return names.length
    ? `${names.length} deliverable${names.length > 1 ? 's' : ''} · ${names.join(', ')}`
    : 'None added';
}
function optionSummary() {
  const kept = VIDEO_OPTIONS.filter(o => st.options[o.id]).map(o => o.label);
  return kept.length ? `${kept.length} method${kept.length > 1 ? 's' : ''} · ${kept.join(', ')}` : 'No methods';
}

// ── PAGE RENDER ──────────────────────────────────────────────────────────────

function pageHtml() {
  const ready = st.template && namedItems().length;

  const steps = [
    stepFrame('template', 'Template', templateBody, () => TPL_LABEL[st.template] || ''),
    st.template ? stepFrame('items', 'Deliverables', itemsBody, itemSummary) : '',
    st.template === 'video' ? stepFrame('options', 'Distribution methods', optionBody, optionSummary) : '',
    st.template ? stepFrame('fields', 'Fill & confirm', fieldBody, () => 'Filled') : ''
  ].join('');

  const preview = ready
    ? `<div class="ds-pv-bar">
         <button class="ds-copy" onclick="DS.copy()">Copy for Gmail</button>
         <span class="ds-copy-note">Paste into a new Gmail message.</span>
       </div>
       <div class="ds-pv-scroll">
         <div class="ds-preview">${buildEmail().html}</div>
       </div>`
    : `<div class="ds-pv-empty">
         <div class="ds-pv-empty-h">Your email will appear here</div>
         <div class="ds-pv-empty-b">Pick a template and name at least one deliverable to start building.</div>
       </div>`;

  return `<div class="ds-split">
    <div class="ds-form">${steps}</div>
    <div class="ds-preview-col">${preview}</div>
  </div>`;
}

// render() replaces the whole wizard, which throws away the element the user
// may be typing into — the caret would land on <body> mid-word. Most typing
// avoids a render entirely (see the mutators), but some transitions genuinely
// need one: naming the FIRST deliverable makes the preview appear, and clearing
// the LAST name makes it vanish. Both happen on a keystroke.
//
// So focus is carried across the rebuild. Every generated input and select
// carries a `data-fk` key that identifies it by what it edits rather than by
// position — 'item:<id>:name', 'f:clientName' — so it survives rows being added
// or removed above it. Selection offsets are restored too, so the caret comes
// back where it was rather than jumping to the end of the value.
function render() {
  const a = document.activeElement;
  const fk = a && a.dataset ? a.dataset.fk : null;
  const start = fk ? a.selectionStart : null;
  const end   = fk ? a.selectionEnd   : null;

  document.getElementById('distro-root').innerHTML = pageHtml();

  if (!fk) return;
  const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
  if (!el) return;
  el.focus();
  // Only text inputs have a selection range; a <select> throws on this.
  if (start !== null) { try { el.setSelectionRange(start, end); } catch (e) {} }
}

// ── EMAIL ASSEMBLY ───────────────────────────────────────────────────────────
// Produces the final HTML. Every instruction-to-self is gone by construction —
// they exist nowhere in this builder, only in the original template doc. Options
// are renumbered from the KEPT set, so numbering is always 1..n with no gaps.

function link(href, text) {
  const h = href && !/^https?:\/\//i.test(href) ? 'https://' + href : href;
  return h ? `<a href="${esc(h)}">${esc(text)}</a>` : esc(text);
}

// On the guide template every deliverable is a guide, whatever its stored kind
// — the kind picker is not even shown there, so a row left as 'video' from an
// earlier template choice must not slip through as a video item.
const isGuideItem = it => st.template === 'guide' || it.kind === 'guide';

function buildEmail() {
  const selected = namedItems();
  const clientName = st.clientName || '[Client Name]';
  const contact = st.contact || '[Client Contact]';

  let body;

  if (st.template === 'guide') {
    // ONE email. The greeting, resolution key, and sign-off appear once; only
    // the per-deliverable line (product name + download link) repeats, listed
    // under a single Final Files heading.
    const items = selected.map(it =>
      `<p><strong>${esc(it.name)}:</strong> ${link(it.download, 'Click here')} to download.</p>`
    ).join('');

    const productList = selected.map(it => esc(it.name)).join(', ');
    const key = BOILER.resolutionKey.map(([abbr, name, use]) =>
      `<div><strong style="color:#67E74E">${abbr}</strong> - ${esc(name)} - <em>${esc(use)}</em></div>`
    ).join('');

    body = `<p>Hi ${esc(contact)},</p>
      <p>Good news! Your <strong>${esc(clientName)} ${productList}</strong> ${selected.length > 1 ? 'are' : 'is'} ready to be distributed.</p>
      <p><strong style="color:#67E74E">&gt;&gt;</strong> <strong>Final Files</strong></p>
      ${items}
      <p>${key}</p>
      <p>Please let us know if you have any questions or need anything else.</p>
      <p>Thank you!<br>${BOILER.signoffName} ${BOILER.signoffTeam}</p>`;
  } else {
    // VIDEO — the option kit, and the frame for mixed sends.
    const videoItems = selected.filter(it => !isGuideItem(it));
    const guideItems = selected.filter(it => isGuideItem(it));

    // "Good news!" lists only the PRODUCT NAMES of the included deliverables —
    // no client/project name. Uses the full selection so a mixed send names
    // everything going out, videos and guides alike.
    const productList = selected.map(it => esc(it.name)).join(', ');

    const H = t => `<p><strong style="color:#67E74E">&gt;&gt;</strong> <strong>${t}</strong></p>`;

    // Kept options only, renumbered 1..n. These are VIDEO concerns, so they
    // iterate videoItems, not the full selection — a guide has no embed code.
    const kept = VIDEO_OPTIONS.filter(o => st.options[o.id]);
    let n = 0;
    const optionBlocks = kept.map(o => {
      n++;
      if (o.id === 'url')
        return `<p><strong>Option ${n}: Custom URL</strong></p>` + videoItems.map(it =>
          `<p>${esc(it.name)}: ${it.distUrl ? link(it.distUrl, it.distUrl) : '[URL]'}</p>`
        ).join('');
      if (o.id === 'email')
        return `<p><strong>Option ${n}: Distribute by email</strong></p>
          <p>Copy and paste the image below to send from your email account with your own messaging, including the hyperlinked text in case the recipient's email doesn't display images.</p>` +
          videoItems.map(it =>
            // The thumbnail is pasted into Gmail by hand — the page can't hold
            // the image and shouldn't try. It leaves an unmistakable marker in
            // the right spot so the step is never forgotten or misplaced.
            `<p>${link(it.distUrl, `Open the ${clientName} ${it.name}`)}</p>
             <p class="ds-ph"><em>[ Paste the ${esc(it.name)} thumbnail image here ]</em></p>`
          ).join('');
      if (o.id === 'embed')
        return `<p><strong>Option ${n}: Embed into a website, intranet or portal</strong></p>
          <p>Send the iFrame code below to your IT team to embed the content directly within a web page, intranet or portal.</p>` +
          videoItems.map(it => `<pre>${esc(it.embedCode || '[Embed code]')}</pre>`).join('') +
          `<p><em>Note on Resizing: You can adjust the height and width of the content in the code but be sure to maintain proportions to avoid distortion.</em></p>`;
      if (o.id === 'qr')
        return `<p><strong>Option ${n}: QR Code</strong> (attached to this email)</p>`;
      if (o.id === 'mp4')
        return `<p><strong>Option ${n}: Download the MP4 file</strong></p>` +
          videoItems.map(it => `<p>${link(it.mp4Link, 'Click here')} to download.</p>`).join('') +
          `<p><em>Please note that by using the MP4 file, you forgo the engagement metrics tracked by the Flimp URL and embed code.</em></p>`;
      if (o.id === 'ai')
        return `<p><strong>Option ${n}: Employee Benefits AI Agent</strong></p>
          <p>Here is the external link to your Employee Benefits AI Agent: ${link(st.aiLink, st.aiLink || '[AI link]')}</p>
          ${H('AI Agent Reporting')}
          <p>Here's your ${link(st.aiReport, 'shareable, real-time tracking report to monitor engagement')}.</p>`;
      return '';
    }).join('');

    // Guide items fold into their own section — same shape as the standalone
    // guide template (heading + download link + resolution key), one block per
    // guide deliverable, placed after the video Options.
    const guideSection = guideItems.map(it => {
      const keyBlock = BOILER.resolutionKey.map(([abbr, name, use]) =>
        `<div><strong style="color:#67E74E">${abbr}</strong> - ${esc(name)} - <em>${esc(use)}</em></div>`
      ).join('');
      return `${H(`${esc(it.name)} Final Files`)}
        <p>${link(it.download, 'Click here')} to download the ${esc(it.name)}.</p>
        <p>${keyBlock}</p>`;
    }).join('');

    body = `<p>Hi ${esc(contact)},</p>
      <p>Good news! Your <strong>${productList}</strong> ${selected.length > 1 ? 'are' : 'is'} ready to be distributed.</p>
      ${videoItems.length ? H('Reporting') : ''}
      ${videoItems.map(it =>
        // The visible text is the item title + " Reporting Link"; the URL hides
        // behind it. One line per video deliverable.
        `<p>${link(it.reportLink, `${it.name} Reporting Link`)}</p>`
      ).join('')}
      ${H('Distribution Resource Center &amp; Reporting Metrics Explained')}
      <p>Visit our ${link(BOILER.resourceCenter, 'Distribution Resource Center')} and ${link(BOILER.metricsExplained, 'Reporting Metrics Explained')} for best practices, distribution methods, FAQs, and reporting dashboard explanations.</p>
      ${videoItems.length ? H('Distribution Options') + (optionBlocks || '<p><em>No distribution methods selected.</em></p>') : ''}
      ${guideSection}
      ${H('Real-Time Updates')}
      <p>All updates made to your content after sending will automatically update, so you do not have to resend. This includes videos and linked documents.</p>
      ${H('Questions')}
      <p>For distribution or reporting questions, please contact me. For project-specific needs or to scope a new project, contact your account manager directly.</p>
      <p>Thank you!<br>${BOILER.signoffName} ${BOILER.signoffTeam}</p>`;
  }

  return { html: body };
}

// ── MUTATORS ─────────────────────────────────────────────────────────────────
// Two flavours, and the difference matters:
//   • structural changes (template, step, add/remove, toggles) → save + render
//   • text typed into an input → save + patch the PREVIEW ONLY
// A full re-render on every keystroke would destroy and recreate the input
// being typed into, and the caret would jump to a fresh element. So live text
// writes to state and patches only the preview subtree in place.

function patchPreview() {
  if (!(st.template && namedItems().length)) { render(); return; }
  const box = document.querySelector('.ds-preview');
  if (box) box.innerHTML = buildEmail().html;
  else render();   // preview wasn't on screen yet (first named deliverable)
}

const DS = {
  setTemplate(val) {
    st.template = val;
    // Custom URL, Email, and Embed are on for nearly every video distribution,
    // so default them on — you deselect the rare exception rather than select
    // the common case every time. Still deselectable; a 95%-true rule should
    // not remove the 5% escape hatch.
    st.options = val === 'video' ? { url: true, email: true, embed: true } : {};
    st.step = 2;
    save(); render();
  },

  goStep(n) { st.step = n; save(); render(); },

  addItem() {
    st.items.push(blankItem());
    save(); render();
    // Drop the caret straight into the row just added, so adding three
    // deliverables is three clicks and three names, not six clicks.
    const inputs = document.querySelectorAll('.ds-item-nm');
    if (inputs.length) inputs[inputs.length - 1].focus();
  },

  removeItem(id) {
    st.items = st.items.filter(i => i.id !== id);
    save(); render();
  },

  // Structural item change (the kind picker) — needs a re-render because it
  // changes which fields step 3 will show.
  setItem(id, key, val) {
    const it = st.items.find(i => i.id === id); if (!it) return;
    it[key] = val;
    save(); render();
  },

  // Typed item change — preview patch only, so the caret stays put.
  setItemLive(id, key, val) {
    const it = st.items.find(i => i.id === id); if (!it) return;
    const wasNamed = namedItems().length;
    it[key] = val;
    save();
    // Naming the first deliverable (or clearing the last name) changes the
    // whole page shape — the preview appears or disappears, Continue unlocks.
    // That needs a real render; everything else just repaints the preview.
    if (key === 'name' && (!!namedItems().length !== !!wasNamed)) render();
    else patchPreview();
  },

  setField(key, val) { st[key] = val; save(); patchPreview(); },

  toggleOpt(id) { st.options[id] = !st.options[id]; save(); render(); },

  // Rich copy: write HTML so Gmail keeps links and formatting on paste.
  //
  // Two ways this fails, and they need different handling. `new ClipboardItem`
  // throws SYNCHRONOUSLY where the API is missing; `clipboard.write()` REJECTS
  // asynchronously when permission is refused or the document isn't focused. A
  // plain try/catch only sees the first, so a rejected write would leave
  // "Email copied" on screen with an empty clipboard — the one failure the user
  // must not be lied to about, since the copy IS the deliverable. Hence the
  // .then/.catch: the success message only fires once the write resolves.
  copy() {
    const { html } = buildEmail();
    const plainText = html.replace(/<[^>]+>/g, '');
    const plainOnly = () => navigator.clipboard.writeText(plainText)
      .then(() => flash('Email copied as plain text — links will not carry over'))
      .catch(() => flash('Could not copy — select the preview and copy by hand'));
    try {
      const item = new ClipboardItem({
        'text/html':  new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' })
      });
      navigator.clipboard.write([item])
        .then(() => flash('Email copied — paste into Gmail'))
        .catch(plainOnly);   // permission refused / document not focused
    } catch (e) {
      plainOnly();           // browser has no ClipboardItem
    }
  },

  // Clearing throws away typed work that exists nowhere else — there is no
  // project row holding a copy — so it asks first.
  reset() {
    if (!confirm('Clear this draft and start a new email? What you have typed will be lost.')) return;
    st = blankState();
    save(); render();
  }
};

// A small transient confirmation. The hub has A.toast(); this page has no bus,
// so it carries its own three-second banner.
function flash(msg) {
  const el = document.getElementById('ds-flash');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove('on'), 3000);
}

// The generated markup uses inline on* handlers (same approach as the hub), so
// the handler object has to be reachable by name from global scope. A top-level
// `const` in a plain script is NOT a property of window, and an inline
// onclick="DS.copy()" is resolved against window — hence the explicit assign.
window.DS = DS;

render();
