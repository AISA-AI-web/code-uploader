// Local development server: serves the site and runs the real apps-script/Code.gs against
// in-memory Google service mocks, so the whole app works offline.
//
//   npm run dev                 → http://localhost:8787 with sample activities and fake sign-in
//   npm run dev -- --empty      → start with an empty library
//   npm run dev -- --demo       → serve the site without a backend (browser-only demo mode)
//   npm run dev -- --no-ai      → turn off the simulated AI suggestions
//   LATENCY=800 npm run dev     → add a delay to API responses, like a real Apps Script
//
// Sign in as any @aisa.test email (e.g. teacher@aisa.test) on the stand-in for Google's school
// sign-in. The Teachers list below sets names and the admin, like the real Teachers tab while
// TEACHER_LIST is off.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, devFetchHandler } from './gas-mock.mjs';
import { classify } from '../assets/js/classifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.PORT || 8787);
const LATENCY = Number(process.env.LATENCY || 0);
const DEMO = args.has('--demo');

const TEACHERS = [
  ['teacher@aisa.test', 'Ms. Rivera', 'teacher'],
  ['coach@aisa.test', 'Mr. Haddad', 'teacher'],
  ['admin@aisa.test', 'Dr. Admin', 'admin'],
];

function suggestFromText(text) {
  // The AI receives extracted text, not HTML; rebuild just enough HTML for the local classifier.
  const line = (label) => (text.match(new RegExp(`^${label}: (.*)$`, 'm')) || [])[1] || '';
  const html = `<title>${line('Page title')}</title><h1>${line('Headings').split(' | ')[0]}</h1><p>${line('Visible text')}</p><p>${line('Text inside scripts \\(questions, feedback, etc.\\)')}</p>`;
  const r = classify(html, { context: line('Note the teacher pasted along with the code') });
  return { title: r.title, description: r.description, grades: r.grades, subject: r.subject, concept: r.concept, activityType: r.activityType, tags: r.tags };
}

const gas = createGas({
  fetchHandler: devFetchHandler({ classifyText: suggestFromText }),
  log: console.log,
  props: {
    SCHOOL_DOMAIN: 'aisa.test',
    SITE_URL: `http://localhost:${PORT}/`,
    ...(args.has('--no-ai') ? {} : { ANTHROPIC_API_KEY: 'dev-key' }),
  },
});

function seed() {
  gas.run('setup');
  const teachers = gas.sheet('Teachers');
  for (const row of TEACHERS) teachers.appendRow([...row, 'dev seed']);
  gas.run('clearCaches');
  if (args.has('--empty')) return;
  const sessions = {};
  const sessionFor = (email) => {
    if (!sessions[email]) sessions[email] = gas.signIn(email, `http://localhost:${PORT}/library.html`).session.token;
    return sessions[email];
  };
  const samples = fs.readdirSync(path.join(ROOT, 'dev', 'samples')).filter((f) => f.endsWith('.html')).sort();
  samples.forEach((file, i) => {
    const code = fs.readFileSync(path.join(ROOT, 'dev', 'samples', file), 'utf8');
    const meta = classify(code);
    const [email, name] = i % 2 ? TEACHERS[1] : TEACHERS[0];
    const res = gas.doPost({ action: 'create', session: sessionFor(email), ...meta, author: name, code });
    if (!res.ok) console.error('Seed failed for', file, res.error);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || rel.includes('\0')) return send(res, 403, 'Forbidden');
  if (rel === '/assets/js/config.js') {
    // Point the site at the local mock backend (or at no backend in --demo), never the real one.
    const src = fs.readFileSync(file, 'utf8')
      .replace(/apiUrl: '[^']*',/, DEMO ? "apiUrl: ''," : "apiUrl: '/api',")
      .replace(/signInUrl: '[^']*',/, DEMO ? "signInUrl: ''," : "signInUrl: '/signin',");
    return send(res, 200, src, TYPES['.js']);
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      const notFound = path.join(ROOT, '404.html');
      return fs.existsSync(notFound) ? send(res, 404, fs.readFileSync(notFound), TYPES['.html']) : send(res, 404, 'Not found');
    }
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

function handleApi(req, res, url) {
  const respond = (fn) => {
    setTimeout(() => {
      try {
        send(res, 200, JSON.stringify(fn()), 'application/json; charset=utf-8', { 'Access-Control-Allow-Origin': '*' });
      } catch (e) {
        console.error(e);
        send(res, 500, String(e.stack || e));
      }
    }, LATENCY);
  };
  if (req.method === 'GET') return respond(() => gas.doGet(Object.fromEntries(url.searchParams)));
  if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
  if (req.headers['content-type'] && !/^text\/plain/i.test(req.headers['content-type'])) {
    // Apps Script can't answer CORS preflights, so the real frontend must send text/plain.
    return send(res, 415, 'Send JSON as text/plain, like the real Apps Script backend expects.');
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => respond(() => gas.doPost(body)));
}

// Stands in for the "Teachers" deployment. In the real thing Google signs the teacher in with their
// school account before Code.gs runs; here you pick which account to pretend to be.
function handleSignIn(req, res, url) {
  const as = url.searchParams.get('as');
  if (as === null) {
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return send(res, 200, `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dev sign-in</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f4f4}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0002;display:grid;gap:12px;width:min(360px,90vw)}
input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #bbb}button{background:#1a73e8;color:#fff;border:0;font-weight:600}</style></head>
<body><form method="get" action="/signin"><strong>Development sign-in</strong>
<span>Stands in for Google’s school sign-in. Try ${esc(TEACHERS.map((t) => t[0]).join(', '))} or any other address.</span>
<input type="hidden" name="action" value="signin"><input type="hidden" name="return" value="${esc(url.searchParams.get('return') || '')}">
<input id="dev-email" name="as" type="email" value="teacher@aisa.test" aria-label="Email"><button id="dev-continue">Continue</button></form></body></html>`, TYPES['.html']);
  }
  gas.setActiveUser(as);
  const page = gas.doGetRaw(Object.fromEntries(url.searchParams)).getContent();
  gas.setActiveUser('');
  send(res, 200, page, TYPES['.html']);
}

if (!DEMO) seed();

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api') return handleApi(req, res, url);
  if (url.pathname === '/signin' && !DEMO) return handleSignIn(req, res, url);
  serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
  console.log(`Activity Hub dev server → http://localhost:${PORT}/`);
  console.log(DEMO ? 'Demo mode: no backend; activities are stored in the browser.' : `Sign in as: ${TEACHERS.map((t) => t[0]).join(', ')}`);
});
