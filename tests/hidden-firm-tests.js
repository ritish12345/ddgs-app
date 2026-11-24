/*
 * Shree Ram Solvex's own business kept out of this app (setting hiddenFirms, Nov 2026).
 * Its rows stay in the sheet untouched; Raghav's sales TO Shree Ram stay in the app.
 * In the test day: PO-02-OASIS is Shree Ram's own-plant PO with truck DISP-0003;
 * SO-0003 is Raghav selling to Shree Ram (truck DISP-0005).
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { execSync } = require('child_process');
const path = require('path');
const { makeServer } = require('./fake-gas');
const { runScenario, setSetting } = require('./scenario');
const B = require('./browser');
const { idle } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const D = t => ({ t, d: 1 });
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const SR = 'SHREE RAM SOLVEX';

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  const sheetBefore = JSON.stringify(['APP_PO', 'APP_SO', 'APP_TRUCKS'].map(n => s.store.sheet(n).dump()));
  setSetting(s.store, 'hiddenFirms', SR); // the switch, as it will be in the live sheet

  console.log('Kept out of every screen');
  ['own', 'acc', 'dis'].forEach(who => {
    const d = s.run('api_getData', D({ own, acc, dis }[who]));
    ok(!d.po.some(o => o.id === 'PO-02-OASIS') && !d.trucks.some(t => t.id === 'DISP-0003'), who + ': no PO-02-OASIS (Shree Ram own plant), no DISP-0003');
    ok(d.so.some(o => o.id === 'SO-0003') && d.trucks.some(t => t.id === 'DISP-0005'), who + ': Raghav\'s sale TO Shree Ram (SO-0003, DISP-0005) is still there');
  });
  const A = s.run('deriveAll_');
  ok(!A.trucks.some(t => t.id === 'DISP-0003') && !A.po['PO-02-OASIS'], 'not in the totals, the 9 pm report or Excel (shared calculation)');
  ok(A.accounts['RAGHAV TRADING AND COMPANY|' + SR] && A.accounts['RAGHAV TRADING AND COMPANY|' + SR].own === true && A.accounts['RAGHAV TRADING AND COMPANY|' + SR].sales > 0, 'Shree Ram is still a group-company customer in Receivables (' + A.accounts['RAGHAV TRADING AND COMPANY|' + SR].sales + ')');
  const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, '');
  ok(!JSON.stringify(tabs).includes('DISP-0003') && !JSON.stringify(tabs).includes('PO-02-OASIS'), 'full Excel has neither');
  s.run('sendDailyReport_');
  ok(!/DISP-0003|PO-02-OASIS/.test(s.store.mails[s.store.mails.length - 1].htmlBody), '9 pm report has neither');

  console.log('Cannot be changed from this app');
  const refused = (label, fn) => ok(/kept out of this app/.test(err(fn)), label + ': refused');
  refused('edit DISP-0003', () => s.run('api_saveTruck', own, { id: 'DISP-0003', note: 'x' }));
  refused('new truck on PO-02-OASIS', () => s.run('api_saveTruck', dis, { truck: 'PB01HD0001', po: 'PO-02-OASIS', placedOn: '2026-11-19' }));
  refused('cancel DISP-0003', () => s.run('api_cancel', own, 'truck', 'DISP-0003', 'x'));
  refused('photo on DISP-0003', () => s.run('api_savePhoto', own, 'DISP-0003', 'slip', 'AAAA', 'image/jpeg'));
  refused('edit PO-02-OASIS', () => s.run('api_savePO', own, { id: 'PO-02-OASIS', note: 'x' }));
  refused('short-close PO-02-OASIS', () => s.run('api_settle', own, 'po', 'PO-02-OASIS', true));
  refused('new PO in Shree Ram', () => s.run('api_savePO', own, { plant: 'Oasis Ethanol', date: '2026-11-19', qty: 100, rate: 2000, gst: 0.05, poType: 'trade', firm: SR }));
  refused('new own-plant PO', () => s.run('api_savePO', own, { plant: 'Oasis Ethanol', date: '2026-11-19', qty: 100, rate: 2000, gst: 0.05, poType: 'plant' }));
  ok(/not found/.test(err(() => s.run('api_payBatch', acc, 'plant', ['DISP-0003'], '2026-11-19', '', 0))), 'pay supplier for DISP-0003: not found');
  ok(err(() => s.run('api_savePO', own, { plant: 'Oasis Ethanol', date: '2026-11-19', qty: 100, rate: 2000, gst: 0.05, poType: 'trade' })) === '', 'a normal Raghav PO still works');

  console.log('Raghav keeps working normally');
  // DISP-0003 was vehicle PB 29 X 0297 on 14-11-2026: a Raghav truck with the same number that day is not blocked by a hidden one
  const maxBefore = s.store.sheet('APP_TRUCKS').dump().slice(1).map(r => Number(String(r[0]).slice(5))).reduce((m, x) => Math.max(m, x), 0);
  ok(err(() => s.run('api_saveTruck', dis, { truck: 'PB29X0297', po: 'PO-01-BCL', placedOn: '2026-11-14', date: '2026-11-14' })) === '', 'same-vehicle check ignores Shree Ram\'s trucks');
  const ids = s.store.sheet('APP_TRUCKS').dump().slice(1).map(r => r[0]).sort();
  ok(ids[ids.length - 1] === 'DISP-' + String(maxBefore + 1).padStart(4, '0') && ids.indexOf('DISP-0003') >= 0, 'Dispatch numbers keep counting over all rows (new truck ' + ids[ids.length - 1] + ', after DISP-' + String(maxBefore).padStart(4, '0') + ')');
  ok(err(() => s.run('api_saveTruck', own, { id: 'DISP-0005', note: 'checked at the plant' })) === '', 'Raghav\'s truck to Shree Ram can be changed (it is closed now, so by the Owner)');

  console.log('Nothing in the sheet was changed or deleted');
  const after = ['APP_PO', 'APP_SO', 'APP_TRUCKS'].map(n => s.store.sheet(n).dump());
  const keepRow = (tab, id) => JSON.stringify(after[tab].find(r => r[0] === id)) === JSON.stringify(JSON.parse(sheetBefore)[tab].find(r => r[0] === id));
  ok(keepRow(2, 'DISP-0003') && keepRow(0, 'PO-02-OASIS'), 'DISP-0003 and PO-02-OASIS rows are exactly as before');

  console.log('Screen (Owner)');
  const W = openApp(s, own);
  ok(await idle(W), 'app loads');
  ok(!W.win.T.some(t => t.id === 'DISP-0003') && W.win.T.some(t => t.id === 'DISP-0005'), 'Shree Ram\'s truck not on screen; Raghav\'s truck to Shree Ram is');
  ok(!W.$('#nav [data-tab="receive"]'), 'no Plant Inward tab');
  W.win.go('dispatch');
  const fb = W.$('.firmbar') ? W.$$('.firmbar button').map(b => b.textContent).join(' ') : '';
  ok(fb === 'All Raghav Devan Saraswati Jai Mahavir', 'firm buttons: All, Raghav, Devan, Saraswati, Jai Mahavir; no Shree Ram (' + fb + ')');
  W.win.runAct('newPO');
  ok(!/Own plant/.test(W.$('#f_poType').innerHTML) && !/SHREE RAM/.test((W.$('#f_firm') || { innerHTML: '' }).innerHTML), 'new PO: no "Own plant" type, no Shree Ram firm');
  W.win.closeForm();
  W.win.go('receivables');
  ok(W.$$('#view .td a').some(a => a.textContent === SR), 'Receivables still lists Shree Ram as a customer');
  W.win.close();

  console.log('Switch off (clear the setting): everything is back');
  setSetting(s.store, 'hiddenFirms', '');
  const d2 = s.run('api_getData', D(own));
  ok(d2.trucks.some(t => t.id === 'DISP-0003') && d2.po.some(o => o.id === 'PO-02-OASIS'), 'DISP-0003 and PO-02-OASIS show again');

  console.log('Upgrade from the live version adds the setting once');
  const old = makeServer({ code: execSync('git show 0348cb0:Code.js', { cwd: path.join(__dirname, '..'), maxBuffer: 1e8 }).toString() });
  old.store.activeEmail = old.store.ownerEmail; old.run('setup');
  const neu = makeServer({ store: old.store });
  neu.run('api_authState'); neu.run('api_authState');
  const rows = old.store.sheet('APP_SETTINGS').dump().filter(r => r[0] === 'hiddenFirms');
  ok(rows.length === 1 && rows[0][1] === SR, 'APP_SETTINGS gets one row: hiddenFirms = SHREE RAM SOLVEX');

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll hidden-firm tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
