import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './src/routes/api.js';
import { ensureSeedData } from './src/storage/jsonStore.js';
import { sessions } from './src/auth/sessions.js';

// Load .env file — search current dir and up to 4 parent dirs
(function loadEnv() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const publicDir  = path.join(__dirname, 'public');
const port       = Number(process.env.PORT || 4173);

await ensureSeedData();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ── Cookie helper ─────────────────────────────────────────────────────────────

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    try { cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim()); }
    catch { cookies[key] = pair.slice(idx + 1).trim(); }
  }
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token   = cookies['dt_session'];
  return token ? sessions.get(token) : null;
}

// Paths that work without a session
function isPublicPath(pathname) {
  return (
    pathname === '/login.html' ||
    pathname.startsWith('/api/auth/')
  );
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // ── Auth gate ──────────────────────────────────────────────────────────────
    if (!isPublicPath(url.pathname)) {
      const session = getSession(req);
      if (!session) {
        if (url.pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Session expired. Please sign in again.' }));
        } else {
          res.writeHead(302, { Location: '/login.html' });
          res.end();
        }
        return;
      }
    }

    // ── API ────────────────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res, url);
      return;
    }

    // ── Static files ──────────────────────────────────────────────────────────
    const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath  = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
    const filePath  = path.join(publicDir, safePath);
    const ext       = path.extname(filePath);
    const body      = await readFile(filePath);

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(body);

  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(port, () => {
  console.log(`Logistics dashboard running at http://localhost:${port}`);
});
