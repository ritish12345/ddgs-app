/*
 * Round 2 (Nitish, Nov 2026): loaded weight on Freight, freight UTR optional, dates DD-MM-YYYY, S.No. on lists,
 * Closed & cancelled page, faster updates from other users, ±1% order quantity window.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { execSync } = require('child_process');
const path = require('path');
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit, truckRow } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const D = t => ({ t, d: 1 });
const openApp = (s, token, storage) => B.openApp(s, token, storage, msg => { console.log('  page error: ' + msg); fails++; });
const lastId = (s, truck) => s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === truck).map(r => r[0]).pop();

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const newTruck = (tok, o) => { s.run('api_saveTruck', tok, Object.assign({ placedOn: '2026-11-19' }, o)); return lastId(s, o.truck.replace(/\s/g, '').toUpperCase()); };

  console.log('7. ±1% order quantity window (PO 1,000 qtl: complete from 990, limit 1,010)');
  s.run('api_savePO', own, { plant: 'Test Plant', date: '2026-11-19', qty: 1000, rate: 2000, gst: 0.05, poType: 'trade', commodity: 'DDGS' }); // PO-04-TEST
  s.run('api_saveSO', own, { buyer: 'Aman Feed Khana', date: '2026-11-19', qty: 500, rate: 2200, gst: 0.05, gstMode: 'incl', freightMode: 'ours', commodity: 'DDGS' }); // SO-0004
  const w = (truck, wt) => ({ truck, po: 'PO-04-TEST', date: '2026-11-19', loadWt: String(wt), transporter: 'Bansal Transport', frate: '85' });
  const ta = newTruck(dis, w('PB01QA0001', 400)), tb = newTruck(dis, w('PB01QA0002', 400));
  ok(!!ta && !!tb, 'two trucks of 400 qtl saved (800 of 1,000)');
  let e = err(() => s.run('api_saveTruck', dis, w('PB01QA0003', 215)));
  ok(/PO-04-TEST would go over its limit of 1,010.00 qtl \(1,000.00 \+ 1%\) by 5.00 qtl\. Ask the Owner\./.test(e), 'staff: 215 more (1,015) refused: ' + e);
  const tc = newTruck(dis, w('PB01QA0003', 205));
  ok(!!tc, '205 more (1,005, inside 1,010) is saved');
  e = err(() => s.run('api_saveTruck', dis, { truck: 'PB01QA0004', po: 'PO-04-TEST', placedOn: '2026-11-19' }));
  ok(/PO-04-TEST is complete \(1,005.00 of 1,000.00 qtl loaded\)\. Ask the Owner\./.test(e), 'staff: a new truck on a complete PO is refused: ' + e);
  e = err(() => s.run('api_saveTruck', own, { truck: 'PB01QA0004', po: 'PO-04-TEST', placedOn: '2026-11-19' }));
  ok(/is complete .*Save twice/.test(e), 'Owner without "Save again" gets the same check (told how to accept)');
  ok(err(() => s.run('api_saveTruck', own, { truck: 'PB01QA0004', po: 'PO-04-TEST', placedOn: '2026-11-19', _force: true })) === '', 'Owner with "Save again" can add it');
  ok(err(() => s.run('api_saveTruck', own, { id: tc, loadWt: '300', _force: true })) === '', 'Owner can accept going over the limit (1,100)');
  ok(err(() => s.run('api_saveTruck', dis, { id: ta, note: 'checked' })) === '', 'an unrelated change on a truck of an over-limit PO is not blocked');
  ok(err(() => s.run('api_saveTruck', dis, { id: tc, loadWt: '200' })) === '', 'lowering a weight is never blocked');
  ok(/looks like kg/.test(err(() => s.run('api_saveTruck', dis, { id: lastId(s, 'PB01QA0004'), loadWt: '38450', date: '2026-11-19', transporter: 'X', frate: '85' }))), 'a kg weight still gets the clear "looks like kg" message');
  ok(err(() => s.run('api_saveTruck', dis, { id: ta, so: 'SO-0004' })) === '', 'SO 500: first truck of 400 assigned');
  e = err(() => s.run('api_saveTruck', dis, { id: tb, so: 'SO-0004' }));
  ok(/SO-0004 would go over its limit of 505.00 qtl/.test(e), 'SO too: a second truck of 400 (800 > 505) refused for staff: ' + e);
  ok(err(() => s.run('api_settle', own, 'po', 'PO-04-TEST', true)) === '', 'Short-close works as before');
  ok(err(() => s.run('api_saveTruck', dis, { id: tc, loadWt: '250' })) === '', 'a short-closed PO is not checked any more');

  console.log('2. UTR optional for freight and (since 21-11-2026) for supplier payments');
  const tf = newTruck(dis, { truck: 'PB08UT0001', po: 'PO-01-BCL', date: '2026-11-19', loadWt: '380', transporter: 'Sharma Roadlines', frate: '85', so: 'SO-0001' });
  s.run('api_saveTruck', dis, { id: tf, unloadDate: '2026-11-19', unloadWt: '379' });
  ok(err(() => s.run('api_saveTruck', acc, { id: tf, freightPaid: true, freightPaidDate: '2026-11-19', detention: '0' })) === '' && truckRow(s, tf)['Freight Paid'] === true, 'one truck: freight marked paid without UTR');
  ok(err(() => s.run('api_saveTruck', acc, { id: tf, plantPaid: true, plantPaidDate: '2026-11-19' })) === '' && truckRow(s, tf)['Supplier Paid'] === true, 'one truck: supplier marked paid without UTR');
  const tg = newTruck(dis, { truck: 'PB08UT0002', po: 'PO-01-BCL', date: '2026-11-19', loadWt: '381', transporter: 'Sharma Roadlines', frate: '85', so: 'SO-0001' });
  s.run('api_saveTruck', dis, { id: tg, unloadDate: '2026-11-19', unloadWt: '380' });
  ok(err(() => s.run('api_payBatch', acc, 'freight', [tg], '2026-11-19', '', 0)) === '' && truckRow(s, tg)['Freight Paid'] === true, 'several trucks: freight paid without UTR');
  ok(s.store.sheet('APP_LOG').dump().some(r => r[2] === 'Freight payment' && r[3] === 'no UTR'), 'the log says "no UTR"');
  ok(err(() => s.run('api_payBatch', acc, 'plant', [tg], '2026-11-19', '', 0)) === '' && truckRow(s, tg)['Supplier Paid'] === true, 'several trucks: supplier paid without UTR');
  console.log('3. Dates as DD-MM-YYYY');
  e = err(() => s.run('api_saveTruck', dis, { truck: 'HR 55 A 1234', po: 'PO-01-BCL', placedOn: '2026-11-12', date: '2026-11-12' }));
  ok(/already entered on 12-11-2026/.test(e), 'messages: "' + e.slice(0, 60) + '…"');
  const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, '');
  const head = tabs[0].rows[0], dcol = head.indexOf('Dispatch Date');
  ok(head[0] === 'S.No.' && tabs[0].rows[1][0] === 1 && tabs[0].rows[2][0] === 2, '4. Excel: S.No. column first (1, 2, 3…)');
  ok(tabs[0].dateCols.indexOf(dcol) >= 0 && /^2026-11-\d\dT/.test(tabs[0].rows[1][dcol]), 'Excel: dates are real dates (shown as DD-MM-YYYY by the cell format)');
  const so = tabs.find(t => t.name === 'Sale Orders'), sc = so.rows.find(r => r[1] === 'SO-0002');
  ok(sc[so.rows[0].indexOf('Status')] === 'Short-closed', 'Excel: status says Short-closed, not Settled');
  const ot = s.run('exportTabs_', 'orders', '', ['SO-0002', 'PO-04-TEST'], { money: true }, '');
  ok(ot.length === 2 && ot[0].rows.length === 2 && ot[1].rows.length === 2, 'Excel of an orders list (Closed & cancelled page) has just those orders');

  console.log('6. Background check: nothing read when nothing changed');
  s.run('api_getData', D(own));
  const v = s.run('api_sync', D(own), s.run('api_getData', D(own)).v, false).v;
  s.store.resetStats();
  const r = s.run('api_sync', D(own), v, false);
  ok(r.same === true && s.store.stats.props === 0 && s.store.stats.reads === 0 && s.store.stats.meta === 0, '"nothing new": 0 property reads, 0 sheet reads, sheet not even opened (' + JSON.stringify(s.store.stats) + ')');
  const t9 = s.run('api_login', 'vineet12', 'secret3').token;
  s.run('api_sync', D(t9), v, false);
  s.run('api_logout', D(t9));
  ok(/LOGIN/.test(err(() => s.run('api_sync', D(t9), v, false))), 'logging out still ends the login at once (cache cleared)');

  console.log('Upgrade: the new setting row is added once, nothing else changes');
  const old = makeServer({ code: execSync('git show 920e788:Code.js', { cwd: path.join(__dirname, '..'), maxBuffer: 1e8 }).toString() });
  old.store.activeEmail = old.store.ownerEmail; old.run('setup');
  const before = JSON.stringify(old.store.sheet('APP_TRUCKS').dump());
  const neu = makeServer({ store: old.store });
  neu.run('api_authState');
  const set = old.store.sheet('APP_SETTINGS').dump().slice(1);
  ok(set.filter(x => x[0] === 'qtyTolerancePct').length === 1 && set.find(x => x[0] === 'qtyTolerancePct')[1] === 0.01, 'APP_SETTINGS gets qtyTolerancePct = 0.01');
  neu.run('api_authState');
  ok(old.store.sheet('APP_SETTINGS').dump().filter(x => x[0] === 'qtyTolerancePct').length === 1 && JSON.stringify(old.store.sheet('APP_TRUCKS').dump()) === before, 'only once; trucks untouched');

  console.log('Screen (Accounts, Keshav)');
  const A = openApp(s, acc);
  ok(await idle(A), 'app loads');
  A.win.go('freight');
  ok(/<div class="r">Loaded<\/div><div class="r">Unloaded<\/div>/.test(A.$('#view').innerHTML), '1. Freight & Transport shows a Loaded column next to Unloaded');
  ok(A.$('#view .tr.th div').textContent === 'S.No.' && A.$$('#view .td.sn')[0].textContent === '1', '4. S.No. column on Freight');
  A.win.go('dispatch'); A.win.FILTER = 'all'; A.win.render();
  const shown = A.$$('#view .td.sn').length, ids = A.win.LASTIDS;
  ok(shown > 0 && A.$$('#view .td.sn')[shown - 1].textContent === String(shown), '4. S.No. on the Dispatch Register (1…' + shown + ')');
  ok(ids.indexOf('DISP-0002') < 0 && ids.indexOf('DISP-0006') < 0, '5. closed (DISP-0002) and cancelled (DISP-0006) trucks are not in the Dispatch Register');
  ok(!/>Closed <b>|>Cancelled <b>|>Returned <b>/.test(A.$('#view').innerHTML), '5. no Closed / Cancelled / Returned chips there any more');
  A.win.go('sos');
  ok(!/SO-0002/.test(A.$('#view').innerHTML) && /Short-closed &amp; cancelled →|Short-closed & cancelled →/.test(A.$('#view').innerHTML), '5. Sale Orders list: short-closed SO-0002 gone, link to the Closed page');
  // an unloaded truck that is not closed yet (supplier and freight not paid): it is on the Sales page
  const tq = newTruck(dis, { truck: 'PB08UT0004', po: 'PO-01-BCL', date: '2026-11-19', loadWt: '380', transporter: 'Sharma Roadlines', frate: '85', so: 'SO-0001' });
  s.run('api_saveTruck', dis, { id: tq, unloadDate: '2026-11-19', unloadWt: '379' });
  A.win.LASTFULL = 0; A.win.sync(); await idle(A);
  A.win.go('settle');
  const salesHead = A.$$('#view .tr.th div').map(d => d.textContent);
  ok(A.win.LASTIDS.indexOf(tq) >= 0 && !/Short-closed|Fully paid/.test(A.$('#view').innerHTML) && salesHead.indexOf('Received') < 0 && salesHead.indexOf('Balance') < 0 && salesHead.indexOf('Next step') < 0,
    '5. Sales page lists the unloaded truck, with no Received / Balance / Next step');
  A.win.go('closed');
  // New Closed rule: unloaded + supplier paid + freight paid (or customer pays freight). DISP-0003 (own plant) has no supplier payment.
  ok(A.win.LASTIDS.indexOf('DISP-0001') >= 0 && A.win.LASTIDS.indexOf('DISP-0002') >= 0 && A.win.LASTIDS.indexOf('DISP-0003') < 0, '5. Closed & cancelled → Completed trucks: DISP-0001, DISP-0002 (not DISP-0003: supplier unpaid)');
  A.win.SUBF.closed = 'cx'; A.win.render();
  ok(A.win.LASTIDS.indexOf('DISP-0006') >= 0 && /duplicate entry/.test(A.$('#view').innerHTML), '5. Cancelled / returned: DISP-0006 with its reason');
  A.win.runAct('closedOrders');
  ok(A.win.LASTORDERS.indexOf('SO-0002') >= 0 && A.win.LASTORDERS.indexOf('PO-04-TEST') >= 0, '5. Short-closed orders: SO-0002 and PO-04-TEST');

  console.log('Screen: dates');
  const tp = newTruck(own, { truck: 'PB13DT0001', po: 'PO-01-BCL', placedOn: '2026-11-01' });
  A.win.LASTFULL = 0; A.win.sync(); await idle(A);
  A.win.runAct('load', tp);
  const fd = A.win.document.getElementById('f_date');
  ok(fd.type === 'text' && /^\d{2}-\d{2}-\d{4}$/.test(fd.value) && fd.placeholder === 'DD-MM-YYYY', '3. date box shows ' + fd.value + ' (DD-MM-YYYY)');
  fd.value = '05'; fd.dispatchEvent(new A.win.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  fd.value += '11'; fd.dispatchEvent(new A.win.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  ok(fd.value === '05-11-', 'typing 0511 on a number keypad gives 05-11- (dashes come by themselves)');
  fill(A, { loadWt: '391', transporter: 'Sharma Roadlines', frate: '85', date: '31-02-2026' });
  submit(A);
  ok(/DD-MM-YYYY/.test(A.$('#ferr').textContent) && !A.$('#modal').hidden, '31-02-2026 is refused: "' + A.$('#ferr').textContent + '"');
  fill(A, { date: '05-11-2026' });
  submit(A);
  ok(await idle(A), 'saved');
  ok(String(truckRow(s, tp)['Dispatch Date']).slice(0, 10) === '2026-11-05' && A.win.getT(tp).date === '2026-11-05', '05-11-2026 is saved as 5 November 2026 (stored at noon, as always)' +
    ' [sheet ' + truckRow(s, tp)['Dispatch Date'] + ', screen ' + A.win.getT(tp).date + ', form open ' + !A.$('#modal').hidden + ', warn "' + A.$('#fwarn').textContent + '", err "' + A.$('#ferr').textContent + '", refused ' + JSON.stringify(A.win.FAILS) + ']');
  A.win.go('po', 'PO-01-BCL');
  ok(/\d{2}-\d{2}-\d{4}/.test(A.$('table.t tbody').innerHTML), 'truck tables show the full date with the year');

  console.log('Screen: pay freight without UTR (Accounts)');
  const th = newTruck(dis, { truck: 'PB08UT0003', po: 'PO-01-BCL', date: '2026-11-19', loadWt: '377', transporter: 'Sharma Roadlines', frate: '85', so: 'SO-0001' });
  s.run('api_saveTruck', dis, { id: th, unloadDate: '2026-11-19', unloadWt: '376' });
  A.win.sync(); await idle(A);
  A.win.runAct('fpaid', th);
  ok(!/\*/.test(A.$('label[for="f_freightUTR"]').textContent) && /optional/.test(A.$('label[for="f_freightUTR"]').textContent), 'UTR is marked optional');
  ok(!!A.$('#mform input[type=file][data-kind="freightPay"]'), 'the optional payment photo is still there');
  ok(!/No bank details saved/.test(A.$('#mform').innerHTML), 'no "No bank details saved" message, only a small add link');
  submit(A);
  ok(A.$('#modal').hidden, 'saved without UTR');
  ok(await idle(A) && truckRow(s, th)['Freight Paid'] === true, 'the sheet has it paid');
  console.log('Screen: pay supplier without UTR (Dispatch Register, Accounts)');
  A.win.runAct('paid', th);
  ok(/optional/.test(A.$('label[for="f_plantUTR"]').textContent) && !/\*/.test(A.$('label[for="f_plantUTR"]').textContent), 'supplier UTR is marked optional');
  submit(A);
  ok(A.$('#modal').hidden && await idle(A) && truckRow(s, th)['Supplier Paid'] === true && A.win.FAILS.length === 0, 'saved without UTR');
  A.win.runAct('payPlantBatch');
  ok(/UTR \/ bank reference \(optional\)/.test(A.$('#mform').innerHTML), '"Pay supplier (several trucks)": UTR optional too');
  A.win.closeForm();

  console.log('Screen: quantity window');
  s.run('api_savePO', own, { plant: 'Qty Plant', date: '2026-11-19', qty: 1000, rate: 2000, gst: 0.05, poType: 'trade', commodity: 'DDGS' }); // PO-05-QTY
  const q1 = newTruck(dis, Object.assign(w('PB02QB0001', 400), { po: 'PO-05-QTY' })), q2 = newTruck(dis, Object.assign(w('PB02QB0002', 400), { po: 'PO-05-QTY' }));
  const q3 = newTruck(dis, { truck: 'PB02QB0003', po: 'PO-05-QTY', placedOn: '2026-11-19' });
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch app loads');
  V.br.calls.length = 0;
  V.win.runAct('load', q3);
  fill(V, { loadWt: '300', date: '19-11-2026', transporter: 'Bansal Transport', frate: '85' });
  submit(V);
  ok(/PO-05-QTY would go over its limit of 1,010.00 qtl \(1,000.00 \+ 1%\) by 90.00 qtl\. Ask the Owner\./.test(V.$('#ferr').textContent) && !V.$('#modal').hidden, 'staff: stopped in the form: "' + V.$('#ferr').textContent + '"');
  ok(V.br.calls.length === 0 && truckRow(s, q3)['Dispatch Wt (qtl)'] === '', 'nothing sent, nothing saved');
  V.win.closeForm();
  const O = openApp(s, own);
  ok(await idle(O), 'Owner app loads');
  O.win.runAct('load', q3);
  fill(O, { loadWt: '300', date: '19-11-2026', transporter: 'Bansal Transport', frate: '85' });
  submit(O);
  ok(/would go over its limit/.test(O.$('#fwarn').textContent) && /Save again/.test(O.$('#fwarn').textContent) && !O.$('#modal').hidden, 'Owner: a warning first ("…Tap Save again if it is correct.")');
  submit(O);
  ok(await idle(O) && truckRow(s, q3)['Dispatch Wt (qtl)'] === 300 && O.win.FAILS.length === 0, 'Owner taps Save again: accepted (1,100 qtl)');
  O.win.go('pos');
  ok(/PO-05-QTY[\s\S]*Over the limit by 90.00 qtl/.test(O.$('#view').innerHTML), 'PO list shows "Over the limit by 90.00 qtl"');
  s.run('api_saveTruck', own, { id: q3, loadWt: '200' }); // 1,000 qtl: complete, not over
  O.win.sync(); await idle(O); O.win.go('pos');
  const btn = O.$('#view [data-act="settle"][data-id="PO-05-QTY"]');
  ok(/Complete/.test(O.$('#view').innerHTML) && !!btn, '7c. complete PO shows "Complete" and a Short-close button');
  btn.click();
  ok(/short-closed\?/.test(O.$('#mform h3').textContent), 'Short-close asks to confirm');
  submit(O);
  ok(await idle(O) && s.store.sheet('APP_PO').dump().find(x => x[0] === 'PO-05-QTY')[7] === 'Settled' && !/PO-05-QTY/.test(O.$('#view').innerHTML), 'short-closed: it leaves the PO list');
  V.win.sync(); await idle(V);
  ok(!V.$('#view [data-act="settle"]'), 'Dispatch sees no Short-close button (orders are for Owner / Accounts)');

  console.log('6. Screen: someone else\'s change arrives right after your own save');
  s.run('api_saveTruck', own, { id: 'DISP-0005', note: 'owner checked the bill' });
  A.br.calls.length = 0;
  A.win.runAct('advance', 'DISP-0004'); // an open truck (DISP-0001 is now Closed: only the Owner may change it)
  fill(A, { advance: '12000' });
  submit(A);
  ok(await idle(A), 'saved');
  ok(A.win.getT('DISP-0005').note === 'owner checked the bill' && A.br.calls.join(',') === 'api_saveTruck,api_sync', 'the owner\'s note is already on this screen (' + A.br.calls.join(',') + '), no waiting' +
    (A.win.getT('DISP-0005').note === 'owner checked the bill' ? '' : ' [note "' + A.win.getT('DISP-0005').note + '", refused ' + JSON.stringify(A.win.FAILS.map(f => f.msg)) + ', screen v ' + A.win.D.v + ']'));
  O.win.go('activity'); await idle(O);
  ok(/^\d{2}-\d{2}-\d{4}$/.test(O.$('#rv_date').value), 'Activity day box is DD-MM-YYYY too (' + O.$('#rv_date').value + ')');

  [A, V, O].forEach(x => { try { x.win.close(); } catch (e2) {} });
  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll round 2 tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
