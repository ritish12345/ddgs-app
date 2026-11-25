/*
 * Reports tab (Nitish, 25-11-2026): purchase-order-wise (where the trucks went: per sale order rate, trucks, loaded,
 * unloaded, sale amount; then each sale order's trucks with the rate each was sold at and its amount) and
 * sale-order-wise (the mirror, at the purchase rate and amount). PDF and Excel. No profit: amounts only (he works the
 * profit out himself). Money roles only. A truck on two orders counts its part on each, matched old with old.
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
  add('PB01AA1002', OLD, 428.4, '2026-11-07');                                 // no customer yet
  const sp = add('PB11CJ9850', OLD, 367.4, '2026-11-22', SOX);
  s.run('api_saveTruck', own, { id: sp, po2: NEW, poQty: 141.6, so2: SOY, soQty: 104.4, _force: true });
  s.run('api_saveTruck', own, { id: sp, unloadDate: today, unloadWt: '366.40', _force: true });
  add('PB01AA1004', NEW, 300, '2026-11-23', SOY);                               // on the road
  const T = id => A().trucks.find(t => t.id === id);
  console.log('Set-up: ' + OLD + ' (BCL ₹2,371) → ' + SOX + ' (Godrej ₹2,821.60) and the split truck ' + sp + ' (141.60 + 225.80 on ' + NEW + ' ₹2,575; 104.40 on ' + SOX + ' + 263.00 on ' + SOY + ' ₹2,946)');

  console.log('Lists: purchase amount per PO, sale amount per SO');
  const L = s.run('api_reports', own, 'po', '');
  const rOld = L.rows.find(r => r.id === OLD), rNew = L.rows.find(r => r.id === NEW);
  ok(rOld.L === 1000 && rOld.trucks === 3 && rOld.bal === 0 && rOld.amt === 2489550, OLD + ': 1,000.00 loaded, 3 trucks, purchase amount ₹24,89,550 (1,000 × 2,371 × 1.05)');
  ok(rNew.L === 525.8 && rNew.road === 300 && rNew.amt === 1421631.75, NEW + ': 525.80 (300 on the road), purchase amount ₹14,21,631.75 (225.80 + 300 at 2,575 + GST)');
  ok(!JSON.stringify(L).includes('profit'), 'no profit anywhere');
  const LS = s.run('api_reports', own, 'so', '');
  ok(LS.rows.find(r => r.id === SOX).amt === 1505041.44 && LS.rows.find(r => r.id === SOY).amt === 1655652, SOX + ' sale amount ₹15,05,041.44; ' + SOY + ' ₹16,55,652 (incl. 300 on the road on loaded wt)');

  console.log('PO report: where the trucks went, at the sale rate');
  const R = s.run('api_orderReport', own, 'po', OLD), g = id => R.groups.find(x => x.id === id || x.key === id);
  ok(R.groups.map(x => x.id || x.party).join(', ') === SOX + ', ' + SOY + ', No customer yet', 'where it went: ' + SOX + ', ' + SOY + ', No customer yet (old orders first)');
  ok(g(SOX).trucks === 2 && g(SOX).L === 534.4 && g(SOX).rate === 2821.6 && g(SOX).amt === 1505041.44, SOX + ': 2 trucks 534.40 at ₹2,821.60 → ₹15,05,041.44 (429 × 2,821.60 + 104.40 × 2,821.60)');
  ok(g(SOY).L === 37.2 && g(SOY).rows[0].of === 367.4 && g(SOY).rows[0].rate === 2946 && g(SOY).amt === 109591.2, SOY + ': 37.20 of the 367.40 truck at ₹2,946 → ₹1,09,591.20');
  ok(g(SOX).rows.every(r => r.rate === 2821.6) && g(SOX).rows[0].amt === 1210466.4, 'every truck line shows the rate it was sold at (₹2,821.60) and its amount (₹12,10,466.40)');
  ok(g('(no customer yet)').L === 428.4 && g('(no customer yet)').amt === 0 && g('(no customer yet)').rows[0].rate === 0, 'no customer yet: 428.40, no rate, no amount');
  ok(R.order.pur === 2489550 && R.order.sale === 1614632.64, 'top: purchase amount ₹24,89,550 and sale amount ₹16,14,632.64');
  const RN = s.run('api_orderReport', own, 'po', NEW), pn = RN.groups.find(x => x.id === SOY).rows.find(r => r.id === sp);
  ok(pn.L === 225.8 && pn.U === 224.8 && pn.amt === 662260.8 && pn.amt + g(SOY).rows[0].amt === T(sp).sale2Tot, 'split truck matched old with old: 225.80 ' + NEW + '→' + SOY + ' (received 224.80) ₹6,62,260.80; its ' + SOY + ' pieces add up to ₹7,71,852');

  console.log('SO report: where the trucks came from, at the purchase rate');
  const RS = s.run('api_orderReport', own, 'so', SOY);
  ok(RS.groups.map(x => x.id + ' ' + x.L).join(', ') === OLD + ' 37.2, ' + NEW + ' 525.8' && RS.groups[0].rate === 2371 && RS.groups[1].rate === 2575, 'came from ' + OLD + ' 37.20 at ₹2,371 and ' + NEW + ' 525.80 at ₹2,575');
  ok(RS.groups[0].amt === 92611.26 && RS.groups[1].amt === 1421631.75 && RS.groups[0].rows[0].rate === 2371, 'purchase amounts ₹92,611.26 (37.20 × 2,371 + GST) and ₹14,21,631.75; truck lines at ₹2,371');
  ok(RS.order.sale === 1655652 && RS.order.pur === 1514243.01, 'top: sale amount ₹16,55,652, purchase amount ₹15,14,243.01');

  console.log('Roles');
  const RA = s.run('api_orderReport', acc, 'po', OLD);
  ok(RA.order.pur === 2489550 && RA.groups[0].amt === 1505041.44, 'Accounts: the same amounts');
  ok(/not allowed/.test(err(() => s.run('api_reports', dis, 'po', ''))) && /not allowed/.test(err(() => s.run('api_reportFile', dis, 'po', OLD, '', 'pdf'))), 'Dispatch: refused');
  ok(/Unknown firm/.test(err(() => s.run('api_reports', own, 'po', 'XYZ'))) && /was not found/.test(err(() => s.run('api_orderReport', own, 'po', 'PO-99'))), 'unknown firm / order refused');

  console.log('PDF and Excel');
  const pdf = html(s.run('api_reportFile', own, 'po', OLD, '', 'pdf'));
  ok(/<h2>Where the trucks went<\/h2>/.test(pdf) && (pdf.match(/<h2>/g) || []).length === 4 && !/page-break-before|class="pb"/.test(pdf) && !/Profit/i.test(pdf), 'order PDF: summary, then the 3 sale orders one after another (no forced new pages, no wasted paper); no profit');
  ok(/GODREJ AGROVET KHANA · Rs 2,821.60 GST incl., freight incl. · 2 trucks/.test(pdf) && (pdf.match(/<td class="r">Rs 2,821.60<\/td>/g) || []).length === 2 && /Sale amount/.test(pdf), 'section "' + SOX + ' · GODREJ AGROVET KHANA · Rs 2,821.60" and the rate on each truck line below it');
  const lpdf = html(s.run('api_reportFile', own, 'so', '', '', 'pdf'));
  ok(/Sale orders report · All firms/.test(lpdf) && lpdf.indexOf(SOY) >= 0 && /Sale amount/.test(lpdf), 'list PDF (sale orders) with the sale amount');
  const xr = s.run('api_reportFile', own, 'po', OLD, '', 'xlsx');
  ok(/\.xlsx$/.test(xr.name), 'Excel made: ' + xr.name);
  const tabs = s.run('orderReportTabs_', R);
  ok(tabs.map(t => t.name).join(', ') === 'Order, Where it went, ' + SOX + ', ' + SOY + ', No customer yet', 'Excel sheets: Order, Where it went, one per sale order');
  const w = tabs[1].rows, ts = tabs[2].rows;
  ok(w[0].slice(-1)[0] === 'Sale Amount' && w[1][9] === 1505041.44 && w.slice(-1)[0][7] === 1000, 'Where it went: Sale Amount column, numbers as numbers, Total row 1,000');
  ok(ts[0].join('|') === 'S.No.|Dispatch No.|Date Out|Vehicle No|Loaded (qtl)|Unloaded (qtl)|Unload Date|Rate|Sale Amount' && ts[1][7] === 2821.6 && ts[1][8] === 1210466.4, 'sale order sheet: Rate (2,821.60) and Sale Amount on every truck line');
  ok(!JSON.stringify(tabs).includes('Profit'), 'Excel has no profit');

  console.log('Screen');
  const O = openApp(s, own);
  ok(await idle(O), 'Owner screen loads');
  O.win.go('reports');
  ok(await idle(O), 'list loaded');
  const th = O.$('#view .tbl .th').textContent;
  ok(/Purchase amount/.test(th) && !/Profit/i.test(O.$('#view').textContent) && O.$$('#view .tbl .tr:not(.th)').some(x => x.textContent.indexOf(OLD) >= 0), 'purchase orders listed with Purchase amount; no profit');
  O.$('#view [data-act="repKind"][data-id="so"]').click();
  ok(await idle(O), 'sale orders loaded');
  ok(/Sale amount/.test(O.$('#view .tbl .th').textContent) && O.$$('#view .tbl .tr:not(.th)').some(x => x.textContent.indexOf(SOY) >= 0), 'sale orders listed with Sale amount');
  O.win.go('oreport', 'po|' + OLD);
  ok(await idle(O), 'report loaded');
  const v = O.$('#view').textContent.replace(/\s+/g, ' ');
  ok(/Where the trucks went/.test(v) && v.indexOf(SOX + ' · GODREJ AGROVET KHANA · ₹2,821.60') >= 0 && /of 367\.40 \(2 orders\)/.test(v) && !/Profit/i.test(v), 'order report: a section per sale order with its rate, the split truck marked, no profit');
  const sec = O.$$('#view .tbl')[1];
  ok(sec.querySelectorAll('[data-l="Rate"]').length === 2 && Array.from(sec.querySelectorAll('[data-l="Rate"]')).every(c => c.textContent === '₹2,821.60') && /₹12,10,466/.test(sec.textContent), 'each truck line shows ₹2,821.60 and its sale amount');
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
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  ok(!V.$('#nav [data-tab="reports"]'), 'Dispatch: no Reports tab');
  V.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll Reports tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
