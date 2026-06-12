import { roleFor, noStore, NOT_CONFIGURED_MSG } from './_util.js';

export default function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const password = (req.body || {}).password;
  const r = roleFor(password);
  if (r.error === 'not-configured') {
    return res.status(503).json({ error: NOT_CONFIGURED_MSG });
  }
  if (r.error) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  return res.status(200).json({ role: r.role });
}
