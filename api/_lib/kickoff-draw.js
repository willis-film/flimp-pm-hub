// kickoff-draw.js — draws the kickoff PDF onto the template artwork.
//
// Nothing here fills an AcroForm field. The template PDFs supply two things: the
// background art, and the rectangles saying where each region sits. See the
// LAYOUT BOXES note in js/panels/templates.js for why.
//
// ── EVERYTHING TUNABLE IS IN THE `LAYOUT` BLOCK BELOW ────────────────────────
// Positions, sizes, colours, padding, leading, indents, column x-positions and
// row heights all live in one object. Adjusting how the document looks should
// mean editing that block, never the drawing functions underneath it.
//
// The REGION rectangles were read off the template's own AcroForm — including
// its colours and its /Q alignment flags — so they start out matching what the
// form would have produced. They are starting points, not gospel: the whole
// point of drawing is that they can move.

import { PDFName, PDFNumber, PDFString, PDFArray, rgb } from 'pdf-lib';
import { line, fit } from './pdf-text.js';

export const LAYOUT = {
  // ── PAGE 1 REGIONS ────────────────────────────────────────────────────────
  // x/y are the PDF rectangle's lower-left corner; PDF y counts UP from the
  // bottom of the page. Read from the template's fields.
  clientName:  { x: 41.1,  y: 658.1, w: 529.9, h: 45.8,  size: 45, minSize: 20, align: 'centre', colour: [0.083, 0.609, 0.26], bold: true },
  projectName: { x: 41.9,  y: 614.2, w: 529.6, h: 41.0,  size: 20, minSize: 11, align: 'centre', colour: [0.038, 0.097, 0.132] },
  campaign:    { x: 36.7,  y: 358.9, w: 332.6, h: 181.1, size: 12, minSize: 8,  align: 'left',   colour: [0, 0, 0] },
  team:        { x: 425.5, y: 266.0, w: 150.0, h: 259.6, size: 12, minSize: 7,  align: 'left',   colour: [1, 1, 1] },
  process:     { x: 35.3,  y: 61.8,  w: 333.9, h: 247.2, size: 15, minSize: 10, align: 'left',   colour: [0, 0, 0] },

  // ── PAGE 2 REGIONS ────────────────────────────────────────────────────────
  // The template's fields say Helvetica here, but that's an artefact: page 2
  // came from the merge that stripped the Rund fonts, so Helv was the fallback
  // rather than a decision. Drawn in Rund to match page 1.
  firstSteps:  { x: 212.1, y: 582.8, w: 355.5, h: 99.9,  size: 12, minSize: 8,  align: 'left',   colour: [0, 0, 0] },
  timeline:    { x: 26.8,  y: 46.7,  w: 559.1, h: 444.2 },

  // ── SHARED TEXT SETTINGS ──────────────────────────────────────────────────
  leading: 1.4,          // line height as a multiple of font size
  // Where the first baseline sits below the top of a box, as a multiple of the
  // font size. Roughly cap height — raise it if text looks like it's riding too
  // high in its box.
  firstBaseline: 0.85,
  subIndent: 14,         // depth-1 lines, in points
  groupGap: 0.6,         // blank space before a Process heading, in line heights
  personGap: 0.5,        // blank space between people in the team block
  linkColour: [0.083, 0.609, 0.26],
  underlineLinks: true,

  // ── TIMELINE TABLE ────────────────────────────────────────────────────────
  table: {
    pad: 14,             // inset from the Timeline rectangle on all sides
    headerSize: 9,
    bandSize: 9.5,
    rowSize: 9,
    headerHeight: 20,
    bandHeight: 18,
    rowHeight: 15,
    summaryGap: 8,
    // Column x-positions as fractions of the content width. Literal positions,
    // not tab stops — proportional fonts have no tab alignment.
    cols: { party: 0.00, deliverable: 0.14, task: 0.46, due: 1.00 },
    bandFill:   [0.906, 0.925, 0.945],
    bandText:   [0.11, 0.16, 0.20],
    headerText: [0.42, 0.46, 0.50],
    rowText:    [0.11, 0.16, 0.20],
    rule:       [0.85, 0.88, 0.91]
  }
};

const col = c => rgb(c[0], c[1], c[2]);

// ── LOW-LEVEL DRAWING ────────────────────────────────────────────────────────

// A clickable region over drawn text. pdf-lib has no link API, so the annotation
// dictionary is built by hand and pushed onto the page's /Annots.
function addLink(doc, page, url, x, y, w, h) {
  const annot = doc.context.obj({
    Type:    'Annot',
    Subtype: 'Link',
    Rect:    [x, y, x + w, y + h],
    Border:  [0, 0, 0],                       // no visible frame; we style the text
    A: doc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) })
  });
  const ref = doc.context.register(annot);
  let annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
  if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
  annots.push(ref);
}

// Draws a laid-out block into a region. Returns whether it overflowed, so the
// caller can report it rather than silently producing a clipped page.
function drawBlock(doc, page, fonts, region, lines) {
  const l = fit(fonts, lines, {
    size: region.size, minSize: region.minSize,
    width: region.w, height: region.h, leading: LAYOUT.leading
  });
  const top = region.y + region.h;
  for (const row of l.rows) {
    if (!row.text) continue;
    const font = row.bold ? fonts.bold : fonts.regular;
    const width = font.widthOfTextAtSize(row.text, l.size);
    const x = region.align === 'centre'
      ? region.x + (region.w - width) / 2
      : region.x + row.indent;
    const y = top - LAYOUT.firstBaseline * l.size - row.y;

    page.drawText(row.text, {
      x, y, size: l.size, font,
      color: col(row.link ? LAYOUT.linkColour : region.colour)
    });

    if (row.link) {
      if (LAYOUT.underlineLinks) {
        page.drawLine({
          start: { x, y: y - l.size * 0.12 },
          end:   { x: x + width, y: y - l.size * 0.12 },
          thickness: Math.max(0.4, l.size * 0.05),
          color: col(LAYOUT.linkColour)
        });
      }
      addLink(doc, page, row.link, x, y - l.size * 0.2, width, l.size * 1.1);
    }
  }
  return { overflow: l.overflow, size: l.size };
}

// ── REGION CONTENT ───────────────────────────────────────────────────────────
// Each of these turns a slice of the payload into the line list the layout
// engine wants. Kept apart from drawing so the shape of the content and the
// mechanics of putting it on a page stay separable.

const bulletLines = items => items.map(i =>
  line((i.depth === 1 ? '' : '• ') + i.text, {
    indent: i.depth === 1 ? LAYOUT.subIndent : 0,
    link:   i.url || ''
  })
);

// Process: a heading, then steps numbered 1..n per group, with sub-items
// indented and consuming no number.
function processLines(groups) {
  const out = [];
  groups.forEach((g, gi) => {
    out.push(line(g.heading, { bold: true, gapAbove: gi ? LAYOUT.groupGap : 0 }));
    let n = 0;
    for (const l of g.lines) {
      if (l.depth === 1) {
        out.push(line(l.text, { indent: LAYOUT.subIndent, link: l.url || '' }));
      } else {
        n++;
        out.push(line(`${n}. ${l.text}`, { link: l.url || '' }));
      }
    }
  });
  return out;
}

// Team: four lines per person, blank ones skipped so a missing phone doesn't
// leave a hole in a box this narrow.
function teamLines(team) {
  const out = [];
  team.forEach((p, i) => {
    out.push(line(p.name, { bold: true, gapAbove: i ? LAYOUT.personGap : 0 }));
    for (const v of [p.title, p.email, p.phone]) if (v) out.push(line(v));
  });
  return out;
}

// ── TIMELINE TABLE ───────────────────────────────────────────────────────────
// Programmatic, not text layout: a vertical cursor walking down the content
// area, emitting week bands and task rows, breaking to a new page when the next
// week won't fit whole.

function tableGeometry(region) {
  const t = LAYOUT.table;
  const x = region.x + t.pad;
  const w = region.w - t.pad * 2;
  return {
    x, w,
    top:    region.y + region.h - t.pad,
    bottom: region.y + t.pad,
    colX: {
      party:       x + w * t.cols.party,
      deliverable: x + w * t.cols.deliverable,
      task:        x + w * t.cols.task,
      dueRight:    x + w * t.cols.due
    }
  };
}

function drawTableHeader(page, fonts, g, y) {
  const t = LAYOUT.table;
  const put = (text, x) => page.drawText(text, { x, y: y - t.headerSize, size: t.headerSize, font: fonts.bold, color: col(t.headerText) });
  put('PARTY', g.colX.party);
  put('DELIVERABLE', g.colX.deliverable);
  put('TASK', g.colX.task);
  const dueW = fonts.bold.widthOfTextAtSize('DUE', t.headerSize);
  put('DUE', g.colX.dueRight - dueW);
  page.drawLine({
    start: { x: g.x, y: y - t.headerHeight + 4 }, end: { x: g.x + g.w, y: y - t.headerHeight + 4 },
    thickness: 0.7, color: col(t.rule)
  });
  return y - t.headerHeight;
}

function drawWeekBand(page, fonts, g, y, week) {
  const t = LAYOUT.table;
  page.drawRectangle({ x: g.x, y: y - t.bandHeight + 3, width: g.w, height: t.bandHeight - 2, color: col(t.bandFill) });
  page.drawText(`Week ${week.week}`, {
    x: g.x + 6, y: y - t.bandSize - 3, size: t.bandSize, font: fonts.bold, color: col(t.bandText)
  });
  const range = week.range || '';
  const rw = fonts.regular.widthOfTextAtSize(range, t.bandSize);
  page.drawText(range, {
    x: g.colX.dueRight - rw, y: y - t.bandSize - 3, size: t.bandSize, font: fonts.regular, color: col(t.bandText)
  });
  return y - t.bandHeight;
}

// Truncates to fit a column rather than wrapping — a task row must stay one row
// tall or the whole cursor arithmetic stops being predictable.
function clip(font, text, size, width) {
  let s = String(text || '');
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > width) s = s.slice(0, -1);
  return s + '…';
}

function drawTaskRow(page, fonts, g, y, task) {
  const t = LAYOUT.table;
  const f = fonts.regular;
  const baseline = y - t.rowSize - 2;
  const widths = {
    party:       g.colX.deliverable - g.colX.party - 6,
    deliverable: g.colX.task - g.colX.deliverable - 6,
    task:        g.colX.dueRight - g.colX.task - 48
  };
  page.drawText(clip(f, task.party, t.rowSize, widths.party), { x: g.colX.party, y: baseline, size: t.rowSize, font: f, color: col(t.rowText) });
  page.drawText(clip(f, task.deliverable, t.rowSize, widths.deliverable), { x: g.colX.deliverable, y: baseline, size: t.rowSize, font: f, color: col(t.rowText) });
  page.drawText(clip(f, task.task, t.rowSize, widths.task), { x: g.colX.task, y: baseline, size: t.rowSize, font: f, color: col(t.rowText) });
  const due = String(task.due || '');
  const dw = f.widthOfTextAtSize(due, t.rowSize);
  page.drawText(due, { x: g.colX.dueRight - dw, y: baseline, size: t.rowSize, font: f, color: col(t.rowText) });
  return y - t.rowHeight;
}

// How many pages the table will need. Every height involved is a fixed constant,
// so this can be answered before anything is drawn — which is what lets the
// caller copy exactly that many background pages up front. Copying pages is
// async in pdf-lib and the drawing walk is not, so counting first is simpler
// than threading promises through the cursor.
//
// Must stay in step with the walk in drawTimeline: same fit test, same order.
export function timelinePageCount(region, timeline) {
  const t = LAYOUT.table;
  const g = tableGeometry(region);
  let y = g.top - t.headerHeight;
  let pages = 1;
  for (const week of (timeline.weeks || [])) {
    const needed = t.bandHeight + week.tasks.length * t.rowHeight;
    if (y - needed < g.bottom) { pages++; y = g.top - t.headerHeight; }
    y -= needed;
  }
  return pages;
}

// Walks the weeks across the supplied pages. A week's band and its rows are
// never split — a band stranded at the bottom with its tasks overleaf is worse
// than a shorter page.
export function drawTimeline(doc, fonts, pages, region, timeline) {
  const t = LAYOUT.table;
  let pi = 0;
  let page = pages[0];
  let g = tableGeometry(region);
  let y = drawTableHeader(page, fonts, g, g.top);

  for (const week of (timeline.weeks || [])) {
    const needed = t.bandHeight + week.tasks.length * t.rowHeight;
    if (y - needed < g.bottom && pi + 1 < pages.length) {
      page = pages[++pi];
      g = tableGeometry(region);
      y = drawTableHeader(page, fonts, g, g.top);
    }
    y = drawWeekBand(page, fonts, g, y, week);
    for (const task of week.tasks) y = drawTaskRow(page, fonts, g, y, task);
  }

  // Trailing summary — Project Start / Working Days / Due Date / Projected End,
  // straight from the plan's own footer, on the final page.
  const summary = Object.entries(timeline.summary || {}).map(([k, v]) => `${k}: ${v}`).join('   ·   ');
  if (summary) {
    const yy = y - t.summaryGap - t.rowSize;
    if (yy > g.bottom - t.rowSize) {
      page.drawText(clip(fonts.regular, summary, t.rowSize, g.w), {
        x: g.x, y: yy, size: t.rowSize, font: fonts.bold, color: col(t.headerText)
      });
    }
  }
  return { pages: pages.length };
}

export { drawBlock, bulletLines, processLines, teamLines };
