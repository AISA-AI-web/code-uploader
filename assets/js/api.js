// Talks to the Google Apps Script backend. With no apiUrl configured it runs a demo backend
// that keeps everything in this browser's localStorage.
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.apiUrl;
const SESSION_KEY = 'hub-session';

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'ERROR';
  }
}

// ---------------------------------------------------------------------------
// Teacher session (a signed token issued by the backend after Google sign-in)
// ---------------------------------------------------------------------------

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function getSession() {
  try {
    const s = JSON.parse(storage()?.getItem(SESSION_KEY) || 'null');
    if (!s || !s.expiresAt || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function setSession(session) {
  try { storage()?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode */ }
}

export function clearSession() {
  const had = !!getSession();
  try {
    storage()?.removeItem(SESSION_KEY);
    storage()?.removeItem('hub-library-cache'); // don't leave the library on a shared computer
  } catch { /* ignore */ }
  if (had) window.dispatchEvent(new CustomEvent('hub:signed-out'));
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const SESSION_ERRORS = new Set(['AUTH_REQUIRED', 'SESSION_EXPIRED', 'NOT_TEACHER']);

// Read-only actions are retried once: Apps Script occasionally fails a request when many
// students open the same link at the same moment.
const RETRYABLE_ACTIONS = new Set(['config', 'get', 'list']);
const RETRYABLE_ERRORS = new Set(['NETWORK', 'BAD_RESPONSE', 'BUSY']);

async function call(action, payload = {}, options = {}) {
  try {
    return await request(action, payload, options);
  } catch (e) {
    if (!RETRYABLE_ACTIONS.has(action) || !RETRYABLE_ERRORS.has(e.code)) throw e;
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1200));
    return request(action, payload, options);
  }
}

async function request(action, payload = {}, { timeout = 60000 } = {}) {
  if (DEMO) return demoCall(action, payload);
  const session = getSession();
  const body = JSON.stringify({ ...payload, action, session: session?.token || undefined });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    // text/plain keeps this a "simple" request, so the browser doesn't send a CORS preflight
    // (Apps Script can't answer those).
    res = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(
      e.name === 'AbortError'
        ? 'The activity server took too long to respond. Please try again.'
        : 'Couldn’t reach the activity server. Check your internet connection and try again.',
      'NETWORK'
    );
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('The activity server sent an unexpected response. An administrator may need to check the Apps Script deployment.', 'BAD_RESPONSE');
  }
  if (!data || !data.ok) {
    if (SESSION_ERRORS.has(data?.code)) clearSession();
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', data?.code);
  }
  return data;
}

let configPromise = null;

export const api = {
  /** { auth: 'google' | 'open' | 'demo', googleClientId, ai, maxCodeBytes } */
  config() {
    if (!configPromise) configPromise = call('config').catch((e) => { configPromise = null; throw e; });
    return configPromise;
  },
  list() { return call('list'); },
  get(id) { return call('get', { id }); },
  create(activity) { return call('create', activity, { timeout: 120000 }); },
  update(id, activity) { return call('update', { ...activity, id }, { timeout: 120000 }); },
  remove(id) { return call('delete', { id }); },
  classify(text) { return call('classify', { text }, { timeout: 90000 }); },
};

// ---------------------------------------------------------------------------
// Demo backend (no server configured)
// ---------------------------------------------------------------------------

const DEMO_KEY = 'hub-demo-activities';
const META_FIELDS = ['title', 'description', 'grades', 'subject', 'concept', 'activityType', 'tags', 'author'];

function demoLoad() {
  try { return JSON.parse(storage()?.getItem(DEMO_KEY) || '[]'); } catch { return []; }
}

function demoSave(list) {
  try {
    storage()?.setItem(DEMO_KEY, JSON.stringify(list));
  } catch {
    throw new ApiError('This browser’s storage is full. In demo mode activities are kept in the browser — connect the Apps Script backend to store more.', 'STORAGE_FULL');
  }
}

function demoId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function publicRecord(rec) {
  const { code, ...meta } = rec;
  return { ...meta, mine: true, canEdit: true };
}

async function demoCall(action, p) {
  await new Promise((r) => setTimeout(r, 120));
  const list = demoLoad();
  const find = (id) => list.find((a) => a.id === id && a.status === 'active');
  const pickMeta = (src) => Object.fromEntries(META_FIELDS.filter((f) => src[f] !== undefined).map((f) => [f, src[f]]));
  switch (action) {
    case 'config':
      return { ok: true, auth: 'demo', ai: false, maxCodeBytes: 5 * 1024 * 1024 };
    case 'list':
      return { ok: true, activities: list.filter((a) => a.status === 'active').map(publicRecord).reverse() };
    case 'get': {
      const a = find(p.id);
      if (!a) throw new ApiError('We couldn’t find that activity. It may have been removed, or the link may be incomplete.', 'NOT_FOUND');
      return { ok: true, activity: { ...publicRecord(a), code: a.code } };
    }
    case 'create': {
      const now = new Date().toISOString();
      const rec = { ...pickMeta(p), id: demoId(), code: p.code, remixOf: p.remixOf || '', createdAt: now, updatedAt: now, status: 'active' };
      list.push(rec);
      demoSave(list);
      return { ok: true, id: rec.id, activity: publicRecord(rec) };
    }
    case 'update': {
      const a = find(p.id);
      if (!a) throw new ApiError('Activity not found.', 'NOT_FOUND');
      Object.assign(a, pickMeta(p), p.code !== undefined ? { code: p.code } : {}, { updatedAt: new Date().toISOString() });
      demoSave(list);
      return { ok: true, activity: publicRecord(a) };
    }
    case 'delete': {
      const a = find(p.id);
      if (a) { a.status = 'deleted'; delete a.code; demoSave(list); }
      return { ok: true };
    }
    case 'classify':
      throw new ApiError('AI analysis isn’t available in demo mode.', 'AI_DISABLED');
    default:
      throw new ApiError(`Unknown action: ${action}`, 'BAD_ACTION');
  }
}
