// build-design.mjs — emits the Claude Design kickoff document from a payload.
//
//   node build-design.mjs <payload.json> <out.html>
//
// The design is reproduced verbatim: same inline styles, same <doc-page>
// component, same assets. Only the CONTENT is substituted. Anything that had
// to be derived rather than copied is commented where it happens.
//
// ── WHAT VARIES, AND WHAT THAT COSTS ────────────────────────────────────────
// Measured off the design as delivered (all figures in points):
//
//   page 1 left column   397.5     right column 452.3  → block is right-driven
//   roster (3 people)    275       figure 161.3 + 16 margin
//   campaign bullet      14.3 each
//   slack above Resources 26
//
// So: the left column can take 3 more campaign bullets before it even becomes
// the taller column, and ~1 more after that using the slack. And a 4th contact
// (+83) overflows by 57 WITH the figure, but drops the block to 397.5 without
// it — which is why the figure is dropped past three contacts. See figureFor().

import { readFile } from 'node:fs/promises';

const asset = name => new URL('../_assets/' + name, import.meta.url);

// Fonts, images and the doc-page component are inlined as data URIs / inline
// script, so a generated document is ONE self-contained file. It then renders
// identically opened from disk, posted to a headless browser, or forwarded by
// someone who has no access to this repo. Costs ~1MB per document, which is the
// right trade for a client-facing file that has to look the same everywhere.
//
// Populated by loadAssets() before any template function runs. Module-scoped
// rather than threaded through every template so the markup stays readable.
const ASSETS = {};

async function loadAssets() {
  if (ASSETS.loaded) return;
  const png = async n => 'data:image/png;base64,' +
    (await readFile(asset('kickoff/' + n))).toString('base64');
  const otf = async n => 'data:font/otf;base64,' +
    (await readFile(asset('fonts/' + n))).toString('base64');

  const [logo, team, calendar, docPage, r400, r500, r700] = await Promise.all([
    png('flimp-logo.png'), png('photo-team.png'), png('photo-calendar.png'),
    readFile(asset('kickoff/doc-page.js'), 'utf8'),
    otf('RundText-Regular.otf'), otf('RundDisplay-Medium.otf'), otf('RundDisplay-Bold.otf')
  ]);

  Object.assign(ASSETS, {
    logo, team, calendar,
    // A literal </script> inside the component would close the tag early.
    docPage: docPage.replace(/<\/script/gi, '<\\/script'),
    fontCss: [[r400, 400], [r500, 500], [r700, 700]].map(([src, w]) =>
      `@font-face{font-family:'Rund';src:url(${src}) format('opentype');` +
      `font-weight:${w};font-style:normal;font-display:block;}`).join('\n'),
    loaded: true
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

// ── STYLE CONSTANTS ─────────────────────────────────────────────────────────
// Lifted verbatim from the design so the output is byte-identical where the
// content is identical. Named, not inlined, only where they repeat.
const INK = '#08212D', GREEN = '#44A55D', YELLOW = '#FFB21B', WASH = '#F2F8F0';
const MUTED = 'rgba(8,33,45,0.62)', HAIR = 'rgba(8,33,45,0.15)', RULE = 'rgba(8,33,45,0.28)';

const S = {
  page:    `position:relative; display:flex; flex-direction:column; width:100%; height:100%; padding:40pt 54pt 48pt; background:#FFFFFF; overflow:hidden`,
  label:   `margin:0 0 10pt; padding-top:9pt; font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${MUTED}; line-height:1; padding-bottom:8pt; border-bottom:0.5pt solid ${HAIR}`,
  grommet: (x, y) => `position:absolute; ${x}:9pt; ${y}:9pt; width:3pt; height:3pt; border-radius:50%; background:#888888`,
  metaDt:  `font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${MUTED}`,
  metaDd:  `margin:2pt 0 0; font-size:11pt; line-height:1.3`,
  bullet:  `flex:0 0 3pt; width:3pt; height:3pt; border-radius:50%; background:${GREEN}; margin-top:5.5pt`,
  step:    `display:grid; grid-template-columns:16pt 1fr; align-items:baseline`,
  stepNum: `font-size:8.5pt; font-weight:700; color:${GREEN}`,
  stepTxt: `font-size:11pt; font-weight:400; line-height:1.3`,
  note:    `color:${MUTED}; font-size:8.5pt`,
  trackHd: `border-top:1.5pt solid ${GREEN}; padding-top:5pt; margin-bottom:7pt; display:flex; align-items:baseline; justify-content:space-between; gap:8pt`,
  dot:     `width:5pt; height:5pt; border-radius:50%; background:${GREEN}`,
  th:      w => `font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${MUTED}; text-align:left; padding:0 8pt 5pt 0; border-bottom:1pt solid ${RULE}; width:${w}`,
  td:      `font-size:11pt; line-height:1.3; padding:5pt 8pt 5pt 0; border-bottom:0.5pt solid ${HAIR}; vertical-align:top`,
  band:    `font-size:8.5pt; font-weight:400; letter-spacing:0.11em; text-transform:uppercase; color:${MUTED}; background:${WASH}; padding:4pt 8pt 4pt 6pt; border-bottom:0.5pt solid ${RULE}`,
  pill:    `background:${INK}; color:#FFFFFF; font-size:9.5pt; font-weight:700; text-align:center; padding:5pt 8pt; border-radius:999pt; width:150pt`,
  footer:  `position:absolute; left:0; right:0; bottom:0; background:${INK}; padding:7pt 54pt; display:flex; justify-content:space-between; align-items:baseline; font-size:8.5pt; color:rgba(255,255,255,0.72); letter-spacing:0.02em`
};

const grommets = () => [['left','top'],['right','top'],['left','bottom'],['right','bottom']]
  .map(([x,y]) => `<span style="${S.grommet(x,y)}"></span>`).join('\n        ');

// ── DERIVATIONS ─────────────────────────────────────────────────────────────

// A step's title and its small grey note. The copy is authored as one string
// ("Scripting - 1 minute = 150 words"); the design sets the tail smaller and
// grey. An explicit `note` on the line wins if one is ever added to
// kickoff_content — splitting on a dash is a convention, not a contract.
function splitNote(l) {
  if (l.note) return [l.text, l.note];
  const m = String(l.text).match(/^(.*?)\s+[-–—]\s+(.*)$/);
  return m ? [m[1], m[2]] : [l.text, ''];
}

// A process step carrying a URL becomes a link. The step text is the link, not
// a separate marker: the design has no room for one, and a step that IS a
// resource ("Intake Form") reads better as a link than as a step with a
// footnote hanging off it.
//
// Underlined in brand green, matching the roster's email addresses — the house
// treatment for a link on white. Colour stays INK: green text at 11pt on white
// is the contrast problem the old document had.
const linked = (text, url) => url
  ? `<a href="${esc(url)}" style="color:${INK}; border-bottom:0.5pt solid ${GREEN}">${esc(text)}</a>`
  : esc(text);

// Two product types that produce the SAME steps are one track wearing two
// labels — the design shows this as "Traditional & Microsite". Merging is
// derived from the steps themselves rather than configured, so it can't drift
// out of step with the copy.
function mergeIdenticalTracks(groups) {
  // Keyed on depth-0 steps ONLY. The depth-1 lines are hoisted into Resources
  // and never appear in the track, so two tracks differing only in which
  // style-guide link hangs off them are, on the page, identical.
  const key = g => g.lines.filter(l => l.depth === 0).map(l => l.text).join(' | ');
  const out = [];
  for (const g of groups) {
    const prev = out[out.length - 1];
    if (prev && prev.heading && g.heading && key(prev) === key(g)) {
      prev.heading = `${prev.heading} & ${g.heading}`;
      prev.deliverables = [...(prev.deliverables || []), ...(g.deliverables || [])];
      continue;
    }
    out.push({ ...g, deliverables: [...(g.deliverables || [])] });
  }
  return out;
}

// The Resources buttons, taken from the payload as a finished list. The panel
// picks them by product type out of kickoff_content's `links` section, so
// nothing is matched or shortened here.
//
// These used to be scavenged from the depth-1 lines under process steps, which
// meant a button's text was a sentence written to read beneath a step —
// "Benefit Guide & Companion Piece Style Options" — against a fixed 150pt pill
// that does not wrap. Links being their own section is what lets them be
// authored short.
//
// NOTE: depth-1 lines are no longer rendered anywhere. trackBlock() prints only
// depth-0 steps, so any sub-item still sitting in the `process` section prints
// nowhere at all rather than printing badly.
const resourcePills = links => (links || []).filter(l => l.url && l.label);

// ── PAGE 1 ──────────────────────────────────────────────────────────────────

const headerBand = (h, logoH, title) => `
      <div style="position:relative; margin:-40pt -54pt ${title ? 12 : 16}pt; padding:0 54pt">
      <span style="position:absolute; left:0; right:0; top:0; height:${h}pt; background:${GREEN}"></span>
      <header style="position:relative; padding:${title ? 14 : 13}pt 16pt 0; display:flex; align-items:flex-end; justify-content:space-between">
        <img src="${ASSETS.logo}" alt="Flimp" style="height:${logoH}pt; width:auto; display:block">
        ${title ? `<span style="font-size:17.25pt; font-weight:700; letter-spacing:-0.015em; line-height:1; color:#FFFFFF">${esc(title)}</span>` : ''}
      </header>`;

const plaque = (p1, meta) => `
      <section style="position:relative; background:${WASH}; border-radius:10pt; padding:10pt 32pt; margin-top:6pt; box-shadow:0 1pt 4pt rgba(8,33,45,0.12)">
        ${grommets()}
        <h1 style="margin:0; font-size:27pt; font-weight:700; line-height:1.15; letter-spacing:-0.015em; color:${INK}">${esc(p1.clientName)}</h1>
        <p style="margin:4pt 0 0; font-size:13.75pt; font-weight:400; color:${INK}">${esc(p1.projectName)}</p>
        <dl style="display:flex; gap:32pt; margin:8pt 0 0; padding-top:8pt; border-top:0.5pt solid ${RULE}">
          ${meta.map(([k, v]) => `<div>
            <dt style="${S.metaDt}">${esc(k)}</dt>
            <dd style="${S.metaDd}">${esc(v)}</dd>
          </div>`).join('\n          ')}
        </dl>
      </section>
      </div>`;

const campaignBlock = items => !items.length ? '' : `
          <section style="margin-bottom:14pt">
            <h2 style="${S.label}">Campaign</h2>
            <ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:3pt">
              ${items.map(i => `<li style="display:flex; gap:8pt; align-items:flex-start; font-size:11pt; line-height:1.3">
                <span style="${S.bullet}"></span>
                <span>${esc(i.text)}</span>
              </li>`).join('\n              ')}
            </ul>
          </section>`;

// A heading-less group is the hoisted whole-project run: a green dot, no
// number, no track rule. Leading ones sit above the tracks, trailing ones
// below with a hairline over them.
const plainRun = (g, trailing) => g.lines.filter(l => l.depth === 0).map(l => `
            <div style="display:flex; align-items:center; gap:8pt; padding:${trailing ? '9pt 0 1pt' : '1pt 0'}${trailing ? `; border-top:0.5pt solid ${HAIR}` : ''}">
              <span style="${S.dot}"></span>
              <span style="font-size:11pt; font-weight:400; line-height:1.3">${linked(l.text, l.url)}</span>
            </div>`).join('');

function trackBlock(g, last) {
  const steps = g.lines.filter(l => l.depth === 0);
  const cap = (g.deliverables || []).join(', ');
  return `
            <div style="padding:12pt 0${last ? '' : ' 0'}">
              <div style="${S.trackHd}">
                <span style="font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${INK}">${esc(g.heading)}</span>
                ${cap ? `<span style="font-size:8.5pt; color:${MUTED}">${esc(cap)}</span>` : ''}
              </div>
              <ol style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4pt">
                ${steps.map((l, i) => {
                  const [title, note] = splitNote(l);
                  return `<li style="${S.step}">
                  <span style="${S.stepNum}">${i + 1}</span>
                  <span style="${S.stepTxt}">${linked(title, l.url)}${note ? `<span style="${S.note}">&nbsp;&nbsp;${esc(note)}</span>` : ''}</span>
                </li>`;
                }).join('\n                ')}
              </ol>
            </div>`;
}

function processBlock(groups) {
  const lead = [], tracks = [], trail = [];
  let seenTrack = false;
  for (const g of groups) {
    if (g.heading) { seenTrack = true; tracks.push(g); }
    else (seenTrack ? trail : lead).push(g);
  }
  return `
          <section>
            <h2 style="${S.label}">Process</h2>
            ${lead.map(g => plainRun(g, false)).join('')}
            ${tracks.map((g, i) => trackBlock(g, i === tracks.length - 1)).join('')}
            ${trail.map(g => plainRun(g, true)).join('')}
          </section>`;
}

const rosterBlock = team => `
          <section>
            <h2 style="margin:0 0 10pt; padding-top:9pt; font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${INK}; line-height:1; padding-bottom:8pt; border-bottom:0.5pt solid ${GREEN}">Your team</h2>
            <ul style="list-style:none; margin:0; padding:0">
              ${team.map((p, i) => {
                const first = i === 0, last = i === team.length - 1;
                const pad = first ? '0 0 8pt' : last ? '8pt 0 0' : '8pt 0';
                return `<li style="padding:${pad}${last ? '' : `; border-bottom:0.5pt solid ${HAIR}`}">
                <div style="font-size:13.75pt; font-weight:700; line-height:1.15; letter-spacing:-0.005em">${esc(p.name)}</div>
                ${p.title ? `<div style="font-size:11pt; color:${MUTED}; line-height:1.3; margin-top:1pt">${esc(p.title)}</div>` : ''}
                ${p.email || p.phone ? `<div style="font-size:11pt; line-height:1.3; margin-top:4pt">
                  ${p.email ? `<a href="mailto:${esc(p.email)}" style="color:${INK}; border-bottom:0.5pt solid ${GREEN}">${esc(p.email)}</a><br>` : ''}
                  ${p.phone ? esc(p.phone) : ''}
                </div>` : ''}
              </li>`;
              }).join('\n              ')}
            </ul>
          </section>`;

// The illustration is dropped past three contacts. A 4th person adds ~83pt to
// the right column, which overflows the page by 57 with the figure present —
// and drops the column to 358 against the left column's 397.5 without it, so
// removing it costs nothing and buys the whole overflow back. Five contacts
// still fit; six do not, with or without the image.
const figureFor = team => team.length > 3 ? '' : `
          <figure style="margin:16pt 0 0">
            <img src="${ASSETS.team}" alt="Team collaborating around a table" style="display:block; width:100%; height:auto">
          </figure>`;

const resourcesBlock = pills => !pills.length ? '' : `
      <section style="margin-top:auto; padding:11pt 16pt 13pt; background:${WASH}; border-radius:6pt">
        <h2 style="margin:0 0 10pt; font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${MUTED}; line-height:1; padding-bottom:7pt; border-bottom:0.5pt solid ${RULE}">Resources</h2>
        <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6pt">
          ${pills.map(p => `<a href="${esc(p.url)}" style="${S.pill}">${esc(p.label)}</a>`).join('\n          ')}
        </div>
      </section>`;

const footer = (name, n, of) => `
      <footer style="${S.footer}">
        <span>${esc(name)}</span>
        <span style="font-weight:700; color:#FFFFFF">${n} / ${of}</span>
      </footer>`;

// ── PAGE 2+ ─────────────────────────────────────────────────────────────────

const firstStepsBlock = items => `
        <section style="position:relative; flex:0 0 62%; margin:0; padding:12pt 32pt 14pt; background:${YELLOW}; border-radius:10pt">
          ${grommets()}
          <h2 style="margin:0 0 10pt; font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${INK}; line-height:1">First steps</h2>
          <ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column">
            ${items.map(l => `<li style="position:relative; padding:0 0 5pt 20pt; font-size:11pt; font-weight:400; line-height:1.3; color:${INK}">
              <span style="position:absolute; left:0; top:2.5pt; width:9pt; height:9pt; border:1pt solid ${INK}; border-radius:1.5pt"></span>
              ${l.url ? `<a href="${esc(l.url)}" style="color:${INK}; border-bottom:1pt solid ${INK}">${esc(l.text)}</a>` : esc(l.text)}
            </li>`).join('\n            ')}
          </ul>
        </section>`;

const thead = () => `
          <thead>
            <tr>
              <th style="${S.th('16%')}; padding-left:6pt">Party</th>
              <th style="${S.th('30%')}">Deliverable</th>
              <th style="${S.th('38%')}">Task</th>
              <th style="${S.th('16%')}; padding-right:0; text-align:right">Due</th>
            </tr>
          </thead>`;

const taskRow = t => `
            <tr>
              <td style="${S.td}; padding-left:6pt"><span style="font-size:8.5pt; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:${/flimp/i.test(t.party) ? INK : MUTED}">${esc(t.party)}</span></td>
              <td style="${S.td}">${esc(t.deliverable)}</td>
              <td style="${S.td}">${esc(t.task)}</td>
              <td style="${S.td}; padding-right:0; text-align:right; white-space:nowrap">${esc(t.due)}</td>
            </tr>`;

const bandRow = w => `
            <tr>
              <td colspan="4" style="${S.band}">
                Week ${esc(w.week)}<span style="float:right; color:${MUTED}; letter-spacing:0.11em">${esc(w.range)}</span>
              </td>
            </tr>`;

// Measured off the design: page 2 has 528pt of room below the First Steps
// block, a continuation page has 664. A week band is 18.5pt and a task row 25.
// Weeks are kept whole — a band stranded at the foot of a page with its tasks
// on the next one is worse than a short page.
const BUDGET = { first: 528, cont: 664, band: 18.5, row: 25, head: 20 };

function paginateWeeks(weeks) {
  const pages = [];
  let cur = [], used = BUDGET.head, budget = BUDGET.first;
  for (const w of weeks) {
    const h = BUDGET.band + w.tasks.length * BUDGET.row;
    if (cur.length && used + h > budget) {
      pages.push(cur); cur = []; used = BUDGET.head; budget = BUDGET.cont;
    }
    cur.push(w); used += h;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

const timelineTable = (weeks, cont) => `
      <section${cont ? ' style="margin-top:22pt"' : ''}>
        <h2 style="${S.label}">Timeline${cont ? ` <span style="font-weight:400; color:${MUTED}">(continued)</span>` : ''}</h2>
        <table style="width:100%; border-collapse:collapse">
          ${thead()}
          <tbody>${weeks.map(w => bandRow(w) + w.tasks.map(taskRow).join('')).join('')}
          </tbody>
        </table>
      </section>`;

// ── ASSEMBLY ────────────────────────────────────────────────────────────────

const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pocName = s => String(s || '').split('·')[0].trim();

function build(payload) {
  const { page1, page2, timeline: tl = {} } = payload;
  const name = [page1.clientName, page1.projectName].filter(Boolean).join(' — ');
  const groups = mergeIdenticalTracks(page1.process || []);
  const pills = resourcePills(page1.links);
  const team = page1.team || [];

  const meta = [
    ['Kickoff Date', page1.kickoffDate || shortDate(new Date())],
    ['Due Date',     (tl.summary || {})['Due Date'] || ''],
    ['Main POC',     pocName(page1.mainPoc)]
  ].filter(([, v]) => v);

  const weekPages = paginateWeeks(tl.weeks || []);
  const total = 1 + weekPages.length;

  const p1 = `
  <section class="page">
    <div data-screen-label="Page 1" style="${S.page}">
${headerBand(111, 21, 'Project Kickoff')}
${plaque(page1, meta)}

      <div style="display:flex; gap:6%; align-items:flex-start">
        <div style="flex:0 0 62%">
${campaignBlock(page1.campaign || [])}
${processBlock(groups)}
        </div>
        <div style="flex:0 0 32%">
${rosterBlock(team)}
${figureFor(team)}
        </div>
      </div>
${resourcesBlock(pills)}
${footer(name, 1, total)}
    </div>
  </section>`;

  const rest = weekPages.map((weeks, i) => `
  <section class="page">
    <div data-screen-label="Page ${i + 2}" style="${S.page}">
${headerBand(44, 17, '')}
      </div>
${i === 0 ? `
      <div style="display:flex; gap:5%; align-items:stretch; margin:22pt 0 14pt">
        <figure style="flex:1; align-self:stretch; position:relative; margin:0">
          <img src="${ASSETS.calendar}" alt="Two people reviewing a calendar" style="position:absolute; inset:-10pt 0; width:100%; height:calc(100% + 20pt); object-fit:contain">
        </figure>
${firstStepsBlock(page2.firstSteps || [])}
      </div>` : ''}
${timelineTable(weeks, i > 0)}
${footer(name, i + 2, total)}
    </div>
  </section>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(name)} Kickoff</title>
<style>${ASSETS.fontCss}</style>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Rund', Verdana, sans-serif; color: ${INK}; font-variant-numeric: tabular-nums lining-nums; }
  a { color: ${INK}; text-decoration: none; }
  h1, h2, p, ul, ol, dl, dd, figure, table { margin: 0; }
  doc-page:not(:defined) { visibility: hidden; }
  .page { position: relative; }
</style>
</head>
<body>
<doc-page size="letter">${p1}${rest}
</doc-page>
<script>${ASSETS.docPage}</script>
</body></html>`;
}

// The one export. Takes the payload buildPayload() already produces and returns
// a complete HTML document as a string.
export async function buildKickoffHtml(payload) {
  await loadAssets();
  return build(payload);
}
