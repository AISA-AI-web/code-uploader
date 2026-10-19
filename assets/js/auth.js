// Teacher sign-in gate, using Google's built-in school single sign-on.
//
// "Sign in" sends the teacher to the backend's Teachers deployment (Who has access: Anyone within
// the school). Google signs them in with their school account, the backend checks the email
// (and the Teachers tab, when the teacher list is on), and sends them back here with a session in
// the URL fragment.
import { CONFIG } from './config.js';
import { api, DEMO, getSession, setSession, clearSession } from './api.js';
import { h, iconEl } from './ui.js';

const ATTEMPT_KEY = 'hub-signin-attempt'; // stops a redirect loop if a sign-in comes back empty
const SIGNED_OUT_KEY = 'hub-signed-out'; // after "Sign out", don't sign straight back in
let schoolDomain = '';

function store(kind) {
  try { return window[kind]; } catch { return null; }
}

function pseudoSession(kind) {
  return { [kind]: true, role: 'admin', name: '', email: '', expiresAt: new Date(Date.now() + 12 * 3600e3).toISOString() };
}

/** True when this browser has a teacher session (used by the public activity page). */
export function isTeacher() {
  return DEMO || !!getSession();
}

export function signOut() {
  try { store('localStorage')?.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
  clearSession();
  window.location.reload();
}

// The /a/macros/<domain>/ form of a web app address makes Google use the school account. With the
// plain form, a browser that's also signed in to a personal Google account (as its default) gets
// "Sorry, unable to open the file at this time".
function signInAddress() {
  const url = CONFIG.signInUrl;
  return schoolDomain ? url.replace(/^https:\/\/script\.google\.com\/macros\/s\//, `https://script.google.com/a/macros/${schoolDomain}/s/`) : url;
}

function startSignIn() {
  try {
    store('sessionStorage')?.setItem(ATTEMPT_KEY, String(Date.now()));
    store('localStorage')?.removeItem(SIGNED_OUT_KEY);
  } catch { /* ignore */ }
  const back = window.location.href.split('#')[0];
  window.location.assign(`${signInAddress()}?action=signin&return=${encodeURIComponent(back)}`);
}

/** Reads what the sign-in page put after the # and removes it from the address bar. */
function takeSignInResult() {
  const hash = window.location.hash.slice(1);
  if (!/^hub-(session|error)=/.test(hash)) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  const params = new URLSearchParams(hash);
  if (params.has('hub-session')) {
    try {
      const b64 = params.get('hub-session').replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const session = JSON.parse(new TextDecoder().decode(bytes));
      if (session?.token && Date.parse(session.expiresAt) > Date.now()) return { session };
    } catch { /* fall through */ }
    return { error: 'Sign-in didn’t finish. Please try again.' };
  }
  return { error: params.get('hub-message') || 'Sign-in didn’t work. Please try again.', code: params.get('hub-error') };
}

/**
 * Resolves with the teacher's session. Without one, shows the sign-in card in `container` and
 * (unless the teacher just signed out or a sign-in just failed) goes straight to school sign-in.
 */
export async function requireTeacher(container) {
  if (DEMO) return pseudoSession('demo');
  const result = takeSignInResult();
  if (result?.session) {
    setSession(result.session);
    return result.session;
  }
  const existing = getSession();
  if (existing) return existing;

  const status = h('p', { class: 'gate-status', role: 'status' }, 'Checking sign-in…');
  const buttonSlot = h('div', { class: 'gate-button' });
  const text = h('p', { class: 'gate-text' }, `Use your ${CONFIG.schoolName} Google account to create activities and browse the shared library.`);
  container.textContent = '';
  container.append(h('section', { class: 'gate card' },
    h('div', { class: 'gate-icon' }, iconEl('lock')),
    h('p', { class: 'eyebrow' }, 'Teachers only'),
    h('h1', { class: 'gate-title' }, `Sign in to ${CONFIG.appName}`),
    text,
    buttonSlot,
    status,
    h('p', { class: 'gate-note muted small' }, 'Students: you don’t need to sign in — open the link or QR code your teacher shared.')));

  let config;
  try {
    config = await api.config();
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('is-error');
    throw e;
  }
  if (config.auth === 'open') {
    const s = pseudoSession('open');
    setSession(s);
    return s;
  }

  const domain = config.schoolDomain || '';
  schoolDomain = domain;
  const listNote = config.teacherList === false ? '' : ' Only teachers on the school’s list can get in.';
  if (domain) text.textContent = `Sign in with your @${domain} Google account to create activities and browse the shared library.${listNote}`;
  status.textContent = '';
  if (!CONFIG.signInUrl) {
    status.textContent = 'Teacher sign-in isn’t connected yet: an administrator needs to add signInUrl to assets/js/config.js (see README).';
    status.classList.add('is-error');
    return new Promise(() => {});
  }

  const button = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: startSignIn },
    iconEl('lock'), h('span', { class: 'btn-label' }, domain ? `Sign in with your @${domain} account` : 'Sign in with your school account'));
  buttonSlot.append(button);

  if (result?.error) {
    status.textContent = result.error;
    status.classList.add('is-error');
    return new Promise(() => {});
  }
  const lastAttempt = Number(store('sessionStorage')?.getItem(ATTEMPT_KEY) || 0);
  const signedOut = store('localStorage')?.getItem(SIGNED_OUT_KEY) === '1';
  if (!signedOut && Date.now() - lastAttempt > 60000) {
    // Single sign-on: teachers already signed in to their school Google account go straight in.
    status.textContent = 'Signing you in with your school account…';
    startSignIn();
  }
  return new Promise(() => {}); // the page navigates away to sign in
}
