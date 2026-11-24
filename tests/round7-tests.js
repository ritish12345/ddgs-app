/*
 * Disputes tab (Nitish, 24-11-2026): for a transporter who questions a shortage deduction — loaded and unloaded weight,
 * shortage, free 0.2%, charged shortage, rate and deduction per truck; filter by transporter and period; Excel.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  // like DISP-0022: 284 loaded, 283 unloaded, SO rate 2,770 incl. GST, freight ours
  s.run('api_saveSO', own, { buyer: 'King Food Malerkotla', date: '2026-11-14', qty: 2500, rate: 2770, gst: 0.05, gstMode: 'incl', freightMode: 'ours', creditDays: 7, commodity: 'DDGS' });
  const so = Object.keys(s.run('deriveAll_').so).filter(k => s.run('deriveAll_').so[k].rate === 2770)[0];
  s.run('api_saveTruck', dis, { truck: 'HR63B5735', po: 'PO-01-BCL', so: so, placedOn: '2026-11-15', date: '2026-11-15', loadWt: '284', transporter: 'Kang Transport', frate: '85' });
  const id = s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[4] === 'HR63B5735').map(r => r[0]).pop();
  s.run('api_saveTruck', dis, { id, unloadDate: s.run('today_'), unloadWt: '283' });

  console.log('Tab');
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  ok(!V.$('#nav [data-tab="disputes"]'), 'Dispatch has no Disputes tab (money)');
  V.win.close();
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  ok(!!K.$('#nav [data-tab="disputes"]'), 'Accounts: Disputes tab');
  K.win.go('disputes');
  const rows = () => K.$$('#view .tbl .tr:not(.th)');
  const cell = (row, l) => row.querySelector('[data-l="' + l + '"]').textContent;
  ok(rows().length >= 1 && rows().every(r => cell(r, 'Shortage') !== '—'), 'starts with "With shortage": every truck shown has a shortage');

  console.log('One transporter');
  const sel = K.$('#dp_tr');
  ok(Array.from(sel.options).some(o => o.value === 'KANG TRANSPORT'), 'transporter list has KANG TRANSPORT');
  sel.value = 'KANG TRANSPORT'; sel.dispatchEvent(new K.win.Event('change', { bubbles: true }));
  const r = rows();
  const c = l => cell(r[0], l);
  ok(r.length === 1 && /HR63B5735/.test(r[0].textContent), 'only KANG TRANSPORT\'s truck');
  ok(c('Loaded') === '284.00' && c('Unloaded') === '283.00' && c('Shortage') === '1.00' && c('Free 0.2%') === '0.57' && c('Charged') === '0.43' && c('Rate incl. GST') === '₹2,770' && c('Deduction') === '₹1,197', 'loaded 284.00 · unloaded 283.00 · shortage 1.00 · free 0.57 · charged 0.43 · rate ₹2,770 · deduction ₹1,197');
  ok(/Deducted₹1,197/.test(K.$('#view .kpis').textContent.replace(/\s+/g, '')), 'total deducted ₹1,197');
  ok(K.win.rs2(1942.5) === '₹1,942.50' && K.win.rs2(2770) === '₹2,770', 'rate shows paise as 2 digits (₹1,942.50), whole rupees without');
  K.$('#view [data-sf="all"]').click();
  ok(rows().length >= 1, '"All unloaded" also lists trucks without shortage');
  const per = K.$('#dp_per'); per.value = 'last'; per.dispatchEvent(new K.win.Event('change', { bubbles: true }));
  ok(rows().length === 0 && /No trucks here/.test(K.$('#view').textContent), 'last month: nothing (it was unloaded today)');
  const per2 = K.$('#dp_per'); per2.value = 'month'; per2.dispatchEvent(new K.win.Event('change', { bubbles: true }));
  ok(rows().some(x => /HR63B5735/.test(x.textContent)), 'this month: the truck is there');
  K.win.close();

  console.log('Excel for the transporter');
  const xl = s.run('exportTabs_', 'shortage', 'KANG TRANSPORT', [id], { money: true }, '')[0];
  const h = xl.rows[0], v = xl.rows[1];
  ok(xl.name === 'Shortage' && xl.rows.length === 2 && v[h.indexOf('Loaded (qtl)')] === 284 && v[h.indexOf('Unloaded (qtl)')] === 283 && v[h.indexOf('Free 0.2% (qtl)')] === 0.568 &&
    v[h.indexOf('Charged Shortage (qtl)')] === 0.43 && v[h.indexOf('Rate incl GST')] === 2770 && v[h.indexOf('Shortage Deduction')] === 1196.64, 'Shortage sheet: loaded, unloaded, free 0.568, charged 0.43, rate 2,770, deduction 1,196.64');
  let e = ''; try { s.run('exportTabs_', 'shortage', '', null, { money: false }, ''); } catch (x) { e = x.message; }
  ok(/cannot download money/.test(e), 'not for roles without money');

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll Disputes tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
