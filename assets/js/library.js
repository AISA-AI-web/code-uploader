// Shared library: search and filter activities by grade, subject and type.
import { CONFIG } from './config.js';
import { api } from './api.js';
import { requireTeacher, signOut } from './auth.js';
import { GRADES, GRADE_BANDS, SUBJECT_NAMES, ACTIVITY_TYPES, normalizeGrades, formatGrades, gradeIndex, subjectIcon } from './taxonomy.js';
import { h, iconEl, renderHeader, toast, hydrateIcons, openShareDialog, shareToClassroom, activityUrl, downloadActivity, formatDate, button } from './ui.js';

const $ = (sel) => document.querySelector(sel);
const PAGE_SIZE = 48;
const CACHE_KEY = 'hub-library-cache';

const state = {
  all: [],
  filters: { q: '', grade: '', subject: '', type: '', sort: 'new', mine: false },
  shown: PAGE_SIZE,
  loaded: false,
};

function readFilters() {
  const p = new URLSearchParams(window.location.search);
  const f = state.filters;
  f.q = p.get('q') || '';
  f.grade = GRADES.includes(p.get('grade')) ? p.get('grade') : '';
  f.subject = SUBJECT_NAMES.includes(p.get('subject')) ? p.get('subject') : '';
  f.type = ACTIVITY_TYPES.includes(p.get('type')) ? p.get('type') : '';
  f.sort = ['new', 'old', 'title', 'grade'].includes(p.get('sort')) ? p.get('sort') : 'new';
  f.mine = p.get('mine') === '1';
}

function writeFilters() {
  const f = state.filters;
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.grade) p.set('grade', f.grade);
  if (f.subject) p.set('subject', f.subject);
  if (f.type) p.set('type', f.type);
  if (f.sort !== 'new') p.set('sort', f.sort);
  if (f.mine) p.set('mine', '1');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

function normalizeActivity(a) {
  const grades = normalizeGrades(a.grades);
  const tags = Array.isArray(a.tags) ? a.tags : String(a.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const haystack = [a.title, a.concept, a.description, a.subject, a.activityType, a.author, tags.join(' '), formatGrades(grades)].join(' ').toLowerCase();
  return { ...a, grades, tags, haystack, minGrade: grades.length ? gradeIndex(grades[0]) : 99 };
}

function matches(a, f, ignore = '') {
  if (ignore !== 'grade' && f.grade && !a.grades.includes(f.grade)) return false;
  if (ignore !== 'subject' && f.subject && a.subject !== f.subject) return false;
  if (ignore !== 'type' && f.type && a.activityType !== f.type) return false;
  if (f.mine && !a.mine) return false;
  if (f.q) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => a.haystack.includes(w))) return false;
  }
  return true;
}

function sorted(list) {
  const by = state.filters.sort;
  const copy = [...list];
  if (by === 'old') copy.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  else if (by === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  else if (by === 'grade') copy.sort((a, b) => a.minGrade - b.minGrade || a.title.localeCompare(b.title));
  else copy.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return copy;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderGradeChips() {
  const wrap = $('#grade-chips');
  wrap.textContent = '';
  const counts = {};
  for (const a of state.all) if (matches(a, state.filters, 'grade')) for (const g of a.grades) counts[g] = (counts[g] || 0) + 1;
  const chip = (value, label, title) => {
    const pressed = state.filters.grade === value;
    const btn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), title },
      label, value && counts[value] ? h('span', { class: 'count' }, counts[value]) : null);
    btn.addEventListener('click', () => { state.filters.grade = pressed ? '' : value; refresh(); });
    return btn;
  };
  wrap.append(h('div', { class: 'grade-group' }, chip('', 'All grades', 'Show every grade')));
  for (const band of GRADE_BANDS) {
    const group = h('div', { class: 'grade-group', role: 'group', 'aria-label': band.label });
    for (const g of band.grades) group.append(chip(g, g === 'Pre-K' || g === 'K' ? g : `Gr ${g}`, g === 'K' ? 'Kindergarten' : g === 'Pre-K' ? 'Pre-K' : `Grade ${g}`));
    wrap.append(group);
  }
  const active = wrap.querySelector('[aria-pressed="true"]');
  if (active && state.filters.grade) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderSelect(sel, label, values, current, key) {
  const counts = {};
  for (const a of state.all) if (matches(a, state.filters, key)) counts[a[key === 'type' ? 'activityType' : key]] = (counts[a[key === 'type' ? 'activityType' : key]] || 0) + 1;
  sel.textContent = '';
  sel.append(h('option', { value: '' }, label));
  for (const v of values) sel.append(h('option', { value: v }, counts[v] ? `${v} (${counts[v]})` : v));
  sel.value = current;
}

function card(a) {
  const url = activityUrl(a.id);
  const actions = h('div', { class: 'actions' },
    button('QR code', { iconName: 'qr', compact: true, onClick: () => openShareDialog({ id: a.id, title: a.title, description: a.description }) }),
    button('Share to Google Classroom', { iconName: 'classroom', compact: true, onClick: () => shareToClassroom({ url, title: a.title, description: a.description }) }),
    button('Download', {
      iconName: 'download',
      compact: true,
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { activity } = await api.get(a.id);
          downloadActivity(activity);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      },
    }),
    button('Remix', { iconName: 'remix', compact: true, onClick: () => { window.location.href = `index.html?remix=${encodeURIComponent(a.id)}`; } }));
  const tags = h('div', { class: 'tags' },
    a.activityType && a.activityType !== 'Other' ? h('span', { class: 'tag tag-gold' }, a.activityType) : null,
    a.tags.filter((t) => t.toLowerCase() !== String(a.activityType).toLowerCase()).slice(0, 3).map((t) => h('span', { class: 'tag' }, t)));
  const byline = [a.author, formatDate(a.createdAt), a.mine ? 'yours' : ''].filter(Boolean).join(' · ');
  return h('article', { class: 'card activity-card' },
    h('div', { class: 'top' },
      h('div', { class: 'subject-tile', 'aria-hidden': 'true' }, subjectIcon(a.subject)),
      h('div', { class: 'top-text' },
        h('p', { class: 'eyebrow' }, [formatGrades(a.grades), a.subject].filter(Boolean).join(' · ')),
        h('h3', { dir: 'auto' }, h('a', { href: `view.html?id=${encodeURIComponent(a.id)}` }, a.title)),
        a.concept ? h('p', { class: 'concept', dir: 'auto' }, a.concept) : null)),
    a.description ? h('p', { class: 'desc', dir: 'auto' }, a.description) : null,
    tags,
    byline ? h('p', { class: 'byline' }, byline) : null,
    h('div', { class: 'foot' },
      h('span', { class: 'open-hint', 'aria-hidden': 'true' }, 'Open', iconEl('back', 'flip')),
      actions));
}

function render() {
  const f = state.filters;
  $('#q').value !== f.q && ($('#q').value = f.q);
  renderGradeChips();
  renderSelect($('#subject'), 'All subjects', SUBJECT_NAMES, f.subject, 'subject');
  renderSelect($('#type'), 'All activity types', ACTIVITY_TYPES, f.type, 'type');
  $('#sort').value = f.sort;
  $('#mine').setAttribute('aria-pressed', String(f.mine));

  const results = sorted(state.all.filter((a) => matches(a, f)));
  const grid = $('#grid');
  grid.textContent = '';
  grid.setAttribute('aria-busy', 'false');
  const filtered = !!(f.q || f.grade || f.subject || f.type || f.mine);
  $('#reset').hidden = !filtered;
  $('#count').textContent = state.all.length
    ? `${results.length} ${results.length === 1 ? 'activity' : 'activities'}${filtered ? ` (of ${state.all.length})` : ''}`
    : '';

  if (!results.length) {
    grid.append(h('div', { class: 'empty-state', style: 'grid-column: 1 / -1' },
      h('div', { class: 'big', 'aria-hidden': 'true' }, state.all.length ? '🔍' : '🌱'),
      h('h2', {}, state.all.length ? 'No activities match' : 'The library is empty — for now'),
      h('p', {}, state.all.length ? 'Try another grade or subject, or clear the filters.' : 'Be the first to share an activity with your colleagues.'),
      state.all.length
        ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: resetFilters }, 'Clear filters')
        : h('a', { class: 'btn btn-gold', href: 'index.html' }, 'Create an activity')));
    $('#more').hidden = true;
    return;
  }
  for (const a of results.slice(0, state.shown)) grid.append(card(a));
  $('#more').hidden = results.length <= state.shown;
}

function refresh() {
  state.shown = PAGE_SIZE;
  writeFilters();
  render();
}

function resetFilters() {
  Object.assign(state.filters, { q: '', grade: '', subject: '', type: '', mine: false });
  refresh();
}

function showSkeleton() {
  const grid = $('#grid');
  grid.textContent = '';
  grid.setAttribute('aria-busy', 'true');
  for (let i = 0; i < 6; i++) grid.append(h('div', { class: 'skeleton', 'aria-hidden': 'true' }));
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

async function load({ fromCache = true } = {}) {
  if (fromCache) {
    try {
      const cached = JSON.parse(store()?.getItem(CACHE_KEY) || 'null');
      if (cached?.activities) {
        state.all = cached.activities.map(normalizeActivity);
        render();
      }
    } catch { /* ignore a bad cache */ }
  }
  if (!state.all.length) showSkeleton();
  try {
    const { activities } = await api.list();
    state.all = activities.map(normalizeActivity);
    state.loaded = true;
    try { store()?.setItem(CACHE_KEY, JSON.stringify({ activities, at: Date.now() })); } catch { /* cache is optional */ }
    render();
  } catch (e) {
    toast(e.message, 'error', 6000);
    if (!state.all.length) {
      const grid = $('#grid');
      grid.textContent = '';
      grid.append(h('div', { class: 'empty-state', style: 'grid-column: 1 / -1' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, '⚠️'),
        h('h2', {}, 'Couldn’t load the library'),
        h('p', {}, e.message),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => load({ fromCache: false }) }, 'Try again')));
    }
  }
}

function bind() {
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.filters.q = e.target.value.trim(); refresh(); }, 150);
  });
  $('#subject').addEventListener('change', (e) => { state.filters.subject = e.target.value; refresh(); });
  $('#type').addEventListener('change', (e) => { state.filters.type = e.target.value; refresh(); });
  $('#sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; refresh(); });
  $('#mine').addEventListener('click', () => { state.filters.mine = !state.filters.mine; refresh(); });
  $('#reset').addEventListener('click', resetFilters);
  $('#reload').addEventListener('click', () => load({ fromCache: false }));
  $('#more').addEventListener('click', () => { state.shown += PAGE_SIZE; render(); });
}

async function start() {
  hydrateIcons();
  renderHeader({ active: 'library' });
  const gate = $('#gate');
  let session;
  try {
    session = await requireTeacher(gate);
  } catch {
    return;
  }
  gate.hidden = true;
  $('#app').hidden = false;
  renderHeader({ active: 'library', session, teacher: true, onSignOut: signOut });
  window.addEventListener('hub:signed-out', () => window.location.reload());
  if (session.demo) {
    $('#mode-banner').append(h('div', { class: 'banner banner-warn' }, iconEl('info'),
      h('div', {}, h('strong', {}, 'Demo mode. '), 'Only activities created in this browser appear here until the Apps Script backend is connected.')));
  }
  document.title = `Activity library · ${CONFIG.schoolName} ${CONFIG.appName}`;
  readFilters();
  bind();
  load();
}

start();
