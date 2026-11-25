/*
 * Fake Apps Script services so Code.js can run in Node for tests.
 * Never pushed to Apps Script (see .claspignore).
 *
 * Each server call runs Code.js in a fresh context (like Apps Script, where every
 * google.script.run call starts with fresh globals). The sheet data, script
 * properties and cache live in one shared "store" across calls.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
/* busy-app is a copy of the DDGS app without its git history: old DDGS commits are read from the ddgs-app repo next to it. */
const DDGS_GIT = fs.existsSync(path.join(ROOT, '..', 'ddgs-app', '.git')) ? path.join(ROOT, '..', 'ddgs-app') : ROOT;
function gitShow(ref, file) {
  const cp = require('child_process');
  try { return cp.execSync('git show ' + ref + ':' + file, { cwd: ROOT, maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch (e) { return cp.execSync('git show ' + ref + ':' + file, { cwd: DDGS_GIT, maxBuffer: 1e8 }).toString(); }
}
const isDate = x => Object.prototype.toString.call(x) === '[object Date]';
const pad = (n, w) => String(n).padStart(w || 2, '0');

function formatDate(d, tz, pattern) {
  const t = new Date(d.getTime());
  return pattern
    .replace('yyyy', t.getFullYear()).replace('MM', pad(t.getMonth() + 1)).replace('dd', pad(t.getDate()))
    .replace('HH', pad(t.getHours())).replace('mm', pad(t.getMinutes())).replace('ss', pad(t.getSeconds()));
}

/* What Google Sheets does to a value typed/written into a normal (not plain-text) cell. */
function coerce(x, text) {
  if (x === null || x === undefined) return '';
  if (isDate(x)) return new Date(x.getTime());
  if (typeof x !== 'string') return x;
  if (x.charAt(0) === "'") return x.slice(1); // a leading ' keeps the rest as text (and is not stored), like Sheets
  if (text || x === '') return x;
  if (/^(true|false)$/i.test(x)) return x.toUpperCase() === 'TRUE';
  if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x);
  let m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = x.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return x;
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const s = this.sheet; s.store.stats.reads++;
    s.store.stats.cells += this.nr * this.nc;
    const D = s.store.realmDate || Date, out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = s.rows[this.r - 1 + i] || [], o = [];
      for (let j = 0; j < this.nc; j++) {
        const v = row[this.c - 1 + j];
        o.push(v === undefined ? '' : isDate(v) ? new D(v.getTime()) : v);
      }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    const s = this.sheet; s.store.stats.writes++;
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error('The number of rows or columns in the data does not match the range.');
    s.maxRows = Math.max(s.maxRows, this.r + this.nr - 1);
    s.maxCols = Math.max(s.maxCols, this.c + this.nc - 1);
    for (let i = 0; i < this.nr; i++) {
      const ri = this.r - 1 + i;
      s.rows[ri] = s.rows[ri] || [];
      for (let j = 0; j < this.nc; j++) { const cj = this.c - 1 + j; s.rows[ri][cj] = coerce(vals[i][j], s.textCols[cj]); }
    }
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  getValue() { return this.getValues()[0][0]; }
  setNumberFormat(f) { for (let j = 0; j < this.nc; j++) if (f === '@') this.sheet.textCols[this.c - 1 + j] = true; return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
}

class Sheet {
  constructor(store, name) { Object.assign(this, { store, name, rows: [], maxRows: 1000, maxCols: 26, textCols: {} }); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => (r || []).forEach((v, j) => { if (v !== '' && v !== undefined && v !== null) m = Math.max(m, j + 1); })); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr, nc) {
    if (!(r >= 1) || !(c >= 1)) throw new Error('The starting row or column of the range is too small.');
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  setFrozenRows() { return this; }
  /* test helper: the sheet as plain values (dates as yyyy-MM-dd or yyyy-MM-dd HH:mm) */
  dump() { return this.rows.slice(0, this.getLastRow()).map(r => (r || []).map(v => isDate(v) ? formatDate(v, '', v.getHours() || v.getMinutes() ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd') : v)); }
}

class Spreadsheet {
  constructor(store, name) { Object.assign(this, { store, name, sheets: [], id: 'ss-' + (++store.ids) }); }
  getSheetByName(n) { this.store.stats.meta++; return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this.store, n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  getSpreadsheetTimeZone() { this.store.stats.meta++; return 'Asia/Calcutta'; }
  getId() { return this.id; }
}

const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

function makeStore(opts) {
  opts = opts || {};
  const store = { ids: 0, props: {}, cache: {}, triggers: [], mails: [], folders: [], logs: [],
    ownerEmail: 'owner@example.com', activeEmail: '', stats: { reads: 0, writes: 0, cells: 0, meta: 0, props: 0 } };
  store.ss = new Spreadsheet(store, 'RAGHAV DDGS APP');
  store.sheet = name => store.ss.sheets.find(s => s.name === name) || null;
  store.resetStats = () => { store.stats = { reads: 0, writes: 0, cells: 0, meta: 0, props: 0 }; };
  return store;
}

/* Utilities.unzip: the files inside a zip (an .xlsx is one) as blobs, like Apps Script. */
function unzip(b) {
  const zlib = require('zlib'), buf = Buffer.from(b.getBytes().map(x => x & 255)), out = [];
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Could not unzip: not a zip file');
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0, n = buf.readUInt16LE(e + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl), start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + size)) : buf.subarray(start, start + size);
    const f = blob(Array.from(data), 'application/octet-stream', name);
    f.getDataAsString = () => data.toString('utf8');
    out.push(f);
    p += 46 + nl + xl + cl;
  }
  return out;
}

function blob(bytes, type, name) {
  let nm = name || 'blob';
  return { getBytes: () => bytes, getName: () => nm, setName(n) { nm = n; return this; }, getContentType: () => type, getDataAsString: () => String(bytes),
    getAs(t) { const b = blob(bytes, t, nm); b.converted = true; return b; } }; // getAs: the fake keeps the source (e.g. the report HTML) as the bytes
}

function folder(store, name) {
  const f = { name, folders: [], files: [] };
  f.getFoldersByName = n => iter(f.folders.filter(x => x.name === n));
  f.createFolder = n => { const x = folder(store, n); f.folders.push(x); return x; };
  f.createFile = b => { const file = { name: b.getName(), getUrl: () => 'https://drive.google.com/file/d/' + (++store.ids) + '/view', getDateCreated: () => new Date(), setTrashed() {} }; f.files.push(file); return file; };
  f.getFiles = () => iter(f.files.slice());
  return f;
}

function services(store) {
  const props = {
    getProperty: k => { store.stats.props++; return k in store.props ? store.props[k] : null; },
    setProperty: (k, v) => { store.stats.props++; store.props[k] = String(v); return props; },
    deleteProperty: k => { store.stats.props++; delete store.props[k]; return props; },
    getProperties: () => { store.stats.props++; return Object.assign({}, store.props); }
  };
  const cache = {
    get: k => (k in store.cache ? store.cache[k] : null),
    put: (k, v) => { store.cache[k] = String(v); },
    remove: k => { delete store.cache[k]; },
    getAll: keys => { const o = {}; keys.forEach(k => { if (k in store.cache) o[k] = store.cache[k]; }); return o; },
    putAll: o => { Object.keys(o).forEach(k => { store.cache[k] = String(o[k]); }); },
    removeAll: keys => keys.forEach(k => delete store.cache[k])
  };
  const trigBuilder = fn => {
    const b = { timeBased: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, onWeekDay: () => b,
      create: () => { const t = { fn, id: String(++store.ids) }; store.triggers.push(t); return t; } };
    return b;
  };
  return {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => { store.stats.meta++; return store.ss; },
      create: name => { const x = new Spreadsheet(store, name); x.insertSheet('Sheet1'); return x; },
      flush: () => {}
    },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => store.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => store.ownerEmail }),
      getScriptTimeZone: () => 'Asia/Kolkata'
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: x => Buffer.from(Array.isArray(x) ? x.map(b => b & 255) : String(x)).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(String(s), 'base64')),
      newBlob: blob,
      unzip
    },
    ScriptApp: {
      getProjectTriggers: () => store.triggers.map(t => ({ getHandlerFunction: () => t.fn, getUniqueId: () => t.id })),
      newTrigger: trigBuilder,
      WeekDay: { SUNDAY: 'SUNDAY' },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
      getOAuthToken: () => 'token'
    },
    HtmlService: {
      createHtmlOutputFromFile: n => ({ getContent: () => fs.readFileSync(path.join(store.root || ROOT, n + '.html'), 'utf8') }),
      createHtmlOutput: html => { const o = { setTitle: () => o, addMetaTag: () => o, getContent: () => html }; return o; }
    },
    MailApp: { sendEmail: m => store.mails.push(m) },
    DriveApp: {
      getFoldersByName: n => iter(store.folders.filter(f => f.name === n)),
      createFolder: n => { const f = folder(store, n); store.folders.push(f); return f; },
      getFileById: () => ({ setTrashed() {}, makeCopy: (name, f) => f.createFile(blob([], 'x', name)) })
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => blob([1, 2, 3], 'application/xlsx', 'x') }) },
    Logger: { log: m => store.logs.push(String(m)) }
  };
}

/* A server: Code.js (or the given source) + one store. run(fn, ...args) is one google.script.run call. */
function makeServer(opts) {
  opts = opts || {};
  const store = opts.store || makeStore();
  store.root = opts.root || ROOT;
  // CODE_REF=<git commit> runs a test against an older Code.js (to see a test fail before a fix).
  const code = opts.code || (process.env.CODE_REF
    ? gitShow(process.env.CODE_REF, 'Code.js')
    : fs.readFileSync(path.join(store.root, 'Code.js'), 'utf8'));
  const script = new vm.Script(code, { filename: 'Code.js' });
  function run(fn) {
    const args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments, 1)));
    const ctx = Object.assign({ console }, services(store));
    vm.createContext(ctx);
    store.realmDate = vm.runInContext('Date', ctx);
    script.runInContext(ctx);
    if (typeof ctx[fn] !== 'function') throw new Error('No server function ' + fn);
    try {
      const res = ctx[fn].apply(null, args);
      return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
    } catch (e) {
      throw new Error(e && e.message ? e.message : String(e));
    } finally { store.realmDate = null; }
  }
  return { store, run };
}

module.exports = { makeServer, makeStore, formatDate, coerce, gitShow };
