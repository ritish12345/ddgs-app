/*
 * Dispatch report PDF (Nitish, 24-11-2026): for a from–to range, all open POs and SOs with their balance, the trucks
 * dispatched (date out) and the trucks unloaded, day by day. Rates and amounts for money roles; Dispatch gets weights only.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const DV = 'DEVAN TRADING AND COMPANY';
const count = (h, re) => (h.match(re) || []).length;
const section = (h, title) => { const i = h.indexOf('<h2>' + title); const j = h.indexOf('<h2>', i + 4); return i < 0 ? '' : h.slice(i, j < 0 ? h.length : j); };
const rowsIn = sec => Math.max(0, count(sec, /<tr>/g) - 1); // minus the heading row (the totals row has class="tot")

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const A = s.run('deriveAll_'), today = A.today;
  const live = A.trucks.filter(t => !t.cx);
  const from = '2026-11-01', to = today;
  const inR = d => d && d >= from && d <= to;
  const nDisp = live.filter(t => t.L && inR(t.date)).length, nUnl = live.filter(t => t.U && inR(t.unloadDate)).length;
  const html = r => { const f = s.store.folders.find(x => x.name === 'RAGHAV BUSY APP Exports'); return String(f.files.length && r ? Buffer.from(r.b64, 'base64').toString('utf8') : ''); };

  console.log('Server');
  const r = s.run('api_reportPdf', acc, from, to, '');
  const h = html(r);
  ok(/^DDGS Dispatch report 01-11-2026 to \d\d-\d\d-2026\.pdf$/.test(r.name) && /drive\.google\.com/.test(r.url), 'PDF named with the dates, saved in Google Drive: ' + r.name);
  ok(rowsIn(section(h, 'Trucks dispatched')) === nDisp && rowsIn(section(h, 'Trucks unloaded')) === nUnl, 'lists ' + nDisp + ' trucks dispatched and ' + nUnl + ' unloaded (same as the app)');
  ok(/<h2>Day by day/.test(h) && /<h2>Purchase orders/.test(h) && /<h2>Sale orders/.test(h), 'sections: day by day, purchase orders, sale orders');
  const openPO = Object.values(A.po).filter(o => o.status !== 'Cancelled' && o.status !== 'Settled');
  ok(openPO.every(o => section(h, 'Purchase orders').indexOf('>' + o.id) >= 0 || section(h, 'Purchase orders').indexOf('<td>' + o.id) >= 0), 'every open PO is listed (' + openPO.length + ')');
  ok(/Rs /.test(h) && /Purchase incl\. GST/.test(h) && /Sale amount/.test(h) && !/weights only/.test(h), 'Accounts: with rates and amounts');
  ok(s.store.sheet('APP_LOG').dump().some(x => x[2] === 'Report PDF'), 'logged');

  const d = html(s.run('api_reportPdf', dis, from, to, ''));
  ok(!/Rs /.test(d) && !/Purchase incl/.test(d) && /weights only/.test(d) && rowsIn(section(d, 'Trucks dispatched')) === nDisp, 'Dispatch: same trucks, weights only (no rates, no Rs)');

  const one = html(s.run('api_reportPdf', acc, today, today, ''));
  ok(!/Day by day/.test(one) && /Dispatch report/.test(one), 'one day: no day-by-day table');
  ok(/Choose the from and to/.test(err(() => s.run('api_reportPdf', acc, '24-11-2026', today, ''))) && /after the to date/.test(err(() => s.run('api_reportPdf', acc, today, '2026-11-01', ''))) &&
    /at most one year/.test(err(() => s.run('api_reportPdf', acc, '2025-01-01', today, ''))) && /Unknown firm/.test(err(() => s.run('api_reportPdf', acc, from, to, 'XYZ'))), 'bad dates and unknown firm refused');
  ok(/^LOGIN$/.test(err(() => s.run('api_reportPdf', 'bad-token', from, to, ''))), 'needs a login');

  console.log('Per firm');
  s.run('api_savePO', own, { plant: 'BCL', date: '2026-11-20', qty: 3000, rate: 2400, gst: 0.05, poType: 'trade', firm: DV, commodity: 'DDGS' });
  const dpo = Object.keys(s.run('deriveAll_').po).filter(k => s.run('deriveAll_').po[k].firm === DV)[0];
  const dv = html(s.run('api_reportPdf', acc, from, to, DV));
  ok(/Dispatch report · DEVAN TRADING AND COMPANY/.test(dv) && dv.indexOf(dpo) >= 0 && rowsIn(section(dv, 'Purchase orders')) === 1 && rowsIn(section(dv, 'Trucks dispatched')) === 0 && /None\./.test(dv), 'Devan: only Devan\'s PO ' + dpo + ', no trucks ("None.")');

  console.log('Screen');
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  K.win.go('dispatch');
  ok(!!K.$('#view [data-act="report"]'), 'Dispatch Register: "Report PDF" button');
  K.win.runAct('report');
  ok(K.$('#f_from').value === K.win.dmy(today) && K.$('#f_to').value === K.win.dmy(today), 'form starts with today to today');
  K.$$('#mform .chip').find(b => b.textContent === 'This month').click();
  ok(K.$('#f_from').value === '01-' + K.win.dmy(today).slice(3), '"This month" sets 01-' + K.win.dmy(today).slice(3));
  submit(K);
  ok(await idle(K), 'made');
  await new Promise(res => setTimeout(res, 20));
  ok(/PDF is ready/.test(K.$('#mform').textContent) && /Dispatch report 01-11-2026/.test(K.$('#mform').textContent) && !K.$('#modal').hidden, '"PDF is ready" with download and Drive link');
  K.win.closeForm();
  K.win.close();
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  V.win.go('dispatch');
  ok(!!V.$('#view [data-act="report"]'), 'Dispatch staff also have the button (weights only)');
  V.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll report PDF tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
