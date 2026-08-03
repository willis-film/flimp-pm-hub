// Exercises timelineWeeks() against the cases the reshaper actually has to
// survive: gaps, weekend dates, merged deliverables, unresolvable dates, and a
// plan that rolls over a year boundary.
import { readFileSync } from 'node:fs';

const SRC = new URL('../js/panels/timeline.js', import.meta.url).pathname;
const src = readFileSync(SRC, 'utf8');

// Pull the pieces under test out of the module without its DOM/bus imports.
const start = src.indexOf('const NBSP');
const end   = src.indexOf('// ── HEALTH');
const body  = src.slice(start, end);
const mod   = await import('data:text/javascript,' + encodeURIComponent(
  body + '\nexport { parseExport, timelineWeeks, mondayOf };'
));

const { parseExport, timelineWeeks, mondayOf } = mod;

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

// Sanity: the spec's example range implies Monday-start weeks.
console.log('Aug 24 2026 is a', new Date('2026-08-24T00:00:00Z').toUTCString().slice(0, 3));
check('mondayOf(Mon) is itself', mondayOf('2026-08-24').toISOString().slice(0,10), '2026-08-24');
check('mondayOf(Fri) walks back', mondayOf('2026-08-28').toISOString().slice(0,10), '2026-08-24');
check('mondayOf(Sun) walks back 6', mondayOf('2026-08-30').toISOString().slice(0,10), '2026-08-24');

const tsv = rows => rows.map(r => r.join('\t')).join('\n');

// ── Case 1: gap weeks, a weekend task, and a multi-deliverable task ─────────
const plan1 = 'Grange 2026 Timeline\n' + tsv([
  ['Flimp',  'Main Video',                  'Kickoff Call',     'Aug 3'],   // Mon, wk1
  ['Client', 'Main Video',                  'Provide Content',  'Aug 8'],   // SATURDAY, still wk1
  ['Flimp',  'Main Video',                  'Script Draft',     'Aug 11'],  // wk2
  // nothing in weeks 3 and 4
  ['Flimp',  'Main Video',                  'Animation V1',     'Sep 1'],   // wk5
  ['Flimp',  'Main Video, Companion Piece', 'Distribution',     'Sep 10']   // wk6
]) + '\nProject Start: Aug 3 · Working Days: 28 · Due Date: Sep 10';

const g1 = timelineWeeks({ timeline: parseExport(plan1) });
check('week numbers skip the gap', g1.weeks.map(w => w.week), [1, 2, 5, 6]);
check('ranges are Mon-Fri', g1.weeks.map(w => w.range),
  ['Aug 3 – Aug 7', 'Aug 10 – Aug 14', 'Aug 31 – Sep 4', 'Sep 7 – Sep 11']);
check('Saturday task lands in its own week', g1.weeks[0].tasks.map(t => t.task),
  ['Kickoff Call', 'Provide Content']);
check('merged deliverables stay one row', g1.weeks[3].tasks[0].deliverable,
  'Main Video, Companion Piece');
check('due keeps the export label', g1.weeks[0].tasks[0].due, 'Aug 3');
check('summary survives', g1.summary['Working Days'], '28');
check('nothing undated', g1.undated.length, 0);

// ── Case 2: an unresolvable date is kept, not dropped ───────────────────────
const plan2 = 'Plan 2026\n' + tsv([
  ['Flimp',  'Guide', 'Kickoff', 'Aug 3'],
  ['Client', 'Guide', 'Review',  'TBD']
]) + '\nProject Start: Aug 3';
const g2 = timelineWeeks({ timeline: parseExport(plan2) });
check('undated task is separated, not lost', g2.undated.map(t => t.task), ['Review']);
check('dated task still grouped', g2.weeks.map(w => w.tasks.length), [1]);

// ── Case 3: a plan crossing new year keeps counting weeks upward ────────────
const plan3 = 'OE 2026\n' + tsv([
  ['Flimp',  'Video', 'Kickoff',      'Dec 21'],
  ['Flimp',  'Video', 'Draft',        'Dec 28'],
  ['Client', 'Video', 'Review',       'Jan 4'],
  ['Flimp',  'Video', 'Distribution', 'Jan 11']
]) + '\nProject Start: Dec 21';
const g3 = timelineWeeks({ timeline: parseExport(plan3) });
check('weeks continue across the year roll', g3.weeks.map(w => w.week), [1, 2, 3, 4]);
check('ranges cross the year cleanly', g3.weeks.map(w => w.range),
  ['Dec 21 – Dec 25', 'Dec 28 – Jan 1', 'Jan 4 – Jan 8', 'Jan 11 – Jan 15']);

// ── Case 4: same-date tasks keep the plan's own ordering ────────────────────
// Chronological, as a real export is: resolveDates() treats a backwards date
// as a year roll, so an out-of-order plan is outside what the parser supports.
const plan4 = 'Plan 2026\n' + tsv([
  ['Flimp',  'Video', 'Earlier',    'Aug 3'],
  ['Flimp',  'Video', 'Zebra task', 'Aug 5'],
  ['Flimp',  'Video', 'Alpha task', 'Aug 5']
]) + '\nProject Start: Aug 3';
const g4 = timelineWeeks({ timeline: parseExport(plan4) });
check('sorted by date, ties keep plan order', g4.weeks[0].tasks.map(t => t.task),
  ['Earlier', 'Zebra task', 'Alpha task']);

// ── Case 5: degenerate inputs ───────────────────────────────────────────────
check('no timeline', timelineWeeks({}).weeks, []);
check('empty task list', timelineWeeks({ timeline: { tasks: [] } }).weeks, []);

console.log(failures ? `\n${failures} FAILING` : '\nall passing');
process.exit(failures ? 1 : 0);
