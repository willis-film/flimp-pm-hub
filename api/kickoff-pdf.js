// api/kickoff-pdf.js — generates the kickoff PDF.
//
// Deliberately thin. All the work is in _lib/kickoff-build.js so it can be run
// from Node against a fixture with no server, no Supabase and no deploy — see
// test/kickoff-fixture.mjs. This file is only the HTTP wrapper.
//
// POST { page1, page2, timeline }  ->  application/pdf
//
// The panel resolves every value into finished strings before posting, so
// nothing here knows about rows, product types or the New/Update axis. See the
// payload contract in _lib/kickoff-build.js.

import { buildKickoffPdf } from './_lib/kickoff-build.js';

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

    const { bytes, notes, timelinePages } = await buildKickoffPdf(body);
    const name = (body.filename || 'kickoff').replace(/[^\w.-]+/g, '-');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    // Anything the generator wants to say about the result — an overflowing
    // region, a multi-page timeline — travels in a header rather than being
    // swallowed, so the panel can surface it after the download.
    if (notes.length) res.setHeader('X-Kickoff-Notes', JSON.stringify(notes));
    res.setHeader('X-Kickoff-Timeline-Pages', String(timelinePages));
    return res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    console.error('api/kickoff-pdf error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build the PDF' });
  }
}
