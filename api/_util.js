import crypto from 'crypto';

/* Constant-time string comparison. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length || ab.length === 0) {
    // Burn comparable time, then fail.
    if (ab.length > 0) crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/*
 * Resolve a submitted key to a role.
 * EDITOR_PASSWORD -> full edit access
 * VIEWER_PASSWORD -> read-only + comments
 */
export function roleFor(key) {
  const editor = process.env.EDITOR_PASSWORD;
  const viewer = process.env.VIEWER_PASSWORD;
  if (!editor && !viewer) return { error: 'not-configured' };
  if (editor && safeEqual(key, editor)) return { role: 'editor' };
  if (viewer && safeEqual(key, viewer)) return { role: 'viewer' };
  return { error: 'invalid' };
}

export const NOT_CONFIGURED_MSG =
  'Access passwords are not configured. In Vercel: Project > Settings > Environment Variables, add VIEWER_PASSWORD and EDITOR_PASSWORD, then redeploy.';

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}
