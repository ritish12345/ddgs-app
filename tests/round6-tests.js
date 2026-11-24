/*
 * Advances tab (Nitish, 24-11-2026): transporter advances get their own tab; adding more to a transporter is a new line;
 * the per-truck freight advance asks "given now" and adds it to what was given before.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit, truckRow } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const R = 'RAGHAV TRADING AND COMPANY';

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  s.run('api_addAdvance', acc, { transporter: 'Ambay', amount: 20000, date: '2026-11-20', firm: R });

  console.log('Tab');
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  ok(!V.$('#nav [data-tab="advances"]'), 'Dispatch has no Advances tab (money)');
  V.win.close();
  const K = openApp(s, acc);
  ok(await idle(K), 'Accounts screen loads');
  const tab = K.$('#nav [data-tab="advances"]');
  ok(!!tab && /Advances 1/.test(tab.textContent), 'Accounts: "Advances" tab, 1 transporter with advance left');
  K.win.go('advances');
  ok(/AMBAY/.test(K.$('#view .tbl').textContent) && /₹20,000/.test(K.$('#view .tbl').textContent), 'AMBAY: given ₹20,000');

  console.log('Transporter A has 20,000: add 10,000 more');
  K.$('#view [data-act="tAdv"][data-id="' + R + '|AMBAY"]').click();
  ok(!K.$('#modal').hidden && K.win.document.getElementById('f_transporter').value === 'AMBAY' && /left now ₹20,000/.test(K.$('#advAfter').textContent), 'the form opens for AMBAY and shows "left now ₹20,000"');
  fill(K, { amount: '10000', date: '24-11-2026', ref: 'hdfc12' });
  K.$('#f_amount').dispatchEvent(new K.win.Event('input', { bubbles: true }));
  ok(/after saving ₹30,000/.test(K.$('#advAfter').textContent), 'while typing: "after saving ₹30,000"');
  submit(K);
  ok(await idle(K), 'saved');
  const a = K.win.TADV[R + '|AMBAY'];
  ok(a.given === 30000 && a.left === 30000, 'AMBAY now given ₹30,000, left ₹30,000');
  const lines = s.store.sheet('APP_ADVANCES').dump().slice(1).filter(r => r[2] === 'AMBAY');
  ok(lines.length === 2 && lines[0][5] === 20000 && lines[1][5] === 10000, 'two lines in APP_ADVANCES: 20,000 and 10,000 (the first is not changed)');
  ok(/All advances \(2\)/.test(K.$('#view').textContent) && K.$$('#view [data-act="reverseAdv"]').length === 2, 'both lines listed, each with Reverse');
  K.win.QS = 'hdfc12'; K.win.render();
  ok(/All advances \(1\)/.test(K.$('#view').textContent), 'search finds the line by its UTR');
  K.win.QS = '';

  console.log('Also from the Dispatch Register');
  K.win.go('dispatch');
  ok(!!K.$('#view [data-act="tAdv"]'), '"+ Transporter advance" button in the Dispatch Register');

  console.log('Per-truck freight advance: given now is added');
  s.run('api_saveTruck', dis, { truck: 'PB13AF8596', po: 'PO-01-BCL', so: 'SO-0001', placedOn: '2026-11-23', date: '2026-11-23', loadWt: '300', transporter: 'Ambay', frate: '85' });
  K.win.sync(); await idle(K); K.win.LASTFULL = 0; K.win.sync(); await idle(K);
  const tid = K.win.T.find(t => t.truck === 'PB13AF8596').id;
  K.win.runAct('advance', tid);
  ok(/Given so far <b>₹0<\/b>/.test(K.$('#mform').innerHTML) && !!K.win.document.getElementById('f_addNow') && !K.win.document.getElementById('f_total'), 'form: given so far ₹0, "Advance given now" (no total box for Accounts)');
  fill(K, { addNow: '20000' }); submit(K); await idle(K);
  K.win.runAct('advance', tid);
  ok(/Given so far <b>₹20,000<\/b>/.test(K.$('#mform').innerHTML), 'second time: given so far ₹20,000');
  fill(K, { addNow: '10000' });
  K.$('#f_addNow').dispatchEvent(new K.win.Event('input', { bubbles: true }));
  ok(/New total ₹30,000/.test(K.$('#advTot').textContent), 'shows "New total ₹30,000"');
  submit(K);
  ok(await idle(K) && truckRow(s, tid)['Freight Advance'] === 30000, 'the truck now has ₹30,000 (20,000 + 10,000)');
  K.win.runAct('advance', tid);
  submit(K);
  ok(/Enter the advance given now/.test(K.$('#ferr').textContent), 'saving with nothing typed is stopped');
  K.win.closeForm();
  K.win.close();
  const O = openApp(s, own);
  ok(await idle(O), 'Owner screen loads');
  O.win.runAct('advance', tid);
  ok(!!O.win.document.getElementById('f_total') && O.win.document.getElementById('f_total').value === '30000', 'Owner: "correct the total" box, showing 30,000');
  fill(O, { total: '25000' }); submit(O);
  ok(await idle(O) && truckRow(s, tid)['Freight Advance'] === 25000, 'Owner corrects the total to 25,000');
  O.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll Advances tab tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
