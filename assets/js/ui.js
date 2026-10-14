// Shared UI: DOM helper, icons, header, toasts, dialogs, sharing (link, QR code, Google Classroom), downloads.
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// DOM helper — always sets user content as text, never as HTML.
// ---------------------------------------------------------------------------

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only for trusted static markup such as icons
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// ---------------------------------------------------------------------------
// Icons (24×24 stroke icons)
// ---------------------------------------------------------------------------

const PATHS = {
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  classroom: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4"/><circle cx="12" cy="10" r="2.2"/><path d="M8.5 15a3.5 3.5 0 0 1 7 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  remix: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
}

export function iconEl(name, cls = '') {
  const span = document.createElement('span');
  span.className = 'icon-wrap';
  span.innerHTML = icon(name, cls);
  return span.firstElementChild;
}

/** Button with an icon and a label (label can be visually hidden on small screens). */
export function button(label, { iconName, variant = 'ghost', onClick, title, compact = false, type = 'button', attrs = {} } = {}) {
  const btn = h('button', { type, class: `btn btn-${variant}${compact ? ' btn-compact' : ''}`, title: title || (compact ? label : null), 'aria-label': compact ? label : null, onClick, ...attrs });
  if (iconName) btn.append(iconEl(iconName));
  btn.append(h('span', { class: 'btn-label' }, label));
  return btn;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function renderHeader({ active = '', session = null, onSignOut = null, teacher = false, slim = false } = {}) {
  const header = document.querySelector('[data-site-header]');
  if (!header) return;
  header.textContent = '';
  header.className = `site-header${slim ? ' site-header--slim' : ''}`;
  const brand = h('a', { class: 'brand', href: teacher ? 'library.html' : '#', 'aria-label': `${CONFIG.schoolName} ${CONFIG.appName}` },
    h('span', { class: 'brand-mark' }, CONFIG.schoolName),
    h('span', { class: 'brand-name' }, CONFIG.appName));
  if (!teacher) brand.removeAttribute('href');
  const nav = h('nav', { class: 'site-nav', 'aria-label': 'Main' });
  if (teacher) {
    const link = (href, label, iconName, key) => {
      const a = h('a', { href, class: `nav-link${active === key ? ' is-active' : ''}` });
      if (active === key) a.setAttribute('aria-current', 'page');
      a.append(iconEl(iconName), h('span', {}, label));
      return a;
    };
    nav.append(link('index.html', 'Create', 'plus', 'create'), link('library.html', 'Library', 'grid', 'library'));
  }
  header.append(brand, nav);
  if (session && !session.open && !session.demo && session.email) {
    const who = h('div', { class: 'user-chip', title: session.email });
    if (session.picture) who.append(h('img', { src: session.picture, alt: '', referrerpolicy: 'no-referrer', width: 28, height: 28 }));
    else who.append(h('span', { class: 'user-initial', 'aria-hidden': 'true' }, (session.name || session.email || '?').trim().charAt(0).toUpperCase()));
    who.append(h('span', { class: 'user-name' }, session.name || session.email));
    if (onSignOut) who.append(button('Sign out', { iconName: 'logout', compact: true, variant: 'header', onClick: onSignOut }));
    header.append(who);
  }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastRegion;
export function toast(message, type = 'info', ms = 3200) {
  if (!toastRegion) {
    toastRegion = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const t = h('div', { class: `toast toast-${type}` }, message);
  toastRegion.append(t);
  requestAnimationFrame(() => t.classList.add('is-visible'));
  setTimeout(() => {
    t.classList.remove('is-visible');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export function openDialog({ title, body, actions = [], size = 'md', onClose, className = '' }) {
  const dlg = h('dialog', { class: `dialog dialog-${size} ${className}`, 'aria-labelledby': 'dlg-title' });
  const close = () => { if (dlg.open) dlg.close(); };
  const head = h('div', { class: 'dialog-head' },
    h('h2', { id: 'dlg-title', class: 'dialog-title' }, title || ''),
    button('Close', { iconName: 'x', compact: true, variant: 'ghost', onClick: close }));
  const content = h('div', { class: 'dialog-body' }, body);
  dlg.append(head, content);
  if (actions.length) {
    const foot = h('div', { class: 'dialog-actions' });
    for (const a of actions) {
      foot.append(button(a.label, {
        iconName: a.icon,
        variant: a.variant || 'ghost',
        onClick: async () => {
          const keepOpen = a.onClick ? await a.onClick() : false;
          if (keepOpen !== true) close();
        },
      }));
    }
    dlg.append(foot);
  }
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      size: 'sm',
      body: h('p', {}, message),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------------------------------------------------------------------------
// Links, clipboard, downloads
// ---------------------------------------------------------------------------

export function siteBase() {
  const base = CONFIG.publicBaseUrl || new URL('.', window.location.href).href;
  return base.endsWith('/') ? base : `${base}/`;
}

export function activityUrl(id) {
  return `${siteBase()}view.html?id=${encodeURIComponent(id)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export async function copyLink(url) {
  if (await copyText(url)) toast('Link copied — paste it anywhere.', 'success');
  else toast('Couldn’t copy automatically. Select the link and copy it.', 'error');
}

export function slugify(text) {
  return String(text || 'activity')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'activity';
}

export function downloadFile(filename, content, type = 'text/html;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadActivity(activity) {
  downloadFile(`${slugify(activity.title)}.html`, activity.code);
  toast('Download started.', 'success');
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Google Classroom
// ---------------------------------------------------------------------------

export function shareToClassroom({ url, title, description }) {
  const params = new URLSearchParams({
    url,
    title: title || '',
    body: description ? `${description}\n\nOpen the activity: ${url}` : `Open the activity: ${url}`,
    itemtype: 'assignment',
  });
  const shareUrl = `https://classroom.google.com/share?${params}`;
  const w = 620;
  const hgt = 640;
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - hgt) / 2);
  const win = window.open(shareUrl, 'classroom-share', `width=${w},height=${hgt},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (win) {
    try { win.opener = null; } catch { /* cross-origin */ }
  } else {
    window.open(shareUrl, '_blank', 'noopener');
  }
}

// ---------------------------------------------------------------------------
// QR codes (uses the vendored qrcode-generator library: assets/vendor/qrcode.js)
// ---------------------------------------------------------------------------

function makeQr(text) {
  if (typeof window.qrcode !== 'function') throw new Error('QR library not loaded');
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('qr-svg');
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}

export function qrPng(text, title) {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  const scale = Math.floor(900 / (n + 8));
  const qrSize = scale * (n + 8);
  const pad = 60;
  const width = qrSize + pad * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '"DM Sans", system-ui, sans-serif';
  const titleLines = [];
  if (title) {
    ctx.font = `700 44px ${font}`;
    let line = '';
    for (const word of String(title).split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width - pad * 2 && line) { titleLines.push(line); line = word; } else line = test;
    }
    if (line) titleLines.push(line);
  }
  const lines = titleLines.slice(0, 3);
  const titleH = lines.length ? lines.length * 56 + 20 : 0;
  canvas.width = width;
  canvas.height = pad + titleH + qrSize + 70 + pad / 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#21076C';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `700 44px ${font}`;
  lines.forEach((l, i) => ctx.fillText(l, width / 2, pad + i * 56));
  ctx.fillStyle = '#000';
  const top = pad + titleH;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(pad + (c + 4) * scale, top + (r + 4) * scale, scale, scale);
    }
  }
  ctx.fillStyle = '#555';
  ctx.font = `400 26px ${font}`;
  ctx.fillText(text.replace(/^https?:\/\//, ''), width / 2, top + qrSize + 18, width - pad);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** The QR / share dialog used on every page. */
export function openShareDialog({ id, title, description, heading = 'Share this activity', intro = null }) {
  const url = activityUrl(id);
  const linkInput = h('input', { class: 'input link-input', type: 'text', readonly: true, value: url, 'aria-label': 'Activity link', onFocus: (e) => e.target.select() });
  const qrBox = h('div', { class: 'qr-box' }, qrSvg(url, { label: `QR code for ${title}` }));
  const present = h('div', { class: 'qr-present' },
    h('div', { class: 'qr-present-title' }, title),
    qrSvg(url, { label: `QR code for ${title}` }),
    h('div', { class: 'qr-present-url' }, url.replace(/^https?:\/\//, '')),
    h('div', { class: 'qr-present-hint' }, 'Press Esc to exit'));
  const body = h('div', { class: 'share-dialog' },
    intro,
    h('div', { class: 'share-grid' },
      h('div', { class: 'share-qr' }, qrBox, h('p', { class: 'muted small' }, 'Students scan this with a tablet or phone camera.')),
      h('div', { class: 'share-actions' },
        h('label', { class: 'field-label', for: 'share-link' }, 'Activity link'),
        h('div', { class: 'link-row' }, Object.assign(linkInput, { id: 'share-link' }), button('Copy', { iconName: 'link', variant: 'primary', onClick: () => copyLink(url), attrs: { autofocus: true } })),
        button('Share to Google Classroom', { iconName: 'classroom', variant: 'classroom', onClick: () => shareToClassroom({ url, title, description }) }),
        button('Show QR code full screen', { iconName: 'fullscreen', variant: 'ghost', onClick: () => present.requestFullscreen?.().catch(() => toast('Full screen isn’t available here.', 'error')) }),
        button('Download QR code (PNG)', {
          iconName: 'download',
          variant: 'ghost',
          onClick: async () => {
            const blob = await qrPng(url, title);
            downloadFile(`${slugify(title)}-qr.png`, blob, 'image/png');
          },
        }),
        button('Open activity in a new tab', { iconName: 'external', variant: 'ghost', onClick: () => window.open(url, '_blank', 'noopener') }))),
    present);
  return openDialog({ title: heading, body, size: 'lg', className: 'share-dialog-wrap' });
}

/** Inserts icons into static markup: <button data-icon="upload">Upload</button> */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.querySelector(':scope > svg.icon')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

/** Swaps a button into a loading state; returns a function that restores it. */
export function busy(btn, label) {
  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '';
  btn.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'btn-label' }, label));
  return () => { btn.innerHTML = original; btn.disabled = wasDisabled; };
}
