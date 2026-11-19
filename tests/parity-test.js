/*
 * The truck calculation exists twice: derive_ / carry_ in Code.js (server) and derive / CARRY in Index.html (screen).
 * CLAUDE.md rule: they must give identical numbers. This runs both on the same trucks and compares every amount.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

const S = { shortageAllowancePct: 0.002, freeDays: 3, detentionPerDay: 500, defaultCreditDays: 7, firms: 'RAGHAV TRADING AND COMPANY, SHREE RAM SOLVEX', plantFirm: 'SHREE RAM SOLVEX', slipCheckFrom: '2026-11-12' };
const today = '2026-11-19';
const PO = {
  'PO-01-BCL': { id: 'PO-01-BCL', plant: 'BCL', rate: 1900, gst: 0.05, poType: 'trade' },
  'PO-02-OASIS': { id: 'PO-02-OASIS', plant: 'OASIS ETHANOL', rate: 1850, gst: 0.05, poType: 'plant', firm: 'SHREE RAM SOLVEX' },
  'PO-03-MG': { id: 'PO-03-MG', plant: 'MG PETROCHEM', rate: 1950, gst: 0.05, poType: 'trade', firm: 'RAGHAV TRADING AND COMPANY' }
};
const SO = {
  'SO-0001': { id: 'SO-0001', buyer: 'GODREJ AGROVET KHANA', rate: 2100, gst: 0.05, gstMode: 'incl', freightMode: 'ours', creditDays: 7 },
  'SO-0002': { id: 'SO-0002', buyer: 'KING FOOD MALERKOTLA', rate: 2000, gst: 0.05, gstMode: 'excl', freightMode: 'buyer', creditDays: '' },
  'SO-0003': { id: 'SO-0003', buyer: 'SHREE RAM SOLVEX', rate: 2050, gst: 0.05, gstMode: 'incl', freightMode: 'ours' }
};
const trucks = [
  { id: 'DISP-0001', date: '2026-11-10', po: 'PO-01-BCL', so: 'SO-0001', truck: 'PB29X0297', loadWt: 384.5, unloadWt: 382, unloadDate: '2026-11-16', frate: 85, advance: 10000, received: 0, deduction: '', detention: '', saleRate: '' },
  { id: 'DISP-0002', date: '2026-11-12', po: 'PO-01-BCL', so: 'SO-0002', truck: 'HR55A1234', loadWt: 350, unloadWt: 349.5, unloadDate: '2026-11-13', frate: 90, advance: 5000, received: 735000, deduction: 0, detention: '' },
  { id: 'DISP-0003', date: '2026-11-14', po: 'PO-02-OASIS', so: '', truck: 'PB 29 X 0297', loadWt: 300, unloadWt: 297, unloadDate: '2026-11-15', frate: 80, advance: 30000, freightPaid: true, detention: 1000 },
  { id: 'DISP-0004', date: '2026-11-15', po: 'PO-03-MG', so: 'SO-0003', truck: 'RJ14C5555', loadWt: 410.2, unloadWt: '', frate: 88, advance: 0, saleRate: 2080, plantPaid: true, billQty: 410.2 },
  { id: 'DISP-0005', date: '2026-11-18', po: 'PO-01-BCL', so: 'SO-0001', truck: 'PB29X0297', loadWt: 390, unloadWt: 388, unloadDate: '2026-11-19', frate: 85, advance: 0, received: 400000, deduction: 1000, slipPhoto: 'x' },
  { id: 'DISP-0006', date: '2026-11-18', po: 'PO-01-BCL', so: 'SO-0001', truck: 'UP15Z9', loadWt: '', status: 'Cancelled' },
  { id: 'DISP-0007', date: '2026-11-01', po: 'PO-01-BCL', so: 'SO-0001', truck: 'MH04XY1111', loadWt: 395, unloadWt: 395, unloadDate: '2026-11-03', frate: 85, advance: 0, received: 829500, deduction: 0, freightPaid: true },
  { id: 'DISP-0008', date: '2026-11-02', po: 'PO-01-BCL', so: 'SO-0001', truck: 'GJ01ZZ0001', loadWt: 380, unloadWt: 372, unloadDate: '2026-11-06', frate: 85, advance: 50000, detention: 1500 },
  { id: 'DISP-0009', date: '2026-11-05', po: 'PO-01-BCL', so: 'SO-0001', truck: 'GJ 01 ZZ 0001', loadWt: 381, unloadWt: 380, unloadDate: '2026-11-09', frate: 85, advance: 0 },
  { id: 'DISP-0010', date: '2026-11-19', po: 'PO-01-BCL', so: '', truck: 'KA01AA0001', loadWt: '', placedOn: '2026-11-19', status: 'Returned' }
];

// server
const code = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const sv = { Utilities: {}, console };
vm.createContext(sv);
vm.runInContext(code + '\nthis.derive_ = derive_; this.carry_ = carry_;', sv);
const sOut = sv.carry_(trucks.map(t => sv.derive_(Object.assign({}, t), PO[t.po], SO[t.so], S, today)));

// screen: everything up to flagIssues (helpers, data, fast saving, derive, CARRY)
const html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const calc = js.slice(0, js.indexOf('function flagIssues'));
const cv = { document: { querySelector() { return null; } }, window: {}, console };
vm.createContext(cv);
vm.runInContext(calc + '\nD = ' + JSON.stringify({ settings: S, today }) + '; P = { money: true }; PO = ' + JSON.stringify(PO) + '; SO = ' + JSON.stringify(SO) +
  '; this.out = CARRY(' + JSON.stringify(trucks) + '.map(derive));', cv);

const keys = ['L', 'U', 'R', 'A', 'FR', 'DED', 'purEx', 'purTot', 'saleWt', 'saleEx', 'saleTot', 'soBase', 'short', 'allow', 'shortDed', 'frAmt', 'trip', 'detDays', 'detSuggest', 'det',
  'netFr', 'netPay', 'carryIn', 'carryOut', 'carryLeft', 'bal', 'profit', 'st', 'credit', 'overdue', 'ownBuyer', 'fBuyer', 'plantPO', 'firm', 'rateUsed', 'noSlip', 'cx', 'placed', 'stage'];
let bad = 0;
sOut.forEach((s, i) => {
  const c = cv.out[i];
  keys.forEach(k => {
    if (JSON.stringify(s[k]) !== JSON.stringify(c[k])) { bad++; console.log('  DIFF ' + s.id + ' ' + k + ': server ' + JSON.stringify(s[k]) + ' screen ' + JSON.stringify(c[k])); }
  });
});
sOut.forEach(s => console.log('  ' + s.id + '  purchase ' + s.purTot + '  sale ' + s.saleTot + '  shortDed ' + s.shortDed + '  netFreight ' + s.netFr + '  pay ' + s.netPay + '  balance ' + s.bal + '  profit ' + s.profit + '  ' + s.stage));
console.log(bad ? '\n' + bad + ' DIFFERENCES between server and screen' : '\nServer and screen give identical numbers on all ' + sOut.length + ' trucks (' + keys.length + ' values each).');
process.exitCode = bad ? 1 : 0;
