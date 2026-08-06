// api/kickoff-html.js — returns the kickoff document as HTML.
//
// Deliberately thin, like api/kickoff-pdf.js beside it: all the work is in
// _lib/kickoff-html.js so it can be run from Node against a fixture with no
// server and no deploy (see test/kickoff-html.mjs).
//
// POST { page1, page2, timeline }  ->  text/html
//
// WHY HTML AND NOT A PDF. The document is drawn entirely by CSS now, so the
// thing that turns it into a PDF is a browser. The panel already has one: it
// loads this into a hidden iframe and calls print(), and the user picks
// "Save as PDF". No headless Chrome, no bundle, nothing to deploy.
//
// The response is a COMPLETE self-contained document — fonts, artwork and the
// doc-page component are all inlined — so it prints identically wherever it is
// opened, and can be saved and forwarded as-is.
//
// If unattended generation is ever wanted (a silent download, a filename set by
// us, no dialog), the same bytes go to a headless browser unchanged. That would
// be adding a renderer, not replacing this.

import { buildKickoffHtml } from './_lib/kickoff-html.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Expected a JSON payload { page1, page2, timeline }' });
    }

    const html = await buildKickoffHtml(body);

    // The page count is the thing most likely to surprise someone, and it isn't
    // visible until the print preview opens. Counted off data-screen-label
    // rather than the page element, because the inlined doc-page component's
    // own source contains that markup as a string.
    const pages = (html.match(/data-screen-label="Page \d+"/g) || []).length;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Kickoff-Pages', String(pages));
    return res.status(200).send(html);
  } catch (err) {
    console.error('api/kickoff-html error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build the document' });
  }
}
