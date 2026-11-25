/*
 * A realistic day in the app, driven through the server API exactly like the screen does.
 * Used to compare the old and the new Code.js: same inputs must give the same sheet and the same screens.
 */
'use strict';

/* Test helper: sets an APP_SETTINGS value directly in the fake sheet (only if the row exists — older code has fewer settings). */
function setSetting(store, key, value) {
  const sh = store.sheet('APP_SETTINGS');
  if (!sh) return false;
  const i = sh.dump().findIndex(r => r[0] === key);
  if (i < 1) return false;
  sh.getRange(i + 1, 2).setValue(value);
  return true;
}

/* Runs every step; a step that throws is recorded with its error message (that is part of the comparison). */
function runScenario(s) {
  const st = s.store, log = [];
  const step = (label, fn) => {
    const r0 = st.stats.reads;
    try { const r = fn(); log.push({ label, ok: true, reads: st.stats.reads - r0 }); return r; }
    catch (e) { log.push({ label, ok: false, err: e.message, reads: st.stats.reads - r0 }); return null; }
  };
  const call = (fn, ...a) => s.run(fn, ...a);

  st.activeEmail = st.ownerEmail; // the owner opens the editor / the app with his own Google account
  step('setup', () => call('setup'));
  setSetting(st, 'hiddenFirms', ''); // this day covers Raghav + own-plant trucks; hiding a firm has its own tests (hidden-firm-tests.js)
  step('authState', () => call('api_authState'));
  const own = step('create owner', () => call('api_createOwner', 'nidhish23', 'Nitish', 'secret1')).token;
  st.activeEmail = '';            // staff open the link from their own phones
  step('add keshav', () => call('api_saveUser', own, { _new: true, id: 'keshav12', name: 'Keshav', role: 'Accounts', password: 'secret2' }));
  step('add vineet', () => call('api_saveUser', own, { _new: true, id: 'vineet12', name: 'Vineet', role: 'Dispatch', password: 'secret3' }));
  step('add viewer', () => call('api_saveUser', own, { _new: true, id: 'view1', name: 'Viewer', role: 'Viewer', password: 'secret4' }));
  step('wrong password', () => call('api_login', 'keshav12', 'nope'));
  const acc = step('login keshav', () => call('api_login', 'keshav12', 'secret2')).token;
  const dis = step('login vineet', () => call('api_login', 'vineet12', 'secret3')).token;
  const vw = step('login viewer', () => call('api_login', 'view1', 'secret4')).token;

  // Orders
  step('SO godrej', () => call('api_saveSO', own, { buyer: 'Godrej Agrovet Khana', date: '2026-11-01', qty: 5000, rate: 2100, gst: 0.05, gstMode: 'incl', freightMode: 'ours', creditDays: 7, commodity: 'DDGS' }));
  step('SO king food (customer pays freight)', () => call('api_saveSO', acc, { buyer: 'King Food Malerkotla', date: '2026-11-02', qty: 2000, rate: 2000, gst: 0.05, gstMode: 'excl', freightMode: 'buyer', creditDays: 10, commodity: 'DDGS' }));
  step('SO to own group (Shree Ram)', () => call('api_saveSO', own, { buyer: 'Shree Ram Solvex', date: '2026-11-03', qty: 1000, rate: 2050, gst: 0.05, gstMode: 'incl', freightMode: 'ours', commodity: 'DDGS' }));
  step('SO missing gst mode', () => call('api_saveSO', own, { buyer: 'Aman Feed Khana', date: '2026-11-03', qty: 100, rate: 2000 }));
  step('PO BCL', () => call('api_savePO', own, { plant: 'BCL', date: '2026-11-01', qty: 6000, rate: 1900, gst: 0.05, poType: 'trade', commodity: 'DDGS' }));
  step('PO Oasis own plant', () => call('api_savePO', own, { plant: 'Oasis Ethanol', date: '2026-11-01', qty: 3000, rate: 1850, gst: 0.05, poType: 'plant', firm: 'SHREE RAM SOLVEX', commodity: 'DDGS' }));
  step('PO MG sells to SO-0001', () => call('api_savePO', acc, { plant: 'MG Petrochem', date: '2026-11-02', qty: 2000, rate: 1950, gst: 0.05, poType: 'trade', linkSO: 'SO-0001', takenIn: 'Devan Trading and Company', commodity: 'DDGS' }));
  step('dispatch cannot add PO', () => call('api_savePO', dis, { plant: 'X', qty: 1, rate: 1 }));

  // Trucks entered by Dispatch
  step('T1 placed', () => call('api_saveTruck', dis, { truck: 'pb29x0297', po: 'PO-01-BCL', placedOn: '2026-11-10', transporter: 'Sharma Roadlines', driver: 'Ram 98765' }));
  step('T1 weight', () => call('api_saveTruck', dis, { id: 'DISP-0001', loadWt: '384.5', date: '2026-11-10', transporter: 'Sharma Roadlines', frate: '85', slip: 'RST 1201' }));
  step('T1 customer', () => call('api_saveTruck', dis, { id: 'DISP-0001', so: 'SO-0001' }));
  step('T2 with weight', () => call('api_saveTruck', dis, { truck: 'HR55A1234', po: 'PO-01-BCL', placedOn: '2026-11-12', date: '2026-11-12', loadWt: '350', transporter: 'Sharma Roadlines', frate: '90', so: 'SO-0002' }));
  step('T3 own plant', () => call('api_saveTruck', dis, { truck: 'PB 29 X 0297', po: 'PO-02-OASIS', placedOn: '2026-11-14', date: '2026-11-14', loadWt: '300', transporter: 'Sharma Roadlines', frate: '80' }));
  step('T4 on linked PO (gets SO-0001)', () => call('api_saveTruck', dis, { truck: 'RJ14C5555', po: 'PO-03-MG', placedOn: '2026-11-15', date: '2026-11-15', loadWt: '410.2', transporter: 'Bansal Transport', frate: '88' }));
  step('T5 to group company', () => call('api_saveTruck', dis, { truck: 'PB10K7777', po: 'PO-01-BCL', placedOn: '2026-11-16', date: '2026-11-16', loadWt: '395', transporter: 'Bansal Transport', frate: '86', so: 'SO-0003' }));
  step('T6 placed only', () => call('api_saveTruck', dis, { truck: 'UP15Z9', po: 'PO-01-BCL', placedOn: '2026-11-18' }));
  step('same vehicle same day refused', () => call('api_saveTruck', dis, { truck: 'HR 55 A 1234', po: 'PO-01-BCL', placedOn: '2026-11-12', date: '2026-11-12' }));
  step('kg typed as qtl refused', () => call('api_saveTruck', dis, { id: 'DISP-0006', loadWt: '38450', date: '2026-11-18', transporter: 'X', frate: '80' }));
  step('weight without transporter refused', () => call('api_saveTruck', dis, { id: 'DISP-0006', loadWt: '380', date: '2026-11-18' }));
  step('dispatch money fields dropped', () => call('api_saveTruck', dis, { id: 'DISP-0002', advance: '99999', received: '5' }));

  // Accounts: payments and freight
  step('advance T1', () => call('api_saveTruck', acc, { id: 'DISP-0001', advance: '10000' }));
  step('advance T3', () => call('api_saveTruck', acc, { id: 'DISP-0003', advance: '30000' }));
  step('supplier paid T1', () => call('api_saveTruck', acc, { id: 'DISP-0001', plantPaid: true, plantPaidDate: '2026-11-11', plantUTR: 'SBIN111' }));
  step('batch supplier pay T2 T4', () => call('api_payBatch', acc, 'plant', ['DISP-0002', 'DISP-0004'], '2026-11-16', 'hdfc222', 1517000));
  step('batch pay again refused', () => call('api_payBatch', acc, 'plant', ['DISP-0002'], '2026-11-16', 'X', ''));
  step('unload T1', () => call('api_saveTruck', dis, { id: 'DISP-0001', unloadDate: '2026-11-16', unloadWt: '382' }));
  step('unload T2', () => call('api_saveTruck', dis, { id: 'DISP-0002', unloadDate: '2026-11-13', unloadWt: '349.5' }));
  step('unload T3 at own plant', () => call('api_saveTruck', dis, { id: 'DISP-0003', unloadDate: '2026-11-15', unloadWt: '297' }));
  step('unload T5', () => call('api_saveTruck', dis, { id: 'DISP-0005', unloadDate: '2026-11-18', unloadWt: '394' }));
  step('received more than 5% over refused', () => call('api_saveTruck', dis, { id: 'DISP-0004', unloadDate: '2026-11-18', unloadWt: '440' }));
  step('payment T2 full', () => call('api_addPayment', acc, 'DISP-0002', 733950, '2026-11-17', '', ''));
  step('payment T1 part + TDS', () => call('api_addPayment', acc, 'DISP-0001', 400000, '2026-11-18', 802, 'TDS'));
  step('accounts cannot edit received', () => call('api_saveTruck', acc, { id: 'DISP-0001', received: '1' }));
  step('freight paid T3 own plant', () => call('api_saveTruck', acc, { id: 'DISP-0003', freightPaid: true, freightPaidDate: '2026-11-16', freightUTR: 'utr333', detention: '0' }));
  step('batch freight T1 T5', () => call('api_payBatch', acc, 'freight', ['DISP-0001', 'DISP-0005'], '2026-11-19', 'icic444', 40000));
  step('invoice rate T5', () => call('api_saveTruck', own, { id: 'DISP-0005', saleRate: '2080' }));
  step('supplier bill T4', () => call('api_saveTruck', acc, { id: 'DISP-0004', billNo: 'MG/77', billQty: '410.2' }));
  step('bank details', () => call('api_saveBank', acc, 'supplier', 'BCL', 'BCL Ltd', '0012345678', 'SBIN0001234'));
  step('bank bad ifsc', () => call('api_saveBank', acc, 'transporter', 'Sharma Roadlines', 'Sharma', '1234567', 'XX'));
  step('note', () => call('api_addNote', dis, 'Dispatch Board', 'Bigger buttons please'));
  step('note done', () => call('api_noteStatus', own, 'NOTE-0001', 'Done'));
  step('returned T6', () => call('api_returned', dis, 'DISP-0006', 'not called inside'));
  step('undo returned T6', () => call('api_restore', dis, 'truck', 'DISP-0006'));
  step('cancel T6', () => call('api_cancel', acc, 'truck', 'DISP-0006', 'duplicate entry'));
  step('dispatch cannot cancel via cancel api', () => call('api_cancel', dis, 'truck', 'DISP-0005', 'x'));
  step('cancel PO with trucks refused', () => call('api_cancel', own, 'po', 'PO-01-BCL', 'x'));
  step('short-close SO-0002', () => call('api_settle', acc, 'so', 'SO-0002', true));
  step('truck on short-closed SO refused', () => call('api_saveTruck', dis, { truck: 'PB01A1', po: 'PO-01-BCL', placedOn: '2026-11-19', so: 'SO-0002' }));
  step('owner edits SO note', () => call('api_saveSO', own, { id: 'SO-0001', note: 'Credit 7 days' }));
  step('viewer cannot save', () => call('api_saveTruck', vw, { id: 'DISP-0001', note: 'x' }));
  step('logout viewer', () => call('api_logout', vw));
  step('viewer token gone', () => call('api_getData', vw));
  return { log, tokens: { own, acc, dis } };
}

module.exports = { runScenario, setSetting };
