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
import { line, fit, MARKER_WIDTH } from './pdf-text.js';

// Flimp text blue, #08212D. Every piece of body text the generator draws uses
// this rather than pure black — one constant so it can never drift between the
// page-1 regions and the timeline table.
const INK = [0.031, 0.129, 0.176];

export const LAYOUT = {
  // ── PAGE 1 REGIONS ────────────────────────────────────────────────────────
  // x/y are the PDF rectangle's lower-left corner; PDF y counts UP from the
  // bottom of the page.
  //
  // The redesigned page 1 has no AcroForm fields, so these were measured off a
  // render instead. A Letter page renders at exactly 1px per point at 72dpi, so
  // pixel positions ARE points — only the y axis flips. Landmarks found:
  //
  //   grey title block   x 24..588   PDF y 590..722
  //   "Campaign:" label              PDF y 552..574
  //   green divider rule             PDF y 442..443
  //   "Process:" label               PDF y 401..418
  //   green team panel   x 415..587  PDF y 244..575
  //
  // Content regions sit between those landmarks with a little padding. Two
  // changes from the old page worth knowing: Campaign lost height (100pt against
  // 181), and Process gained a lot (356pt against 247), because the new layout
  // gives it the whole left column down to the footer.
  // Campaign and Process are inset from the artwork's "Campaign:" / "Process:"
  // headings so the content reads as subordinate to them rather than starting
  // at the same left edge. The heading sits at x 34; content starts at 48.
  clientName:  { x: 40,  y: 650, w: 533, h: 56,  size: 45, minSize: 20, align: 'centre', colour: [0.020, 0.659, 0.329], bold: true },
  projectName: { x: 40,  y: 602, w: 533, h: 44,  size: 20, minSize: 11, align: 'centre', colour: INK },
  campaign:    { x: 48,  y: 447, w: 346, h: 100, size: 12, minSize: 8,  align: 'left',   colour: INK },
  team:        { x: 428, y: 254, w: 146, h: 274, size: 12, minSize: 7,  align: 'left',   colour: [1, 1, 1] },
  process:     { x: 48,  y: 40,  w: 346, h: 356, size: 15, minSize: 10, align: 'left',   colour: INK },

  // ── PAGE 2 REGIONS ────────────────────────────────────────────────────────
  // Page 2 still has its fields, so these came off the AcroForm. Its own fields
  // say Helvetica, but that's an artefact — page 2 came from the merge that
  // stripped the Rund fonts, so Helv was the fallback rather than a decision.
  // Drawn in Rund to match the rest.
  firstSteps:  { x: 212.1, y: 582.8, w: 355.5, h: 99.9,  size: 15, minSize: 9,  align: 'left',   colour: INK },
  timeline:    { x: 26.8,  y: 46.7,  w: 559.1, h: 444.2 },

  // ── PAGE 3: TIMELINE CONTINUATION ─────────────────────────────────────────
  // The lighter continuation page — a "Timeline (con't)" heading, no First Steps
  // panel, and nothing else. Measured the same way:
  //
  //   dark header                    PDF y 744..791
  //   "Timeline (con't)" label       PDF y 705..724
  //   footer                         PDF y   8..35
  //
  // 652pt of content against page 2's 444 — about 47% more room, because there's
  // no First Steps box eating the top third. Continuation pages therefore hold
  // noticeably more rows than the first one, which is exactly why the page count
  // has to be computed against BOTH profiles rather than one.
  timelineCont: { x: 26.8, y: 43, w: 559.1, h: 652 },

  // ── SHARED TEXT SETTINGS ──────────────────────────────────────────────────
  leading: 1.4,          // line height as a multiple of font size
  // Where the first baseline sits below the top of a box, as a multiple of the
  // font size. Roughly cap height — raise it if text looks like it's riding too
  // high in its box.
  firstBaseline: 0.85,
  // Depth-1 lines (the resource links under a step), in points. Enough to clear
  // the "1. " numbering above so a sub-item reads as hanging off its step rather
  // than as another step.
  subIndent: 22,
  groupGap: 0.6,         // blank space before a Process heading, in line heights
  personGap: 0.5,        // blank space between people in the team block
  // A team member's name against their title/email/phone. Without this the four
  // lines are one grey mass and the name doesn't read as the heading it is.
  teamNameScale: 1.25,
  linkColour: [0.083, 0.609, 0.26],
  underlineLinks: true,
  // The vector tick used where a check mark is wanted. The brand font has no
  // check glyph — ✓, ✔ and ☑ all measure identically, which is the .notdef box —
  // so it's stroked rather than typed. Coordinates are multiples of the line's
  // font size, so it scales with the text automatically.
  check: { w: 0.62, dipX: 0.24, dipY: 0.02, startY: 0.26, endY: 0.60, weight: 0.11 },

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
    bandText:   INK,
    headerText: [0.42, 0.46, 0.50],   // column labels stay grey: chrome, not content
    rowText:    INK,
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

// A check mark, stroked rather than typed — see LAYOUT.check.
function drawCheck(page, x, baseline, size, colour) {
  const c = LAYOUT.check;
  const w = Math.max(0.6, size * c.weight);
  const opts = { thickness: w, color: col(colour), lineCap: 1 };   // 1 = round
  page.drawLine({
    start: { x, y: baseline + size * c.startY },
    end:   { x: x + size * c.dipX, y: baseline + size * c.dipY },
    ...opts
  });
  page.drawLine({
    start: { x: x + size * c.dipX, y: baseline + size * c.dipY },
    end:   { x: x + size * c.w,    y: baseline + size * c.endY },
    ...opts
  });
}

// Draws a laid-out block into a region. Returns whether it overflowed, so the
// caller can report it rather than silently producing a clipped page.
//
// Rows carry their own size — a block can mix sizes, which is how a team
// member's name sits larger than their contact lines.
function drawBlock(doc, page, fonts, region, lines) {
  const l = fit(fonts, lines, {
    size: region.size, minSize: region.minSize,
    width: region.w, height: region.h, leading: LAYOUT.leading
  });
  const top = region.y + region.h;
  for (const row of l.rows) {
    const size = row.size;
    const y = top - LAYOUT.firstBaseline * size - row.y;
    const font = row.bold ? fonts.bold : fonts.regular;
    const left = region.x + row.indent;

    if (row.marker === 'check') drawCheck(page, left, y, size, region.colour);
    if (!row.text) continue;

    const width = font.widthOfTextAtSize(row.text, size);
    const x = region.align === 'centre'
      ? region.x + (region.w - width) / 2
      : left + row.markerW;

    page.drawText(row.text, {
      x, y, size, font,
      color: col(row.link ? LAYOUT.linkColour : region.colour)
    });

    if (row.link) {
      if (LAYOUT.underlineLinks) {
        page.drawLine({
          start: { x, y: y - size * 0.12 },
          end:   { x: x + width, y: y - size * 0.12 },
          thickness: Math.max(0.4, size * 0.05),
          color: col(LAYOUT.linkColour)
        });
      }
      addLink(doc, page, row.link, x, y - size * 0.2, width, size * 1.1);
    }
  }
  return { overflow: l.overflow, size: l.size };
}

// ── REGION CONTENT ───────────────────────────────────────────────────────────
// Each of these turns a slice of the payload into the line list the layout
// engine wants. Kept apart from drawing so the shape of the content and the
// mechanics of putting it on a page stay separable.

// `marker` is 'bullet' (typed, the font has one) or 'check' (stroked, it
// doesn't). Sub-items get neither — they hang off the line above rather than
// being items in their own right.
const bulletLines = (items, marker = 'bullet') => items.map(i => {
  const sub = i.depth === 1;
  const useCheck = !sub && marker === 'check';
  return line((sub || useCheck ? '' : '• ') + i.text, {
    indent: sub ? LAYOUT.subIndent : 0,
    marker: useCheck ? 'check' : '',
    link:   i.url || ''
  });
});

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
    out.push(line(p.name, {
      bold: true,
      scale: LAYOUT.teamNameScale,       // so the name reads as a heading
      gapAbove: i ? LAYOUT.personGap : 0
    }));
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

// The region a given timeline page draws into. Page 1 of the table shares page 2
// with the First Steps panel and is the short one; every continuation page is
// the taller page-3 profile.
const regionForPage = i => (i === 0 ? LAYOUT.timeline : LAYOUT.timelineCont);

// How many pages the table will need. Every height involved is a fixed constant,
// so this can be answered before anything is drawn — which is what lets the
// caller copy exactly that many background pages up front. Copying pages is
// async in pdf-lib and the drawing walk is not, so counting first is simpler
// than threading promises through the cursor.
//
// Must stay in step with the walk in drawTimeline: same fit test, same order,
// same per-page regions. The two profiles differ by ~200pt of height, so using
// one for both would misjudge the count badly.
export function timelinePageCount(timeline) {
  const t = LAYOUT.table;
  let pages = 1;
  let g = tableGeometry(regionForPage(0));
  let y = g.top - t.headerHeight;
  for (const week of (timeline.weeks || [])) {
    const needed = t.bandHeight + week.tasks.length * t.rowHeight;
    if (y - needed < g.bottom) {
      g = tableGeometry(regionForPage(pages));
      y = g.top - t.headerHeight;
      pages++;
    }
    y -= needed;
  }
  return pages;
}

// Walks the weeks across the supplied pages. A week's band and its rows are
// never split — a band stranded at the bottom with its tasks overleaf is worse
// than a shorter page.
export function drawTimeline(doc, fonts, pages, timeline) {
  const t = LAYOUT.table;
  let pi = 0;
  let page = pages[0];
  let g = tableGeometry(regionForPage(0));
  let y = drawTableHeader(page, fonts, g, g.top);

  for (const week of (timeline.weeks || [])) {
    const needed = t.bandHeight + week.tasks.length * t.rowHeight;
    if (y - needed < g.bottom && pi + 1 < pages.length) {
      page = pages[++pi];
      g = tableGeometry(regionForPage(pi));
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
