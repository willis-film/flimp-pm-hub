// Builds the kickoff document across the cases whose content actually varies,
// so a layout change can be checked against all of them rather than against the
// one payload that happened to be open.
//
//   node test/kickoff-variants.mjs [outDir]        # default: .preview/
//
// The two axes that move are the team roster and the campaign list — the process
// copy and the resource links are near-fixed, and the timeline paginates on its
// own. Measured capacities, live, at the time of writing:
//
//   3 contacts + illustration      792pt   exactly one full page
//   5 contacts, short titles       777pt   fits
//   5 contacts, wrapping titles    806pt   14pt over
//   6 contacts                     858pt   66pt over
//   7 campaign bullets                     fits
//
// A contact costs 80–95pt depending on whether its job title wraps in the 32%
// column, which is why the two 5-contact cases land on opposite sides. The
// illustration is dropped past three contacts (see figureFor) and that is what
// buys four and five contacts their room.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildKickoffHtml } from '../api/_lib/kickoff-html.js';

const outDir = process.argv[2] || '.preview';
const base = JSON.parse(await readFile(new URL('./kickoff-payload.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(base);

// A long job title wraps in the roster column; a short one doesn't. Both are
// realistic, and they cost different amounts, so both are represented.
const person = (i, longTitle) => ({
  name: `Contact Number ${i}`,
  title: longTitle ? 'Senior Project Manager, Production Analytics' : 'Motion Designer',
  email: `person${i}@flimp.net`,
  phone: `555-01${String(i).padStart(2, '0')}`
});

const cases = {};

for (const n of [4, 5, 6]) {
  for (const long of [false, true]) {
    const p = clone();
    p.page1.team = [...base.page1.team];
    while (p.page1.team.length < n) p.page1.team.push(person(p.page1.team.length + 1, long));
    cases[`contacts-${n}${long ? '-longtitles' : ''}`] = p;
  }
}

for (const m of [5, 7, 9]) {
  const p = clone();
  p.page1.campaign = Array.from({ length: m }, (_, i) =>
    base.page1.campaign[i] || { text: `Grange – HSA Deliverable ${i + 1}`, url: '', depth: 0 });
  cases[`campaign-${m}`] = p;
}

// Long enough to force continuation pages, which is the only thing that changes
// the page count.
const long = clone();
for (let i = 7; i <= 16; i++) {
  long.timeline.weeks.push({
    week: i, range: `Week ${i}`,
    tasks: [
      { party: 'Flimp',  deliverable: 'Main Video', task: `Revision round ${i}`, due: `Sep ${i}` },
      { party: 'Client', deliverable: 'Main Video', task: `Client review ${i}`,  due: `Sep ${i}` },
      { party: 'Flimp',  deliverable: 'Microsite',  task: `Proofing pass ${i}`,  due: `Sep ${i}` }
    ]
  });
}
cases['timeline-long'] = long;
cases['baseline'] = clone();

await mkdir(outDir, { recursive: true });
for (const [name, payload] of Object.entries(cases)) {
  const html = await buildKickoffHtml(payload);
  await writeFile(`${outDir}/kickoff-${name}.html`, html);
  const pages = (html.match(/data-screen-label="Page \d+"/g) || []).length;
  const figure = /alt="Team collaborating/.test(html);
  console.log(`  ${name.padEnd(24)} ${pages} pages   illustration: ${figure ? 'yes' : 'dropped'}`);
}
console.log(`\n${Object.keys(cases).length} variants written to ${outDir}/`);
