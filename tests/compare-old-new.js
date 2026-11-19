/*
 * Runs the same realistic day on the OLD Code.js (from git) and the NEW Code.js (working copy)
 * and checks that the sheet and every role's screen data come out the same.
 * Usage: node tests/compare-old-new.js [git-commit-of-old-code]   (default: the commit that moved the screen to Index.html)
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');

const ROOT = path.join(__dirname, '..');
const oldRef = process.argv[2] || '920e788';
const oldCode = execSync('git show ' + oldRef + ':Code.js', { cwd: ROOT, maxBuffer: 1e8 }).toString();

// Columns whose values depend on the clock or on random salts, not on the logic.
const VOLATILE_HEAD = ['Updated At', 'Entered At', 'Written At', 'Verified At', 'Salt', 'Password Hash', 'Time'];
const VOLATILE_KEY = ['at', 'syncedAt', 'v', 'salt', 'hash', 'time', 'verifiedAt'];

function sheetDump(store, name) {
  const sh = store.sheet(name);
  if (!sh) return null;
  const rows = sh.dump(), head = rows[0] || [];
  const keep = head.map((h, i) => VOLATILE_HEAD.indexOf(h) < 0 ? i : -1).filter(i => i >= 0);
  return rows.map(r => keep.map(i => (r[i] === undefined ? '' : r[i])));
}
function clean(x) {
  if (Array.isArray(x)) return x.map(clean);
  if (x && typeof x === 'object') {
    const o = {};
    Object.keys(x).sort().forEach(k => { if (VOLATILE_KEY.indexOf(k) < 0 && k !== '_row') o[k] = clean(x[k]); });
    return o;
  }
  return x;
}

function runOn(code) {
  const s = makeServer({ code });
  const out = runScenario(s);
  const tabs = {};
  ['APP_PO', 'APP_SO', 'APP_TRUCKS', 'APP_PAYMENTS', 'APP_NOTES', 'APP_BANK', 'APP_SETTINGS', 'APP_USERS', 'APP_LOG'].forEach(n => { tabs[n] = sheetDump(s.store, n); });
  const screens = {};
  Object.keys(out.tokens).forEach(k => { screens[k] = clean(s.run('api_getData', out.tokens[k])); });
  return { log: out.log, tabs, screens };
}

let fails = 0;
function same(label, a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { console.log('  same  ' + label); return; }
  fails++;
  console.log('  DIFF  ' + label);
  // show the first difference
  for (let i = 0; i < Math.max(ja.length, jb.length); i++) if (ja[i] !== jb[i]) { console.log('        old: …' + ja.slice(Math.max(0, i - 120), i + 120) + '\n        new: …' + jb.slice(Math.max(0, i - 120), i + 120)); break; }
}

const A = runOn(oldCode), B = runOn(undefined);

/* Differences Nitish asked for (round 2, Nov 2026). They are taken out here so everything else must still match exactly:
   - dates in messages are DD-MM-YYYY (old: yyyy-mm-dd)
   - new setting qtyTolerancePct (order quantity window) */
const EXPECTED = ['dates in messages DD-MM-YYYY', 'new setting qtyTolerancePct'];
A.log.forEach(l => { if (l.err) l.err = l.err.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3-$2-$1'); });
if (B.tabs.APP_SETTINGS) B.tabs.APP_SETTINGS = B.tabs.APP_SETTINGS.filter(r => r[0] !== 'qtyTolerancePct');
Object.keys(B.screens).forEach(k => { if (B.screens[k].settings) delete B.screens[k].settings.qtyTolerancePct; });

console.log('Old code: ' + oldRef + '  vs  new code: working copy   (expected changes left out: ' + EXPECTED.join('; ') + ')');
same('step results and error messages (' + A.log.length + ' steps)', A.log.map(l => [l.label, l.ok, l.err || '']), B.log.map(l => [l.label, l.ok, l.err || '']));
Object.keys(A.tabs).forEach(n => same('sheet ' + n, A.tabs[n], B.tabs[n]));
Object.keys(A.screens).forEach(k => same('screen data for ' + k, A.screens[k], B.screens[k]));

const sumReads = log => log.reduce((s, l) => s + l.reads, 0);
console.log('\nSheet reads, old -> new (whole day: ' + sumReads(A.log) + ' -> ' + sumReads(B.log) + ')');
A.log.forEach((l, i) => { if (/T1 weight|supplier paid T1|unload T1|payment T1|batch freight|T2 with weight/.test(l.label)) console.log('  ' + l.label.padEnd(34) + String(l.reads).padStart(3) + ' -> ' + B.log[i].reads); });
console.log(fails ? '\n' + fails + ' DIFFERENCES' : '\nAll the same.');
process.exitCode = fails ? 1 : 0;
