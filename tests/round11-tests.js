/*
 * Reports tab (Nitish, 25-11-2026): purchase-order-wise (where the trucks went: per sale order rate, trucks, loaded,
 * unloaded, profit; then each sale order's trucks) and sale-order-wise (the mirror). PDF and Excel. Profit only for the
 * Owner; money roles only. A truck on two orders counts its part on each, matched old with old.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const lastId = (s, truck) => s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === truck).map(r => r[0]).pop();
const r2 = x => Math.round(x * 100) / 100;
const html = r => Buffer.from(r.b64, 'base64').toString('utf8');

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const A = () => s.run('deriveAll_');
  s.run('api_settle', own, 'po', 'PO-01-BCL', true);
  s.run('api_settle', own, 'so', 'SO-0001', true);
  const po = (date, qty, rate) => { s.run('api_savePO', own, { plant: 'BCL', date, qty, rate, gst: 0.05, poType: 'trade', commodity: 'DDGS' }); return Object.values(A().po).find(o => Number(o.rate) === rate).id; };
  const so = (date, qty, rate) => { s.run('api_saveSO', own, { buyer: 'Godrej Agrovet Khana', date, qty, rate, gst: 0.05, gstMode: 'incl', freightMode: 'ours', creditDays: 7, commodity: 'DDGS' }); return Object.values(A().so).find(o => Number(o.rate) === rate).id; };
  const OLD = po('2026-11-05', 1000, 2371), NEW = po('2026-11-21', 5000, 2575), SOX = so('2026-11-10', 534.4, 2821.6), SOY = so('2026-11-17', 2000, 2946);
  const today = s.run('today_');
  const add = (no, p, w, day, soId, u) => {
    s.run('api_saveTruck', own, { truck: no, po: p, so: soId || '', placedOn: day, date: day, loadWt: String(w), frate: '85', _force: true });
    const id = lastId(s, no);
    if (u) s.run('api_saveTruck', own, { id, unloadDate: today, unloadWt: String(u), _force: true });
    return id;
  };
  const t1 = add('PB01AA1001', OLD, 430, '2026-11-06', SOX, 429);
  const t2 = add('PB01AA1002', OLD, 428.4, '2026-11-07');                     // no customer yet
  const sp = add('PB11CJ9850', OLD, 367.4, '2026-11-22', SOX);
  s.run('api_saveTruck', own, { id: sp, po2: NEW, poQty: 141.6, so2: SOY, soQty: 104.4, _force: true });
  s.run('api_saveTruck', own, { id: sp, unloadDate: today, unloadWt: '366.40', _force: true });
  const t4 = add('PB01AA1004', NEW, 300, '2026-11-23', SOY);                  // on the road
  const T = id => A().trucks.find(t => t.id === id);
  console.log('Set-up: ' + OLD + ' (old BCL) → ' + SOX + ' and the split truck ' + sp + ' (141.60 + 225.80 on ' + NEW + '; 104.40 on ' + SOX + ' + 263.00 on ' + SOY + ')');

  console.log('Server: list and order reports');
  const L = s.run('api_reports', own, 'po', '');
  const rOld = L.rows.find(r => r.id === OLD), rNew = L.rows.find(r => r.id === NEW);
  ok(rOld.L === 1000 && rOld.trucks === 3 && rOld.bal === 0 && rNew.L === 525.8 && rNew.trucks === 2 && rNew.road === 300, OLD + ': 1,000.00 loaded, 3 trucks, balance 0; ' + NEW + ': 525.80 (225.80 + 300 on the road)');
  const truckProfit = [t1, sp].reduce((a, id) => a + T(id).profit, 0);
  ok(r2(rOld.profit + rNew.profit) === r2(truckProfit) && L.profit === true, 'Owner: profit of the two POs adds up to the trucks\' profit (₹' + r2(truckProfit) + ')');
  const R = s.run('api_orderReport', own, 'po', OLD), g = id => R.groups.find(x => x.id === id || x.key === id);
  ok(R.groups.map(x => x.id || x.party).join(', ') === SOX + ', ' + SOY + ', No customer yet', 'where it went: ' + SOX + ', ' + SOY + ', No customer yet (old orders first)');
  ok(g(SOX).trucks === 2 && g(SOX).L === 534.4 && g(SOX).rate === 2821.6 && g(SOY).L === 37.2 && g(SOY).rows[0].of === 367.4 && g('(no customer yet)').L === 428.4, SOX + ': 2 trucks 534.40 at ₹2,821.60; ' + SOY + ': 37.20 of the 367.40 truck; no customer yet 428.40');
  const pieces = R.groups.reduce((a, x) => a.concat(x.rows.filter(r => r.id === sp)), []);
  const RN = s.run('api_orderReport', own, 'po', NEW), pn = RN.groups.find(x => x.id === SOY).rows.find(r => r.id === sp);
  ok(pieces.map(r => r.L + '/' + r.U).join(' ') === '104.4/104.4 37.2/37.2' && pn.L === 225.8 && pn.U === 224.8, 'split truck matched old with old: 104.40 ' + OLD + '→' + SOX + ', 37.20 ' + OLD + '→' + SOY + ', 225.80 ' + NEW + '→' + SOY + ' (received 224.80: the shortage falls at the end)');
  ok(r2(pieces.reduce((a, r) => a + r.profit, 0) + pn.profit) === T(sp).profit, 'its three pieces add up to its profit (₹' + T(sp).profit + ')');
  const RS = s.run('api_orderReport', own, 'so', SOY);
  ok(RS.groups.map(x => x.id + ' ' + x.L).join(', ') === OLD + ' 37.2, ' + NEW + ' 525.8' && RS.order.L === 563 && RS.order.road === 300 && RS.groups[0].rate === 2371, 'SO report ' + SOY + ': came from ' + OLD + ' 37.20 (₹2,371) and ' + NEW + ' 525.80; 563.00 dispatched, 300.00 on the road');

  console.log('Roles');
  const LA = s.run('api_reports', acc, 'po', ''), RA = s.run('api_orderReport', acc, 'po', OLD);
  ok(LA.profit === false && !('profit' in LA.rows[0]) && !('profit' in RA.order) && !('profit' in RA.groups[0]) && !('profit' in RA.groups[0].rows[0]), 'Accounts: everything except the profit');
  ok(/not allowed/.test(err(() => s.run('api_reports', dis, 'po', ''))) && /not allowed/.test(err(() => s.run('api_reportFile', dis, 'po', OLD, '', 'pdf'))), 'Dispatch: refused');
  ok(/Unknown firm/.test(err(() => s.run('api_reports', own, 'po', 'XYZ'))) && /was not found/.test(err(() => s.run('api_orderReport', own, 'po', 'PO-99'))), 'unknown firm / order refused');

  console.log('PDF and Excel');
  const pdf = html(s.run('api_reportFile', own, 'po', OLD, '', 'pdf'));
  ok(/<h2>Where the trucks went<\/h2>/.test(pdf) && (pdf.match(/class="pb"/g) || []).length === 3 && /Profit/.test(pdf), 'order PDF: summary first, then each sale order on a new page (3), with profit');
  const pdfA = html(s.run('api_reportFile', acc, 'po', OLD, '', 'pdf'));
  ok(!/Profit/.test(pdfA) && /Where the trucks went/.test(pdfA), 'Accounts\' PDF has no profit');
  const lpdf = html(s.run('api_reportFile', own, 'so', '', '', 'pdf'));
  ok(/Sale orders report · All firms/.test(lpdf) && lpdf.indexOf(SOY) >= 0, 'list PDF (sale orders)');
  const xr = s.run('api_reportFile', own, 'po', OLD, '', 'xlsx');
  ok(/\.xlsx$/.test(xr.name) && /DDGS Exports/.test(JSON.stringify(s.store.folders.map(f => f.name))), 'Excel made and saved in DDGS Exports: ' + xr.name);
  const tabs = s.run('orderReportTabs_', R);
  ok(tabs.map(t => t.name).join(', ') === 'Order, Where it went, ' + SOX + ', ' + SOY + ', No customer yet', 'Excel sheets: Order, Where it went, one per sale order');
  const w = tabs[1].rows;
  ok(w[1][2] === SOX && w[1][7] === 534.4 && w.slice(-1)[0][1] === 'Total' && w.slice(-1)[0][7] === 1000 && typeof w[1][9] === 'number', 'Where it went: numbers as numbers, Total row 1,000');
  ok(s.store.sheet('APP_LOG').dump().some(x => x[2] === 'Report PDF') && s.store.sheet('APP_LOG').dump().some(x => x[2] === 'Report Excel'), 'downloads are in the log');

  console.log('Screen');
  const O = openApp(s, own);
  ok(await idle(O), 'Owner screen loads');
  ok(!!O.$('#nav [data-tab="reports"]'), 'Reports tab');
  O.win.go('reports');
  ok(await idle(O), 'list loaded');
  const rowsP = O.$$('#view .tbl .tr:not(.th)');
  ok(rowsP.some(x => x.textContent.indexOf(OLD) >= 0) && /Profit/.test(O.$('#view .tbl .th').textContent), 'purchase orders listed, with Profit');
  O.$('#view [data-act="repKind"][data-id="so"]').click();
  ok(await idle(O), 'sale orders loaded');
  ok(O.$$('#view .tbl .tr:not(.th)').some(x => x.textContent.indexOf(SOY) >= 0), 'sale orders listed');
  O.win.go('oreport', 'po|' + OLD);
  ok(await idle(O), 'report loaded');
  const v = O.$('#view').textContent;
  ok(/Where the trucks went/.test(v) && v.indexOf(SOX + ' · GODREJ AGROVET KHANA') >= 0 && /of 367\.40 \(2 orders\)/.test(v), 'order report: where it went, a section per sale order, the split truck marked');
  O.$('#view [data-act="repPdf"]').click();
  ok(await idle(O), 'PDF made');
  await new Promise(r => setTimeout(r, 20));
  ok(/PDF is ready/.test(O.$('#mform').textContent), '"PDF is ready"');
  O.win.closeForm();
  O.$('#view [data-act="repXlsx"]').click();
  ok(await idle(O), 'Excel made');
  await new Promise(r => setTimeout(r, 20));
  ok(/Excel is ready/.test(O.$('#mform').textContent), '"Excel is ready"');
  O.win.closeForm();
  O.win.go('po', OLD);
  ok(!!O.$('#view [data-go="oreport"]'), 'order page has a Report button');
  O.win.close();
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  K.win.go('oreport', 'po|' + OLD);
  ok(await idle(K), 'report loaded');
  ok(!/Profit/.test(K.$('#view').textContent) && /Where the trucks went/.test(K.$('#view').textContent), 'Accounts: report without profit');
  K.win.close();
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  ok(!V.$('#nav [data-tab="reports"]'), 'Dispatch: no Reports tab');
  V.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll Reports tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
