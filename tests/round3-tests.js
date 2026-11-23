/*
 * Round 3 (Nitish, 23-11-2026):
 * 1. The transporter is no longer compulsory with the weight (the freight rate still is).
 * 2. Freight & Transport: the "Freight adv." column shows the advance set against the trip, including extra advance
 *    carried from an earlier trip of the same truck (real case: DISP-0022, HR63B5735, ₹20,146 from DISP-0013),
 *    so every row reads freight − shortage − advance + detention = net freight payable.
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

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;

  console.log('1. Transporter optional');
  s.run('api_saveTruck', dis, { truck: 'PB13AF8596', po: 'PO-01-BCL', so: 'SO-0001', placedOn: '2026-11-19' });
  const t1 = lastId(s, 'PB13AF8596');
  ok(/Enter the freight rate per qtl/.test(err(() => s.run('api_saveTruck', dis, { id: t1, loadWt: '233.4', date: '2026-11-19' }))), 'weight without freight rate: still refused (rate is needed)');
  ok(err(() => s.run('api_saveTruck', dis, { id: t1, loadWt: '233.4', date: '2026-11-19', frate: '85' })) === '' && truckRow(s, t1)['Dispatch Wt (qtl)'] === 233.4 && truckRow(s, t1).Transporter === '', 'weight with rate and no transporter: saved');
  ok(err(() => s.run('api_saveTruck', dis, { id: t1, transporter: '' })) === '', 'clearing the transporter later is allowed');
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  s.run('api_saveTruck', dis, { truck: 'PB11CL4967', po: 'PO-01-BCL', so: 'SO-0001', placedOn: '2026-11-19' });
  V.win.sync(); await idle(V); V.win.LASTFULL = 0; V.win.sync(); await idle(V);
  const t2 = lastId(s, 'PB11CL4967');
  V.win.runAct('load', t2);
  ok(/can be added later/.test(V.$('label[for="f_transporter"]').textContent) && !/\*/.test(V.$('label[for="f_transporter"]').textContent), 'weight form: "Transporter (can be added later)", not marked required');
  fill(V, { loadWt: '33010', date: '19-11-2026', transporter: '', frate: '85' });
  submit(V);
  ok(V.$('#modal').hidden, 'saved without a transporter (no "Enter the transporter" message)');
  ok(await idle(V) && truckRow(s, t2)['Dispatch Wt (qtl)'] === 330.1 && V.win.FAILS.length === 0, 'server accepted it: 330.10 qtl');
  V.win.close();

  console.log('2. Freight advance includes extra advance from an earlier trip of the same truck');
  // HR63B5735: trip 1 advance 45,000 but freight only 24,854 → 20,146 extra; trip 2 uses it (like DISP-0013 → DISP-0022)
  s.run('api_saveTruck', dis, { truck: 'HR63B5735', po: 'PO-01-BCL', so: 'SO-0001', placedOn: '2026-11-12', date: '2026-11-12', loadWt: '292.5', transporter: 'Kang Transport', frate: '85' });
  const a = lastId(s, 'HR63B5735');
  s.run('api_saveTruck', acc, { id: a, advance: '45000' });
  s.run('api_saveTruck', dis, { id: a, unloadDate: '2026-11-13', unloadWt: '292.4' });
  s.run('api_saveTruck', dis, { truck: 'HR63B5735', po: 'PO-01-BCL', so: 'SO-0001', placedOn: '2026-11-15', date: '2026-11-15', loadWt: '284', transporter: 'Kang Transport', frate: '85' });
  const b = lastId(s, 'HR63B5735');
  s.run('api_saveTruck', dis, { id: b, unloadDate: '2026-11-16', unloadWt: '283' });
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  const ta = K.win.getT(a), tb = K.win.getT(b);
  ok(ta.carryOut === 20146 && tb.carryIn === 20146 && tb.A === 0, 'trip 1: 20,146 extra advance; trip 2 uses it (' + ta.carryOut + ' / ' + tb.carryIn + ')');
  ok(Math.abs(tb.frAmt - tb.shortDed - (tb.A + tb.carryIn) + tb.det - tb.netPay) < 0.01, 'trip 2 adds up: ' + tb.frAmt + ' − ' + tb.shortDed + ' − ' + (tb.A + tb.carryIn) + ' = ' + tb.netPay);
  K.win.QS = 'hr63b5735'; K.win.SUBF.freight = 'all'; K.win.go('freight');
  const row = K.$$('#view .tbl .tr').find(r => r.textContent.indexOf(b) >= 0);
  const adv = row && row.querySelector('[data-l="Freight adv."]'), net = row && row.querySelector('[data-l="Net freight payable"]');
  ok(!!adv && /₹20,146/.test(adv.textContent) && /from earlier trip/.test(adv.textContent), 'Freight & Transport: trip 2 "Freight adv." shows ₹20,146 from earlier trip (' + (adv && adv.textContent) + ')');
  ok(!!net && net.textContent.indexOf(K.win.inr(tb.netPay)) === 0 && !/earlier adv/.test(net.textContent), 'net freight payable shows ' + K.win.inr(tb.netPay) + ' without the old "after … earlier adv." line');
  const rowA = K.$$('#view .tbl .tr').find(r => r.textContent.indexOf(a) >= 0);
  ok(!!rowA && /₹45,000/.test(rowA.querySelector('[data-l="Freight adv."]').textContent) && /₹20,146 extra adv\. → next trip/.test(rowA.textContent), 'trip 1 still shows its own ₹45,000 and "₹20,146 extra adv. → next trip"');
  K.win.go('truck', b);
  ok(/Freight advance₹20,146 \(₹20,146 extra advance from an earlier trip of this truck\)/.test(K.$('#view').textContent), 'truck page: Freight advance ₹20,146 (extra advance from an earlier trip)');
  K.win.QS = ''; K.win.go('transporter', 'KANG TRANSPORT');
  const st = K.$('#view table.t');
  ok(!!st && /₹20,146 \(from earlier trip\)/.test(st.textContent) && /₹45,000 given/.test(st.querySelector('tfoot').textContent), 'transporter statement: trip 2 shows it too; the total counts the advance once (₹45,000 given)');
  K.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll round 3 tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
