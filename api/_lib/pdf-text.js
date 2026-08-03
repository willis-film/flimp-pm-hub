// pdf-text.js — text measurement, wrapping and fit-to-box, for the kickoff PDF.
//
// Everything the generator draws goes through here, because every region on the
// page is the same problem: a block of lines that must sit inside a rectangle,
// at the largest size that fits, wrapped to the rectangle's width.
//
// Kept separate from the drawing code so it can be tested from Node without a
// PDF — the wrapping and fitting is where the bugs live, and it's pure once a
// font is supplied. The only thing it needs from pdf-lib is
// `font.widthOfTextAtSize`, which every embedded font provides.
//
// NOTE ON WHY THIS EXISTS AT ALL: an AcroForm field would have done its own
// wrapping and (with `0 Tf`) its own auto-sizing. We draw instead — see the
// LAYOUT BOXES note in js/panels/templates.js — so the wrapping and sizing are
// ours to do. In exchange we get per-line fonts, colours, indents and links,
// none of which a single-appearance form field can express.

// A line as the caller wants it drawn. `text` is the visible string; everything
// else is presentation the layout has to account for.
//
//   indent  extra left offset in points (sub-items)
//   gapAbove blank space before the line, in multiples of the line height
//   bold    pick the bold face
//   link    a URL — the drawn text becomes clickable
export function line(text, opts = {}) {
  return {
    text:     text == null ? '' : String(text),
    indent:   opts.indent   || 0,
    gapAbove: opts.gapAbove || 0,
    bold:     !!opts.bold,
    link:     opts.link     || ''
  };
}

// Break one line to fit `width` at `size`, returning one or more physical lines.
// Words longer than the width (a pasted URL, usually) are hard-split rather than
// allowed to overflow the box — a URL that runs off the page is worse than one
// broken across two lines.
export function wrap(font, text, size, width) {
  const out = [];
  const paragraphs = String(text).split('\n');
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let cur = '';
    for (const word of words) {
      const candidate = cur ? cur + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { cur = candidate; continue; }
      if (cur) { out.push(cur); cur = ''; }
      // The word alone still doesn't fit: split it at the last character that does.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
    }
    if (cur) out.push(cur);
  }
  return out;
}

// Lay a block of lines out at a given size: how tall is it, and what are the
// physical lines? Returns null if it doesn't fit the height.
//
// `leading` is a multiple of the font size, matching how the panel estimates.
export function layout(fonts, lines, { size, width, height, leading }) {
  const lineHeight = size * leading;
  const rows = [];
  let y = 0;
  for (const l of lines) {
    y += l.gapAbove * lineHeight;
    const font = l.bold ? fonts.bold : fonts.regular;
    const pieces = wrap(font, l.text, size, width - l.indent);
    for (const [i, piece] of pieces.entries()) {
      rows.push({
        text:   piece,
        indent: l.indent,
        bold:   l.bold,
        // Only the FIRST physical row of a wrapped line carries the link, so a
        // wrapped step doesn't produce two overlapping annotations.
        link:   i === 0 ? l.link : '',
        y
      });
      y += lineHeight;
    }
  }
  const used = y;
  return used <= height ? { rows, used, size, lineHeight } : null;
}

// The largest size in [minSize, size] at which the block fits, or the block at
// minSize if nothing fits. Steps down in halves of a point: finer than that is
// invisible, coarser leaves obvious slack.
//
// Returning an overflowing layout rather than throwing is deliberate. A kickoff
// with one step too many should still generate, with that step running past the
// box, so the person looking at it can see what to cut. Failing to produce a
// document teaches them nothing. `overflow` says which happened.
export function fit(fonts, lines, { size, minSize, width, height, leading }) {
  for (let s = size; s >= minSize; s -= 0.5) {
    const l = layout(fonts, lines, { size: s, width, height, leading });
    if (l) return { ...l, overflow: false };
  }
  const forced = layout(fonts, lines, { size: minSize, width, height: Infinity, leading });
  return { ...forced, size: minSize, overflow: true };
}
