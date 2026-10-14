// Teacher sign-in gate. Teachers sign in with Google; the backend checks the email against the
// "Teachers" tab of the private Google Sheet and returns a session token.
import { CONFIG } from './config.js';
import { api, DEMO, getSession, setSession, clearSession, ApiError } from './api.js';
import { h, iconEl } from './ui.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise = null;

function loadGis() {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load. Check your connection or any content blocker.')); };
      document.head.append(s);
    });
  }
  return gisPromise;
}

function pseudoSession(kind) {
  return { [kind]: true, role: 'admin', name: '', email: '', expiresAt: new Date(Date.now() + 12 * 3600e3).toISOString() };
}

/** True when this browser has a teacher session (used by the public activity page). */
export function isTeacher() {
  return DEMO || !!getSession();
}

export function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
  clearSession();
  window.location.reload();
}

/**
 * Resolves with the teacher session once signed in. While waiting, shows the sign-in card
 * inside `container`.
 */
export async function requireTeacher(container) {
  if (DEMO) return pseudoSession('demo');
  const existing = getSession();
  if (existing) return existing;

  const status = h('p', { class: 'gate-status', role: 'status' }, 'Checking sign-in…');
  const buttonSlot = h('div', { class: 'gate-button' });
  const card = h('section', { class: 'gate card' },
    h('div', { class: 'gate-icon' }, iconEl('lock')),
    h('p', { class: 'eyebrow' }, 'Teachers only'),
    h('h1', { class: 'gate-title' }, `Sign in to ${CONFIG.appName}`),
    h('p', { class: 'gate-text' }, `Use your ${CONFIG.schoolName} Google account to create activities and browse the shared library.`),
    buttonSlot,
    status,
    h('p', { class: 'gate-note muted small' }, 'Students: you don’t need to sign in — open the link or QR code your teacher shared.'));
  container.textContent = '';
  container.append(card);

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
  if (domain) {
    card.querySelector('.gate-text').textContent = `Sign in with your @${domain} Google account to create activities and browse the shared library. Only teachers on the school’s list can get in.`;
  }

  return new Promise((resolve) => {
    const finish = async (idToken) => {
      status.classList.remove('is-error');
      status.textContent = 'Signing you in…';
      try {
        const { session } = await api.login(idToken);
        setSession(session);
        resolve(session);
      } catch (e) {
        status.textContent = e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.';
        status.classList.add('is-error');
        // Don't keep signing in automatically with an account that isn't allowed.
        if (e.code === 'WRONG_DOMAIN' || e.code === 'NOT_TEACHER') {
          try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
        }
      }
    };

    if (CONFIG.devSignIn) {
      // Local development only (set by dev/server.mjs): fake Google sign-in.
      const email = h('input', { class: 'input', type: 'email', value: 'teacher@aisa.test', 'aria-label': 'Email' });
      const name = h('input', { class: 'input', type: 'text', value: 'Ms. Rivera', 'aria-label': 'Name' });
      const go = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => finish(`dev:${email.value}:${name.value}`) }, 'Dev sign-in');
      buttonSlot.append(h('div', { class: 'dev-signin' }, email, name, go));
      status.textContent = 'Development mode: any email can be tried; the Teachers list decides who gets in.';
      return;
    }

    if (!config.googleClientId) {
      status.textContent = 'Teacher sign-in isn’t finished being set up. An administrator needs to add GOOGLE_CLIENT_ID to the Apps Script properties (see README).';
      status.classList.add('is-error');
      return;
    }

    loadGis().then((google) => {
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (resp) => finish(resp.credential),
        ...(domain ? { hd: domain } : {}), // only offer school accounts in Google's account picker
        auto_select: true, // returning teachers already signed in to Google get straight in
        cancel_on_tap_outside: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton(buttonSlot, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left' });
      google.accounts.id.prompt();
      status.textContent = '';
    }).catch((e) => {
      status.textContent = e.message;
      status.classList.add('is-error');
    });
  });
}
