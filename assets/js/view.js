// Activity viewer — the page students open from a link or QR code.
// Students see the activity with Download / Print / Full screen. Signed-in teachers also get
// sharing (Classroom, QR, link), details, remix, edit and delete.
import { CONFIG } from './config.js';
import { api } from './api.js';
import { isTeacher } from './auth.js';
import { buildSrcdoc, createActivityFrame } from './code-tools.js';
import { formatGrades } from './taxonomy.js';
import {
  h, iconEl, button, toast, openDialog, confirmDialog, openShareDialog, shareToClassroom,
  activityUrl, copyLink, copyText, downloadActivity, formatDate,
} from './ui.js';

const $ = (sel) => document.querySelector(sel);
const STORE_LIMIT = 1024 * 1024;
let activity = null;
let frame = null;

function storeKey(id) { return `hub-store:${id}`; }

function loadActivityStorage(id) {
  try { return JSON.parse(window.localStorage.getItem(storeKey(id)) || '{}') || {}; } catch { return {}; }
}

function saveActivityStorage(id, data) {
  try {
    const json = JSON.stringify(data);
    if (json.length > STORE_LIMIT) return;
    window.localStorage.setItem(storeKey(id), json);
  } catch { /* storage unavailable or full */ }
}

function showStatus(title, message, actions = []) {
  const status = $('#status');
  status.hidden = false;
  status.textContent = '';
  status.append(h('div', {}, h('div', { class: 'big', style: 'font-size:2.6rem', 'aria-hidden': 'true' }, '🧭'), h('h2', {}, title), h('p', { class: 'muted' }, message), ...actions));
}

function render() {
  const a = activity;
  const teacher = isTeacher();
  document.title = `${a.title} · ${CONFIG.schoolName} ${CONFIG.appName}`;
  $('#title').textContent = a.title;
  $('#title').dir = 'auto';
  $('#meta').textContent = [formatGrades(a.grades), a.subject !== 'Other' ? a.subject : '', a.concept].filter(Boolean).join(' · ');

  const brand = $('#brand');
  brand.textContent = CONFIG.schoolName;
  if (teacher) { brand.href = 'library.html'; brand.title = 'Back to the library'; }

  const stage = $('#stage');
  frame = createActivityFrame(a.title);
  frame.srcdoc = buildSrcdoc(a.code, { storage: loadActivityStorage(a.id) });
  stage.append(frame);
  $('#status').hidden = true;

  const url = activityUrl(a.id);
  const actions = $('#actions');
  actions.textContent = '';
  const download = button('Download', { iconName: 'download', variant: 'ghost', onClick: () => downloadActivity(a), title: 'Download the activity as an HTML file' });
  const full = button('Full screen', { iconName: 'fullscreen', variant: 'ghost', onClick: () => stage.requestFullscreen?.().catch(() => toast('Full screen isn’t available here.', 'error')) });
  const print = () => frame?.contentWindow?.postMessage({ __hub: 'print' }, '*');

  if (!teacher) {
    actions.append(download, button('Print', { iconName: 'print', variant: 'ghost', onClick: print, title: 'Print or save as PDF' }), full);
    return;
  }

  const classroom = button('Classroom', { iconName: 'classroom', variant: 'primary', onClick: () => shareToClassroom({ url, title: a.title, description: a.description }), title: 'Share to Google Classroom' });
  classroom.classList.add('keep-label');
  const qr = button('QR code', { iconName: 'qr', variant: 'ghost', onClick: () => openShareDialog({ id: a.id, title: a.title, description: a.description }) });
  const link = button('Copy link', { iconName: 'link', variant: 'ghost', onClick: () => copyLink(url) });
  link.classList.add('hide-sm');
  full.classList.add('hide-sm');

  const menuItems = [
    button('Copy link', { iconName: 'link', onClick: () => copyLink(url), attrs: { class: 'btn btn-ghost show-sm' } }),
    button('Full screen', { iconName: 'fullscreen', onClick: () => stage.requestFullscreen?.().catch(() => toast('Full screen isn’t available here.', 'error')), attrs: { class: 'btn btn-ghost show-sm' } }),
    button('Print / save as PDF', { iconName: 'print', onClick: print }),
    button('Details', { iconName: 'info', onClick: showDetails }),
    button('View code', { iconName: 'code', onClick: showCode }),
    button('Remix (make my own copy)', { iconName: 'remix', onClick: () => { window.location.href = `index.html?remix=${encodeURIComponent(a.id)}`; } }),
  ];
  if (a.canEdit) {
    menuItems.push(h('div', { class: 'menu-sep' }),
      button('Edit', { iconName: 'edit', onClick: () => { window.location.href = `index.html?edit=${encodeURIComponent(a.id)}`; } }),
      button('Delete', { iconName: 'trash', onClick: remove, attrs: { class: 'btn btn-ghost is-danger' } }));
  }
  menuItems.push(h('div', { class: 'menu-sep' }), button('Back to the library', { iconName: 'back', onClick: () => { window.location.href = 'library.html'; } }));
  actions.append(classroom, qr, link, download, full, menu(menuItems));
}

function menu(items) {
  const list = h('div', { class: 'menu-list', role: 'menu', hidden: true }, items);
  const toggle = button('More', { iconName: 'more', variant: 'ghost', compact: true, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
  const close = () => { list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) list.querySelector('button')?.focus();
  });
  list.addEventListener('click', close);
  document.addEventListener('click', (e) => { if (!list.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) { close(); toggle.focus(); } });
  return h('div', { class: 'menu' }, toggle, list);
}

function showDetails() {
  const a = activity;
  const row = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : []);
  const more = new URLSearchParams();
  if (a.grades[0]) more.set('grade', a.grades[0]);
  if (a.subject && a.subject !== 'Other') more.set('subject', a.subject);
  openDialog({
    title: a.title,
    body: h('div', {},
      a.description ? h('p', { style: 'margin-bottom:1rem' }, a.description) : null,
      h('dl', { class: 'info-list' },
        row('Grade', formatGrades(a.grades)),
        row('Subject', a.subject),
        row('Concept', a.concept),
        row('Type', a.activityType),
        row('Tags', (a.tags || []).join(', ')),
        row('Shared by', a.author),
        row('Created', formatDate(a.createdAt)),
        row('Updated', a.updatedAt && a.updatedAt !== a.createdAt ? formatDate(a.updatedAt) : ''),
        row('Link', activityUrl(a.id)))),
    actions: [
      { label: 'Find similar activities', icon: 'search', onClick: () => { window.location.href = `library.html?${more}`; } },
      { label: 'Close', variant: 'primary' },
    ],
  });
}

function showCode() {
  openDialog({
    title: 'Activity code',
    size: 'lg',
    body: h('pre', { class: 'code-view' }, activity.code),
    actions: [
      { label: 'Copy code', icon: 'clipboard', onClick: async () => { toast((await copyText(activity.code)) ? 'Code copied.' : 'Couldn’t copy — select the code instead.', 'success'); return true; } },
      { label: 'Download', icon: 'download', onClick: () => downloadActivity(activity) },
    ],
  });
}

async function remove() {
  const ok = await confirmDialog({
    title: 'Delete this activity?',
    message: `“${activity.title}” will be removed from the library and its link and QR code will stop working for everyone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.remove(activity.id);
    toast('Activity deleted.', 'success');
    setTimeout(() => { window.location.href = 'library.html'; }, 900);
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
}

function onMessage(e) {
  if (!frame || e.source !== frame.contentWindow || !e.data || e.data.__hub !== 'storage') return;
  const data = e.data.data;
  if (!data || typeof data !== 'object') return;
  const clean = {};
  for (const [k, v] of Object.entries(data)) clean[String(k)] = String(v);
  saveActivityStorage(activity.id, clean);
}

async function start() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get('id') || '').trim();
  window.addEventListener('message', onMessage);
  if (!id) {
    $('#title').textContent = CONFIG.appName;
    showStatus('No activity selected', 'This link is missing the activity code. Ask your teacher for the full link or QR code.');
    return;
  }
  try {
    ({ activity } = await api.get(id));
  } catch (e) {
    $('#title').textContent = 'Activity not available';
    const retry = e.code === 'NETWORK' ? [h('button', { type: 'button', class: 'btn btn-primary', style: 'margin-top:1rem', onClick: () => window.location.reload() }, 'Try again')] : [];
    showStatus(e.code === 'NOT_FOUND' ? 'We couldn’t find this activity' : 'The activity didn’t load', e.message, retry);
    return;
  }
  activity.grades = activity.grades || [];
  render();

  if (params.has('new') || params.has('saved')) {
    params.delete('new');
    params.delete('saved');
    history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
}

// Show the "it's live" dialog once, straight after publishing.
const first = new URLSearchParams(window.location.search);
const justPublished = first.has('new');
const justSaved = first.has('saved');
start().then(() => {
  if (!activity) return;
  if (justPublished) {
    openShareDialog({
      id: activity.id,
      title: activity.title,
      description: activity.description,
      heading: 'Your activity is live!',
      intro: h('div', { class: 'celebrate' }, iconEl('check'), 'Published. Share it with your class using the link, QR code or Google Classroom.'),
    });
  } else if (justSaved) {
    toast('Changes saved — the link and QR code stay the same.', 'success', 4500);
  }
});
