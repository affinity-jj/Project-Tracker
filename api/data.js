import { get, put } from '@vercel/blob';
import { roleFor, noStore, NOT_CONFIGURED_MSG } from './_util.js';
import { SEED } from './_seed.js';

const BLOB_PATH = 'portfolio/data.json';

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function storageReady() {
  /* Legacy stores inject BLOB_READ_WRITE_TOKEN; OIDC-connected stores inject
     BLOB_STORE_ID and the SDK authenticates via the runtime OIDC token. */
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readData() {
  if (!storageReady()) {
    return { data: clone(SEED), storage: false };
  }
  try {
    const result = await get(BLOB_PATH, { access: 'private' });
    if (result && result.statusCode === 200 && result.stream) {
      const text = await new Response(result.stream).text();
      return { data: JSON.parse(text), storage: true };
    }
  } catch (e) {
    /* fall through to seed */
  }
  return { data: clone(SEED), storage: true };
}

async function writeData(data) {
  await put(BLOB_PATH, JSON.stringify(data), {
    access: 'private',
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0
  });
}

/*
 * When the editor saves a full document, keep any comments that were posted
 * (by viewers) after the editor last loaded, so a save can't silently drop them.
 * Union is by comment id, per project id.
 */
function mergeComments(stored, incoming) {
  const incomingProjects = new Map();
  (incoming.categories || []).forEach((c) =>
    (c.projects || []).forEach((p) => incomingProjects.set(p.id, p))
  );
  (stored.categories || []).forEach((c) =>
    (c.projects || []).forEach((sp) => {
      const ip = incomingProjects.get(sp.id);
      if (!ip) return;
      const have = new Set((ip.comments || []).map((x) => x.id));
      (sp.comments || []).forEach((sc) => {
        if (!have.has(sc.id)) {
          if (!ip.comments) ip.comments = [];
          ip.comments.push(sc);
        }
      });
      if (ip.comments) ip.comments.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    })
  );
  return incoming;
}

function validPayload(d) {
  if (!d || !Array.isArray(d.categories)) return false;
  return d.categories.every(
    (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.projects)
  );
}

export default async function handler(req, res) {
  noStore(res);

  const auth = roleFor(req.headers['x-portfolio-key']);
  if (auth.error === 'not-configured') {
    return res.status(503).json({ error: NOT_CONFIGURED_MSG });
  }
  if (auth.error) {
    return res.status(401).json({ error: 'Invalid or expired access key. Sign in again.' });
  }

  try {
    if (req.method === 'GET') {
      const { data, storage } = await readData();
      return res.status(200).json({ data, role: auth.role, storage });
    }

    if (req.method === 'PUT') {
      if (auth.role !== 'editor') {
        return res.status(403).json({ error: 'Editor access is required to save changes.' });
      }
      if (!storageReady()) {
        return res.status(503).json({
          error:
            'Blob storage is not connected. In Vercel: Project > Storage > Create Blob store, connect it to this project, then redeploy.'
        });
      }
      const incoming = req.body;
      if (!validPayload(incoming)) {
        return res.status(400).json({ error: 'Invalid payload.' });
      }
      const { data: stored } = await readData();
      const merged = mergeComments(stored, incoming);
      merged.updatedAt = Date.now();
      await writeData(merged);
      return res.status(200).json({ ok: true, data: merged });
    }

    if (req.method === 'POST') {
      /* Append a single comment. Allowed for viewers and editors. */
      const { projectId, author, text } = req.body || {};
      if (!projectId || !text || !String(text).trim()) {
        return res.status(400).json({ error: 'Comment text is required.' });
      }
      if (!storageReady()) {
        return res.status(503).json({
          error:
            'Blob storage is not connected. In Vercel: Project > Storage > Create Blob store, connect it to this project, then redeploy.'
        });
      }
      const { data } = await readData();
      let target = null;
      (data.categories || []).forEach((c) =>
        (c.projects || []).forEach((p) => {
          if (p.id === projectId) target = p;
        })
      );
      if (!target) return res.status(404).json({ error: 'Project not found.' });
      const comment = {
        id: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        author: String(author || 'Anonymous').trim().slice(0, 80) || 'Anonymous',
        text: String(text).trim().slice(0, 2000),
        ts: Date.now()
      };
      if (!target.comments) target.comments = [];
      target.comments.push(comment);
      data.updatedAt = Date.now();
      await writeData(data);
      return res.status(200).json({ ok: true, comment });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error: ' + (e && e.message ? e.message : 'unknown') });
  }
}
