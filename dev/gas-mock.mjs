// In-memory stand-ins for the Google Apps Script services used by apps-script/Code.gs, so the
// real backend code can run in Node for tests and local development. Only the methods Code.gs
// uses are implemented, with the same quirks that matter (signed byte arrays, 100 KB cache
// values, formulas in cells, sheet size limits).
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CODE_PATH = path.join(ROOT, 'apps-script', 'Code.gs');

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(Array.from(arr, (b) => (b < 0 ? b + 256 : b)));

class Blob {
  constructor(bytes = Buffer.alloc(0), contentType = 'application/octet-stream', name = '') {
    this.bytes = bytes;
    this.contentType = contentType;
    this.name = name;
  }
  setDataFromString(str, charset = 'UTF-8') {
    if (!/^utf-?8$/i.test(charset)) throw new Error(`Unsupported charset ${charset}`);
    this.bytes = Buffer.from(String(str), 'utf8');
    return this;
  }
  setContentType(t) { this.contentType = t; return this; }
  setName(n) { this.name = n; return this; }
  getName() { return this.name; }
  getContentType() { return this.contentType; }
  getBytes() { return signed(this.bytes); }
  getDataAsString(charset = 'UTF-8') {
    if (!/^utf-?8$/i.test(charset)) throw new Error(`Unsupported charset ${charset}`);
    return this.bytes.toString('utf8');
  }
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getRow() { return this.row; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error(`The number of rows or columns in the data does not match the range (${values.length}x${values[0]?.length} vs ${this.numRows}x${this.numCols}).`);
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v)));
    return this;
  }
  setNumberFormat(format) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.formats.set(`${this.row + r}:${this.col + c}`, format);
    return this;
  }
  setFontWeight() { return this; }
  createTextFinder(text) {
    const range = this;
    let entire = false;
    let caseSensitive = false;
    const finder = {
      matchEntireCell(v) { entire = v; return finder; },
      matchCase(v) { caseSensitive = v; return finder; },
      findNext() {
        const norm = (s) => (caseSensitive ? s : s.toLowerCase());
        const needle = norm(String(text));
        for (let r = 0; r < range.numRows; r++) {
          for (let c = 0; c < range.numCols; c++) {
            const value = norm(String(range.sheet.get(range.row + r, range.col + c)));
            if (entire ? value === needle : value.includes(needle)) return new Range(range.sheet, range.row + r, range.col + c, 1, 1);
          }
        }
        return null;
      },
    };
    return finder;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();
    this.formats = new Map();
    this.maxRows = 1000;
    this.maxCols = 26;
  }
  get(r, c) { return this.cells.has(`${r}:${c}`) ? this.cells.get(`${r}:${c}`) : ''; }
  write(r, c, value) {
    if (r > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    if (c > this.maxCols) this.maxCols = c;
    let v = value;
    if (typeof v === 'string') {
      if (v.startsWith("'")) v = v.slice(1); // Sheets treats a leading apostrophe as "store as text"
      else if (v.startsWith('=')) v = '#FORMULA!'; // a formula would be evaluated — tests treat this as a failure
      else if (this.formats.get(`${r}:${c}`) !== '@' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v); // auto-parsed number
    }
    if (v === '' || v === null || v === undefined) this.cells.delete(`${r}:${c}`);
    else this.cells.set(`${r}:${c}`, v);
  }
  getName() { return this.name; }
  getLastRow() {
    let max = 0;
    for (const key of this.cells.keys()) max = Math.max(max, Number(key.split(':')[0]));
    return max;
  }
  getLastColumn() {
    let max = 0;
    for (const key of this.cells.keys()) max = Math.max(max, Number(key.split(':')[1]));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (typeof row !== 'number') throw new Error('A1 notation is not supported by the mock');
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Invalid range ${row},${col},${numRows},${numCols}`);
    if (row + numRows - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, row, col, numRows, numCols);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r;
    values.forEach((v, c) => this.write(r, c + 1, v));
    return this;
  }
  setFrozenRows() { return this; }
}

export function createGas({ fetchHandler = null, props: initialProps = {}, owner = 'owner@aisa.test', log = () => {} } = {}) {
  const props = new Map(Object.entries(initialProps));
  const cache = new Map();
  const files = new Map();
  const folders = new Map();
  const spreadsheets = new Map();
  let seq = 0;
  const newId = (prefix) => `${prefix}${(++seq).toString(36)}${crypto.randomBytes(6).toString('hex')}`;

  class File {
    constructor(blob) {
      this.id = newId('file_');
      this.bytes = blob.bytes;
      this.name = blob.name;
      this.mime = blob.contentType;
      this.trashed = false;
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return `https://drive.google.com/file/d/${this.id}`; }
    getBlob() { return new Blob(Buffer.from(this.bytes), this.mime, this.name); }
    setTrashed(v) { this.trashed = !!v; return this; }
    isTrashed() { return this.trashed; }
    setDescription() { return this; }
  }

  class Folder {
    constructor(name) { this.id = newId('folder_'); this.name = name; }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
    createFile(blob) {
      if (!(blob instanceof Blob)) throw new Error('createFile(blob) expects a Blob in this mock');
      const f = new File(blob);
      files.set(f.id, f);
      return f;
    }
  }

  class Spreadsheet {
    constructor(name) { this.id = newId('ss_'); this.name = name; this.sheets = [new Sheet('Sheet1')]; }
    getId() { return this.id; }
    getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }
    getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
    getSheets() { return [...this.sheets]; }
    insertSheet(name) { const s = new Sheet(name); this.sheets.push(s); return s; }
    deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
  }

  const globals = {
    console: { log, info: log, warn: console.warn, error: console.error },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'UTF-8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, value) => signed(crypto.createHash(alg).update(String(value), 'utf8').digest()),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()),
      base64EncodeWebSafe: (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : unsigned(data)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (data, contentType, name) => new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : unsigned(data || []), contentType, name),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) { props.set(k, String(v)); return this; },
        deleteProperty(k) { props.delete(k); return this; },
        getProperties: () => Object.fromEntries(props),
      }),
    },
    CacheService: {
      getScriptCache: () => {
        const live = (k) => {
          const e = cache.get(k);
          if (!e) return null;
          if (e.expires < Date.now()) { cache.delete(k); return null; }
          return e.value;
        };
        const put = (k, v, ttl = 600) => {
          if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error(`Argument too large: value for ${k}`);
          if (String(k).length > 250) throw new Error('Key too long');
          cache.set(k, { value: String(v), expires: Date.now() + Math.min(ttl, 21600) * 1000 });
        };
        return {
          get: live,
          put,
          getAll: (keys) => Object.fromEntries(keys.map((k) => [k, live(k)]).filter(([, v]) => v !== null)),
          putAll: (obj, ttl) => { for (const [k, v] of Object.entries(obj)) put(k, v, ttl); },
          remove: (k) => { cache.delete(k); },
          removeAll: (keys) => { for (const k of keys) cache.delete(k); },
        };
      },
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }),
    },
    SpreadsheetApp: {
      create: (name) => { const ss = new Spreadsheet(name); spreadsheets.set(ss.id, ss); return ss; },
      openById: (id) => { if (!spreadsheets.has(id)) throw new Error(`Spreadsheet ${id} not found`); return spreadsheets.get(id); },
      getActiveSpreadsheet: () => null,
    },
    DriveApp: {
      createFolder: (name) => { const f = new Folder(name); folders.set(f.id, f); return f; },
      getFolderById: (id) => { if (!folders.has(id)) throw new Error(`Folder ${id} not found`); return folders.get(id); },
      getFileById: (id) => { if (!files.has(id)) throw new Error(`File ${id} not found`); return files.get(id); },
    },
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        if (!fetchHandler) throw new Error(`UrlFetchApp.fetch not mocked: ${url}`);
        const res = fetchHandler(url, options, { props });
        return { getResponseCode: () => res.status ?? 200, getContentText: () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) };
      },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
  };

  const context = vm.createContext(globals);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });

  // Each web request in Apps Script is a fresh execution; reset per-execution memo state.
  const freshExecution = () => vm.runInContext('STORE_ = null;', context);

  return {
    context,
    props,
    files,
    cache,
    spreadsheets,
    eval: (src) => vm.runInContext(src, context),
    run(fn, ...args) { freshExecution(); return context[fn](...args); },
    doGet(parameter = {}) {
      freshExecution();
      return JSON.parse(context.doGet({ parameter }).getContent());
    },
    doPost(body) {
      freshExecution();
      const contents = typeof body === 'string' ? body : JSON.stringify(body);
      return JSON.parse(context.doPost({ parameter: {}, postData: { contents, type: 'text/plain' } }).getContent());
    },
    sheet(name) {
      const id = props.get('SPREADSHEET_ID');
      return spreadsheets.get(id)?.getSheetByName(name);
    },
  };
}

/** UrlFetchApp handler for local development: fake Google sign-in tokens of the form "dev:email:name". */
export function devFetchHandler({ classifyText } = {}) {
  return (url, options, { props }) => {
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?id_token=')) {
      const token = decodeURIComponent(url.split('id_token=')[1]);
      const [kind, email, name] = token.split(':');
      if (kind !== 'dev' || !email) return { status: 400, body: { error: 'invalid_token' } };
      return {
        status: 200,
        body: {
          aud: props.get('GOOGLE_CLIENT_ID'),
          iss: 'https://accounts.google.com',
          email,
          email_verified: 'true',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          name: name || email.split('@')[0],
          picture: '',
          // Google adds "hd" (hosted domain) only for Google Workspace accounts.
          ...(/@(gmail|googlemail)\.com$/i.test(email) ? {} : { hd: email.split('@')[1] }),
        },
      };
    }
    if (url === 'https://api.anthropic.com/v1/messages' && classifyText) {
      const req = JSON.parse(options.payload);
      const text = req.messages[0].content.split('<activity>')[1] || '';
      const suggestion = classifyText(text);
      return {
        status: 200,
        body: {
          model: req.model,
          stop_reason: 'end_turn',
          content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(suggestion) }],
        },
      };
    }
    return { status: 404, body: { error: `No dev handler for ${url}` } };
  };
}
