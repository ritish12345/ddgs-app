/*
 * Customer money per customer (factory), not per truck (Nitish, Nov 2026):
 * Sales page without payments, Receivables page, "+ Received", statement, reversal, new Closed rule.
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
const D = t => ({ t, d: 1 });
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const daysAgo = k => { const d = new Date(); d.setDate(d.getDate() - k); return ymd(d); };
const RG = 'RAGHAV TRADING AND COMPANY|'; // customer accounts are kept per firm and customer (24-11-2026)
const GOD = 'GODREJ AGROVET KHANA', KING = 'KING FOOD MALERKOTLA', SR = 'SHREE RAM SOLVEX';

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s); // the scenario still uses the old per-truck API once: those lines count for the customer
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const view = s.run('api_login', 'view1', 'secret4').token;
  const accounts = () => s.run('deriveAll_').accounts;
  const trucks = () => { const m = {}; s.run('deriveAll_').trucks.forEach(t => { m[t.id] = t; }); return m; };
  const payRows = () => s.store.sheet('APP_PAYMENTS').dump().slice(1);
  // The test day's Godrej truck (DISP-0001) was unloaded on 16-11-2026 with 7 credit days, so from 24-11-2026 on it would be
  // overdue too and change the figures below. Keep it unloaded 2 days ago, so these checks do not depend on the calendar.
  s.run('api_saveTruck', own, { id: 'DISP-0001', unloadDate: daysAgo(2) });

  console.log('Customer accounts');
  let a = accounts();
  ok(a[RG + GOD].sales === 802200 && a[RG + GOD].received === 400000 && a[RG + GOD].deducted === 802 && a[RG + GOD].outstanding === 401398, 'Godrej: sales 8,02,200 − received 4,00,000 − TDS 802 = 4,01,398');
  ok(a[RG + KING].outstanding === 0 && a[RG + KING].received === 733950, 'King Food paid in full: outstanding 0');
  ok(a[RG + SR].own === true && a[RG + SR].sales === 819520 && a[RG + SR].outstanding === 819520, 'Shree Ram (group company): 8,19,520 (invoice rate 2,080 on 394 qtl)');
  ok(!a[RG + 'AMAN FEED KHANA'], 'a customer with no unloaded truck and no payment is not listed');

  console.log('Overdue: sales past their credit days, less everything received');
  const x = (s.run('api_saveTruck', dis, { truck: 'PB65OD0001', po: 'PO-01-BCL', placedOn: daysAgo(25), date: daysAgo(25), loadWt: '380', transporter: 'Sharma Roadlines', frate: '85', so: 'SO-0001' }), s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === 'PB65OD0001')[0][0]);
  s.run('api_saveTruck', dis, { id: x, unloadDate: daysAgo(20), unloadWt: '379' });
  a = accounts();
  ok(a[RG + GOD].sales === 1598100 && a[RG + GOD].overdue === 395098 && a[RG + GOD].oldest === 13, 'Godrej: truck unloaded 20 days ago (7 credit days) is 13 days past credit; overdue 7,95,900 − 4,00,802 = 3,95,098');
  s.run('sendDailyReport_');
  const mail = s.store.mails[s.store.mails.length - 1].htmlBody;
  ok(/Customer payment overdue Rs 3,95,098, oldest 13 days past credit/.test(mail) && /outside customers owe Rs/.test(mail), '9 pm report shows the customer overdue line and what customers owe');

  console.log('+ Received (per customer)');
  ok(/not allowed/.test(err(() => s.run('api_addCustomerPayment', dis, GOD, 1000, daysAgo(0), '', '', '', '', ''))), 'Dispatch cannot enter customer money');
  ok(/not allowed/.test(err(() => s.run('api_addCustomerPayment', view, GOD, 1000, daysAgo(0), '', '', '', '', ''))), 'Viewer cannot either');
  ok(/no sale order for NOBODY/.test(err(() => s.run('api_addCustomerPayment', acc, 'Nobody', 1000, daysAgo(0), '', '', '', '', ''))), 'unknown customer refused');
  ok(/reason/.test(err(() => s.run('api_addCustomerPayment', acc, GOD, 0, daysAgo(0), 500, '', '', '', ''))), 'deduction without a reason refused');
  ok(/amount received, or a deduction/.test(err(() => s.run('api_addCustomerPayment', acc, GOD, 0, daysAgo(0), 0, '', '', '', ''))), 'nothing entered: refused');
  let r = s.run('api_addCustomerPayment', D(acc), 'Godrej Agrovet Khana', 400000, daysAgo(0), 800, 'TDS', 'sbin777', 'part payment', 'cpay-rid-0001');
  const line = payRows().find(p => p[5] === 400000 && p[2] === ''); // the new line (the scenario has an older per-truck 4,00,000)
  ok(line && line[2] === '' && line[4] === GOD && line[6] === 800 && line[7] === 'TDS · Ref SBIN777 · part payment', 'one APP_PAYMENTS line: no Dispatch No., customer, amount, deduction, note "TDS · Ref SBIN777 · part payment"');
  ok(r.delta === true && Array.isArray(r.pays) && r.pays.length === payRows().length, 'the reply carries the payments list (Accounts)');
  s.run('api_addCustomerPayment', D(acc), GOD, 400000, daysAgo(0), 800, 'TDS', 'sbin777', 'part payment', 'cpay-rid-0001');
  ok(payRows().filter(p => p[5] === 400000 && p[2] === '').length === 1, 'the same payment sent twice (same id) is saved once');
  a = accounts();
  ok(a[RG + GOD].received === 800000 && a[RG + GOD].deducted === 1602 && a[RG + GOD].overdue === 0 && a[RG + GOD].outstanding === 796498, 'Godrej now: received 8,00,000, deductions 1,602, nothing overdue, outstanding 7,96,498');
  s.run('api_addCustomerPayment', D(acc), KING, 50000, daysAgo(0), '', '', '', '', '');
  ok(accounts()[RG + KING].outstanding === -50000, 'King Food paid 50,000 extra: advance (outstanding −50,000)');
  ok(!('pays' in s.run('api_getData', D(dis))) && Array.isArray(s.run('api_getData', D(view)).pays), 'Dispatch never receives payments; Viewer sees them');

  console.log('Reversal (nothing is deleted)');
  const pid = line[0];
  ok(err(() => s.run('api_reversePayment', D(acc), pid, 'entered on the wrong customer')) === '', 'Accounts reverses a payment entered today');
  const rev = payRows().find(p => String(p[7]).indexOf('Reversal of ' + pid + ':') === 0);
  ok(rev && rev[5] === -400000 && rev[6] === -800 && rev[4] === GOD, 'a minus line is added (−4,00,000 and −800)');
  ok(accounts()[RG + GOD].received === 400000 && accounts()[RG + GOD].deducted === 802, 'Godrej back to 4,00,000 received');
  ok(/already reversed/.test(err(() => s.run('api_reversePayment', D(acc), pid, 'again'))), 'cannot reverse twice');
  ok(/itself a reversal/.test(err(() => s.run('api_reversePayment', D(acc), rev[0], 'x'))), 'a reversal line cannot be reversed');
  const sh = s.store.sheet('APP_PAYMENTS');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 10).setValues([['PAY-09000', daysAgo(10), '', '', SR, 100000, '', 'old', 'keshav12', daysAgo(10) + ' 10:00']]);
  ok(/Only the Owner/.test(err(() => s.run('api_reversePayment', D(acc), 'PAY-09000', 'x'))), 'Accounts cannot reverse a payment from an earlier day');
  ok(err(() => s.run('api_reversePayment', D(own), 'PAY-09000', 'wrong amount')) === '', 'the Owner can');

  console.log('Closed = unloaded + freight paid (or customer pays freight); the supplier payment does not count (24-11-2026)');
  let t = trucks();
  ok(t['DISP-0001'].st === 6 && t['DISP-0002'].st === 6, 'DISP-0001 (freight paid) and DISP-0002 (customer pays freight) are Closed, without any customer money per truck');
  ok(t['DISP-0005'].st === 6 && t['DISP-0003'].st === 6 && !t['DISP-0005'].plantPaid && !t['DISP-0003'].plantPaid, 'DISP-0005 and DISP-0003 (own plant): freight paid, supplier not paid → Closed too');
  ok(t['DISP-0004'].st === 2, 'DISP-0004: supplier paid but not unloaded → still open (Supplier paid)');
  ok(/is closed/.test(err(() => s.run('api_saveTruck', acc, { id: 'DISP-0003', note: 'x' }))), 'Accounts still cannot change a closed truck…');
  ok(err(() => s.run('api_saveTruck', acc, { id: 'DISP-0003', plantPaid: true, plantPaidDate: daysAgo(0), plantUTR: 'UTR5' })) === '' && trucks()['DISP-0003'].plantPaid, '…but can mark its supplier paid');
  ok(err(() => s.run('api_saveTruck', dis, { id: 'DISP-0005', billNo: 'BCL/9', billQty: '390' })) === '', 'and Dispatch can enter the supplier invoice on a closed truck');

  console.log('Excel');
  const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, '');
  const th = tabs[0].rows[0], ca = tabs.find(x2 => x2.name === 'Customer Accounts');
  ok(th.indexOf('Outstanding') < 0 && th.indexOf('Received') < 0 && th.indexOf('Overdue Days') < 0 && th.indexOf('Sale Total') >= 0, 'truck sheet has no per-truck Received / Outstanding / Overdue');
  ok(ca && ca.rows[0].indexOf('Outstanding') >= 0 && ca.rows.some(row => row[1] === 'RAGHAV TRADING AND COMPANY' && row[2] === GOD), 'new "Customer Accounts" sheet, one row per firm and customer');
  ok(s.run('exportTabs_', 'accounts', '', null, { money: true }, '').length === 2, 'Receivables download: accounts + payments');

  console.log('Screen (Accounts, Keshav)');
  const A = openApp(s, acc);
  ok(await idle(A), 'app loads');
  const tabsShown = A.$$('#nav button').map(b2 => b2.dataset.tab + ':' + b2.textContent.replace(/\s*\d+$/, ''));
  ok(tabsShown.indexOf('settle:Sales') >= 0 && tabsShown.some(x2 => /^receivables:Receivables/.test(x2)), 'tabs: "Sales" and "Receivables"');
  A.win.go('receivables');
  const rhead = A.$$('#view .tr.th div').map(d => d.textContent);
  ok(rhead.join('|') === 'S.No.|Customer|Trucks|Sales|Received|Deductions|Outstanding|Overdue|Last received|', 'Receivables columns: ' + rhead.filter(String).join(', '));
  ok(A.$$('#view .td.sn').length === Object.keys(A.win.ACC).length && !!A.$('#view [data-act="custPay"][data-id="' + RG + GOD + '"]'), 'one row per firm and customer, each with "+ Received"');
  ok(/Advance/.test(A.$('#view').innerHTML), 'King Food shows its advance');
  const before = A.win.ACC[RG + GOD].received;
  A.win.runAct('custPay', GOD);
  fill(A, { amt: '', deduction: '500' });
  submit(A);
  ok(/reason/.test(A.$('#ferr').textContent), 'deduction without a reason: stopped in the form');
  fill(A, { amt: '25000', deduction: '', date: '20-11-2026'.replace('20-11-2026', daysAgo(0).split('-').reverse().join('-')), ref: 'hdfc888' });
  submit(A);
  ok(A.$('#modal').hidden && A.win.ACC[RG + GOD].received === before + 25000 && /Saving/.test(A.$('#view').innerHTML), '+ Received shows at once (received +25,000, "Saving…")');
  ok(await idle(A) && payRows().some(p => p[5] === 25000 && p[4] === GOD && /Ref HDFC888/.test(p[7])), 'confirmed by the server');
  A.win.go('buyer', GOD);
  const st = A.$$('#view table.t')[0], lastBal = st ? st.querySelector('tbody tr:last-child td:last-child').textContent : '';
  ok(!!st && /Statement/.test(A.$('#view').innerHTML) && lastBal.replace(/[₹,]/g, '') === String(Math.round(A.win.ACC[RG + GOD].outstanding)), 'customer page: statement, last balance = outstanding (' + lastBal + ')');
  const revBtn = A.$('#view [data-act="reversePay"]');
  ok(!!revBtn, 'payments list has Reverse buttons');
  revBtn.click();
  fill(A, { reason: 'test' });
  submit(A);
  ok(await idle(A) && /Reversed/.test(A.$('#view').innerHTML), 'Reverse adds the minus line and marks the payment "Reversed"');
  A.win.go('dispatch'); const dHtml = A.$('#view').innerHTML;
  A.win.go('settle'); const sHtml = A.$('#view').innerHTML;
  A.win.go('truck', 'DISP-0005'); const tHtml = A.$('#view').innerHTML;
  A.win.runAct('menu', 'DISP-0005'); const mHtml = A.$('#mform').innerHTML; A.win.closeForm();
  ok(![dHtml, sHtml, tHtml, mHtml].some(h => /data-act="receive"|Add customer payment|\+ Payment/.test(h)), 'no per-truck customer payment anywhere (register, Sales, truck page, menu)');
  A.win.go('home');
  ok(!!A.$('#view [data-tab="receivables"]') && /Customers owe you/.test(A.$('#view').innerHTML), 'Overview: "Customers owe you" opens Receivables');

  console.log('Screen (Dispatch, Vineet)');
  const V = openApp(s, dis);
  ok(await idle(V), 'app loads');
  ok(!V.$('#nav [data-tab="receivables"]') && !V.$('#nav [data-tab="settle"]') && !V.win.D.pays, 'no Sales / Receivables tabs and no payments for Dispatch');

  [A, V].forEach(w => { try { w.win.close(); } catch (e) {} });
  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll receivables tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
