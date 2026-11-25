/* Server speed work: "only what changed" replies, the data version / background check, duplicate protection, user cache. */
'use strict';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const J = x => JSON.stringify(x);

const s = makeServer();
const { tokens } = runScenario(s);
const D = t => ({ t, d: 1 });              // how the new screen sends its token
const own = tokens.own, acc = tokens.acc, dis = tokens.dis;
const fresh = (tok, id) => s.run('api_getData', tok).trucks.find(t => t.id === id);

console.log('Only what changed comes back after a save');
s.store.resetStats();
let r = s.run('api_saveTruck', D(dis), { id: 'DISP-0004', unloadDate: '2026-11-19', unloadWt: '409', slip: '00123' });
const readsDelta = s.store.stats.reads;
ok(r.delta === true && r.trucks.length === 1 && r.trucks[0].id === 'DISP-0004' && r.po.length === 0 && r.so.length === 0, 'one truck back, no orders');
ok(r.trucks[0].unloadWt === 409 && r.trucks[0].slip === '123', 'values are read back from the sheet (slip 00123 is stored by Sheets as 123, same as a full reload shows)');
ok(J(r.trucks[0]) === J(fresh(dis, 'DISP-0004')), 'the truck is exactly what a full reload gives (Dispatch view)');
ok(!('frate' in r.trucks[0]) && !('advance' in r.trucks[0]) && r.trucks[0]._st === 3, 'Dispatch still gets no money fields, and gets the stage (Unloaded)');
ok(!('settings' in r) && !('notes' in r) && typeof r.v === 'string', 'no settings/notes in the reply, only the new data version');
console.log('        sheet reads for this save: ' + readsDelta);

r = s.run('api_saveTruck', D(acc), { id: 'DISP-0004', advance: '5000' });
ok(J(r.trucks[0]) === J(fresh(acc, 'DISP-0004')) && r.trucks[0].advance === 5000, 'Accounts gets the money fields (same as a full reload)');
r = s.run('api_saveTruck', D(dis), { truck: 'MH12AB1234', po: 'PO-01-BCL', placedOn: '2026-11-19' });
ok(r.trucks.length === 1 && /^DISP-\d{4}$/.test(r.trucks[0].id) && r.trucks[0].truck === 'MH12AB1234', 'a new truck comes back with its new Dispatch No. (' + r.trucks[0].id + ')');
const newId = r.trucks[0].id;
r = s.run('api_savePO', D(acc), { id: 'PO-01-BCL', linkSO: 'SO-0001' });
ok(r.po.length === 1 && r.trucks.some(t => t.id === newId && t.so === 'SO-0001'), 'PO linked to a sale order: the PO and the trucks it filled in come back');
r = s.run('api_addNote', D(dis), 'Overview', 'test note');
ok(Array.isArray(r.notes) && r.notes[0].text === 'test note' && r.trucks.length === 0, 'a note comes back with the notes list');
r = s.run('api_saveBank', D(acc), 'transporter', 'Bansal Transport', 'Bansal', '99887766', 'HDFC0001234');
ok(Array.isArray(r.banks) && r.banks.some(b => b.name === 'BANSAL TRANSPORT'), 'bank details come back for Accounts');

console.log('Several trucks in one payment');
const many = [];
for (let i = 0; i < 7; i++) {
  const x = s.run('api_saveTruck', D(dis), { truck: 'PB0' + i + 'Z' + (1000 + i), po: 'PO-01-BCL', placedOn: '2026-11-19', date: '2026-11-19', loadWt: String(380 + i), transporter: 'Bansal Transport', frate: '85', so: 'SO-0001' });
  many.push(x.trucks[0].id);
}
r = s.run('api_payBatch', D(acc), 'plant', many, '2026-11-19', 'UTR777', 0, 'batch-rid-0001');
ok(r.trucks.length === 7 && r.trucks.every(t => t.plantPaid === true && t.plantUTR === 'UTR777'), '7 trucks marked paid and all 7 come back');
ok(J(r.trucks.find(t => t.id === many[3])) === J(fresh(acc, many[3])), 'same as a full reload');

console.log('Data version and the background check');
const v1 = s.run('api_getData', D(own)).v;
ok(s.run('api_sync', D(own), v1, false).same === true, 'nothing changed: "same", no data sent');
s.store.resetStats();
s.run('api_sync', D(own), v1, false);
ok(s.store.stats.reads === 0, 'and no tab was read for it (' + s.store.stats.reads + ' reads)');
s.run('api_saveTruck', D(acc), { id: 'DISP-0004', note: 'checked' });
r = s.run('api_sync', D(own), v1, false);
ok(!r.same && Array.isArray(r.trucks) && r.v !== v1, 'after someone saves: everything comes back with a new version');
ok(s.run('api_sync', D(own), r.v, true).trucks !== undefined, 'full = true always sends everything');
const v2 = s.run('api_getData', D(own)).v;
s.run('api_getReview', D(own), '2026-11-19', '');
s.run('api_export', D(acc), 'trucks', '', null, '');
ok(s.run('api_getData', D(own)).v === v2, 'looking at the review or downloading Excel does not change the version');

console.log('The same save sent twice counts once');
const before = fresh(acc, 'DISP-0004').received || 0;
r = s.run('api_addPayment', D(acc), 'DISP-0004', 1000, '2026-11-19', '', '', 'pay-rid-000001');
ok(r.delta === true, 'first time: saved (only changes back)');
r = s.run('api_addPayment', D(acc), 'DISP-0004', 1000, '2026-11-19', '', '', 'pay-rid-000001');
ok(fresh(acc, 'DISP-0004').received === before + 1000, 'second time with the same id: not added again (received ' + before + ' -> ' + fresh(acc, 'DISP-0004').received + ')');
ok(r.delta !== true && Array.isArray(r.trucks) && Array.isArray(r.po), 'second time: the screen gets everything as it is now');
const payRows = s.store.sheet('APP_PAYMENTS').dump().slice(1).filter(x => x[2] === 'DISP-0004').length;
ok(payRows === 1, 'only one payment line in APP_PAYMENTS');
s.run('api_addPayment', D(acc), 'DISP-0004', 1000, '2026-11-19', '', '', 'pay-rid-000002');
ok(fresh(acc, 'DISP-0004').received === before + 2000, 'a new payment with a new id is added normally');
s.run('api_saveTruck', D(acc), { id: 'DISP-0004', advance: '6000', _rid: 'edit-rid-0001' });
ok(fresh(acc, 'DISP-0004').advance === 6000, 'truck saves accept the id too');

console.log('Screens opened before this update keep working');
r = s.run('api_saveTruck', acc, { id: 'DISP-0004', note: 'old screen' });
ok(r.delta === undefined && Array.isArray(r.trucks) && r.trucks.length > 10 && Array.isArray(r.po) && r.settings, 'plain token: the full data comes back, as before');
ok(J(r.trucks.find(t => t.id === 'DISP-0004')) === J(fresh(acc, 'DISP-0004')), 'and it is read fresh from the sheet');
ok(err(() => s.run('api_logout', D(tokens.own))) === '' && /LOGIN/.test(err(() => s.run('api_getData', D(tokens.own)))), 'logout works with the new token form');

console.log('User cache');
const t2 = s.run('api_login', 'keshav12', 'secret2').token;
ok(err(() => s.run('api_getData', D(t2))) === '', 'Keshav can work');
const own2 = s.run('api_login', 'nidhish23', 'secret1').token;
s.run('api_saveUser', D(own2), { id: 'keshav12', active: false });
ok(/LOGIN/.test(err(() => s.run('api_getData', D(t2)))), 'blocking a user in the app stops him at once (cache cleared)');

console.log('Log lines are written together at the end of a save');
const logBefore = s.store.sheet('APP_LOG').getLastRow();
ok(/not unloaded yet/.test(err(() => s.run('api_payBatch', D(own2), 'freight', many, '2026-11-19', 'X1', 0))), 'a refused batch writes nothing');
ok(s.store.sheet('APP_LOG').getLastRow() === logBefore, 'and no log line');

console.log(fails ? '\n' + fails + ' FAILED' : '\nAll server speed tests passed.');
process.exitCode = fails ? 1 : 0;
