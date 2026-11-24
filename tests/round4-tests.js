/*
 * Transporter advances (Nitish, 24-11-2026): money given to a transporter that is not tied to a truck (e.g. before loading),
 * used automatically on that transporter's freight, oldest unload first. A paid truck keeps what it took (tAdv).
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
const advRows = s => s.store.sheet('APP_ADVANCES').dump();

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const T = id => s.run('deriveAll_').trucks.find(t => t.id === id);
  const left = k => (s.run('deriveAll_').tadv['RAGHAV TRADING AND COMPANY|' + k] || {}).left; // advances are kept per firm
  // two unloaded trucks of KANG TRANSPORT: freight 300 × 85 = 25,500 and 290 × 85 = 24,650 (no shortage, no truck advance)
  const trip = (truck, day) => {
    const wt = truck === 'PB10AA0002' ? '290' : '300';
    s.run('api_saveTruck', dis, { truck, po: 'PO-01-BCL', so: 'SO-0001', placedOn: day, date: day, loadWt: wt, transporter: 'Kang Transport', frate: '85' });
    const id = lastId(s, truck);
    s.run('api_saveTruck', dis, { id, unloadDate: day, unloadWt: wt });
    return id;
  };

  console.log('Tab and rights');
  ok(!!s.store.sheet('APP_ADVANCES') && advRows(s)[0].join('|') === 'Advance No.|Date|Transporter|Vehicle No|Driver|Amount|UTR / Ref|Note|Entered By|Entered At|Firm', 'APP_ADVANCES tab made by setup');
  ok(s.store.sheet('APP_TRUCKS').dump()[0].slice(-1)[0] === 'Transporter Advance Used', 'APP_TRUCKS: new column at the end only');
  ok(/Dispatch\) is not allowed/.test(err(() => s.run('api_addAdvance', dis, { transporter: 'Kang Transport', amount: 1000, date: '2026-11-20' }))), 'Dispatch cannot enter advances');
  ok(/Enter the amount/.test(err(() => s.run('api_addAdvance', acc, { transporter: 'Kang Transport', amount: 0, date: '2026-11-20' }))) && /Enter the transporter/.test(err(() => s.run('api_addAdvance', acc, { amount: 5, date: '2026-11-20' }))), 'amount and transporter are needed');

  console.log('Given before loading, used automatically');
  s.run('api_addAdvance', acc, { transporter: 'kang  transport', amount: '30000', date: '2026-11-18', vehicle: 'pb 10 aa 0001', driver: 'Gurpreet', ref: 'sbin77' });
  ok(advRows(s)[1][0] === 'ADV-0001' && advRows(s)[1][2] === 'KANG TRANSPORT' && advRows(s)[1][3] === 'PB10AA0001' && advRows(s)[1][6] === 'SBIN77', 'ADV-0001 saved: KANG TRANSPORT, vehicle PB10AA0001, ref SBIN77');
  ok(left('KANG TRANSPORT') === 30000, 'no trucks yet: 30,000 left');
  const a = trip('PB10AA0001', '2026-11-19'), b = trip('PB10AA0002', '2026-11-20');
  let ta = T(a), tb = T(b);
  ok(ta.advUsed === 25500 && ta.netPay === 0 && tb.advUsed === 4500 && tb.netPay === 20150 && left('KANG TRANSPORT') === 0, 'oldest trip takes 25,500 (pays 0), next takes the last 4,500 (pays 20,150); left 0');

  console.log('A paid truck keeps what it took');
  s.run('api_payBatch', acc, 'freight', [a], '2026-11-21', '', 0);
  ok(truckRow(s, a)['Transporter Advance Used'] === 25500, 'paying freight saves 25,500 on the truck');
  s.run('api_addAdvance', acc, { transporter: 'Kang Transport', amount: '10000', date: '2026-11-22' });
  ta = T(a); tb = T(b);
  ok(ta.advUsed === 25500 && tb.advUsed === 14500 && tb.netPay === 10150 && left('KANG TRANSPORT') === 0, 'a later advance goes to the unpaid truck only (14,500, pays 10,150); the paid one is unchanged');
  const today = s.run('today_'); // Accounts can undo only a payment made today
  ok(err(() => s.run('api_saveTruck', acc, { id: b, freightPaid: true, freightPaidDate: today, detention: '1000' })) === '' && truckRow(s, b)['Transporter Advance Used'] === 14500, 'single pay with 1,000 detention: takes 14,500 (all that is left), pays 11,150');
  ok(T(b).netPay === 11150, 'to pay 24,650 + 1,000 − 14,500 = 11,150');
  ok(err(() => s.run('api_saveTruck', acc, { id: b, freightPaid: false, freightPaidDate: '' })) === '' && truckRow(s, b)['Transporter Advance Used'] === '', 'undoing the payment clears it');
  ok(/not allowed|Only the Owner/.test(err(() => s.run('api_saveTruck', acc, { id: b, tAdv: 1 }))) || truckRow(s, b)['Transporter Advance Used'] === '', 'the saved amount cannot be typed in directly');

  console.log('Mistakes are reversed, not deleted');
  ok(err(() => s.run('api_reverseAdvance', acc, 'ADV-0002', 'entered twice')) === '' && advRows(s).length === 4 && advRows(s)[3][5] === -10000, 'ADV-0002 reversed by a minus line (ADV-0003)');
  ok(/already reversed/.test(err(() => s.run('api_reverseAdvance', acc, 'ADV-0002', 'x'))) && /itself a reversal/.test(err(() => s.run('api_reverseAdvance', acc, 'ADV-0003', 'x'))), 'cannot reverse twice, or reverse a reversal');
  ok(T(b).advUsed === 4500 && left('KANG TRANSPORT') === 0, 'back to 4,500 for the unpaid truck');
  const logRows = s.store.sheet('APP_LOG').dump();
  ok(logRows.some(r => r[2] === 'Transporter advance' && r[3] === 'KANG TRANSPORT') && logRows.some(r => r[2] === 'Advance reversed' && r[3] === 'ADV-0002'), 'advances and reversals are in the log');

  console.log('Excel and report');
  const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, '');
  const adv = tabs.find(t => t.name === 'Transporter Advances'), trs = tabs.find(t => t.name === 'Transporters');
  ok(!!adv && adv.rows.length === 4 && trs.rows[0].indexOf('Transporter Advance Left') >= 0, 'full Excel: Transporter Advances tab and given / used / left per transporter');
  ok(tabs[0].rows[0].indexOf('Transporter Advance Used') >= 0, 'Trucks tab: Transporter Advance Used column');
  s.run('sendDailyReport_');
  ok(/transporter advances left/.test(s.store.mails[s.store.mails.length - 1].htmlBody), '9 pm report shows the advances left');

  console.log('Screen');
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  K.win.SUBF.freight = 'all'; K.win.go('freight');
  const v = K.$('#view').textContent;
  ok(/Transporter advances/.test(v) && /KANGTRANSPORT(Raghav)?₹30,000₹30,000₹0/.test(v.replace(/\s+/g, '')), 'Freight & Transport: Transporter advances table (given 30,000 · used 30,000 · left 0)');
  const rowB = K.$$('#view .tbl .tr').find(r => r.textContent.indexOf(b) >= 0);
  ok(!!rowB && /₹4,500/.test(rowB.querySelector('[data-l="Freight adv."]').textContent) && /from transporter advance/.test(rowB.textContent) && /₹21,150/.test(rowB.querySelector('[data-l="Net freight payable"]').textContent), 'truck row: Freight adv. ₹4,500 from transporter advance, to pay ₹21,150 (24,650 + 1,000 detention − 4,500)');
  K.win.runAct('tAdv', 'KANG TRANSPORT');
  ok(K.win.document.getElementById('f_transporter').value === 'KANG TRANSPORT', '"+ Advance" opens with the transporter filled');
  fill(K, { amount: '5000', date: '23-11-2026', vehicle: 'PB10AA0003' });
  submit(K);
  ok(await idle(K), 'saved');
  ok(K.win.TADV['RAGHAV TRADING AND COMPANY|KANG TRANSPORT'].given === 35000 && K.win.getT(b).advUsed === 9500 && K.win.getT(b).netPay === 16150, 'screen updates at once: given 35,000; the unpaid truck now takes 9,500 and pays 16,150');
  K.win.runAct('fpaid', b);
  ok(/transporter advance/.test(K.$('#mform').textContent) && /₹16,150/.test(K.$('#fnet').textContent), 'Pay freight popup shows the transporter advance and net ₹16,150');
  K.win.closeForm();
  K.win.go('transporter', 'KANG TRANSPORT');
  ok(/Transporter advance left/.test(K.$('#view').textContent) && /Advances given \(4\)/.test(K.$('#view').textContent) && !!K.$('[data-act="reverseAdv"][data-id="ADV-0004"]'), 'transporter page: advance left, the 4 lines, Reverse on ADV-0004');
  K.win.close();
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  ok(V.win.D.advances === undefined && !Object.keys(V.win.TADV).length, 'Dispatch gets no advances (money)');
  V.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll transporter advance tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
