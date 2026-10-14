// Helpers for cleaning pasted code, spotting common problems, and rendering it safely.

const FENCE_RE = /```[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?[ \t]*```/g;

function guessLang(lang, body) {
  const l = (lang || '').toLowerCase();
  if (['html', 'htm', 'xml', 'xhtml', 'svg', 'vue'].includes(l)) return 'html';
  if (['css', 'scss'].includes(l)) return 'css';
  if (['js', 'javascript', 'mjs', 'jsx', 'ts', 'typescript'].includes(l)) return 'js';
  const t = body.trim();
  if (/^</.test(t)) return 'html';
  if (/^[.#@:a-z*][^{]*\{[\s\S]*\}\s*$/i.test(t) && !/\bfunction\b|=>|\bconst\b|\blet\b/.test(t)) return 'css';
  return l ? 'other' : 'js';
}

function injectBefore(html, closingTag, snippet) {
  const re = new RegExp(`</${closingTag}\\s*>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return html.slice(0, m.index) + snippet + html.slice(m.index);
}

function removeLocalRefs(html, ext) {
  const attr = ext === 'css' ? 'href' : 'src';
  const tag = ext === 'css' ? 'link' : 'script';
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["'](?![a-z]+:|//|/)[^"']+\\.${ext}["'][^>]*>${tag === 'script' ? '\\s*</script>' : ''}`, 'gi');
  return html.replace(re, '');
}

/**
 * Cleans up code pasted from AI tools: strips markdown fences and chatty text around the code,
 * and merges separate HTML / CSS / JS blocks into a single page.
 * @returns {{code: string, changes: string[], context: string}}
 */
export function normalizePastedCode(raw) {
  let text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const changes = [];
  let context = '';

  const blocks = [];
  let m;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text))) blocks.push({ lang: guessLang(m[1], m[2]), body: m[2] });

  if (blocks.length) {
    context = text.replace(FENCE_RE, ' ');
    const html = blocks.filter((b) => b.lang === 'html');
    const css = blocks.filter((b) => b.lang === 'css');
    const js = blocks.filter((b) => b.lang === 'js');
    if (blocks.length === 1) {
      text = blocks[0].body;
      changes.push('Removed the ``` markdown markers and any text around the code.');
    } else if (html.length || css.length || js.length) {
      let page = html.length
        ? html.reduce((a, b) => (b.body.length > a.body.length ? b : a)).body
        : '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Activity</title>\n</head>\n<body>\n</body>\n</html>';
      if (css.length) {
        page = removeLocalRefs(page, 'css');
        const style = `<style>\n${css.map((b) => b.body).join('\n\n')}\n</style>\n`;
        page = injectBefore(page, 'head', style) ?? style + page;
      }
      if (js.length) {
        page = removeLocalRefs(page, 'js');
        const script = `<script>\n${js.map((b) => b.body).join('\n\n')}\n</script>\n`;
        page = injectBefore(page, 'body', script) ?? page + '\n' + script;
      }
      text = page;
      const parts = [html.length && 'HTML', css.length && 'CSS', js.length && 'JavaScript'].filter(Boolean);
      changes.push(`Combined the separate ${parts.join(', ')} code blocks into one page.`);
      if (html.length > 1) changes.push('There were several HTML blocks — we used the longest one. Check the preview.');
    }
  } else {
    const start = text.search(/<!doctype html|<html[\s>]/i);
    if (start > 0 && !/<[a-z!]/i.test(text.slice(0, start))) {
      context = text.slice(0, start);
      text = text.slice(start);
      changes.push('Removed the text before the code.');
    }
    const closeAt = text.toLowerCase().lastIndexOf('</html');
    const end = closeAt === -1 ? -1 : text.indexOf('>', closeAt) + 1;
    if (end > 0) {
      const after = text.slice(end);
      if (after.trim() && !/<[a-z!/]/i.test(after)) {
        context += ` ${after}`;
        text = text.slice(0, end);
        changes.push('Removed the text after the code.');
      }
    }
  }

  // `context` is the chat text that came with the code (e.g. "Here's a game for your 3rd grade
  // class"). It isn't published, but it helps guess the grade and subject.
  return { code: text.trim() + '\n', changes, context: context.replace(/\s+/g, ' ').trim().slice(0, 2000) };
}

/**
 * Looks for problems that would stop the activity from working once published.
 * @returns {{level: 'error'|'warn'|'info', message: string}[]}
 */
export function analyzeCode(code, { maxBytes = 5 * 1024 * 1024 } = {}) {
  const issues = [];
  const src = String(code || '');
  if (!src.trim()) return issues;
  const add = (level, message) => issues.push({ level, message });

  const bytes = new TextEncoder().encode(src).length;
  if (bytes > maxBytes) add('error', `This code is ${(bytes / 1048576).toFixed(1)} MB. The limit is ${(maxBytes / 1048576).toFixed(0)} MB — large embedded images are the usual cause.`);

  const hasTags = /<\/?[a-z][\w-]*[\s>/]/i.test(src);
  const looksReact = /\bimport\s+React\b|from\s+['"]react['"]|export\s+default\s+function\s+\w+\s*\(|\buseState\s*\(/.test(src);
  if (looksReact && !/<html[\s>]/i.test(src)) {
    add('error', 'This looks like a React component, not a web page, so it can’t run on its own. Ask your AI tool: “Rewrite this as a single, self-contained HTML file.”');
  } else if (!hasTags) {
    add('error', 'This doesn’t look like HTML. Paste the full HTML code (it usually starts with <!DOCTYPE html>).');
  }

  if (hasTags) {
    if (/<html[\s>]/i.test(src) && !/<\/html\s*>/i.test(src)) {
      add('warn', 'The code seems to be cut off (there’s no closing </html> tag). AI tools sometimes stop part-way — ask it to “continue” and paste the rest, or ask for the complete file again.');
    }
    const opens = (src.match(/<script\b/gi) || []).length;
    const closes = (src.match(/<\/script\s*>/gi) || []).length;
    if (opens > closes) add('warn', 'A <script> block isn’t closed, so the code may be incomplete.');

    const placeholder = src.match(/(?:\/\/|<!--|\/\*)\s*(?:\.{3}\s*)?(?:(?:the )?rest of (?:the|your) (?:code|content|html|questions)|(?:code|everything else) (?:remains|stays) the same|(?:add|insert) (?:more|remaining|the rest of the) (?:questions|items|code) here|same as (?:before|above))/i);
    if (placeholder) add('warn', 'The code contains a placeholder comment (like “rest of the code stays the same”), so part of it may be missing. Ask your AI tool for the complete file.');

    const local = new Set();
    const refRe = /<(script|link|img|audio|video|source|iframe|embed)\b[^>]*\b(src|href)=["']([^"']+)["']/gi;
    let m;
    while ((m = refRe.exec(src))) {
      const url = m[3].trim();
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{|\$)/i.test(url)) continue;
      if (m[1].toLowerCase() === 'link' && !/stylesheet|icon|manifest/i.test(m[0])) continue;
      local.add(url.split(/[?#]/)[0]);
    }
    if (local.size) {
      const list = [...local].slice(0, 3).join(', ');
      add('warn', `The code refers to files that aren’t included (${list}${local.size > 3 ? ', …' : ''}). Paste their contents into the page or use full web addresses (https://…), otherwise those parts won’t load.`);
    }

    if (/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=["']http:\/\//i.test(src)) {
      add('info', 'Some files load over “http://”. Browsers block these on secure pages — change them to “https://” if something is missing.');
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Sandboxed rendering
// ---------------------------------------------------------------------------

export const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation allow-orientation-lock';
export const ALLOW = 'fullscreen; clipboard-write; autoplay; microphone; camera; geolocation; accelerometer; gyroscope; speaker-selection';

// Runs inside the activity before any of its own code. Activities are rendered in a sandbox with
// no access to this site, so browser storage is unavailable there — this provides stand-ins
// (saved back to the parent page per activity), keeps #anchor links working inside the frame,
// opens external links in a new tab, and lets the toolbar ask the activity to print.
function shim(initialStore) {
  return `(function(){
  var P = window.parent;
  function post(msg){ try { P.postMessage(msg, '*'); } catch (e) {} }
  function makeStore(initial, persist) {
    var data = Object.create(null), timer = null;
    for (var k in initial) if (Object.prototype.hasOwnProperty.call(initial, k)) data[k] = String(initial[k]);
    function save(){ if (!persist) return; clearTimeout(timer); timer = setTimeout(function(){ var copy = {}; for (var k in data) copy[k] = data[k]; post({ __hub: 'storage', data: copy }); }, 250); }
    var api = {
      getItem: function(k){ k = String(k); return k in data ? data[k] : null; },
      setItem: function(k, v){ data[String(k)] = String(v); save(); },
      removeItem: function(k){ delete data[String(k)]; save(); },
      clear: function(){ for (var k in data) delete data[k]; save(); },
      key: function(i){ var keys = Object.keys(data); return i < keys.length ? keys[i] : null; }
    };
    return new Proxy(api, {
      get: function(t, p){ if (p === 'length') return Object.keys(data).length; if (p in api) return api[p]; return typeof p === 'string' && p in data ? data[p] : undefined; },
      set: function(t, p, v){ if (p in api) return true; data[String(p)] = String(v); save(); return true; },
      deleteProperty: function(t, p){ delete data[String(p)]; save(); return true; },
      has: function(t, p){ return p in api || p in data; },
      ownKeys: function(){ return Object.keys(data); },
      getOwnPropertyDescriptor: function(t, p){ return p in data ? { value: data[p], writable: true, enumerable: true, configurable: true } : undefined; }
    });
  }
  function install(name, initial, persist) {
    try { window[name].getItem('__hub_test__'); return; } catch (e) {}
    try { Object.defineProperty(window, name, { value: makeStore(initial, persist), configurable: true, enumerable: true }); } catch (e) {}
  }
  install('localStorage', ${initialStore}, true);
  install('sessionStorage', {}, false);
  try { void document.cookie; } catch (e) {
    var jar = {};
    try { Object.defineProperty(document, 'cookie', { configurable: true,
      get: function(){ return Object.keys(jar).map(function(k){ return k + '=' + jar[k]; }).join('; '); },
      set: function(v){ v = String(v); var pair = v.split(';')[0], i = pair.indexOf('='); if (i < 1) return; var k = pair.slice(0, i).trim();
        if (/max-age=0|expires=thu, 01 jan 1970/i.test(v)) delete jar[k]; else jar[k] = pair.slice(i + 1).trim(); } }); } catch (e2) {}
  }
  window.addEventListener('click', function(e){
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') {
      e.preventDefault();
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (err) {}
      var el = id && (document.getElementById(id) || document.getElementsByName(id)[0]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (/^javascript:/i.test(href) || (a.target && a.target !== '_self')) return;
    if (/^(?:https?:)?\\/\\//i.test(href)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });
  window.addEventListener('message', function(e){
    if (e.source !== P || !e.data || e.data.__hub !== 'print') return;
    window.print();
  });
  window.addEventListener('error', function(e){
    if (e && e.message) post({ __hub: 'error', message: String(e.message).slice(0, 300), line: e.lineno || 0 });
  });
})();`;
}

/** Builds the srcdoc for a sandboxed <iframe>, inserting the helper script before any of the page's own code. */
export function buildSrcdoc(code, { storage = {} } = {}) {
  const src = String(code || '');
  const json = JSON.stringify(storage && typeof storage === 'object' ? storage : {}).replace(/</g, '\\u003c');
  const tag = `<script>${shim(json)}</script>`;
  const patterns = [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) {
      const at = m.index + m[0].length;
      return src.slice(0, at) + tag + src.slice(at);
    }
  }
  return tag + src;
}

/** Creates a sandboxed iframe element for untrusted activity code. */
export function createActivityFrame(title = 'Activity') {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', ALLOW);
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', title);
  frame.className = 'activity-frame';
  return frame;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
