// kickoff-build.js — assembles the kickoff PDF from a payload.
//
// Split from the HTTP handler so it can be run straight from Node against a
// fixture (see test/kickoff-fixture.mjs) and the output opened, with no server,
// no Supabase and no deploy. Given how much of this work is "look at it, nudge
// a number, look again", that loop matters more than the endpoint does.
//
// THE PAYLOAD IS THE CONTRACT. The panel resolves every value — names, bullets,
// team lines, process groups, week bands — into finished strings and hands them
// over. Nothing here knows about rows, product types, or the New/Update axis.
// That's what keeps this testable and lets the panel's preview be an honest
// picture of what will print.
//
//   {
//     page1: { clientName, projectName,
//              campaign: [{ text, url, depth }],
//              team:     [{ name, title, email, phone }],
//              process:  [{ heading, lines: [{ text, url, depth }] }] },
//     page2: { firstSteps: [{ text, url, depth }] },
//     timeline: { weeks: [{ week, range, tasks: [{ party, deliverable, task, due }] }],
//                 summary: { ... } }
//   }

import { PDFDocument, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import {
  LAYOUT, drawBlock, drawTimeline, timelinePageCount,
  bulletLines, processLines, teamLines
} from './kickoff-draw.js';

const asset = name => new URL('../_assets/' + name, import.meta.url);

// The template's form fields are widget ANNOTATIONS sitting on top of the page.
// The artwork is XObjects in the content stream underneath, so removing the
// annotations and the AcroForm leaves the page visually identical and gives us
// a clean surface to draw on — verified against both templates.
function stripForm(doc) {
  doc.getPages().forEach(p => p.node.delete(PDFName.of('Annots')));
  doc.catalog.delete(PDFName.of('AcroForm'));
}

async function loadTemplate(name) {
  const doc = await PDFDocument.load(await readFile(asset(name)));
  stripForm(doc);
  return doc;
}

export async function buildKickoffPdf(payload) {
  const p1 = payload.page1 || {};
  const p2 = payload.page2 || {};
  const tl = payload.timeline || { weeks: [], summary: {} };

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);

  // SUBSETTING IS OFF DELIBERATELY. With `subset: true` fontkit's CFF subsetter
  // produces a font whose encoding doesn't survive these OTFs: every glyph
  // renders as the wrong character — "Grange Insurance" came out as `! " #$%&`,
  // consecutive codepoints, which is the signature of glyphs being written in
  // order of first use with the mapping lost. Embedding whole fixes it.
  //
  // The cost is about 120KB of font in every generated PDF (~370KB -> ~440KB
  // for a two-page kickoff). That's the right trade for a document that has to
  // be legible; revisit only if a future fontkit fixes the subsetter.
  const fonts = {
    regular: await out.embedFont(await readFile(asset('fonts/RundDisplay-Medium.otf')), { subset: false }),
    bold:    await out.embedFont(await readFile(asset('fonts/RundDisplay-Bold.otf')),   { subset: false })
  };

  const page1Tpl = await loadTemplate('kickoff-page1.pdf');
  const page2Tpl = await loadTemplate('kickoff-page2.pdf');

  // Every continuation page is a fresh copy of the page-2 background.
  //
  // PROFILE B IS NOT BUILT. The spec calls for a lighter continuation page with
  // no First Steps box and therefore a taller content area. That design doesn't
  // exist yet, so overflow pages currently reuse page 2 — correct table, but
  // with an empty First Steps box at the top and less room than the real
  // continuation page will have. Swapping it is a matter of loading a third
  // template and giving it its own `timeline` rectangle.
  const copyPage = async tpl => {
    const [copied] = await out.copyPages(tpl, [0]);
    return out.addPage(copied);
  };

  const notes = [];

  // ── PAGE 1 ────────────────────────────────────────────────────────────────
  const page1 = await copyPage(page1Tpl);
  const region = (name, lines) => {
    const r = drawBlock(out, page1, fonts, LAYOUT[name], lines);
    if (r.overflow) notes.push(`${name} overflows its box even at ${LAYOUT[name].minSize}pt`);
    return r;
  };

  region('clientName',  [{ text: p1.clientName  || '', indent: 0, gapAbove: 0, bold: true,  link: '' }]);
  region('projectName', [{ text: p1.projectName || '', indent: 0, gapAbove: 0, bold: false, link: '' }]);
  region('campaign',    bulletLines(p1.campaign || []));
  region('team',        teamLines(p1.team || []));
  region('process',     processLines(p1.process || []));

  // ── PAGE 2 AND ANY CONTINUATION PAGES ─────────────────────────────────────
  // Counted before drawing so the backgrounds can all be copied up front —
  // copying is async, the drawing walk isn't.
  const needed = timelinePageCount(LAYOUT.timeline, tl);
  const timelinePages = [];
  for (let i = 0; i < needed; i++) timelinePages.push(await copyPage(page2Tpl));

  // First Steps belongs to page 2 only; continuation pages carry the table alone.
  const fs = drawBlock(out, timelinePages[0], fonts, LAYOUT.firstSteps, bulletLines(p2.firstSteps || []));
  if (fs.overflow) notes.push(`firstSteps overflows its box even at ${LAYOUT.firstSteps.minSize}pt`);

  drawTimeline(out, fonts, timelinePages, LAYOUT.timeline, tl);
  if (needed > 1) {
    notes.push(`timeline runs to ${needed} pages; continuation pages reuse the page-2 background until the page-3 design exists`);
  }
  if ((tl.undated || []).length) {
    notes.push(`${tl.undated.length} task(s) had no resolved date and are not in any week band`);
  }

  return { bytes: await out.save(), notes, timelinePages: needed };
}
