// Generates a kickoff PDF from a fixture payload, with no server, no Supabase
// and no deploy. This is the loop for tuning layout: edit LAYOUT in
// api/_lib/kickoff-draw.js, run this, open the PDF, repeat.
//
//   node test/kickoff-fixture.mjs [out.pdf]
//
// The payload here mirrors what the Templates panel produces, using the real
// Process and First Steps copy so the line counts are honest. Pass --long for a
// timeline big enough to force continuation pages.

import { writeFile } from 'node:fs/promises';
import { buildKickoffPdf } from '../api/_lib/kickoff-build.js';

const long = process.argv.includes('--long');
const outPath = process.argv.find(a => a.endsWith('.pdf')) || 'kickoff-sample.pdf';

const week = (n, range, tasks) => ({ week: n, range, tasks });
const task = (party, deliverable, t, due) => ({ party, deliverable, task: t, due });

const weeks = [
  week(1, 'Aug 3 – Aug 7', [
    task('Flimp',  'Main Video',      'Project Kickoff',   'Aug 3'),
    task('Client', 'Main Video',      'Provide Content',   'Aug 5')
  ]),
  week(2, 'Aug 10 – Aug 14', [
    task('Flimp',  'Main Video',      'Script Draft',      'Aug 11'),
    task('Client', 'Main Video',      'Script Review',     'Aug 13')
  ]),
  week(3, 'Aug 17 – Aug 21', [
    task('Flimp',  'Main Video',      'Style Slides',      'Aug 18'),
    task('Flimp',  'Companion Piece', 'Design Draft',      'Aug 20')
  ]),
  week(4, 'Aug 24 – Aug 28', [
    task('Client', 'Companion Piece', 'Review',            'Aug 25')
  ]),
  week(5, 'Aug 31 – Sep 4', [
    task('Flimp',  'Main Video',      'Animation V1',      'Sep 1'),
    task('Client', 'Main Video',      'V1 Review',         'Sep 3')
  ]),
  week(6, 'Sep 7 – Sep 11', [
    task('Flimp',  'Main Video, Companion Piece', 'Distribution', 'Sep 10')
  ])
];

// Enough weeks to spill onto a second page, for exercising pagination.
if (long) {
  for (let i = 7; i <= 18; i++) {
    weeks.push(week(i, `Week ${i} range`, [
      task('Flimp',  'Main Video',      'Revisions round ' + i, 'Sep ' + i),
      task('Client', 'Main Video',      'Client review ' + i,   'Sep ' + i),
      task('Flimp',  'Companion Piece', 'Proofing pass ' + i,   'Sep ' + i)
    ]));
  }
}

const payload = {
  page1: {
    clientName:  'Grange Insurance',
    projectName: 'HSA Seed Campaign 2026',
    campaign: [
      { text: 'Grange Insurance – HSA Seed Campaign – Main Video' },
      { text: 'Grange – HSA Main Video' },
      { text: 'Grange – HSA Companion Piece' },
      { text: 'Grange – HSA Microsite Update' }
    ],
    team: [
      { name: 'Andrew Willis', title: 'Senior Project Manager, Production Analytics', email: 'awillis@flimp.net', phone: '555-0101' },
      { name: 'Julie',         title: 'Senior Account Manager', email: 'julie@flimp.net', phone: '555-0102' }
    ],
    process: [
      { heading: 'Video', lines: [
        { text: 'Project Kickoff' },
        { text: 'Scripting - 1 minute = 150 words' },
        { text: 'Open Enrollment Example', depth: 1, url: 'https://flimp.live/oe-example' },
        { text: 'Style Slides' },
        { text: 'Storyboards' },
        { text: 'Voice over' },
        { text: 'Animation' },
        { text: 'Distribution' },
        { text: 'Distribution Toolkit', depth: 1, url: 'https://flimp.live/Distribution-Resource-Center' }
      ]},
      { heading: 'Traditional', lines: [
        { text: 'Project Kickoff' },
        { text: 'Intake Form' },
        { text: 'Benefit Guide & Companion Piece Style Options', depth: 1, url: 'https://flimp.live/trad-styles' },
        { text: 'Initial Draft in ReviewStudio' },
        { text: 'How To Use ReviewStudio', depth: 1, url: 'https://flimp.live/reviewstudio' },
        { text: 'Rounds of Edits' },
        { text: 'Distribution' },
        { text: 'Distribution Toolkit', depth: 1, url: 'https://flimp.live/Distribution-Resource-Center' }
      ]}
    ]
  },
  page2: {
    firstSteps: [
      { text: 'Style Selection (Video)' },
      { text: 'Starter Script (Video)' },
      { text: 'Intake Form (Traditional)', url: 'https://flimp.live/intake' },
      { text: 'Logos & Branding' }
    ]
  },
  timeline: {
    weeks,
    summary: { 'Project Start': 'Aug 3', 'Working Days': '28', 'Due Date': 'Sep 10', 'Projected End': 'Sep 10' }
  }
};

const { bytes, notes, timelinePages } = await buildKickoffPdf(payload);
await writeFile(outPath, bytes);

console.log(`wrote ${outPath}  ·  ${(bytes.length / 1024).toFixed(0)}KB  ·  timeline pages: ${timelinePages}`);
if (notes.length) {
  console.log('\nnotes:');
  for (const n of notes) console.log('  · ' + n);
}
