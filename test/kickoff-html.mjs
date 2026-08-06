// Generates the kickoff document from a fixture payload — no server, no
// Supabase, no deploy. The loop for working on layout: edit
// api/_lib/kickoff-html.js, run this, open the file, repeat.
//
//   node test/kickoff-html.mjs [out.html] [payload.json]
//
// Output is one self-contained file: fonts, images and the doc-page component
// are all inlined, so it can be opened from anywhere or handed to anyone.

import { writeFile, readFile } from 'node:fs/promises';
import { buildKickoffHtml } from '../api/_lib/kickoff-html.js';

const args = process.argv.slice(2);
const outPath     = args.find(a => a.endsWith('.html'))  || 'kickoff-sample.html';
const payloadPath = args.find(a => a.endsWith('.json'))
  || new URL('./kickoff-payload.json', import.meta.url).pathname;

const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
const html = await buildKickoffHtml(payload);
await writeFile(outPath, html);

// Page count is worth reporting: it's the thing that changes with the timeline
// length, and the thing most likely to surprise someone.
//
// Counted off data-screen-label rather than `<section class="page">` — the
// inlined doc-page component's own source contains that literal string, so
// matching it counts the component too and reports one page too many.
const pages = (html.match(/data-screen-label="Page \d+"/g) || []).length;
console.log(`wrote ${outPath}  ·  ${(html.length / 1024).toFixed(0)}KB  ·  ${pages} pages`);
