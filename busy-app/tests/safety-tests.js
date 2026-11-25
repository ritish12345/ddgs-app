/* Safety fixes: role gaps, editor/timer-only functions, restore duplicate check, Excel stage names. */
'use strict';
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };
const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
const truck = (s, id) => s.store.sheet('APP_TRUCKS').dump().slice(1).filter(r => r[0] === id).map(r => ({ status: r[19], slipPhoto: r[36] }))[0];
const orderStatus = (s, tab, id) => s.store.sheet(tab).dump().slice(1).filter(r => r[0] === id)[0][7];

const s = makeServer();
const { tokens } = runScenario(s);
const { own, acc, dis } = tokens;

console.log('Role gaps');
s.run('api_saveTruck', dis, { id: 'DISP-0005', status: 'Cancelled', slipPhoto: 'https://evil.example/x' });
ok(truck(s, 'DISP-0005').status === '', 'Dispatch cannot cancel a truck by sending a status in a normal save');
ok(truck(s, 'DISP-0005').slipPhoto === '', 'a normal save cannot set a photo link');
s.run('api_saveTruck', acc, { id: 'DISP-0006', status: '' });
ok(truck(s, 'DISP-0006').status === 'Cancelled', 'a cancelled truck cannot be restored by a normal save');
s.run('api_savePO', acc, { id: 'PO-01-BCL', status: 'Cancelled' });
ok(orderStatus(s, 'APP_PO', 'PO-01-BCL') === '', 'a PO with trucks cannot be cancelled through Edit');
s.run('api_saveSO', acc, { id: 'SO-0002', status: '' });
ok(orderStatus(s, 'APP_SO', 'SO-0002') === 'Settled', 'short-close cannot be undone through Edit (only Undo short-close)');

console.log('Restore checks for the same vehicle on the same day');
s.run('api_saveTruck', dis, { truck: 'UP15Z9', po: 'PO-01-BCL', placedOn: '2026-11-18' }); // DISP-0006 (cancelled) was UP15Z9 on 2026-11-18
ok(/already entered again that day/.test(err(() => s.run('api_restore', acc, 'truck', 'DISP-0006'))), 'Accounts cannot restore a cancelled truck when the vehicle is entered again that day');
ok(err(() => s.run('api_restore', own, 'truck', 'DISP-0006')) === '', 'the Owner can still restore it');

console.log('Editor-only and timer-only functions');
s.store.activeEmail = '';  // someone opening the app link, not the owner
ok(/Apps Script editor/.test(err(() => s.run('setup'))), 'setup cannot be started from a browser');
ok(/Apps Script editor/.test(err(() => s.run('testDailyReport'))), 'testDailyReport cannot be started from a browser');
const mails = s.store.mails.length;
s.run('dailyReport', { triggerUid: 'made-up' });
ok(s.store.mails.length === mails, 'dailyReport with a made-up trigger id sends nothing');
const backupsBefore = (s.store.folders.find(f => f.name === 'RAGHAV BUSY APP Backups') || { files: [] }).files.length;
s.run('weeklyBackup', { triggerUid: 'made-up' });
ok((s.store.folders.find(f => f.name === 'RAGHAV BUSY APP Backups') || { files: [] }).files.length === backupsBefore, 'weeklyBackup with a made-up trigger id makes no copy');
const daily = s.store.triggers.find(t => t.fn === 'dailyReport'), weekly = s.store.triggers.find(t => t.fn === 'weeklyBackup');
ok(!daily && !weekly, 'Busy app: no 9 pm email or Sunday backup timer by default (settings dailyReport / weeklyBackup = no)');
s.store.sheet('APP_SETTINGS').rows.forEach(r => { if (r && (r[0] === 'dailyReport' || r[0] === 'weeklyBackup')) r[1] = 'yes'; });
s.store.activeEmail = s.store.ownerEmail; s.run('setup'); s.store.activeEmail = '';
const daily2 = s.store.triggers.find(t => t.fn === 'dailyReport'), weekly2 = s.store.triggers.find(t => t.fn === 'weeklyBackup');
ok(!!daily2 && !!weekly2, 'switched on in the settings: setup makes the two timers');
s.run('dailyReport', { triggerUid: daily2.id });
ok(s.store.mails.length === mails + 1, 'the real 9 pm trigger still sends the report');
s.run('weeklyBackup', { triggerUid: weekly2.id });
ok(s.store.folders.find(f => f.name === 'RAGHAV BUSY APP Backups').files.length === backupsBefore + 1, 'the real Sunday trigger still makes the backup');
s.store.activeEmail = s.store.ownerEmail; // the owner in the editor
ok(err(() => s.run('setup')) === '', 'setup still works from the editor');
ok(err(() => s.run('testDailyReport')) === '' && s.store.mails.length === mails + 2, 'testDailyReport still works from the editor');

console.log('Excel uses the same stage words as the screen');
const tabs = s.run('exportTabs_', 'full', '', null, { money: true, profit: true }, '');
const head = tabs[0].rows[0], col = head.indexOf('Stage');
const stages = tabs[0].rows.slice(1).map(r => r[col]);
ok(stages.indexOf('Supplier paid') >= 0 || stages.indexOf('Customer paid') >= 0 || stages.indexOf('Closed') >= 0, 'stages: ' + Array.from(new Set(stages)).join(', '));
ok(!stages.some(x => x === 'Paid to plant' || x === 'Buyer paid' || x === 'Placed'), 'no old words (Paid to plant, Buyer paid, Placed)');

console.log(fails ? '\n' + fails + ' FAILED' : '\nAll safety tests passed.');
process.exitCode = fails ? 1 : 0;
