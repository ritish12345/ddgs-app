/*
 * Transporter names (Nitish, 25-11-2026): a transporter that got an advance (Advances tab) before its first truck shows
 * in the Transporter list of the truck forms, for Accounts and for Dispatch (names only, no amounts).
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { idle, fill, submit } = B;

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const openApp = (s, token) => B.openApp(s, token, null, msg => { console.log('  page error: ' + msg); fails++; });
const listed = W => Array.from(W.$$('#dl_transporter option')).map(o => o.value);

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const { acc, dis } = tokens;
  s.run('api_addAdvance', acc, { transporter: 'Kang  Roadways', amount: 20000, date: '2026-11-24' });

  for (const [who, tok] of [['Accounts', acc], ['Dispatch', dis]]) {
    console.log(who);
    const W = openApp(s, tok);
    ok(await idle(W), who + ' screen loads');
    W.win.go('dispatch');
    W.win.runAct('newTruck');
    ok(listed(W).indexOf('KANG ROADWAYS') >= 0 && listed(W).indexOf('SHARMA ROADLINES') >= 0, 'New truck: transporter list has KANG ROADWAYS (advance, no truck yet) and the truck transporters');
    fill(W, { truck: 'PB10ZZ0001', transporter: 'Kang Roadways' });
    ok(!/New transporter name/.test(W.win.FORM.warn({ truck: 'PB10ZZ0001', transporter: 'Kang Roadways', po: 'PO-01-BCL', placedOn: '2026-11-25' }) || ''), 'no "new transporter name" warning for it');
    W.win.closeForm();
    if (who === 'Dispatch') ok(W.win.D.advances === undefined && Array.isArray(W.win.D.advNames) && !JSON.stringify(W.win.D).includes('20000'), 'Dispatch gets the names only, no advance amounts');
    W.win.close();
  }

  console.log('A new advance reaches an open Dispatch screen');
  const V = openApp(s, dis);
  ok(await idle(V), 'Dispatch screen loads');
  s.run('api_addAdvance', acc, { transporter: 'Bhullar Carriers', amount: 5000, date: '2026-11-25' });
  V.win.sync();
  ok(await idle(V), 'synced');
  ok(V.win.transporters().indexOf('BHULLAR CARRIERS') >= 0, 'BHULLAR CARRIERS (advance entered by Accounts) is in Dispatch\'s list after the background check');
  V.win.close();

  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll transporter name tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
