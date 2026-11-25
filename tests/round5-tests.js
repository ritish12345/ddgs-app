/*
 * Four firm windows (Nitish, 24-11-2026): Raghav, Devan, Saraswati, Jai Mahavir each have their own POs, SOs, trucks,
 * customer accounts and transporter advances. Buttons at the top switch the window; everyone sees all firms.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { execSync } = require('child_process');
const path = require('path');
const { makeServer } = require('./fake-gas');
const { runScenario, setSetting } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit, truckRow } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const openApp = (s, token, storage) => B.openApp(s, token, storage, msg => { console.log('  page error: ' + msg); fails++; });
const lastId = (s, truck) => s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === truck).map(r => r[0]).pop();
const R = 'RAGHAV TRADING AND COMPANY', DV = 'DEVAN TRADING AND COMPANY', GOD = 'GODREJ AGROVET KHANA';

(async () => {
  console.log('Upgrade of the live sheet: the 3 trading firms become firms, once');
  const old = makeServer({ code: require('./fake-gas').gitShow('9801944', 'Code.js') });
  old.store.activeEmail = old.store.ownerEmail; old.run('setup');
  const firmsCell = st => st.sheet('APP_SETTINGS').dump().find(r => r[0] === 'firms')[1];
  ok(firmsCell(old.store) === R + ', SHREE RAM SOLVEX', 'before: Raghav and Shree Ram (hidden)');
  const neu = makeServer({ store: old.store });
  const v0 = old.store.props.data_v || '0';
  neu.run('api_authState');
  ok(old.store.props.data_v !== v0 && old.store.cache.data_v === old.store.props.data_v, 'the upgrade tells every open screen to fetch everything (data version changed)');
  ok(firmsCell(old.store) === R + ', ' + DV + ', SARASWATI SOLVEX, JAI MAHAVIR TRADING AND COMPANY, SHREE RAM SOLVEX', 'after: Raghav, Devan, Saraswati, Jai Mahavir, Shree Ram (hidden, last)');
  ok(old.store.sheet('APP_LOG').dump().some(r => r[2] === 'Firms'), 'the change is in the log');
  setSetting(old.store, 'firms', R + ', ' + DV + ', SHREE RAM SOLVEX'); // the Owner later removes two firms by hand
  delete old.store.props.schema_v; delete old.store.cache.schema_ok;
  neu.run('api_authState');
  ok(firmsCell(old.store) === R + ', ' + DV + ', SHREE RAM SOLVEX', 'done only once: a later change by the Owner is kept');
  ok(old.store.sheet('APP_PAYMENTS').dump()[0].slice(-3).join('|') === 'Firm|Source|Busy Key' && old.store.sheet('APP_ADVANCES').dump()[0].slice(-3).join('|') === 'Firm|Source|Busy Key', 'Firm column added at the end of APP_PAYMENTS and APP_ADVANCES (Busy app: then Source, Busy Key)');

  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const A = () => s.run('deriveAll_');

  console.log('Devan has its own orders and trucks');
  s.run('api_savePO', own, { plant: 'BCL', date: '2026-11-20', qty: 3000, rate: 2400, gst: 0.05, poType: 'trade', firm: DV, commodity: 'DDGS' });
  s.run('api_saveSO', own, { buyer: 'Godrej Agrovet Khana', date: '2026-11-20', qty: 3000, rate: 2700, gst: 0.05, gstMode: 'incl', freightMode: 'ours', creditDays: 7, firm: DV, commodity: 'DDGS' });
  const po = A().trucks && Object.keys(A().po).filter(k => A().po[k].firm === DV)[0], so = Object.keys(A().so).filter(k => A().so[k].firm === DV)[0];
  ok(/^PO-\d+-BCL$/.test(po) && /^SO-\d{4}$/.test(so), 'Devan PO ' + po + ' and SO ' + so + ' (one numbering for all firms)');
  ok(/must be in the same firm as its PO/.test(err(() => s.run('api_saveTruck', dis, { truck: 'PB08FF0001', po: 'PO-01-BCL', so: so, placedOn: '2026-11-21' }))), 'a Raghav PO with a Devan SO is refused');
  s.run('api_saveTruck', dis, { truck: 'PB08FF0001', po: po, so: so, placedOn: '2026-11-21', date: '2026-11-21', loadWt: '300', transporter: 'Kang Transport', frate: '85' });
  const dt = lastId(s, 'PB08FF0001');
  s.run('api_saveTruck', dis, { id: dt, unloadDate: s.run('today_'), unloadWt: '300' });
  ok(A().trucks.find(t => t.id === dt).firm === DV, dt + ' is a Devan truck');

  console.log('Customer money per firm');
  let ac = A().accounts;
  ok(ac[R + '|' + GOD] && ac[DV + '|' + GOD] && ac[DV + '|' + GOD].sales === 810000, 'Godrej has two accounts: Raghav and Devan (300 × 2,700 = 8,10,000)');
  const rBefore = ac[R + '|' + GOD].received;
  ok(rBefore === 400000, 'old payments (no firm) count under Raghav');
  ok(/no sale order for NOBODY in/.test(err(() => s.run('api_addCustomerPayment', acc, 'Nobody', 1, s.run('today_'), 0, '', '', '', '', DV))), 'a payment needs a sale order of that customer in that firm');
  ok(/Choose the firm/.test(err(() => s.run('api_addCustomerPayment', acc, GOD, 1, s.run('today_'), 0, '', '', '', '', 'XYZ'))), 'unknown firm refused');
  s.run('api_addCustomerPayment', acc, GOD, 300000, s.run('today_'), 0, '', 'utr9', '', '', DV);
  ac = A().accounts;
  ok(ac[DV + '|' + GOD].received === 300000 && ac[DV + '|' + GOD].outstanding === 510000 && ac[R + '|' + GOD].received === rBefore, 'Devan payment lowers only Devan\'s Godrej account (8,10,000 − 3,00,000 = 5,10,000)');
  { const pd = s.store.sheet('APP_PAYMENTS').dump(); ok(pd.slice(-1)[0][pd[0].indexOf('Firm')] === DV, 'the payment line says Devan'); }

  console.log('Transporter advances per firm');
  s.run('api_addAdvance', acc, { transporter: 'Kang Transport', amount: 20000, date: '2026-11-20', firm: DV });
  let tv = A().tadv;
  ok(tv[DV + '|KANG TRANSPORT'].used === 20000 && A().trucks.find(t => t.id === dt).advUsed === 20000 && !tv[R + '|KANG TRANSPORT'], 'Devan\'s advance is used on the Devan truck (25,500 freight → 5,500 to pay)');
  ok(A().trucks.find(t => t.id === dt).netPay === 5500, 'to pay 5,500');

  console.log('Excel per firm');
  const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, DV);
  const ca = tabs.find(t => t.name === 'Customer Accounts'), cp = tabs.find(t => t.name === 'Customer Payments');
  ok(ca.rows.length === 2 && ca.rows[1][1] === DV && cp.rows.length === 2 && tabs.find(t => t.name === 'Trucks').rows.length === 2, 'Devan\'s Excel: only Devan\'s account, payment and truck');
  ok(tabs.find(t => t.name === 'Purchase Orders').rows[0].indexOf('Booked in the name of') < 0, 'no "Booked in the name of" column');

  console.log('Screen');
  const W = openApp(s, acc);
  ok(await idle(W), 'Accounts screen loads');
  W.win.go('dispatch');
  ok(W.$$('.firmbar button').map(b => b.textContent).join(' ') === 'All Raghav Devan Saraswati Jai Mahavir Shree Ram', 'firm buttons (Shree Ram shown here because the test day does not hide it)');
  W.$('.firmbar button[data-firm="' + DV + '"]').click();
  ok(W.win.FIRM === DV && W.win.LASTIDS.length === 1 && W.win.LASTIDS[0] === dt, 'Devan window: only the Devan truck');
  W.win.go('receivables');
  ok(!!W.$('.firmbar') && W.$$('#view .td.sn').length === 1 && /GODREJ/.test(W.$('#view .tbl').textContent), 'Receivables has the firm buttons; Devan: one account (Godrej)');
  W.win.runAct('custPay', GOD);
  ok(W.$('#f_firm') && W.$('#f_firm').value === DV, '+ Received from Devan\'s window starts with Devan');
  W.win.closeForm();
  W.win.go('pos'); W.win.runAct('newPO');
  ok(!W.$('#f_takenIn') && W.$('#f_firm').value === DV, 'new PO: firm Devan, no "Booked in the name of"');
  W.win.closeForm();
  W.win.go('freight');
  ok(/KANG TRANSPORT/.test(W.$('#view').textContent) && /₹20,000/.test(W.$('#view').textContent), 'Freight: Devan\'s advance to Kang Transport');
  const saved = W.storage();
  W.win.close();
  ok(saved.ddgs_firm === DV, 'the chosen firm is remembered on this phone');
  const W2 = openApp(s, acc, { ddgs_firm: DV });
  ok(await idle(W2), 'opened again');
  W2.win.go('dispatch');
  ok(W2.win.FIRM === DV && W2.$('.firmbar .on').textContent === 'Devan', 'opens in Devan\'s window');
  W2.win.$('.firmbar button[data-firm="all"]').click();
  ok(W2.win.FIRM === 'all' && W2.win.LASTIDS.indexOf(dt) >= 0 && W2.win.LASTIDS.length > 1, 'All: every firm\'s trucks');
  W2.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll four-firm tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
