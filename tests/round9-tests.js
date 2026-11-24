/*
 * One truck on two orders (Nitish, 24-11-2026), like DISP-0055 (PB11CJ9850, 367.40 qtl): the older PO had 141.60 left,
 * the older Godrej SO 104.40. Older order first: the Dispatch Register offers "141.60 on the old PO + the rest on the
 * next one" (and the same for the SO). The first order's part is fixed; the rest (and any shortage) is on the second.
 * "No split" keeps today's ±1% rule.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit, truckRow } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const lastId = (s, truck) => s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === truck).map(r => r[0]).pop();
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const A = () => s.run('deriveAll_');
  const T = id => A().trucks.find(t => t.id === id);
  // the test day's own BCL PO and Godrej SO are short-closed, so only the orders below count
  s.run('api_settle', own, 'po', 'PO-01-BCL', true);
  s.run('api_settle', own, 'so', 'SO-0001', true);
  s.run('api_settle', own, 'po', 'PO-03-MG', true);
  const po = (plant, date, qty, rate) => { s.run('api_savePO', own, { plant, date, qty, rate, gst: 0.05, poType: 'trade', commodity: 'DDGS' }); return Object.values(A().po).find(o => o.plant === plant.toUpperCase() && Number(o.rate) === rate).id; };
  const so = (date, qty, rate, fm) => { s.run('api_saveSO', own, { buyer: 'Godrej Agrovet Khana', date, qty, rate, gst: 0.05, gstMode: 'incl', freightMode: fm || 'ours', creditDays: 7, commodity: 'DDGS' }); return Object.values(A().so).find(o => Number(o.rate) === rate).id; };
  const truck = (no, p, w, day, soId) => { s.run('api_saveTruck', dis, { truck: no, po: p, so: soId || '', placedOn: day, date: day, loadWt: w ? String(w) : '', frate: w ? '85' : '' }); return lastId(s, no); };

  const OLD = po('BCL', '2026-11-05', 1000, 2371), NEW = po('BCL', '2026-11-21', 5000, 2575);
  const SOX = so('2026-11-10', 534.4, 2821.6), SOY = so('2026-11-17', 2000, 2946);
  truck('PB01AA1001', OLD, 430, '2026-11-06', SOX);
  truck('PB01AA1002', OLD, 428.4, '2026-11-07');
  const id = truck('PB11CJ9850', NEW, 0, '2026-11-21'); // placed on the newer PO, like DISP-0055
  console.log('Set-up: ' + OLD + ' (1,000 @ 2,371) has 141.60 left, ' + NEW + ' newer; ' + SOX + ' (Godrej @ 2,821.60) has 104.40 left, ' + SOY + ' newer');

  console.log('Weight entered in the Dispatch Register (Dispatch staff)');
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  V.win.go('dispatch');
  V.win.runAct('load', id);
  fill(V, { loadWt: '367.40', date: '22-11-2026', frate: '85' });
  submit(V);
  const box = () => V.$('#fsplit') ? V.$('#fsplit').textContent.replace(/\s+/g, ' ') : '';
  ok(new RegExp(OLD + ' \\(BCL\\) has 141.60 qtl left \\(858.40 of 1,000.00 qtl loaded\\) and is older than ' + NEW).test(box()), 'popup: "' + OLD + ' (BCL) has 141.60 qtl left … older than ' + NEW + '"');
  ok(V.$('#spq0').value === '141.60' && V.$('#spr0').textContent === '225.80' && V.$('#sps0').value === NEW && V.$('#fsplit input[name="sp0"]:checked').value === 'split', 'Split: [141.60] on ' + OLD + ' + 225.80 on ' + NEW + ' (chosen)');
  ok(/No split: all 367.40 qtl on/.test(box()) && !/Supplier already paid/.test(box()), '"No split" choice; no money shown to Dispatch');
  submit(V);
  ok(await idle(V), 'Save again: saved');
  let r = truckRow(s, id);
  ok(r['PO ID'] === OLD && r['Second PO ID'] === NEW && r['Qty On First PO'] === 141.6, 'sheet: PO ' + OLD + ', Second PO ' + NEW + ', Qty On First PO 141.6');
  let st = V.win.orderStats('po', V.win.PO[OLD]), st2 = V.win.orderStats('po', V.win.PO[NEW]);
  ok(st.done === 1000 && st.bal === 0 && st.complete && st2.done === 225.8, OLD + ' 1,000.00 loaded, balance 0.00, Complete; ' + NEW + ' 225.80');
  ok(/PB11CJ9850/.test(V.$('#view').textContent) && V.$$('#view [data-l="PO"]').some(c => c.textContent.replace(/\s+/g, ' ').indexOf(OLD + ' 141.60 + ' + NEW + ' 225.80') >= 0), 'Dispatch Register shows "' + OLD + ' 141.60 + ' + NEW + ' 225.80"');

  console.log('Customer chosen: the older Godrej SO first');
  V.win.runAct('assign', id);
  fill(V, { so: SOY });
  submit(V);
  ok(new RegExp(SOX + ' \\(GODREJ AGROVET KHANA\\) has 104.40 qtl left .* older than ' + SOY).test(box()) && V.$('#spr0').textContent === '263.00' && !/BCL\)/.test(box()), 'popup: ' + SOX + ' has 104.40 left → 104.40 + 263.00 on ' + SOY + ' (the PO is already split: not asked again)');
  submit(V);
  ok(await idle(V), 'saved');
  r = truckRow(s, id);
  ok(r['SO ID'] === SOX && r['Second SO ID'] === SOY && r['Qty On First SO'] === 104.4, 'sheet: SO ' + SOX + ', Second SO ' + SOY + ', Qty On First SO 104.4');
  ok(V.win.orderStats('so', V.win.SO[SOX]).bal === 0 && V.win.orderStats('so', V.win.SO[SOY]).done === 263, SOX + ' balance 0.00; ' + SOY + ' 263.00 dispatched');
  V.win.go('truck', id);
  ok(!/Supplier amount/.test(V.$('#view').textContent) && /141\.60/.test(V.$('#view').textContent), 'truck page for Dispatch: both orders, no money');
  V.win.close();

  console.log('Money (first order fixed, the rest on the second)');
  let t = T(id);
  ok(t.purTot === 963027.03 && t.pur1Tot === 352520.28 && t.pur2Tot === 610506.75, 'purchase 141.60 × 2,371 × 1.05 + 225.80 × 2,575 × 1.05 = ₹9,63,027.03 (was ₹9,93,357.75 all on ' + NEW + ')');
  ok(t.saleTot === 1069373.04, 'sale before unloading 104.40 × 2,821.60 + 263.00 × 2,946 = ₹10,69,373.04');
  s.run('api_saveTruck', dis, { id, unloadDate: s.run('today_'), unloadWt: '366.40' });
  t = T(id);
  ok(t.saleTot === 1066427.04 && t.sale1Qty === 104.4 && t.sale2Qty === 262, 'unloaded 366.40: 104.40 stays on ' + SOX + ', 262.00 on ' + SOY + ' → ₹10,66,427.04');
  ok(t.shortDed === 781.28 && t.shortRate === 2946 && t.shortOver === 0.27, 'shortage 1.00 − free 0.73 = 0.27 charged at ' + SOY + '\'s ₹2,946 → ₹781.28');
  const sy = A().accounts['RAGHAV TRADING AND COMPANY|GODREJ AGROVET KHANA'];
  ok(!!sy && sy.trucks >= 1, 'Godrej\'s account counts the truck once');

  console.log('Accounts screen: truck page and order pages');
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  K.win.go('truck', id);
  const tv = K.$('#view').textContent.replace(/\s+/g, ' ');
  ok(tv.indexOf('141.60 qtl × ₹2,371 (' + OLD + ') + 225.80 qtl × ₹2,575 (' + NEW + '), + GST = ₹3,52,520 + ₹6,10,507') >= 0, 'supplier amount working: 141.60 × ₹2,371 + 225.80 × ₹2,575, + GST');
  ok(tv.indexOf('104.40 qtl × ₹2,821.60 (' + SOX + ') + 262.00 qtl × ₹2,946 (' + SOY + ')') >= 0 && /₹2,821\.60\/qtl \+ ₹2,946\/qtl/.test(tv), 'sale working and both rates');
  K.win.go('po', OLD);
  const rowOld = K.$$('#view table.t tbody tr').find(x => /PB11CJ9850/.test(x.textContent));
  ok(!!rowOld && /141\.60of 367\.40 \(2 orders\)/.test(rowOld.textContent.replace(/\s+/g, ' ').replace(/ of/, 'of')) && /₹3,52,520/.test(rowOld.textContent), OLD + ' page: the truck with 141.60 of 367.40 and ₹3,52,520');
  K.win.go('so', SOY);
  ok(/263\.00/.test((K.$$('#view table.t tbody tr').find(x => /PB11CJ9850/.test(x.textContent)) || {}).textContent || ''), SOY + ' page: the truck with 263.00');
  K.win.QS = NEW.toLowerCase();
  ok(K.win.matchQ(K.win.getT(id)), 'searching ' + NEW + ' finds the split truck');
  K.win.QS = '';
  K.win.close();

  console.log('Move, and "No split" (MG Petrochem)');
  const M1 = po('MG Petrochem', '2026-11-08', 500, 3050), M2 = po('MG Petrochem', '2026-11-20', 1000, 3060);
  truck('HR37E0001', M1, 300, '2026-11-09');
  const t3 = truck('HR37E0003', M2, 0, '2026-11-22'), t4 = truck('HR37E0004', M1, 0, '2026-11-23');
  const K2 = openApp(s, acc);
  ok(await idle(K2), 'Accounts screen loads');
  K2.win.runAct('load', t3);
  fill(K2, { loadWt: '180', date: '22-11-2026', frate: '85' });
  submit(K2);
  const box2 = () => K2.$('#fsplit') ? K2.$('#fsplit').textContent.replace(/\s+/g, ' ') : '';
  ok(new RegExp(M1 + ' \\(MG PETROCHEM\\) has 200.00 qtl left').test(box2()) && /Put this truck \(180.00 qtl\) on/.test(box2()), 'fits in the older ' + M1 + ': "Put this truck (180.00 qtl) on ' + M1 + '"');
  submit(K2);
  ok(await idle(K2) && truckRow(s, t3)['PO ID'] === M1 && !truckRow(s, t3)['Second PO ID'], 'moved to ' + M1 + ' (20.00 left)');
  K2.win.runAct('load', t4);
  fill(K2, { loadWt: '350', date: '23-11-2026', frate: '85' });
  submit(K2);
  ok(/Split: .* qtl on/.test(box2()) && K2.$('#spq0').value === '20.00', 'does not fit: split offered (20.00 + 330.00)');
  K2.$('#fsplit input[name="sp0"][value="no"]').checked = true;
  submit(K2);
  ok(/would go over its limit of 505.00 qtl .* Ask the Owner/.test(K2.$('#ferr').textContent) && !truckRow(s, t4)['Dispatch Wt (qtl)'], 'No split, over the +1% limit: staff stopped ("Ask the Owner"), nothing saved');
  K2.win.closeForm();
  K2.win.close();
  const O = openApp(s, own);
  ok(await idle(O), 'Owner screen loads');
  O.win.runAct('load', t4);
  fill(O, { loadWt: '350', date: '23-11-2026', frate: '85' });
  submit(O);
  O.$('#fsplit input[name="sp0"][value="no"]').checked = true;
  submit(O);
  ok(/would go over its limit/.test(O.$('#fwarn').textContent), 'Owner: No split → warning, Save again to accept');
  submit(O);
  ok(await idle(O), 'saved');
  ok(O.win.orderStats('po', O.win.PO[M1]).bal === -330, M1 + ' shows a negative balance: −330.00 (as today)');
  O.win.close();

  console.log('Server checks');
  const fresh = truck('HR37E0005', M2, 300, '2026-11-24');
  ok(/same supplier/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: NEW, poQty: 100 }))), 'second PO of another supplier refused');
  s.run('api_savePO', own, { plant: 'MG Petrochem', date: '2026-11-21', qty: 1000, rate: 3070, gst: 0.05, poType: 'trade', firm: 'DEVAN TRADING AND COMPANY', commodity: 'DDGS' });
  const DV = Object.values(A().po).find(o => Number(o.rate) === 3070).id;
  ok(/same firm/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: DV, poQty: 100 }))), 'second PO in another firm refused');
  ok(/less than the dispatch weight/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: M1, poQty: 300 }))), 'qty on the first PO must be less than the weight');
  ok(/same as the first/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: M2, poQty: 100 }))), 'second PO = first PO refused');
  ok(/short-closed/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: OLD, poQty: 100 }))) || /same supplier/.test(err(() => s.run('api_saveTruck', acc, { id: fresh, po2: OLD, poQty: 100 }))), 'closed / other orders refused');
  const SOZ = so('2026-11-22', 1000, 2950, 'buyer');
  ok(/freight terms/.test(err(() => s.run('api_saveTruck', own, { id, so2: SOZ, _force: true }))), 'second SO with other freight terms refused');
  ok(/still has 1 active truck|still has \d+ active trucks/.test(err(() => s.run('api_cancel', own, 'po', NEW, 'x'))), NEW + ' cannot be cancelled: the split truck is on it');

  console.log('Excel, PDF and 9 pm report count each order\'s part');
  const xl = s.run('exportTabs_', 'trucks', '', [id], { money: true }, '')[0], h0 = xl.rows[0], v0 = xl.rows[1];
  ok(v0[h0.indexOf('Second PO')] === NEW && v0[h0.indexOf('Qty on First PO')] === 141.6 && v0[h0.indexOf('Second SO')] === SOY && v0[h0.indexOf('Qty on First SO')] === 104.4, 'Excel Trucks: Second PO, Qty on First PO, Second SO, Qty on First SO');
  const ords = s.run('exportTabs_', 'orders', '', [OLD, NEW], { money: true }, '');
  const pr = ords[0].rows, ph = pr[0];
  ok(pr.find(x => x[ph.indexOf('ID')] === OLD)[ph.indexOf('Done')] === 1000 && pr.find(x => x[ph.indexOf('ID')] === NEW)[ph.indexOf('Done')] === 225.8, 'Excel orders: ' + OLD + ' done 1,000, ' + NEW + ' done 225.80');
  const pdf = Buffer.from(s.run('api_reportPdf', acc, '2026-11-01', s.run('today_'), '').b64, 'base64').toString('utf8');
  ok(pdf.indexOf(OLD + ' 141.60 + ' + NEW + ' 225.80') >= 0 && pdf.indexOf(SOX + ' 104.40 + ' + SOY + ' 263.00') >= 0, 'PDF: the truck shows both orders with their parts');
  s.run('sendDailyReport_');
  const mail = s.store.mails[s.store.mails.length - 1].htmlBody;
  ok(new RegExp(OLD + '</td>(<td[^>]*>[^<]*</td>){3}<td[^>]*>1000.00</td><td[^>]*>0.00</td>').test(mail), '9 pm report: ' + OLD + ' loaded 1000.00, outstanding 0.00');

  console.log('Removing a split');
  ok(err(() => s.run('api_saveTruck', own, { id: fresh, po2: M1, poQty: 100, _force: true })) === '' && truckRow(s, fresh)['Second PO ID'] === M1, 'Owner splits ' + fresh);
  ok(err(() => s.run('api_saveTruck', own, { id: fresh, po2: '', _force: true })) === '' && truckRow(s, fresh)['Second PO ID'] === '' && truckRow(s, fresh)['Qty On First PO'] === '', 'blank second PO removes the split (qty cleared too)');
  ok(s.store.sheet('APP_LOG').dump().some(x => x[3] === id && /Second PO|po2/.test(x[4])), 'split changes are in the log');

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll split-truck tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
