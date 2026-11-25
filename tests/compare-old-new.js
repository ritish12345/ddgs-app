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
// busy-app is a copy of the DDGS app without its git history: the old DDGS code comes from the ddgs-app repo next to it.
const DDGS = path.join(ROOT, '..', 'ddgs-app');
const GIT = require('fs').existsSync(path.join(DDGS, '.git')) ? DDGS : ROOT;
const oldCode = require('./fake-gas').gitShow(oldRef, 'Code.js');

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
const EXPECTED = ['dates in messages DD-MM-YYYY', 'new settings qtyTolerancePct + hiddenFirms (left empty in this day)',
  'customer payments (pays) sent to money roles', 'new Closed rule changes the stage sent to Dispatch (_st)',
  'transporter optional (23-11-2026): a weight without transporter and rate is refused for the missing rate'];
A.log.forEach(l => {
  if (l.err) l.err = l.err.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3-$2-$1');
  if (l.err === 'Enter the transporter. It is required once the weight is entered.') l.err = 'Enter the freight rate per qtl. It is required once the weight is entered.';
});
if (B.tabs.APP_SETTINGS) B.tabs.APP_SETTINGS = B.tabs.APP_SETTINGS.filter(r => r[0] !== 'qtyTolerancePct' && r[0] !== 'hiddenFirms');
Object.keys(B.screens).forEach(k => { if (B.screens[k].settings) { delete B.screens[k].settings.qtyTolerancePct; delete B.screens[k].settings.hiddenFirms; } delete B.screens[k].pays; });
// Transporter advances (24-11-2026): new column at the end of APP_TRUCKS (blank in this day) and the advances sent to money roles.
EXPECTED.push('transporter advances: new APP_TRUCKS column "Transporter Advance Used" (blank here), advances sent to money roles');
if (B.tabs.APP_TRUCKS) { const ci = B.tabs.APP_TRUCKS[0].indexOf('Transporter Advance Used'); if (ci >= 0) B.tabs.APP_TRUCKS = B.tabs.APP_TRUCKS.map(r => r.filter((x, i) => i !== ci)); }
Object.keys(B.screens).forEach(k => { delete B.screens[k].advances; (B.screens[k].trucks || []).forEach(t => { delete t.tAdv; }); });
// Four firms (24-11-2026): the firms setting lists Devan, Saraswati and Jai Mahavir too; payments carry a Firm column (last).
EXPECTED.push('four firms: firms setting, new APP_PAYMENTS column "Firm"');
[A, B].forEach(X => {
  if (X.tabs.APP_SETTINGS) X.tabs.APP_SETTINGS = X.tabs.APP_SETTINGS.filter(r => r[0] !== 'firms');
  Object.keys(X.screens).forEach(k => { if (X.screens[k].settings) delete X.screens[k].settings.firms; });
});
if (B.tabs.APP_PAYMENTS) { const pi = B.tabs.APP_PAYMENTS[0].indexOf('Firm'); if (pi >= 0) B.tabs.APP_PAYMENTS = B.tabs.APP_PAYMENTS.map(r => r.filter((x, i) => i !== pi)); }
// One truck on two orders (24-11-2026): four new APP_TRUCKS columns at the end, blank on this day.
EXPECTED.push('split trucks: new APP_TRUCKS columns Second PO ID, Qty On First PO, Second SO ID, Qty On First SO, Qty On Second PO, Qty On Second SO (blank here)');
if (B.tabs.APP_TRUCKS) { const cut = ['Second PO ID', 'Qty On First PO', 'Second SO ID', 'Qty On First SO', 'Qty On Second PO', 'Qty On Second SO'].map(h => B.tabs.APP_TRUCKS[0].indexOf(h)).filter(i => i >= 0); B.tabs.APP_TRUCKS = B.tabs.APP_TRUCKS.map(r => r.filter((x, i) => cut.indexOf(i) < 0)); }
Object.keys(B.screens).forEach(k => (B.screens[k].trucks || []).forEach(t => { ['po2', 'poQty', 'so2', 'soQty', 'po2Qty', 'so2Qty'].forEach(f => { delete t[f]; }); }));
// Transporter names with an advance (25-11-2026): roles without money get the names only (advNames).
EXPECTED.push('advNames (transporter names with an advance) sent to roles without money');
Object.keys(B.screens).forEach(k => { delete B.screens[k].advNames; });
// RAGHAV BUSY APP (25-11-2026): Busy columns at the end of APP_PO / APP_SO / APP_TRUCKS / APP_PAYMENTS (blank on a day without
// Busy uploads), Busy settings, company name, the "busy" permission. Everything else must still be exactly the DDGS app.
EXPECTED.push('Busy app: Busy columns at the end of APP_PO / APP_SO / APP_TRUCKS / APP_PAYMENTS (blank here), Busy settings, company name, perm.busy');
const BUSY_COLS = ['Source', 'Busy Key', 'GSTIN', 'Busy Bills', 'Busy Amount incl GST', 'Last Bill Date', 'Busy Purchase Key', 'Busy Sale Key', 'Sale Bill No', 'Sale Bill Qty', 'Busy Purchase Amount', 'Busy Sale Amount', 'Supplier Status (Busy)', 'Customer Status (Busy)', 'Match'];
['APP_PO', 'APP_SO', 'APP_TRUCKS', 'APP_PAYMENTS'].forEach(n => { if (B.tabs[n]) { const cut = B.tabs[n][0].map((h, i) => BUSY_COLS.indexOf(h) >= 0 ? i : -1).filter(i => i >= 0); B.tabs[n] = B.tabs[n].map(r => r.filter((x, i) => cut.indexOf(i) < 0)); } });
const BUSY_SET = ['dailyReport', 'weeklyBackup', 'busyCompany', 'busyFirm', 'busyGapDays', 'busyPairQty', 'busyPairBefore', 'busyPairAfter', 'busyWetCakeItems', 'busyWetCakeAccounts', 'company'];
[A, B].forEach(X => {
  if (X.tabs.APP_SETTINGS) X.tabs.APP_SETTINGS = X.tabs.APP_SETTINGS.filter(r => BUSY_SET.indexOf(r[0]) < 0);
  Object.keys(X.screens).forEach(k => {
    const sc = X.screens[k];
    if (sc.settings) BUSY_SET.forEach(f => { delete sc.settings[f]; });
    if (sc.perm) delete sc.perm.busy;
    ['po', 'so', 'trucks', 'pays'].forEach(l => (sc[l] || []).forEach(r => { ['src', 'bkey', 'gstin', 'bBills', 'bAmt', 'bLast', 'bPKey', 'bSKey', 'sBillNo', 'sBillQty', 'bPAmt', 'bSAmt', 'bPStat', 'bSStat', 'bMatch'].forEach(f => { delete r[f]; }); }));
  });
});
// Stage values follow the new Closed rule (checked in parity / receivables tests); here only that Dispatch still gets one.
[A, B].forEach(X => Object.keys(X.screens).forEach(k => (X.screens[k].trucks || []).forEach(t => { if ('_st' in t) t._st = 'present'; })));

console.log('Old code: ' + oldRef + '  vs  new code: working copy   (expected changes left out: ' + EXPECTED.join('; ') + ')');
same('step results and error messages (' + A.log.length + ' steps)', A.log.map(l => [l.label, l.ok, l.err || '']), B.log.map(l => [l.label, l.ok, l.err || '']));
Object.keys(A.tabs).forEach(n => same('sheet ' + n, A.tabs[n], B.tabs[n]));
Object.keys(A.screens).forEach(k => same('screen data for ' + k, A.screens[k], B.screens[k]));

const sumReads = log => log.reduce((s, l) => s + l.reads, 0);
console.log('\nSheet reads, old -> new (whole day: ' + sumReads(A.log) + ' -> ' + sumReads(B.log) + ')');
A.log.forEach((l, i) => { if (/T1 weight|supplier paid T1|unload T1|payment T1|batch freight|T2 with weight/.test(l.label)) console.log('  ' + l.label.padEnd(34) + String(l.reads).padStart(3) + ' -> ' + B.log[i].reads); });
console.log(fails ? '\n' + fails + ' DIFFERENCES' : '\nAll the same.');
process.exitCode = fails ? 1 : 0;
