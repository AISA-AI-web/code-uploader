// Create / edit / remix page.
import { CONFIG } from './config.js';
import { api, DEMO } from './api.js';
import { requireTeacher, signOut } from './auth.js';
import { classify, textForAi } from './classifier.js';
import { normalizePastedCode, analyzeCode, buildSrcdoc, createActivityFrame, formatBytes } from './code-tools.js';
import { GRADES, SUBJECT_NAMES, ACTIVITY_TYPES, normalizeGrades, formatGrades } from './taxonomy.js';
import { h, icon, iconEl, renderHeader, toast, hydrateIcons, busy, confirmDialog, downloadActivity } from './ui.js';

const $ = (sel) => document.querySelector(sel);
const FIELDS = ['title', 'activityType', 'grades', 'subject', 'concept', 'description', 'tags'];
const DRAFT_KEY = 'hub-draft';
const AUTHOR_KEY = 'hub-author';

const state = {
  mode: 'create', // 'create' | 'edit' | 'remix'
  editId: '',
  remixOf: '',
  grades: new Set(),
  dirty: new Set(), // fields the teacher has changed by hand — never overwritten by detection
  badges: {}, // field -> 'auto' | 'ai'
  cleanup: null, // { changes, raw } after we tidied a paste
  pasteContext: '', // chat text that came with the code — a hint for grade/subject
  issues: [],
  frameErrors: [],
  frame: null,
  aiAvailable: false,
  aiRunning: false,
  aiFor: '',
  maxBytes: 5 * 1024 * 1024,
  published: false,
};

const els = {};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hash(str) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); }
  return `${str.length}:${(h1 >>> 0).toString(36)}`;
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

function buildFormControls() {
  for (const name of ACTIVITY_TYPES) els.type.append(h('option', { value: name }, name));
  els.subject.append(h('option', { value: '' }, 'Choose a subject…'));
  for (const name of SUBJECT_NAMES) els.subject.append(h('option', { value: name }, name));
  for (const g of GRADES) {
    const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', dataset: { grade: g }, title: g === 'K' ? 'Kindergarten' : g === 'Pre-K' ? 'Pre-K' : `Grade ${g}` }, g);
    chip.addEventListener('click', () => {
      if (state.grades.has(g)) state.grades.delete(g); else state.grades.add(g);
      markDirty('grades');
      paintGrades();
      els.errGrades.hidden = true;
      saveDraft();
    });
    els.gradeChips.append(chip);
  }
}

function paintGrades() {
  els.gradeChips.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(state.grades.has(chip.dataset.grade))));
}

function getField(name) {
  switch (name) {
    case 'grades': return normalizeGrades([...state.grades]);
    case 'tags': return els.tags.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    case 'activityType': return els.type.value;
    default: return els[name].value.trim();
  }
}

function setField(name, value) {
  switch (name) {
    case 'grades': state.grades = new Set(normalizeGrades(value)); paintGrades(); break;
    case 'tags': els.tags.value = (Array.isArray(value) ? value : String(value || '').split(',')).map((t) => String(t).trim()).filter(Boolean).join(', '); break;
    case 'activityType': els.type.value = ACTIVITY_TYPES.includes(value) ? value : 'Other'; break;
    case 'subject': els.subject.value = SUBJECT_NAMES.includes(value) ? value : ''; break;
    default: els[name].value = value || '';
  }
}

function setBadge(name, kind) {
  state.badges[name] = kind;
  const badge = document.querySelector(`[data-badge="${name}"]`);
  if (!badge) return;
  badge.hidden = !kind;
  badge.classList.toggle('is-ai', kind === 'ai');
  badge.innerHTML = kind ? `${icon('sparkle')}${kind === 'ai' ? 'AI suggested' : 'Auto-detected'}` : '';
}

function markDirty(name) {
  state.dirty.add(name);
  setBadge(name, null);
}

/** Fill in suggestions without touching anything the teacher has edited. */
function applySuggestion(s, kind) {
  for (const name of FIELDS) {
    if (state.dirty.has(name)) continue;
    const value = s[name];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (empty) continue;
    if (name === 'subject' && value === 'Other' && kind === 'auto' && state.badges.subject === 'ai') continue;
    setField(name, value);
    setBadge(name, kind);
  }
}

// ---------------------------------------------------------------------------
// Code, notices and preview
// ---------------------------------------------------------------------------

function renderNotices() {
  els.notices.textContent = '';
  if (state.cleanup) {
    const n = h('div', { class: 'notice notice-success' }, iconEl('check'),
      h('div', {}, state.cleanup.changes.join(' '), ' ',
        h('button', { type: 'button', class: 'link-btn', onClick: undoCleanup }, 'Undo')));
    els.notices.append(n);
  }
  for (const issue of state.issues) {
    els.notices.append(h('div', { class: `notice notice-${issue.level}` }, iconEl(issue.level === 'info' ? 'info' : 'alert'), h('div', {}, issue.message)));
  }
}

function undoCleanup() {
  if (!state.cleanup) return;
  els.code.value = state.cleanup.raw;
  state.cleanup = null;
  update({ immediate: true });
}

function renderPreview() {
  const code = els.code.value;
  state.frameErrors = [];
  els.previewErrors.hidden = true;
  if (state.frame) { state.frame.remove(); state.frame = null; }
  els.previewEmpty.hidden = !!code.trim();
  if (!code.trim()) return;
  const frame = createActivityFrame('Activity preview');
  frame.srcdoc = buildSrcdoc(code);
  els.stage.append(frame);
  state.frame = frame;
}
const renderPreviewSoon = debounce(renderPreview, 650);

function onFrameMessage(e) {
  if (!state.frame || e.source !== state.frame.contentWindow || !e.data || e.data.__hub !== 'error') return;
  const msg = `${e.data.message}${e.data.line ? ` (line ${e.data.line})` : ''}`;
  if (state.frameErrors.includes(msg) || state.frameErrors.length >= 3) return;
  state.frameErrors.push(msg);
  els.previewErrors.hidden = false;
  els.previewErrors.textContent = `The activity reported a problem: ${state.frameErrors.join(' · ')}. It may still work — try it in the preview. If something is broken, ask your AI tool to fix this error.`;
}

function updateStats(code) {
  if (!code.trim()) { els.stats.textContent = 'Nothing pasted yet'; return; }
  const lines = code.split('\n').length;
  const bytes = new TextEncoder().encode(code).length;
  els.stats.textContent = `${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${formatBytes(bytes)}`;
}

function runDetection(code) {
  if (!code.trim()) { els.detectBanner.hidden = true; return; }
  const result = classify(code, { context: state.pasteContext });
  applySuggestion(result, 'auto');
  els.detectBanner.hidden = false;
  const kind = result.activityType !== 'Other' ? result.activityType.toLowerCase() : 'activity';
  const parts = [];
  if (result.grades.length) parts.push(formatGrades(result.grades));
  if (result.subject !== 'Other') parts.push(result.subject);
  els.detectSummary.textContent = '';
  if (parts.length || result.concept) {
    els.detectSummary.append('We read your code: this looks like a ', h('strong', {}, `${parts.join(' ')} ${kind}`.trim()),
      result.concept ? ` about ${result.concept.toLowerCase()}.` : '.', ' Check the details below.');
  } else {
    els.detectSummary.append('We couldn’t work out the grade level or subject from the code — please choose them below.');
  }
  els.detectReasons.textContent = result.reasons.join(' · ');
}

const update = (() => {
  const slow = debounce((code) => { runDetection(code); saveDraft(); }, 500);
  return ({ immediate = false, ai = false } = {}) => {
    const code = els.code.value;
    els.editorEmpty.hidden = !!code;
    updateStats(code);
    state.issues = analyzeCode(code, { maxBytes: state.maxBytes });
    renderNotices();
    if (immediate) {
      renderPreview();
      runDetection(code);
      saveDraft();
    } else {
      renderPreviewSoon();
      slow(code);
    }
    if (ai) runAi({ auto: true });
  };
})();

function tidyAndUpdate() {
  const raw = els.code.value;
  const { code, changes, context } = normalizePastedCode(raw);
  if (changes.length && code.trim() !== raw.trim()) {
    els.code.value = code;
    state.cleanup = { changes, raw };
    state.pasteContext = context;
  } else {
    state.cleanup = null;
    state.pasteContext = '';
  }
  update({ immediate: true, ai: true });
}

function loadText(text) {
  els.code.value = text;
  tidyAndUpdate();
  els.code.scrollTop = 0;
}

async function readFile(file) {
  if (!file) return;
  if (file.size > state.maxBytes * 1.2) { toast('That file is too large to publish.', 'error'); return; }
  loadText(await file.text());
  toast(`Loaded ${file.name}`, 'success');
}

// ---------------------------------------------------------------------------
// AI suggestions (only when the backend has an AI key configured)
// ---------------------------------------------------------------------------

async function runAi({ auto = false } = {}) {
  if (!state.aiAvailable || state.aiRunning) return;
  const code = els.code.value;
  if (code.trim().length < 80 || state.issues.some((i) => i.level === 'error')) {
    if (!auto) toast('Paste some activity code first.', 'error');
    return;
  }
  const key = hash(code);
  if (auto && key === state.aiFor) return;
  state.aiRunning = true;
  state.aiFor = key;
  const restore = busy(els.aiBtn, 'Checking with AI…');
  try {
    const { suggestion } = await api.classify(textForAi(code, { context: state.pasteContext }));
    applySuggestion(suggestion, 'ai');
    const what = [formatGrades(suggestion.grades || []), suggestion.subject, suggestion.concept && `— ${suggestion.concept}`].filter(Boolean).join(' ');
    els.detectReasons.textContent = `AI suggestion: ${what}. Fields you’ve already edited were left alone.`;
    saveDraft();
  } catch (e) {
    if (!auto) toast(e.message, 'error');
    else els.detectReasons.textContent += els.detectReasons.textContent ? ' · AI check unavailable right now' : 'AI check unavailable right now';
  } finally {
    restore();
    state.aiRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Drafts — so a refresh or an expired sign-in never loses work
// ---------------------------------------------------------------------------

function collectFields() {
  const out = {};
  for (const name of FIELDS) out[name] = getField(name);
  out.author = els.author.value.trim();
  return out;
}

const saveDraft = debounce(() => {
  if (state.mode === 'edit' || state.published) return;
  const code = els.code.value;
  try {
    if (!code.trim()) { store()?.removeItem(DRAFT_KEY); return; }
    store()?.setItem(DRAFT_KEY, JSON.stringify({ code, fields: collectFields(), dirty: [...state.dirty], remixOf: state.remixOf, context: state.pasteContext, savedAt: Date.now() }));
  } catch { /* storage full or unavailable — drafts are a convenience */ }
}, 400);

function restoreDraft() {
  let draft;
  try { draft = JSON.parse(store()?.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft || !draft.code || (draft.remixOf || '') !== state.remixOf) return false;
  if (Date.now() - (draft.savedAt || 0) > 7 * 24 * 3600e3) return false;
  els.code.value = draft.code;
  state.pasteContext = draft.context || '';
  for (const name of FIELDS) if (draft.fields && draft.fields[name] !== undefined) setField(name, draft.fields[name]);
  if (draft.fields?.author) els.author.value = draft.fields.author;
  state.dirty = new Set(draft.dirty || []);
  update({ immediate: true });
  els.notices.prepend(h('div', { class: 'notice notice-info' }, iconEl('info'),
    h('div', {}, 'We restored the work you hadn’t published yet. ', h('button', { type: 'button', class: 'link-btn', onClick: clearAll }, 'Start fresh'))));
  return true;
}

async function clearAll() {
  els.code.value = '';
  state.cleanup = null;
  state.pasteContext = '';
  state.dirty = new Set();
  state.aiFor = '';
  for (const name of FIELDS) { setField(name, name === 'activityType' ? 'Other' : ''); setBadge(name, null); }
  try { store()?.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  update({ immediate: true });
  els.code.focus();
}

// ---------------------------------------------------------------------------
// Edit / remix
// ---------------------------------------------------------------------------

async function loadExisting(id, mode) {
  els.hero.eyebrow.textContent = mode === 'edit' ? 'Edit activity' : 'Remix an activity';
  els.hero.title.textContent = 'Loading…';
  try {
    const { activity } = await api.get(id);
    if (mode === 'edit' && !activity.canEdit) {
      toast('Only the teacher who created this activity can edit it — you can remix your own copy instead.', 'error', 6000);
      mode = 'remix';
    }
    state.mode = mode;
    if (mode === 'edit') {
      state.editId = id;
      els.hero.title.textContent = `Editing “${activity.title}”`;
      els.hero.lead.textContent = 'Changes go live at the same link and QR code as soon as you save.';
      els.publishBtn.querySelector('.btn-label').textContent = 'Save changes';
      els.publishNote.textContent = 'Students using the link will see the new version next time they open it.';
    } else {
      state.remixOf = id;
      els.hero.eyebrow.textContent = 'Remix an activity';
      els.hero.title.textContent = `Remixing “${activity.title}”`;
      els.hero.lead.textContent = 'Change the code or details, then publish your own copy with its own link. The original stays as it is.';
      els.publishBtn.querySelector('.btn-label').textContent = 'Publish my copy';
    }
    if (mode === 'remix' && restoreDraft()) return;
    els.code.value = activity.code;
    for (const name of FIELDS) setField(name, activity[name]);
    if (mode === 'remix') setField('title', `${activity.title} (remix)`);
    state.dirty = new Set(FIELDS);
    update({ immediate: true });
    for (const name of FIELDS) setBadge(name, null);
  } catch (e) {
    els.hero.title.textContent = 'Couldn’t load that activity';
    toast(e.message, 'error', 6000);
  }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

function validate() {
  let ok = true;
  const code = els.code.value;
  const errors = analyzeCode(code, { maxBytes: state.maxBytes }).filter((i) => i.level === 'error');
  if (!code.trim()) {
    toast('Paste your activity code first.', 'error');
    els.code.focus();
    return false;
  }
  if (errors.length) {
    toast('Please fix the problem shown under the code first.', 'error');
    els.notices.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  const title = getField('title');
  els.errTitle.hidden = !!title;
  els.title.classList.toggle('is-invalid', !title);
  if (!title) { els.errTitle.textContent = 'Add a title so teachers can find it.'; ok = false; }
  const grades = getField('grades');
  els.errGrades.hidden = grades.length > 0;
  if (!grades.length) { els.errGrades.textContent = 'Choose at least one grade level.'; ok = false; }
  if (!ok) {
    toast('A couple of details are missing.', 'error');
    (title ? els.gradeChips : els.title).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return ok;
}

async function publish(e) {
  e.preventDefault();
  if (!validate()) return;
  const payload = { ...collectFields(), code: els.code.value, remixOf: state.remixOf || undefined };
  if (!payload.subject) payload.subject = 'Other';
  try { store()?.setItem(AUTHOR_KEY, payload.author); } catch { /* ignore */ }
  const restore = busy(els.publishBtn, state.mode === 'edit' ? 'Saving…' : 'Publishing…');
  try {
    if (state.mode === 'edit') {
      await api.update(state.editId, payload);
      state.published = true;
      window.location.href = `view.html?id=${encodeURIComponent(state.editId)}&saved=1`;
    } else {
      const res = await api.create(payload);
      state.published = true;
      try { store()?.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      window.location.href = `view.html?id=${encodeURIComponent(res.id)}&new=1`;
    }
  } catch (err) {
    restore();
    toast(err.message, 'error', 7000);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function bind() {
  Object.assign(els, {
    code: $('#code'), editorWrap: $('#editor-wrap'), editorEmpty: $('#editor-empty'), notices: $('#notices'), stats: $('#code-stats'),
    stage: $('#preview-stage'), previewEmpty: $('#preview-empty'), previewErrors: $('#preview-errors'),
    detectBanner: $('#detect-banner'), detectSummary: $('#detect-summary'), detectReasons: $('#detect-reasons'), aiBtn: $('#ai-btn'),
    form: $('#details-form'), title: $('#f-title'), type: $('#f-type'), subject: $('#f-subject'), concept: $('#f-concept'),
    description: $('#f-description'), tags: $('#f-tags'), author: $('#f-author'), gradeChips: $('#grade-chips'),
    errTitle: $('#err-title'), errGrades: $('#err-grades'), publishBtn: $('#publish-btn'), publishNote: $('#publish-note'),
    hero: { eyebrow: $('#hero-eyebrow'), title: $('#hero-title'), lead: $('#hero-lead') },
  });

  els.code.addEventListener('paste', () => setTimeout(tidyAndUpdate, 0));
  els.code.addEventListener('input', (e) => { if (e.inputType !== 'insertFromPaste') update(); });
  els.code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  $('#paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { toast('Your clipboard is empty — copy the code from your AI tool first.', 'error'); return; }
      loadText(text);
    } catch {
      els.code.focus();
      toast('Click in the box and press Ctrl+V (⌘V on a Mac) to paste.', 'info', 4500);
    }
  });
  const fileInput = $('#file-input');
  $('#upload-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { readFile(fileInput.files[0]); fileInput.value = ''; });
  $('#clear-btn').addEventListener('click', async () => {
    if (els.code.value.trim() && !(await confirmDialog({ title: 'Clear everything?', message: 'This removes the code and the details you’ve entered.', confirmLabel: 'Clear', danger: true }))) return;
    clearAll();
  });

  ['dragenter', 'dragover'].forEach((t) => els.editorWrap.addEventListener(t, (e) => { e.preventDefault(); els.editorWrap.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((t) => els.editorWrap.addEventListener(t, () => els.editorWrap.classList.remove('is-dragging')));
  els.editorWrap.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) { e.preventDefault(); readFile(file); }
  });

  document.querySelectorAll('.device-toggle button').forEach((btn) => btn.addEventListener('click', () => {
    els.stage.dataset.device = btn.dataset.device;
    document.querySelectorAll('.device-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  }));
  $('#refresh-btn').addEventListener('click', renderPreview);
  $('#preview-full-btn').addEventListener('click', () => {
    if (!els.code.value.trim()) { toast('Paste some code to preview first.', 'info'); return; }
    els.stage.requestFullscreen?.().catch(() => toast('Full screen isn’t available here.', 'error'));
  });
  $('#download-btn').addEventListener('click', () => {
    if (!els.code.value.trim()) { toast('Paste some code first.', 'info'); return; }
    downloadActivity({ title: getField('title') || 'activity', code: els.code.value });
  });
  window.addEventListener('message', onFrameMessage);

  els.aiBtn.addEventListener('click', () => runAi());
  for (const name of ['title', 'concept', 'description', 'tags']) {
    els[name].addEventListener('input', () => { markDirty(name); saveDraft(); });
  }
  els.title.addEventListener('input', () => { els.errTitle.hidden = true; els.title.classList.remove('is-invalid'); });
  els.type.addEventListener('change', () => { markDirty('activityType'); saveDraft(); });
  els.subject.addEventListener('change', () => { markDirty('subject'); saveDraft(); });
  els.author.addEventListener('input', saveDraft);
  els.form.addEventListener('submit', publish);
}

function modeBanner(session) {
  const slot = $('#mode-banner');
  if (session.demo) {
    slot.append(h('div', { class: 'banner banner-warn mode-banner' }, iconEl('info'),
      h('div', {}, h('strong', {}, 'Demo mode. '), 'The backend isn’t connected yet, so activities are saved only in this browser and links won’t work on other devices. See the README to connect Google Apps Script.')));
  } else if (session.open) {
    slot.append(h('div', { class: 'banner banner-warn mode-banner' }, iconEl('alert'),
      h('div', {}, h('strong', {}, 'Teacher sign-in is turned off. '), 'Anyone with this address can create and browse activities. An administrator can turn sign-in on in the Apps Script settings.')));
  }
}

async function start() {
  hydrateIcons();
  renderHeader({ active: 'create' });
  const gate = $('#gate');
  let session;
  try {
    session = await requireTeacher(gate);
  } catch {
    return; // the gate shows the error
  }
  gate.hidden = true;
  $('#app').hidden = false;
  renderHeader({ active: 'create', session, teacher: true, onSignOut: signOut });
  window.addEventListener('hub:signed-out', () => {
    toast('Your sign-in has expired. Your work is saved — please sign in again.', 'error', 6000);
    setTimeout(() => window.location.reload(), 2500);
  });

  bind();
  buildFormControls();
  modeBanner(session);
  els.type.value = 'Other';
  let savedAuthor = '';
  try { savedAuthor = store()?.getItem(AUTHOR_KEY) || ''; } catch { /* ignore */ }
  els.author.value = savedAuthor || session.name || '';

  api.config().then((cfg) => {
    state.maxBytes = cfg.maxCodeBytes || state.maxBytes;
    state.aiAvailable = !!cfg.ai;
    els.aiBtn.hidden = !state.aiAvailable;
  }).catch(() => {});

  const params = new URLSearchParams(window.location.search);
  if (params.get('edit')) await loadExisting(params.get('edit'), 'edit');
  else if (params.get('remix')) await loadExisting(params.get('remix'), 'remix');
  else if (!restoreDraft()) update({ immediate: true });

  document.title = `${state.mode === 'edit' ? 'Edit activity' : 'Create an activity'} · ${CONFIG.schoolName} ${CONFIG.appName}`;
  if (DEMO) els.publishNote.textContent = 'Demo mode: the activity is saved in this browser only.';
}

start();
