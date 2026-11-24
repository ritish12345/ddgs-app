/*
 * The real Index.html in a simulated browser (jsdom), talking to the real Code.js on the fake sheet.
 * Checks fast saving: the change shows at once, the server confirms later, refused saves come back,
 * lost internet is retried without saving twice, and saves still waiting survive closing the app.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');
const B = require('./browser');
const { sleep, idle, fill, submit, truckRow } = B;
let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const openApp = (s, token, storage) => B.openApp(s, token, storage, msg => { console.log('  page error: ' + msg); fails++; });

(async () => {
  const s = makeServer();
  const { tokens } = runScenario(s);
  const own = s.run('api_login', 'nidhish23', 'secret1').token;
  s.run('api_saveTruck', tokens.dis, { truck: 'MH04XY1111', po: 'PO-01-BCL', placedOn: '2026-11-19' }); // DISP-0007, waiting for its weight

  console.log('Opening the app (Dispatch, Vineet)');
  const A = openApp(s, tokens.dis);
  ok(await idle(A), 'app loads');
  ok(A.br.calls[0] === 'api_getData' && A.win.T.length >= 7, 'first open (no saved copy): all data fetched once');
  ok(!!A.$('#view').textContent.match(/Overview|Dispatch|Money|trucks/i), 'screen is drawn');

  console.log('Enter weight: shows at once, server confirms after');
  A.br.calls.length = 0;
  A.win.runAct('load', 'DISP-0007');
  fill(A, { loadWt: '38520', date: '2026-11-19', transporter: 'bansal transport', frate: '85', slip: 'RST 99' });
  submit(A);
  const t7 = A.win.getT('DISP-0007');
  ok(A.$('#modal').hidden, 'form closes at once');
  ok(t7.L === 385.2 && t7.transporter === 'BANSAL TRANSPORT' && t7.st === 1 && t7.stage === 'Loaded', 'truck shows 385.20 qtl, Loaded, before the server answered');
  ok(A.win.PEND['DISP-0007'] === 1 && /Saving 1/.test(A.$('#sync').textContent), 'marked "Saving…" and the header says Saving 1…');
  ok(!!A.$('#view').innerHTML.match(/tag pend/) || A.win.ROUTE.v !== 'dispatch', 'Saving tag is drawn');
  ok(truckRow(s, 'DISP-0007')['Dispatch Wt (qtl)'] === '', 'the sheet does not have it yet');
  ok(await idle(A), 'server confirms');
  ok(truckRow(s, 'DISP-0007')['Dispatch Wt (qtl)'] === 385.2, 'now the sheet has 385.2');
  ok(!A.win.PEND['DISP-0007'] && /Synced/.test(A.$('#sync').textContent), 'Saving mark gone, header says Synced');
  ok(A.br.calls.join(',') === 'api_saveTruck', 'one server call only (no full reload): ' + A.br.calls.join(','));
  const d7 = A.win.D.trucks.find(t => t.id === 'DISP-0007');
  ok(d7.loadWt === 385.2 && !('frate' in d7) && d7._st === 1, 'confirmed copy from the server, still without money fields for Dispatch');

  console.log('New truck: appears at once with a temporary number');
  A.br.calls.length = 0;
  A.win.runAct('newTruck');
  fill(A, { truck: 'gj01 zz 0001', po: 'PO-01-BCL', placedOn: '2026-11-19' });
  submit(A);
  const tmp = A.win.T.find(t => t.truck === 'GJ01ZZ0001');
  ok(!!tmp && /^NEW-/.test(tmp.id) && tmp.st === 0, 'new truck in the list at once (' + (tmp && tmp.id) + ')');
  const fake = A.win.document.createElement('button'); fake.dataset.act = 'menu'; fake.dataset.id = tmp.id; A.$('#view').appendChild(fake); fake.click();
  ok(/still saving/.test(A.$('#toast').textContent) && A.$('#modal').hidden, 'tapping it while saving says "still saving" instead of opening');
  ok(await idle(A), 'server confirms');
  const real = A.win.T.filter(t => t.truck === 'GJ01ZZ0001');
  ok(real.length === 1 && /^DISP-\d{4}$/.test(real[0].id), 'replaced by the real Dispatch No. ' + (real[0] && real[0].id) + ', no duplicate');

  console.log('Refused by the server: change goes away, listed with "Open again"');
  s.run('api_saveTruck', own, { truck: 'KA01AA0001', po: 'PO-01-BCL', placedOn: '2026-11-19' }); // someone else just entered it; this screen does not know yet
  A.win.runAct('newTruck');
  fill(A, { truck: 'KA01AA0001', po: 'PO-01-BCL', placedOn: '2026-11-19', driver: 'Gurpreet' });
  submit(A);
  ok(A.win.T.some(t => /^NEW-/.test(t.id) && t.truck === 'KA01AA0001'), 'shows at once');
  ok(await idle(A), 'server answers');
  ok(!A.win.T.some(t => /^NEW-/.test(t.id)), 'the refused truck is gone from the screen');
  ok(A.win.FAILS.length === 1 && /already entered/.test(A.win.FAILS[0].msg) && !A.$('#fails').hidden, 'listed at the bottom: ' + (A.win.FAILS[0] && A.win.FAILS[0].msg.slice(0, 60)) + '…');
  ok(/Open again/.test(A.$('#fails').textContent), 'with an "Open again" button');
  A.$('#fails [data-act="reopen"]').click();
  ok(!A.$('#modal').hidden && A.win.document.getElementById('f_truck').value === 'KA01AA0001' && A.win.document.getElementById('f_driver').value === 'Gurpreet', '"Open again" opens the New truck form with what was typed');
  ok(A.win.FAILS.length === 0 && A.$('#fails').hidden, 'and the message is cleared');
  A.win.closeForm();

  console.log('Accounts (Keshav): customer payment, internet lost after the server saved it');
  const B = openApp(s, tokens.acc);
  ok(await idle(B), 'app loads');
  const RG = 'RAGHAV TRADING AND COMPANY|'; // accounts are kept per firm and customer
  const GOD = 'GODREJ AGROVET KHANA', before = B.win.ACC[RG + GOD].received;
  const payLines = () => s.store.sheet('APP_PAYMENTS').dump().slice(1).filter(r => r[4] === GOD && r[5] === 1000 && r[2] === '').length;
  let lostOnce = true;
  B.br.net = fn => (fn === 'api_addCustomerPayment' && lostOnce ? (lostOnce = false, 'lost') : 'ok');
  B.br.calls.length = 0;
  B.win.runAct('custPay', GOD);
  fill(B, { amt: '1000', date: '19-11-2026' });
  submit(B);
  ok(B.win.ACC[RG + GOD].received === before + 1000, 'received goes up by 1,000 at once (' + before + ' -> ' + B.win.ACC[RG + GOD].received + ')');
  await sleep(300);
  ok(B.win.Q.length === 1 && /No internet/.test(B.$('#sync').textContent), 'reply lost: still waiting, header says "No internet?"');
  ok(await idle(B, 15000), 'tries again by itself and finishes');
  ok(payLines() === 1, 'the sheet has the payment ONCE (one line in APP_PAYMENTS)');
  ok(B.br.calls.filter(f => f === 'api_addCustomerPayment').length === 2 && B.win.ACC[RG + GOD].received === before + 1000, 'sent twice, counted once; screen shows the right total');

  console.log('Two quick saves on one truck go in order');
  s.run('api_saveTruck', own, { truck: 'PB65QQ4321', po: 'PO-01-BCL', placedOn: '2026-11-19' });
  const nid = s.run('api_getData', tokens.acc).trucks.find(t => t.truck === 'PB65QQ4321').id;
  B.win.sync(); await idle(B);
  B.win.LASTFULL = 0; B.win.sync(); await idle(B);
  ok(!!B.win.getT(nid), 'background check picked up the truck entered by someone else (' + nid + ')');
  B.br.calls.length = 0;
  B.win.runAct('load', nid);
  fill(B, { loadWt: '401.10', date: '2026-11-19', transporter: 'Sharma Roadlines', frate: '86' });
  submit(B);
  B.win.runAct('paid', nid);
  fill(B, { plantPaidDate: '2026-11-19', plantUTR: 'SBIN000999' });
  submit(B);
  ok(B.win.getT(nid).L === 401.1 && B.win.getT(nid).plantPaid === true && B.win.getT(nid).st === 2, 'both show at once: loaded and supplier paid');
  ok(await idle(B), 'both confirmed');
  const r = truckRow(s, nid);
  ok(r['Dispatch Wt (qtl)'] === 401.1 && r['Supplier Paid'] === true && r['Supplier Payment UTR'] === 'SBIN000999', 'sheet: weight first, then paid (no "enter the weight first" error)');
  ok(B.win.FAILS.length === 0, 'nothing refused');

  console.log('Background check');
  B.br.calls.length = 0;
  const dObj = B.win.D;
  B.win.sync(); await idle(B);
  ok(B.br.calls.join(',') === 'api_sync' && B.win.D === dObj, 'nothing new: tiny answer, screen not reloaded');
  s.run('api_saveTruck', own, { id: 'DISP-0002', note: 'checked by owner' });
  B.win.sync(); await idle(B);
  ok(B.win.getT('DISP-0002').note === 'checked by owner', 'someone else saved: the change arrives');

  console.log('Batch supplier payment shows at once');
  const unpaid = B.win.T.filter(t => t.L && !t.plantPaid && !t.cx && t.plant === 'BCL').map(t => t.id);
  B.win.runAct('payPlantBatch');
  B.$('#b_party').value = 'BCL'; B.$('#b_party').dispatchEvent(new B.win.Event('change', { bubbles: true }));
  B.win.document.querySelectorAll('#b_list input').forEach(c => { c.checked = true; });
  B.$('#b_amt').value = '1'; B.$('#b_utr').value = 'axis555';
  submit(B); submit(B); // second Save confirms the amount warning
  ok(unpaid.length > 0 && unpaid.every(id => B.win.getT(id).plantPaid && B.win.getT(id).plantUTR === 'AXIS555'), unpaid.length + ' trucks show paid at once');
  ok(await idle(B), 'confirmed');
  ok(unpaid.every(id => truckRow(s, id)['Supplier Paid'] === true), 'sheet has all of them paid');

  console.log('Closing the app while a save is waiting (no internet)');
  B.br.net = () => 'offline';
  B.win.runAct('advance', 'DISP-0004');
  fill(B, { advance: '2500' });
  submit(B);
  await sleep(200);
  ok(B.win.Q.length === 1, 'save waiting');
  B.win.logout();
  ok(/still saving/.test(B.$('#toast').textContent) && !!B.win.D, 'log out is held back while something is still saving');
  const saved = B.storage();
  ok(JSON.parse(saved.ddgs_q || '[]').length === 1, 'the waiting save is kept on the phone');
  B.win.close();
  const C = openApp(s, null, saved); // the app is opened again later, internet back
  ok(await idle(C, 15000), 'app opens from the saved copy and sends the waiting save');
  ok(C.br.calls[0] === 'api_sync', 'opening with a saved copy only asks "anything new?" first (' + C.br.calls.slice(0, 2).join(',') + ')');
  ok(truckRow(s, 'DISP-0004')['Freight Advance'] === 2500 && C.win.getT('DISP-0004').A === 2500, 'the advance reached the sheet');
  ok(JSON.parse(C.storage().ddgs_q || '[]').length === 0, 'nothing left waiting');

  console.log('Different user on the same phone does not send the old user\'s save');
  const lost = JSON.stringify([{ rid: 'zzrid0000001', fn: 'api_saveTruck', args: [{ id: 'DISP-0004', advance: '9999', _rid: 'zzrid0000001' }], k: 'truck', data: { id: 'DISP-0004', patch: { advance: '9999' } }, ids: ['DISP-0004'], label: 'RJ14C5555 · Freight advance', user: 'keshav12', at: Date.now(), reopen: null }]);
  const E = openApp(s, own, { ddgs_q: lost });
  ok(await idle(E), 'owner opens the app');
  ok(truckRow(s, 'DISP-0004')['Freight Advance'] === 2500 && E.win.FAILS.length === 1 && /entered it on this device/.test(E.win.FAILS[0].msg), 'not sent; listed for checking');

  console.log('Old waiting saves are not sent');
  const old = JSON.stringify([{ rid: 'zzrid0000002', fn: 'api_saveTruck', args: [{ id: 'DISP-0004', advance: '7777', _rid: 'zzrid0000002' }], k: 'truck', data: { id: 'DISP-0004', patch: { advance: '7777' } }, ids: ['DISP-0004'], label: 'RJ14C5555 · Freight advance', user: 'nidhish23', at: Date.now() - 6 * 3600e3, reopen: null }]);
  const F = openApp(s, own, { ddgs_q: old });
  ok(await idle(F), 'app opens');
  ok(truckRow(s, 'DISP-0004')['Freight Advance'] === 2500 && F.win.FAILS.length === 1, 'a save older than 5 hours is only listed for checking');

  [A, B, C, E, F].forEach(x => { try { x.win.close(); } catch (e) {} });
  console.log(fails ? '\n' + fails + ' FAILED' : '\nAll screen tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
