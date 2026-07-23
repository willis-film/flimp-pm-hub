// api/hello.js — throwaway control endpoint.
//
// Purpose: determine whether Vercel is building NEW files in api/ at all, or
// whether the problem is specific to sync-gmail-threads.js. Deliberately has
// no imports, no env vars, and no external calls — if this doesn't deploy,
// nothing about the file content is to blame.
//
// Delete once the question is answered.

export default function handler(req, res) {
  res.status(200).json({ ok: true, from: 'hello' });
}
