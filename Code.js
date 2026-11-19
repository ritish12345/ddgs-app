/**
 * DDGS Trade Control - Google Apps Script web app
 * ------------------------------------------------
 * ONE-FILE VERSION: paste this whole file into Extensions > Apps Script > Code.gs.
 * The screen (Index.html) is already included at the bottom as INDEX_HTML,
 * so you do not need a separate HTML file.
 *
 * On first run it creates its own tabs (APP_PO, APP_SO, APP_TRUCKS,
 * APP_LOG, APP_SETTINGS) and copies your data in from MASTER PO,
 * SALE ORDER, DISPATCH, SALE and Freight, matching rows by Dispatch ID.
 * Your old tabs are only read, never changed.
 *
 * Version 6.4: vocabulary, compulsory fields (transporter and freight rate once the weight is
 * entered, UTR for every payment), "Vehicle Placed On" date, activity review with verified ticks,
 * bank details for paying, slip and payment photos in Drive, flow charts on PO and buyer pages.
 * Version 6.1: orders can be marked Settled; a driver's advance is adjusted across trips of the same truck.
 * Version 6: same-day duplicate block, several trucks paid in one go with UTR,
 * 'Returned, not loaded', plant bill quantity check, 'Order taken in' on POs.
 * Version 5: two firms (Raghav Trading and Company, Sriram Solvex), own-plant POs
 * that only receive trucks, POs that sell to a fixed sale order, per-truck sale
 * rate, table screens with links. Plus everything from version 4: logins with
 * roles, detention, closed-truck lock, payments log, Excel export, daily 9 pm
 * email report and weekly backup.
 * Deploy as "Execute as: Me" so staff never need access to the sheet itself.
 */

var T = { PO: 'APP_PO', SO: 'APP_SO', TR: 'APP_TRUCKS', LOG: 'APP_LOG', SET: 'APP_SETTINGS', US: 'APP_USERS', PAY: 'APP_PAYMENTS', NOTE: 'APP_NOTES', BANK: 'APP_BANK' };

// What each role may do. Change here if needed.
var ROLES = {
  Owner:    { money: true,  trucks: true,  truckMoney: true,  orders: true,  users: true,  cancelTruck: true,  profit: true,  exportX: true,  editClosed: true },
  Accounts: { money: true,  trucks: true,  truckMoney: true,  orders: true,  users: false, cancelTruck: true,  profit: false, exportX: true,  editClosed: false },
  Dispatch: { money: false, trucks: true,  truckMoney: false, orders: false, users: false, cancelTruck: false, profit: false, exportX: false, editClosed: false },
  Viewer:   { money: true,  trucks: false, truckMoney: false, orders: false, users: false, cancelTruck: false, profit: false, exportX: false, editClosed: false }
};
Object.keys(ROLES).forEach(function (r) { ROLES[r].review = r === 'Owner'; ROLES[r].bank = r === 'Owner' || r === 'Accounts'; });
var TRUCK_MONEY = ['plantPaid', 'plantPaidDate', 'frate', 'advance', 'freightPaid', 'freightPaidDate', 'received', 'receivedDate', 'deduction', 'deductionNote', 'detention', 'saleRate', 'plantUTR', 'freightUTR', 'zohoBill', 'zohoInvoice', 'zohoFreight'];
var ORDER_MONEY = ['rate', 'gst', 'gstMode', 'freightMode', 'creditDays'];
// Amounts hidden from roles without money access (paid / not paid status stays visible).
var TRUCK_HIDE = ['frate', 'advance', 'received', 'receivedDate', 'deduction', 'deductionNote', 'detention', 'saleRate', 'plantUTR', 'freightUTR', 'zohoBill', 'zohoInvoice', 'zohoFreight'];
var ME = null;

// [key, header, type]  type: text | date | num | bool
var SCHEMA = {
  APP_PO: [
    ['id', 'PO ID', 'text'], ['date', 'PO Date', 'date'], ['plant', 'Supplier', 'text'],
    ['commodity', 'Commodity', 'text'], ['qty', 'Quantity (qtl)', 'num'], ['rate', 'Rate ex-GST', 'num'],
    ['gst', 'GST', 'num'], ['status', 'Status', 'text'], ['note', 'Note', 'text'],
    ['by', 'Updated By', 'text'], ['at', 'Updated At', 'text'],
    ['firm', 'Firm', 'text'], ['poType', 'PO Type', 'text'], ['linkSO', 'Sells To SO', 'text'], ['takenIn', 'Booked in the name of', 'text']
  ],
  APP_SO: [
    ['id', 'SO ID', 'text'], ['date', 'SO Date', 'date'], ['buyer', 'Customer', 'text'],
    ['commodity', 'Commodity', 'text'], ['qty', 'Quantity (qtl)', 'num'], ['rate', 'Rate ex-GST', 'num'],
    ['gst', 'GST', 'num'], ['status', 'Status', 'text'], ['note', 'Note', 'text'],
    ['by', 'Updated By', 'text'], ['at', 'Updated At', 'text'],
    ['gstMode', 'GST In Rate', 'text'], ['freightMode', 'Freight Terms', 'text'],
    ['creditDays', 'Credit Days', 'num'], ['firm', 'Firm', 'text']
  ],
  APP_TRUCKS: [
    ['id', 'Dispatch No.', 'text'], ['date', 'Dispatch Date', 'date'], ['po', 'PO ID', 'text'],
    ['so', 'SO ID', 'text'], ['truck', 'Vehicle No', 'text'], ['transporter', 'Transporter', 'text'],
    ['driver', 'Driver', 'text'], ['slip', 'RST / Weighment Slip No', 'text'], ['loadWt', 'Dispatch Wt (qtl)', 'num'],
    ['plantPaid', 'Supplier Paid', 'bool'], ['plantPaidDate', 'Supplier Paid Date', 'date'],
    ['unloadDate', 'Unload Date', 'date'], ['unloadWt', 'Received Wt (qtl)', 'num'],
    ['frate', 'Freight Rate', 'num'], ['advance', 'Freight Advance', 'num'],
    ['freightPaid', 'Freight Paid', 'bool'], ['freightPaidDate', 'Freight Paid Date', 'date'],
    ['received', 'Received From Buyer', 'num'], ['receivedDate', 'Received Date', 'date'],
    ['status', 'Status', 'text'], ['note', 'Note', 'text'], ['by', 'Updated By', 'text'],
    ['at', 'Updated At', 'text'], ['zohoBill', 'Zoho Bill ID', 'text'],
    ['zohoInvoice', 'Zoho Invoice ID', 'text'], ['zohoFreight', 'Zoho Freight Bill ID', 'text'],
    ['deduction', 'Deduction (TDS/claim)', 'num'], ['deductionNote', 'Deduction Note', 'text'],
    ['detention', 'Detention (Rs)', 'num'], ['saleRate', 'Invoice Rate (this vehicle)', 'num'],
    ['plantUTR', 'Supplier Payment UTR', 'text'], ['freightUTR', 'Freight Payment UTR', 'text'], ['billNo', 'Supplier Invoice No', 'text'], ['billQty', 'Supplier Invoice Qty', 'num'], ['returnedDate', 'Returned Date', 'text'],
    ['placedOn', 'Vehicle Placed On', 'date'], ['slipPhoto', 'Slip Photo Link', 'text'], ['plantPayPhoto', 'Supplier Payment Screenshot', 'text'], ['freightPayPhoto', 'Freight Payment Screenshot', 'text']
  ],
  APP_LOG: [['time', 'Time', 'text'], ['user', 'User', 'text'], ['action', 'Action', 'text'],
            ['record', 'Record', 'text'], ['details', 'Details', 'text'],
            ['verified', 'Verified', 'bool'], ['verifiedBy', 'Verified By', 'text'], ['verifiedAt', 'Verified At', 'text']],
  APP_SETTINGS: [['key', 'Key', 'text'], ['value', 'Value', 'text'], ['meaning', 'Meaning', 'text']],
  APP_USERS: [['id', 'Username', 'text'], ['name', 'Name', 'text'], ['role', 'Role', 'text'],
              ['salt', 'Salt', 'text'], ['hash', 'Password Hash', 'text'], ['active', 'Active', 'bool'],
              ['by', 'Updated By', 'text'], ['at', 'Updated At', 'text']],
  APP_PAYMENTS: [['id', 'Payment ID', 'text'], ['date', 'Date', 'date'], ['truck', 'Dispatch No.', 'text'], ['so', 'SO ID', 'text'],
                 ['buyer', 'Customer', 'text'], ['amount', 'Amount Received', 'num'], ['deduction', 'Deduction', 'num'],
                 ['note', 'Note', 'text'], ['by', 'Entered By', 'text'], ['at', 'Entered At', 'text']],
  APP_NOTES: [['id', 'Note ID', 'text'], ['date', 'Date', 'date'], ['area', 'Screen', 'text'], ['text', 'Note', 'text'],
              ['status', 'Status', 'text'], ['by', 'Written By', 'text'], ['at', 'Written At', 'text']],
  APP_BANK: [['id', 'Key', 'text'], ['kind', 'Type', 'text'], ['name', 'Party', 'text'], ['accName', 'Account Name', 'text'],
             ['accNo', 'Account Number', 'text'], ['ifsc', 'IFSC', 'text'], ['by', 'Updated By', 'text'], ['at', 'Updated At', 'text']]
};

var SETTINGS_DEFAULT = [
  ['company', 'RAGHAV DDGS', 'Name shown at the top of the app'],
  ['stuckDays', 3, 'A truck is marked stuck after this many days before unloading'],
  ['shortageAllowancePct', 0.002, 'Shortage allowed before deduction, as a fraction of loaded weight (0.002 = 0.2%)'],
  ['defaultGst', 0.05, 'GST for new orders (0.05 = 5%)'],
  ['defaultFreightRate', 85, 'Freight rate per qtl suggested for new trucks'],
  ['defaultCreditDays', 7, 'Days a buyer has to pay after unloading, for new sale orders'],
  ['freeDays', 3, 'Days from loading to unloading before detention starts'],
  ['detentionPerDay', 500, 'Detention paid to the transporter per extra day (Rs)'],
  ['reportEmail', '', 'Daily 9 pm report goes here. Blank = the sheet owner\u2019s Gmail'],
  ['firms', 'RAGHAV TRADING AND COMPANY, SHREE RAM SOLVEX', 'Your firms, separated by commas. Orders with no firm count under the first one'],
  ['plantFirm', 'SHREE RAM SOLVEX', 'Your firm that owns the solvent plant: its POs only receive trucks, no sales'],
  ['tradingFirms', 'RAGHAV TRADING AND COMPANY, DEVAN TRADING AND COMPANY, SARASWATI SOLVEX, JAI MAHAVIR TRADING AND COMPANY', 'Firms an order can be taken in (shown on the PO as Booked in the name of)'],
  ['bankUrl', '', 'Internet banking login. The Open bank button on payment popups goes here'],
  ['slipCheckFrom', '', 'Trucks dispatched on or after this date need a weighment slip photo. Blank = all trucks']
];

/* ---------------- firms ---------------- */
function firms_(S) {
  var list = String((S || readSettings_()).firms || '').split(',').map(function (f) { return normName_(f); }).filter(String);
  return list.length ? list : [''];
}
function isOff_(t) { return t.status === 'Cancelled' || t.status === 'Returned'; }
function sameDayTruck_(obj) {
  var cur = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
  var no = normTruck_('truck' in obj ? obj.truck : cur && cur.truck), date = 'date' in obj ? obj.date : cur && cur.date;
  if (!no || !date || (cur && !('truck' in obj) && !('date' in obj))) return null;
  var key = String(no).replace(/[^A-Z0-9]/g, '');
  return rows_(T.TR).filter(function (t) { return t.id !== obj.id && !isOff_(t) && String(t.truck).replace(/[^A-Z0-9]/g, '') === key && String(t.date) === String(date); })[0] || null;
}
function firmOf_(o, S) { return o && o.firm ? normName_(o.firm) : firms_(S)[0]; }
function isFirm_(name, S) { return !!name && firms_(S).indexOf(normName_(name)) >= 0; }

/* ---------------- web app entry ---------------- */

function doGet(e) {
  var html = typeof INDEX_HTML !== 'undefined' ? INDEX_HTML : HtmlService.createHtmlOutputFromFile('Index').getContent();
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (x) {}
  var safe = function (o) { return JSON.stringify(o).replace(/</g, '\\u003c'); };
  html = html.replace('<head>', '<head><script>var APP_URL=' + safe(url) + ';var INIT=' + safe((e && e.parameter) || {}) + ';</script>');
  return HtmlService.createHtmlOutput(html)
    .setTitle('DDGS Trade Control')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Run once from the editor to create the tabs and import data. Safe to run again: it does nothing if the tabs exist. */
function setup() {
  PropertiesService.getScriptProperties().deleteProperty('schema_v'); // running setup always re-checks the tabs
  var r = ensureSetup_();
  var auto = '';
  try { PropertiesService.getScriptProperties().deleteProperty('triggers_v4'); ensureTriggers_(); auto = ' | Daily 9 pm report and Sunday backup are switched on.'; }
  catch (e) { auto = ' | Could not switch on the daily report: ' + e.message; }
  Logger.log(JSON.stringify(r || 'Already set up') + auto + (users_().length ? '' : ' | Now open the app link to create your owner login.'));
}

/** Run from the editor to get today's report by email right now (to check it works). */
function testDailyReport() {
  ensureSetup_();
  dailyReport({ triggerUid: 'manual-test' });
  Logger.log('Report sent to ' + (readSettings_().reportEmail || Session.getEffectiveUser().getEmail()));
}

/* ---------------- API called by the page ---------------- */

/** Before login: is the app set up, and is there an owner yet? */
function api_authState() {
  var report = ensureSetup_();
  var set = readSettings_();
  return { needsOwner: users_().length === 0, isOwnerGoogle: isOwnerGoogle_(), company: set.company || '', importReport: report };
}

/** First account. Allowed only when no users exist and the person opening the app is the sheet owner's Google account. */
function api_createOwner(username, name, password) {
  return lockRun_(function () {
    if (users_().length) throw new Error('An owner already exists. Please log in.');
    if (!isOwnerGoogle_()) throw new Error('Only the Google account that owns this sheet can create the first login.');
    createUser_({ id: username, name: name, role: 'Owner', password: password, active: true }, true);
    return startSession_(cleanUser_(username));
  });
}

function api_login(username, password) {
  var u = cleanUser_(username), cache = CacheService.getScriptCache(), key = 'fail_' + u;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('Too many wrong passwords. Try again in 10 minutes.');
  var rec = users_().filter(function (x) { return x.id === u && x.active; })[0];
  if (!rec || hash_(rec.salt, String(password || '')) !== rec.hash) {
    cache.put(key, String(fails + 1), 600);
    throw new Error('Wrong username or password.');
  }
  cache.remove(key);
  return startSession_(u);
}

function api_logout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('s_' + token);
  return true;
}

function api_changePassword(token, oldPw, newPw) {
  auth_(token);
  return lockRun_(function () {
    var rec = users_().filter(function (x) { return x.id === ME.id; })[0];
    if (hash_(rec.salt, String(oldPw || '')) !== rec.hash) throw new Error('Current password is wrong.');
    createUser_({ id: ME.id, password: newPw }, false);
    return true;
  });
}

function api_saveUser(token, obj) {
  auth_(token); need_('users');
  return withLock_(function () {
    obj = obj || {};
    var id = cleanUser_(obj.id);
    var exists = users_().some(function (x) { return x.id === id; });
    if (obj._new && exists) throw new Error('Username ' + id + ' is already taken. Choose another.');
    if (!obj._new && !exists) throw new Error('User ' + id + ' was not found.');
    if (id === ME.id && (obj.active === false || (obj.role && obj.role !== 'Owner'))) throw new Error('You cannot remove your own Owner access.');
    createUser_(obj, !!obj._new);
  });
}

function api_getData(token) {
  auth_(token);
  ensureSetup_();
  if (ME.role === 'Owner') ensureTriggers_();
  return readAll_();
}

function api_saveTruck(token, obj) {
  auth_(token); need_('trucks');
  obj = obj || {};
  if (!ME.can.truckMoney) {
    // Dispatch may enter the freight rate together with the weight (it is required then). Other money fields stay hidden.
    var keepRate = num_(obj.loadWt) > 0;
    TRUCK_MONEY.forEach(function (k) { if (!(keepRate && k === 'frate')) delete obj[k]; });
  }
  var force = obj._force === true && ME.role === 'Owner';
  delete obj._force;
  return withLock_(function () {
    [['po', T.PO], ['so', T.SO]].forEach(function (k) {
      if (!(k[0] in obj) || !obj[k[0]]) return;
      var cur = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
      if (cur && cur[k[0]] === obj[k[0]]) return;
      var o = rows_(k[1]).filter(function (r) { return r.id === obj[k[0]]; })[0];
      if (o && o.status === 'Settled') throw new Error(o.id + ' is marked Short-closed. Undo short-close on it first to add more trucks.');
    });
    if (!obj.id) checkNewTruck_(obj);
    var dup = sameDayTruck_(obj);
    if (dup && !force) throw new Error('Vehicle ' + dup.truck + ' is already entered on ' + dup.date + ' as ' + dup.id + '. A vehicle cannot be entered twice on the same day.' + (ME.role === 'Owner' ? '' : ' Ask the Owner if this is a real second trip.'));
    linkTruckOrders_(obj);
    if (obj.id) checkTruckRules_(obj);
    return saveRecord_(T.TR, obj);
  });
}

/** Closed trucks and old payments can only be changed by the Owner. */
/** Plant POs (own solvent plant) never have a sale order; a trading PO linked to a sale order fills it in automatically. */
function linkTruckOrders_(obj) {
  var cur = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
  var poId = 'po' in obj ? obj.po : cur && cur.po;
  var po = rows_(T.PO).filter(function (r) { return r.id === poId; })[0];
  if (!po) return;
  var so = 'so' in obj ? obj.so : cur ? cur.so : '';
  if (po.poType === 'plant') {
    if (so && 'so' in obj && obj.so) throw new Error(po.id + ' is for your own plant (' + firmOf_(po) + '). It has no customer or sale order.');
    if (so) obj.so = '';
  } else if (!so && po.linkSO) {
    var link = rows_(T.SO).filter(function (r) { return r.id === po.linkSO && r.status !== 'Cancelled' && r.status !== 'Settled'; })[0];
    if (link) obj.so = link.id;
  }
}
function checkTruckRules_(obj) {
  var t = rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0];
  if (!t) return;
  var get = function (k) { return (k in obj) ? obj[k] : t[k]; };
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (!ME.can.editClosed) {
    var po = rows_(T.PO).filter(function (r) { return r.id === t.po; })[0];
    var so = rows_(T.SO).filter(function (r) { return r.id === t.so; })[0];
    var d = derive_(t, po, so, readSettings_(), today);
    if (d.st === 6) throw new Error(t.id + ' is closed. Only the Owner can change it.');
    if (obj.plantPaid === false && t.plantPaid && t.plantPaidDate !== today) throw new Error('Only the Owner can undo a supplier payment from an earlier day.');
    if (obj.freightPaid === false && t.freightPaid && t.freightPaidDate !== today) throw new Error('Only the Owner can undo a freight payment from an earlier day.');
    if ('received' in obj || 'deduction' in obj) throw new Error('Only the Owner can correct customer payments. Use + Payment to add money received.');
  }
  requireWeight_(obj, t);
  checkPayment_(obj, t);
  if (get('plantPaid') === true && !(num_(get('loadWt')) > 0)) throw new Error('Enter the dispatch weight before marking the supplier paid.');
  var tpo = rows_(T.PO).filter(function (r) { return r.id === get('po'); })[0];
  if (num_(get('unloadWt')) > 0 && !get('so') && !(tpo && tpo.poType === 'plant')) throw new Error('Choose the customer (sale order) before recording unloading.');
}

/* Once a weight is entered, the transporter and the freight rate are required (checked on the values after this save). */
function requireWeight_(obj, cur) {
  if (!('loadWt' in obj) && !('transporter' in obj) && !('frate' in obj)) return;
  var get = function (k) { return (k in obj) ? obj[k] : cur[k]; };
  if (!(num_(get('loadWt')) > 0)) return;
  if (!String(get('transporter') || '').trim()) throw new Error('Enter the transporter. It is required once the weight is entered.');
  if (!(num_(get('frate')) > 0)) throw new Error('Enter the freight rate per qtl. It is required once the weight is entered.');
}
/* Paying the supplier or the freight needs the bank UTR, every time (not only for a single truck). */
function checkPayment_(obj, t) {
  if (obj.plantPaid === true && t.plantPaid !== true && !(obj.plantUTR || t.plantUTR)) throw new Error('Enter the UTR of the payment to the supplier.');
  if (obj.freightPaid === true && t.freightPaid !== true && !(obj.freightUTR || t.freightUTR)) throw new Error('Enter the UTR of the freight payment.');
}
function checkNewTruck_(obj) {
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (!obj.placedOn) obj.placedOn = today;
  if (!obj.date) {
    if (num_(obj.loadWt) > 0) throw new Error('Enter the date the truck left the plant, from the slip.');
    obj.date = obj.placedOn;
  }
  requireWeight_(obj, {});
  if (obj.plantPaid === true && !(num_(obj.loadWt) > 0)) throw new Error('Enter the dispatch weight before marking the supplier paid.');
  checkPayment_(obj, {});
}

/** Adds a buyer payment (and any TDS/claim deduction) on the server, so two people entering at once never lose an amount. */
function api_addPayment(token, id, amount, date, deduction, note) {
  auth_(token); need_('truckMoney');
  return withLock_(function () {
    var t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
    if (!t) throw new Error('Truck ' + id + ' was not found.');
    var a = num_(amount) || 0, d = num_(deduction) || 0;
    if (a < 0 || d < 0) throw new Error('Amounts must be 0 or more.');
    if (!a && !d) throw new Error('Enter an amount received or a deduction.');
    var upd = { id: id, received: Math.round(((num_(t.received) || 0) + a) * 100) / 100 };
    if (a) upd.receivedDate = date || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
    if (d) {
      upd.deduction = Math.round(((num_(t.deduction) || 0) + d) * 100) / 100;
      upd.deductionNote = (t.deductionNote ? t.deductionNote + ' | ' : '') + (note || 'Deduction') + ' ' + d;
    }
    saveRecord_(T.TR, upd);
    var so = rows_(T.SO).filter(function (r) { return r.id === t.so; })[0];
    var pay = sheet_(T.PAY) || makeTab_(T.PAY);
    pay.getRange(pay.getLastRow() + 1, 1, 1, SCHEMA[T.PAY].length).setValues([rowFor_(T.PAY, {
      id: nextId_(T.PAY, rows_(T.PAY), {}), date: upd.receivedDate || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'),
      truck: id, so: t.so, buyer: so ? so.buyer : '', amount: a || '', deduction: d || '', note: d ? (note || 'Deduction') : ''
    })]);
  });
}

function api_savePO(token, obj) {
  auth_(token); need_('orders');
  return withLock_(function () {
    checkOrderFirm_(T.PO, obj);
    var id = saveRecord_(T.PO, obj);
    var po = rows_(T.PO).filter(function (r) { return r.id === id; })[0];
    if (po && po.linkSO && po.poType !== 'plant' && 'linkSO' in obj) {
      rows_(T.TR).filter(function (t) { return t.po === po.id && !t.so && !isOff_(t); }).forEach(function (t) { saveRecord_(T.TR, { id: t.id, so: po.linkSO }); });
    }
  });
}
function api_saveSO(token, obj) { auth_(token); need_('orders'); return withLock_(function () { checkOrderFirm_(T.SO, obj); return saveRecord_(T.SO, obj); }); }
function checkOrderFirm_(name, obj) {
  var S = readSettings_(), cur = obj.id ? rows_(name).filter(function (r) { return r.id === obj.id; })[0] : null;
  var get = function (k) { return (k in obj) ? obj[k] : cur ? cur[k] : ''; };
  if ('firm' in obj) {
    obj.firm = normName_(obj.firm);
    if (obj.firm && !isFirm_(obj.firm, S)) throw new Error('Unknown firm "' + obj.firm + '". Your firms are: ' + firms_(S).join(', ') + '.');
  }
  var firm = get('firm') ? normName_(get('firm')) : firms_(S)[0];
  if (name === T.PO && 'takenIn' in obj && obj.takenIn) {
    obj.takenIn = normName_(obj.takenIn);
    var tf = String(S.tradingFirms || '').split(',').map(function (f) { return normName_(f); }).filter(String);
    if (tf.length && tf.indexOf(obj.takenIn) < 0) throw new Error('Unknown firm "' + obj.takenIn + '" in Booked in the name of.');
  }
  if (name === T.PO) {
    if ('poType' in obj && obj.poType && ['trade', 'plant'].indexOf(obj.poType) < 0) throw new Error('Unknown PO type.');
    if (get('poType') === 'plant') { if (get('linkSO')) obj.linkSO = ''; return; }
    var link = get('linkSO');
    if (link) {
      var so = rows_(T.SO).filter(function (r) { return r.id === link; })[0];
      if (!so || so.status === 'Cancelled') throw new Error('Sale order ' + link + ' not found.');
      if (firmOf_(so, S) !== firm) throw new Error(link + ' belongs to ' + firmOf_(so, S) + ', but this PO is in ' + firm + '. Use a sale order of the same firm.');
    }
  } else {
    if (normName_(get('buyer')) === firm) throw new Error('A firm cannot sell to itself. Check the firm and the customer.');
  }
}

/** Cancel instead of delete, so nothing is ever lost. */
function api_cancel(token, table, id, reason) {
  auth_(token); need_(table === 'truck' ? 'cancelTruck' : 'orders');
  return withLock_(function () {
    var name = { truck: T.TR, po: T.PO, so: T.SO }[table];
    if (!name) throw new Error('Unknown record type');
    if (table !== 'truck') {
      var key = table === 'po' ? 'po' : 'so';
      var n = rows_(T.TR).filter(function (t) { return t[key] === id && !isOff_(t); }).length;
      if (n) throw new Error(id + ' still has ' + n + ' active truck' + (n > 1 ? 's' : '') + '. Move or cancel them first.');
      if (table === 'so') {
        var lp = rows_(T.PO).filter(function (p) { return p.linkSO === id && p.status !== 'Cancelled'; })[0];
        if (lp) throw new Error(lp.id + ' is set to sell to ' + id + '. Change that PO first.');
      }
    }
    var old = rows_(name).filter(function (r) { return r.id === id; })[0];
    var note = (old && old.note ? old.note + ' | ' : '') + 'Cancelled' + (reason ? ': ' + reason : '');
    return saveRecord_(name, { id: id, status: 'Cancelled', note: note });
  });
}

/** Mark a PO or SO settled (done, small over/under accepted) or undo it. */
function api_settle(token, table, id, on) {
  auth_(token); need_('orders');
  var name = { po: T.PO, so: T.SO }[table];
  if (!name) throw new Error('Unknown order type.');
  return withLock_(function () {
    var o = rows_(name).filter(function (r) { return r.id === id; })[0];
    if (!o) throw new Error(id + ' not found.');
    if (o.status === 'Cancelled') throw new Error(id + ' is cancelled.');
    return saveRecord_(name, { id: id, status: on ? 'Settled' : '' });
  });
}

/** A truck that reached the plant but went back without loading. Kept on record, stops counting against the PO. */
function api_returned(token, id, reason) {
  auth_(token); need_('trucks');
  return withLock_(function () {
    var t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
    if (!t) throw new Error('Truck ' + id + ' not found.');
    if (num_(t.loadWt) > 0) throw new Error('This truck already has a loaded weight. Use Cancel instead.');
    if (isOff_(t)) throw new Error('This truck is already ' + t.status.toLowerCase() + '.');
    var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
    return saveRecord_(T.TR, { id: id, status: 'Returned', returnedDate: today, note: (t.note ? t.note + ' | ' : '') + 'Returned, not loaded' + (reason ? ': ' + reason : '') });
  });
}

/** Design notes: anyone logged in can write what would make the screens easier; the Owner marks them done. */
function api_addNote(token, area, text) {
  auth_(token);
  text = String(text || '').trim();
  if (!text) throw new Error('Write the note first.');
  if (text.length > 2000) throw new Error('Keep the note under 2000 letters.');
  return withLock_(function () {
    var sh = sheet_(T.NOTE) || makeTab_(T.NOTE);
    var n = Math.max(0, sh.getLastRow() - 1) + 1;
    var id = 'NOTE-' + ('000' + n).slice(-4);
    var now = new Date();
    sh.getRange(sh.getLastRow() + 1, 1, 1, 7).setValues([[id, Utilities.formatDate(now, tz_(), 'yyyy-MM-dd'), String(area || 'Other'), text, 'Open', ME.name || ME.id, Utilities.formatDate(now, tz_(), 'yyyy-MM-dd HH:mm')]]);
    log_('Design note', id, text.slice(0, 80));
  });
}
function api_noteStatus(token, id, status) {
  auth_(token);
  if (ME.role !== 'Owner') throw new Error('Only the Owner can mark notes done.');
  if (['Open', 'Done'].indexOf(status) < 0) throw new Error('Unknown status.');
  return withLock_(function () {
    var r = rows_(T.NOTE).filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('Note ' + id + ' not found.');
    sheet_(T.NOTE).getRange(r._row, idx_(T.NOTE, 'status') + 1).setValue(status);
  });
}

/** One bank payment for several trucks: marks each paid with the same date and UTR. */
function api_payBatch(token, kind, ids, date, utr, amount) {
  auth_(token); need_('truckMoney');
  if (kind !== 'plant' && kind !== 'freight') throw new Error('Unknown payment type.');
  ids = (ids || []).filter(String);
  if (!ids.length) throw new Error('Tick at least one truck.');
  utr = String(utr || '').trim().toUpperCase();
  if (!utr) throw new Error('Enter the UTR / bank reference.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('Enter the payment date.');
  return withLock_(function () {
    var A = deriveAll_(), map = {};
    A.trucks.forEach(function (t) { map[t.id] = t; });
    ids.forEach(function (id) {
      var t = map[id];
      if (!t || t.cx) throw new Error('Truck ' + id + ' not found or cancelled.');
      if (kind === 'plant' && !(t.L > 0)) throw new Error(t.truck + ' has no loaded weight yet.');
      if (kind === 'plant' && t.plantPaid) throw new Error(t.truck + ' is already marked supplier paid.');
      if (kind === 'freight' && !(t.U > 0)) throw new Error(t.truck + ' is not unloaded yet.');
      if (kind === 'freight' && (t.freightPaid || t.fBuyer)) throw new Error(t.truck + ' freight is already paid or paid by the customer.');
    });
    ids.forEach(function (id) {
      var t = map[id];
      if (kind === 'plant') saveRecord_(T.TR, { id: id, plantPaid: true, plantPaidDate: date, plantUTR: utr });
      else saveRecord_(T.TR, { id: id, freightPaid: true, freightPaidDate: date, freightUTR: utr, detention: t.det });
    });
    log_(kind === 'plant' ? 'Plant payment' : 'Freight payment', utr, ids.length + ' trucks: ' + ids.join(', ') + ' | amount entered ' + (amount === '' || amount == null ? '-' : amount));
  });
}

function api_restore(token, table, id) {
  auth_(token);
  var ret = table === 'truck' && rows_(T.TR).some(function (r) { return r.id === id && r.status === 'Returned'; });
  need_(table === 'truck' ? (ret ? 'trucks' : 'cancelTruck') : 'orders');
  return withLock_(function () {
    var name = { truck: T.TR, po: T.PO, so: T.SO }[table];
    if (ret) { var dup = sameDayTruck_({ id: id, truck: rows_(T.TR).filter(function (r) { return r.id === id; })[0].truck }); if (dup && ME.role !== 'Owner') throw new Error('This truck is already entered again that day as ' + dup.id + '. Only the Owner can undo this.'); return saveRecord_(name, { id: id, status: '', returnedDate: '' }); }
    return saveRecord_(name, { id: id, status: '' });
  });
}

/* ---------------- activity review (Owner only) ---------------- */
var REVIEW_DATE_FIELDS_ = ['Dispatch Date', 'Supplier Paid Date', 'Unload Date', 'Freight Paid Date', 'Received Date', 'Returned Date'];
var REVIEW_WEIGHT_RATE_ = ['Dispatch Wt (qtl)', 'Received Wt (qtl)', 'Freight Rate', 'Invoice Rate (this vehicle)'];
var REVIEW_LATE_FROM_ = 21; // an entry at or after 21:00 ...
var REVIEW_LATE_TO_ = 6;    // ... or before 06:00 is late-night
var REVIEW_MANY_ = 5;       // this many changes to one truck on one day is flagged

/* "Field: old -> new; Field: old -> new" (as written by saveRecord_) back into parts. */
function parseChanges_(s) {
  var out = [];
  String(s || '').split('; ').forEach(function (part) {
    var i = part.indexOf(': ');
    if (i < 0) return;
    var rest = part.slice(i + 2), j = rest.indexOf(' -> ');
    if (j < 0) return;
    out.push({ f: part.slice(0, i), o: rest.slice(0, j), n: rest.slice(j + 4) });
  });
  return out;
}
function paidBy_(flag, d, date) { return flag === true && !!d && String(d) <= date; }
/* Deterministic pick: the same day always gives the same spot-check entries. */
function seededPick_(list, k, seed) {
  var h = 2166136261;
  for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  var a = h >>> 0;
  var rnd = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  var copy = list.slice();
  for (var j = copy.length - 1; j > 0; j--) { var r = Math.floor(rnd() * (j + 1)); var tmp = copy[j]; copy[j] = copy[r]; copy[r] = tmp; }
  return copy.slice(0, k);
}

function api_getReview(token, date, person) {
  auth_(token); need_('review');
  date = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a date.');
  person = cleanUser_(person);
  var all = rows_(T.LOG).filter(function (r) { return String(r.time).length >= 16; });
  var creator = {}, trucks = {};
  all.forEach(function (r) { if (r.action === 'Created' && !creator[r.record]) creator[r.record] = r.user; });
  rows_(T.TR).forEach(function (t) { trucks[t.id] = t; });
  var day = all.filter(function (r) { return r.time.slice(0, 10) === date && r.action !== 'Login'; });
  var perTruck = {};
  day.forEach(function (r) { if (r.action === 'Updated') perTruck[r.record] = (perTruck[r.record] || 0) + 1; });
  var entries = day.map(function (r) {
    var hh = Number(r.time.slice(11, 13)), changes = r.action === 'Updated' ? parseChanges_(r.details) : [], flags = [];
    var t = trucks[r.record];
    if (hh >= REVIEW_LATE_FROM_ || hh < REVIEW_LATE_TO_) flags.push('Late-night entry');
    changes.forEach(function (c) {
      if (c.f === 'Status' && (c.n === 'Cancelled' || c.n === 'Returned')) flags.push(c.n === 'Cancelled' ? 'Cancelled' : 'Returned empty');
      if (REVIEW_DATE_FIELDS_.indexOf(c.f) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.n) && days_(c.n, date) > 1) flags.push('Backdated: ' + c.f + ' set to ' + c.n);
      if (REVIEW_WEIGHT_RATE_.indexOf(c.f) >= 0 && t && (paidBy_(t.plantPaid, t.plantPaidDate, date) || paidBy_(t.freightPaid, t.freightPaidDate, date) || (Number(t.received) > 0 && t.receivedDate && String(t.receivedDate) <= date))) flags.push('Weight or rate changed after payment (' + c.f + ')');
    });
    if (r.action === 'Updated' && perTruck[r.record] >= REVIEW_MANY_ && r.record.indexOf('DISP-') === 0) flags.push(perTruck[r.record] + ' changes to this truck today');
    return { row: r._row, time: r.time, user: r.user, action: r.action, record: r.record, details: r.details, changes: changes, flags: flags,
      verified: r.verified === true, verifiedBy: r.verifiedBy || '', verifiedAt: r.verifiedAt || '',
      view: r.record.indexOf('DISP-') === 0 ? 'truck' : r.record.indexOf('PO-') === 0 ? 'po' : r.record.indexOf('SO-') === 0 ? 'so' : '' };
  });
  var people = {}, order = [];
  entries.forEach(function (e) {
    if (!people[e.user]) { people[e.user] = { name: e.user, entries: 0, corrections: 0, unverified: 0, flagged: 0 }; order.push(e.user); }
    var p = people[e.user];
    p.entries++;
    if (e.action === 'Updated' && creator[e.record] && creator[e.record] !== e.user) p.corrections++;
    if (!e.verified) p.unverified++;
    if (e.flags.length) p.flagged++;
  });
  var pool = entries.filter(function (e) { return e.action === 'Created' || e.action === 'Updated'; });
  return {
    date: date, person: person, total: entries.length,
    unverified: entries.filter(function (e) { return !e.verified; }).length,
    flagged: entries.filter(function (e) { return e.flags.length > 0; }).length,
    people: order.map(function (u) { return people[u]; }),
    entries: person ? entries.filter(function (e) { return e.user === person; }) : entries,
    spot: seededPick_(pool, 5, date)
  };
}

/* Ticks entries as checked. Each line is matched by time, user and record first, so a moved log line is never ticked by mistake. */
function api_verifyEntries(token, items, on) {
  auth_(token); need_('review');
  if (!items || !items.length) throw new Error('Nothing to verify.');
  return withLock_(function () {
    var sh = sheet_(T.LOG);
    if (!sh) throw new Error('The activity log is missing.');
    var rowsToSet = items.map(function (it) {
      var row = Number(it.row);
      if (!(row > 1) || row > sh.getLastRow()) throw new Error('That log line was not found. Reload the page and try again.');
      var v = sh.getRange(row, 1, 1, 4).getValues()[0];
      var time = v[0] instanceof Date ? Utilities.formatDate(v[0], tz_(), 'yyyy-MM-dd HH:mm') : String(v[0]);
      if (time !== String(it.time) || String(v[1]) !== String(it.user) || String(v[3]) !== String(it.record)) throw new Error('The log changed while you were reviewing. Reload the page and try again.');
      return row;
    });
    var c = idx_(T.LOG, 'verified') + 1;
    rowsToSet.forEach(function (row) {
      sh.getRange(row, c, 1, 3).setValues([[on === true, on === true ? ME.id : '', on === true ? nowStr_() : '']]);
    });
  });
}

/* ---------------- bank details for paying suppliers and transporters ---------------- */
function api_saveBank(token, kind, name, accName, accNo, ifsc) {
  auth_(token); need_('bank');
  if (kind !== 'supplier' && kind !== 'transporter') throw new Error('Unknown bank type.');
  var key = normName_(name);
  if (!key) throw new Error('The name is missing.');
  accName = String(accName || '').trim();
  accNo = String(accNo || '').replace(/\s+/g, '');
  ifsc = String(ifsc || '').replace(/\s+/g, '').toUpperCase();
  if (!accName) throw new Error('Enter the account name.');
  if (!/^\d{6,20}$/.test(accNo)) throw new Error('The account number should be 6 to 20 digits.');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error('The IFSC looks wrong. It has 11 characters, like SBIN0001234.');
  return withLock_(function () {
    var sh = sheet_(T.BANK) || makeTab_(T.BANK), id = kind + ': ' + key;
    sh.getRange(2, idx_(T.BANK, 'accNo') + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    var cur = rows_(T.BANK).filter(function (r) { return r.id === id; })[0];
    var row = rowFor_(T.BANK, { id: id, kind: kind, name: key, accName: accName, accNo: accNo, ifsc: ifsc });
    if (cur) sh.getRange(cur._row, 1, 1, row.length).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    log_(cur ? 'Bank updated' : 'Bank added', key, kind === 'supplier' ? 'Supplier bank details' : 'Transporter bank details');
  });
}

/* ---------------- photos: weighment slip and payment screenshots, kept in Drive under the dispatch number ---------------- */
function api_savePhoto(token, id, kind, b64, mime) {
  auth_(token);
  var col = { slip: 'slipPhoto', plantPay: 'plantPayPhoto', freightPay: 'freightPayPhoto' }[kind];
  if (!col) throw new Error('Unknown photo type.');
  need_(kind === 'slip' ? 'trucks' : 'truckMoney');
  b64 = String(b64 || '');
  if (!b64 || b64.length > 3000000) throw new Error('The photo is too large. Take it again, or use a smaller picture.');
  return withLock_(function () {
    var t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
    if (!t) throw new Error('Truck ' + id + ' was not found.');
    var root = folder_('DDGS Slips'), it = root.getFoldersByName(id), sub = it.hasNext() ? it.next() : root.createFolder(id);
    var label = { slip: 'weighment-slip', plantPay: 'supplier-payment', freightPay: 'freight-payment' }[kind];
    var name = label + '_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss') + '.jpg';
    var file = sub.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime || 'image/jpeg', name));
    var upd = { id: id };
    upd[col] = file.getUrl();
    saveRecord_(T.TR, upd);
  });
}

/* ---------------- logins ---------------- */

function cleanUser_(u) { return String(u || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, ''); }

function users_() { return sheet_(T.US) ? rows_(T.US) : []; }

function isOwnerGoogle_() {
  try {
    var a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
    return !!a && a === e;
  } catch (x) { return false; }
}

function hash_(salt, pw) {
  var s = salt + '|' + pw;
  for (var i = 0; i < 200; i++) {
    s = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s + salt)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  return s;
}

function createUser_(obj, isNew) {
  var id = cleanUser_(obj.id);
  if (!id || id.length < 3) throw new Error('Username must be at least 3 letters or numbers.');
  var rec = { id: id };
  if (isNew || 'name' in obj) rec.name = String(obj.name || '').trim();
  if (isNew && !rec.name) throw new Error('Enter the person’s name.');
  if (isNew || obj.role) {
    if (!ROLES[obj.role]) throw new Error('Choose a role.');
    rec.role = obj.role;
  }
  if ('active' in obj || isNew) rec.active = obj.active !== false;
  if (isNew || obj.password) {
    if (String(obj.password || '').length < 6) throw new Error('Password must be at least 6 characters.');
    rec.salt = Utilities.getUuid();
    rec.hash = hash_(rec.salt, String(obj.password));
  }
  var sh = sheet_(T.US) || makeTab_(T.US);
  var cols = SCHEMA[T.US], existing = users_().filter(function (x) { return x.id === id; })[0];
  if (isNew && existing) throw new Error('Username ' + id + ' is already taken.');
  if (!isNew && !existing) throw new Error('User ' + id + ' was not found.');
  var base = existing || {};
  var row = cols.map(function (c) { var k = c[0]; return toCell_(k in rec ? rec[k] : base[k], c[2]); });
  row[idx_(T.US, 'by')] = user_();
  row[idx_(T.US, 'at')] = nowStr_();
  if (existing) sh.getRange(existing._row, 1, 1, cols.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setValues([row]);
  log_(isNew ? 'User created' : 'User updated', id, (rec.role ? 'Role ' + rec.role : '') + (rec.hash ? ' (password set)' : '') + ('active' in rec ? ' active=' + rec.active : ''));
}

function startSession_(u) {
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('s_') === 0) { try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } }
  });
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('s_' + token, JSON.stringify({ u: u, exp: now + 30 * 864e5 }));
  ME = { id: u };
  log_('Login', u, '');
  return { token: token };
}

function auth_(token) {
  var raw = token ? PropertiesService.getScriptProperties().getProperty('s_' + token) : null;
  if (!raw) throw new Error('LOGIN');
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('s_' + token); throw new Error('LOGIN'); }
  var u = users_().filter(function (x) { return x.id === s.u && x.active; })[0];
  if (!u) throw new Error('LOGIN');
  ME = { id: u.id, name: u.name, role: u.role, can: ROLES[u.role] || ROLES.Viewer };
  return ME;
}

function need_(perm) {
  if (!ME || !ME.can[perm]) throw new Error('Your role (' + (ME ? ME.role : 'none') + ') is not allowed to do this.');
}

function lockRun_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- core ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }
function user_() {
  if (ME && ME.id) return ME.id;
  try { return Session.getActiveUser().getEmail() || 'unknown'; } catch (e) { return 'unknown'; }
}
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    fn();
    return readAll_();
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name) { return ss_().getSheetByName(name); }

function makeTab_(name) {
  var sh = sheet_(name) || ss_().insertSheet(name);
  var heads = SCHEMA[name].map(function (c) { return c[1]; });
  sh.getRange(1, 1, 1, heads.length).setValues([heads])
    .setFontWeight('bold').setBackground('#0f6b5c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function rows_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  var cols = SCHEMA[name], tz = tz_(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    var o = { _row: i + 1 };
    for (var c = 0; c < cols.length; c++) {
      var x = v[i][c], type = cols[c][2];
      if (x === undefined || x === null) x = '';
      if (type === 'date') x = x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x);
      else if (type === 'num') x = x === '' ? '' : num_(x);
      else if (type === 'bool') x = x === true || String(x).toUpperCase() === 'TRUE';
      else x = x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm') : String(x);
      o[cols[c][0]] = x;
    }
    out.push(o);
  }
  return out;
}

function readSettings_() {
  var set = {};
  if (sheet_(T.SET)) rows_(T.SET).forEach(function (r) { set[r.key] = isNaN(Number(r.value)) || r.value === '' ? r.value : Number(r.value); });
  return set;
}

function readAll_() {
  var can = ME && ME.can ? ME.can : ROLES.Viewer;
  var strip = function (list, keys) { list.forEach(function (r) { keys.forEach(function (k) { delete r[k]; }); }); return list; };
  var po = rows_(T.PO), so = rows_(T.SO), trucks = rows_(T.TR), S = readSettings_();
  if (!can.money) {
    // Staff without money access still need the correct stage, so work it out here before the amounts are removed.
    var pm = {}, sm = {}, today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
    po.forEach(function (r) { pm[r.id] = r; }); so.forEach(function (r) { sm[r.id] = r; });
    trucks.forEach(function (t) { t._st = derive_(t, pm[t.po], sm[t.so], S, today).st; });
    strip(po, ORDER_MONEY); strip(so, ORDER_MONEY); strip(trucks, TRUCK_HIDE);
  }
  var out = {
    po: po, so: so, trucks: trucks, settings: S,
    me: ME ? { id: ME.id, name: ME.name, role: ME.role } : null, perm: can,
    today: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'), syncedAt: nowStr_()
  };
  out.notes = sheet_(T.NOTE) ? rows_(T.NOTE).reverse() : [];
  if (can.bank) out.banks = sheet_(T.BANK) ? rows_(T.BANK) : [];
  if (can.users) out.users = users_().map(function (u) { return { id: u.id, name: u.name, role: u.role, active: u.active, at: u.at }; });
  return out;
}

function toCell_(x, type) {
  if (x === undefined || x === null || x === '') return type === 'bool' ? false : '';
  if (type === 'num') { var n = num_(x); return n === '' ? '' : n; }
  if (type === 'bool') return x === true || String(x).toUpperCase() === 'TRUE';
  if (type === 'date') { var d = parseDate_(x); return d || ''; }
  return String(x).trim();
}

function saveRecord_(name, obj) {
  var sh = sheet_(name);
  if (!sh) throw new Error('Tab ' + name + ' is missing. Run setup.');
  var cols = SCHEMA[name], existing = rows_(name), rec = null;
  obj = obj || {};
  if (obj.id) existing.forEach(function (r) { if (r.id === obj.id) rec = r; });
  var isNew = !rec;

  if (isNew) {
    if (obj.id) throw new Error('Record ' + obj.id + ' was not found. Refresh and try again.');
    rec = {};
    obj.id = nextId_(name, existing, obj);
  }
  validate_(name, obj, rec, isNew);

  var changes = [];
  var row = cols.map(function (c) {
    var k = c[0];
    var val = (k in obj) ? toCell_(obj[k], c[2]) : toCell_(rec[k], c[2]);
    if ((k in obj) && k !== 'by' && k !== 'at' && String(toCell_(rec[k], c[2])) !== String(val)) {
      changes.push(c[1] + ': ' + fmtLog_(rec[k]) + ' -> ' + fmtLog_(obj[k]));
    }
    return val;
  });
  row[idx_(name, 'by')] = user_();
  row[idx_(name, 'at')] = nowStr_();

  if (isNew) sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setValues([row]);
  else sh.getRange(rec._row, 1, 1, cols.length).setValues([row]);

  log_(isNew ? 'Created' : 'Updated', obj.id, isNew ? 'New record' : changes.join('; '));
  return obj.id;
}

function fmtLog_(v) { return v === undefined || v === null || v === '' ? '(blank)' : String(v); }
function idx_(name, key) {
  var cols = SCHEMA[name];
  for (var i = 0; i < cols.length; i++) if (cols[i][0] === key) return i;
  return -1;
}

function validate_(name, obj, rec, isNew) {
  var get = function (k) { return (k in obj) ? obj[k] : rec[k]; };
  ['transporter', 'plant', 'buyer'].forEach(function (k) { if (k in obj) obj[k] = normName_(obj[k]); });
  if (name === T.TR) {
    if (!String(get('truck') || '').trim()) throw new Error('Vehicle number is required.');
    if (!get('po')) throw new Error('Choose a purchase order (PO) for this truck.');
    if ('truck' in obj) obj.truck = normTruck_(obj.truck);
    var placedOn = get('placedOn'), dispatchDate = get('date');
    if (placedOn && dispatchDate && String(dispatchDate) < String(placedOn)) throw new Error('The date out cannot be before the date the vehicle was placed.');
    ['loadWt', 'unloadWt', 'billQty', 'frate', 'advance', 'received', 'deduction', 'detention'].forEach(function (k) {
      if (k in obj && obj[k] !== '' && obj[k] !== null && (isNaN(num_(obj[k])) || num_(obj[k]) < 0)) {
        throw new Error('Enter a number of 0 or more.');
      }
    });
    ['loadWt', 'unloadWt', 'billQty'].forEach(function (k) {
      if (k in obj && num_(obj[k]) > 1000) throw new Error('Weight ' + obj[k] + ' looks like kg. Enter it in quintal (e.g. 384.50).');
    });
    var lw = num_(get('loadWt')), uw = num_(get('unloadWt'));
    if (uw !== '' && lw !== '' && uw > lw * 1.05) throw new Error('Received weight is more than 5% above dispatch weight. Check the numbers.');
  }
  if (name === T.PO && isNew) {
    if (!String(obj.plant || '').trim()) throw new Error('Supplier name is required.');
    if (!(num_(obj.qty) > 0) || !(num_(obj.rate) > 0)) throw new Error('Enter quantity and rate.');
  }
  if (name === T.SO && isNew) {
    if (!String(obj.buyer || '').trim()) throw new Error('Customer name is required.');
    if (!(num_(obj.qty) > 0) || !(num_(obj.rate) > 0)) throw new Error('Enter quantity and rate.');
    if (!obj.gstMode) throw new Error('Choose whether the rate includes GST.');
    if (!obj.freightMode) throw new Error('Choose whether the rate includes freight.');
  }
  if (name === T.SO) {
    if ('gstMode' in obj && obj.gstMode && ['incl', 'excl'].indexOf(obj.gstMode) < 0) throw new Error('Unknown GST option.');
    if ('freightMode' in obj && obj.freightMode && ['ours', 'buyer'].indexOf(obj.freightMode) < 0) throw new Error('Unknown freight option.');
  }
}

function nextId_(name, existing, obj) {
  var max = 0, re = name === T.PO ? /^PO-(\d+)/ : name === T.SO ? /^SO-(\d+)/ : name === T.PAY ? /^PAY-(\d+)/ : /^DISP-(\d+)/;
  existing.forEach(function (r) { var m = String(r.id).match(re); if (m) max = Math.max(max, Number(m[1])); });
  var n = max + 1;
  if (name === T.PO) {
    var code = String(obj.plant || '').toUpperCase().split(/\s+/)[0].replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PLANT';
    return 'PO-' + pad_(n, 2) + '-' + code;
  }
  if (name === T.SO) return 'SO-' + pad_(n, 4);
  if (name === T.PAY) return 'PAY-' + pad_(n, 5);
  return 'DISP-' + pad_(n, 4);
}

function normName_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }

function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function normTruck_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function num_(x) {
  if (typeof x === 'number') return x;
  if (x === '' || x === null || x === undefined) return '';
  var s = String(x).replace(/[₹,\s]/g, '');
  if (s === '' || s.indexOf('#') === 0) return '';
  var n = parseFloat(s);
  return isNaN(n) ? '' : n;
}

/** Accepts Date, yyyy-mm-dd, dd-mm-yyyy, d/m/yy. Stores at noon to avoid time-zone day shifts. */
function parseDate_(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
  var s = String(x || '').trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) {
    var y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1], 12);
  }
  return null;
}

function log_(action, record, details) {
  var sh = sheet_(T.LOG);
  if (!sh) return;
  sh.getRange(sh.getLastRow() + 1, 1, 1, 8).setValues([[nowStr_(), user_(), action, record, String(details || '').slice(0, 2000), '', '', '']]);
}

/* ---------------- setup and import ---------------- */

var SCHEMA_V = '6.4';
function ensureSetup_() {
  if (sheet_(T.TR)) {
    // Checking and upgrading the tabs is slow, so it runs only once after each new version of the code.
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('schema_v') !== SCHEMA_V) { upgradeHeaders_(); props.setProperty('schema_v', SCHEMA_V); }
    return null;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (sheet_(T.TR)) return null;
    [T.SET, T.PO, T.SO, T.TR, T.LOG, T.US, T.PAY, T.NOTE, T.BANK].forEach(makeTab_);
    var set = sheet_(T.SET);
    set.getRange(2, 1, SETTINGS_DEFAULT.length, 3).setValues(SETTINGS_DEFAULT);
    var report = importOld_();
    PropertiesService.getScriptProperties().setProperty('schema_v', SCHEMA_V);
    log_('Setup', '-', JSON.stringify(report));
    return report;
  } finally {
    lock.releaseLock();
  }
}

/** Adds any new columns to existing APP_ tabs after an update. Old data stays where it is. */
function upgradeHeaders_() {
  [T.US, T.PAY, T.NOTE, T.BANK].forEach(function (name) { if (!sheet_(name)) makeTab_(name); });
  var set = sheet_(T.SET);
  if (set) {
    var have = {};
    rows_(T.SET).forEach(function (r) { have[r.key] = 1; });
    SETTINGS_DEFAULT.forEach(function (s) { if (!have[s[0]]) set.getRange(set.getLastRow() + 1, 1, 1, 3).setValues([s]); });
    renameFirm_('SRIRAM SOLVEX', 'SHREE RAM SOLVEX');
    // Slip check starts on the day the app is upgraded, unless a date was already set.
    var sdata = set.getDataRange().getValues();
    for (var si = 1; si < sdata.length; si++) {
      if (sdata[si][0] === 'slipCheckFrom' && !String(sdata[si][1]).trim()) {
        set.getRange(si + 1, 2).setValue(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
      }
    }
  }
  // Labels only: header rows are rewritten to the current names. Data under the headers is never moved.
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = sheet_(name);
    if (!sh) return;
    var heads = SCHEMA[name].map(function (c) { return c[1]; });
    var cur = sh.getRange(1, 1, 1, heads.length).getValues()[0];
    if (cur.join('|') !== heads.join('|')) {
      sh.getRange(1, 1, 1, heads.length).setValues([heads])
        .setFontWeight('bold').setBackground('#0f6b5c').setFontColor('#ffffff');
    }
  });
}

/** One-time rename of a firm everywhere (settings, PO/SO firm, SO buyer). */
function renameFirm_(from, to) {
  var set = sheet_(T.SET), changed = false;
  rows_(T.SET).forEach(function (r) {
    if ((r.key === 'firms' || r.key === 'plantFirm') && String(r.value).toUpperCase().indexOf(from) >= 0) {
      set.getRange(r._row, 2).setValue(String(r.value).toUpperCase().split(from).join(to)); changed = true;
    }
  });
  if (!changed) return;
  [[T.PO, ['firm']], [T.SO, ['firm', 'buyer']]].forEach(function (x) {
    var sh = sheet_(x[0]);
    if (!sh) return;
    rows_(x[0]).forEach(function (r) {
      x[1].forEach(function (k) { if (normName_(r[k]) === from) sh.getRange(r._row, idx_(x[0], k) + 1).setValue(to); });
    });
  });
  log_('Renamed firm', from, from + ' -> ' + to);
}

function findOld_(label) {
  var want = label.replace(/\s+/g, '').toUpperCase(), found = null;
  ss_().getSheets().forEach(function (s) {
    if (s.getName().replace(/\s+/g, '').toUpperCase() === want) found = s;
  });
  return found;
}

function oldValues_(label) {
  var s = findOld_(label);
  return s ? s.getDataRange().getValues() : [];
}

function isDispId_(v) { return /^DISP-\d+$/.test(String(v || '').trim()); }
function cellBool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function importOld_() {
  var report = { pos: 0, sos: 0, trucks: 0, skipped: [], notes: [] };
  var gst = 0.05;

  // Purchase orders: PO ID | VENDOR | DATE | COMMODITY | QTY | RATE
  var po = oldValues_('MASTER PO'), poRows = [];
  for (var i = 1; i < po.length; i++) {
    var id = String(po[i][0] || '').trim();
    if (!/^PO-/.test(id)) continue;
    poRows.push(rowFor_(T.PO, { id: id, plant: normName_(po[i][1]), date: po[i][2], commodity: po[i][3] || 'DDGS',
      qty: po[i][4], rate: po[i][5], gst: gst, note: 'Imported' }));
  }

  // Sale orders: DATE | SO ID | BUYER | QTY | RATE
  var so = oldValues_('SALE ORDER'), soRows = [];
  for (i = 1; i < so.length; i++) {
    id = String(so[i][1] || '').trim();
    if (!/^SO-/.test(id)) continue;
    soRows.push(rowFor_(T.SO, { id: id, date: so[i][0], buyer: normName_(so[i][2]), commodity: 'DDGS',
      qty: so[i][3], rate: so[i][4], gst: gst, note: 'Imported' }));
  }

  // SALE and Freight, keyed by Dispatch ID (never by row position)
  var sale = {}, sv = oldValues_('SALE');
  for (i = 1; i < sv.length; i++) {
    if (isDispId_(sv[i][1])) sale[String(sv[i][1]).trim()] = { unloadWt: sv[i][6], received: sv[i][9], advance: sv[i][11] };
    else if (hasInput_([sv[i][6], sv[i][9], sv[i][11]])) {
      report.skipped.push('SALE row ' + (i + 1) + ' has values (' + [sv[i][6], sv[i][9], sv[i][11]].filter(String).join(', ') + ') but its Dispatch ID is broken (#REF!). Not imported.');
    }
  }
  var fr = {}, fv = oldValues_('Freight');
  for (i = 1; i < fv.length; i++) {
    if (isDispId_(fv[i][1])) fr[String(fv[i][1]).trim()] = { unloadDate: fv[i][0], frate: fv[i][7], ref: fv[i][12], paid: fv[i][14] };
    else if (hasInput_([fv[i][7], fv[i][14] === true ? 'paid' : ''])) {
      report.skipped.push('Freight row ' + (i + 1) + ' has values but its Dispatch ID is broken (#REF!). Not imported.');
    }
  }

  // Trucks: DATE | DISP ID | PO | TRUCK | TRANSPORTER | DRIVER | BUYER | WEIGHT | VENDOR PAYMENT | SO | PAID
  var dv = oldValues_('DISPATCH'), trRows = [], seen = {};
  for (i = 1; i < dv.length; i++) {
    id = String(dv[i][1] || '').trim();
    if (!isDispId_(id)) continue;
    if (seen[id]) { report.skipped.push(id + ' appears twice in DISPATCH; kept the first.'); continue; }
    seen[id] = 1;
    var s = sale[id] || {}, f = fr[id] || {};
    trRows.push(rowFor_(T.TR, {
      id: id, date: dv[i][0], po: String(dv[i][2] || '').trim(), so: String(dv[i][9] || '').trim(),
      truck: normTruck_(dv[i][3]), transporter: normName_(dv[i][4] || f.ref || ''), driver: dv[i][5],
      loadWt: dv[i][7], plantPaid: cellBool_(dv[i][10]),
      unloadWt: s.unloadWt, unloadDate: num_(s.unloadWt) !== '' ? f.unloadDate : '',
      frate: f.frate, advance: s.advance, freightPaid: cellBool_(f.paid), received: s.received,
      note: 'Imported'
    }));
  }

  var put = function (name, rows) {
    if (rows.length) sheet_(name).getRange(2, 1, rows.length, SCHEMA[name].length).setValues(rows);
  };
  put(T.PO, poRows); put(T.SO, soRows); put(T.TR, trRows);
  report.pos = poRows.length; report.sos = soRows.length; report.trucks = trRows.length;
  if (!trRows.length) report.notes.push('No trucks found in a DISPATCH tab. Start adding trucks in the app.');
  return report;
}

function hasInput_(arr) {
  return arr.some(function (v) { return v !== '' && v !== null && v !== undefined && v !== false && String(v).indexOf('#') !== 0; });
}

function rowFor_(name, obj) {
  var by = user_(), at = nowStr_();
  return SCHEMA[name].map(function (c) {
    if (c[0] === 'by') return by;
    if (c[0] === 'at') return at;
    return toCell_(obj[c[0]], c[2]);
  });
}

/* ---------------- calculations (same rules as the screen) ---------------- */

function days_(a, b) {
  if (!a || !b) return 0;
  var pa = String(a).split('-'), pb = String(b).split('-');
  return Math.round((new Date(+pb[0], +pb[1] - 1, +pb[2], 12) - new Date(+pa[0], +pa[1] - 1, +pa[2], 12)) / 864e5);
}

var STAGES_ = ['Placed', 'Loaded', 'Paid to plant', 'Unloaded', 'Part paid', 'Buyer paid', 'Closed'];

function derive_(t, po, so, S, today) {
  var n = function (x) { var v = parseFloat(x); return isNaN(v) ? 0 : v; };
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var L = n(t.loadWt), U = n(t.unloadWt), R = n(t.received), A = n(t.advance), FR = n(t.frate), DED = n(t.deduction);
  var plantPO = !!(po && po.poType === 'plant');
  if (plantPO) so = null;
  var own = t.saleRate === '' || t.saleRate == null ? null : n(t.saleRate);
  var poRate = po ? n(po.rate) : 0, poG = po ? n(po.gst) : 0, soRate = so ? (own !== null ? own : n(so.rate)) : 0, soG = so ? n(so.gst) : 0;
  var x = {};
  for (var k in t) x[k] = t[k];
  x.L = L; x.U = U; x.R = R; x.A = A; x.FR = FR; x.DED = DED;
  x.plant = po ? po.plant : ''; x.buyer = so ? so.buyer : '';
  x.plantPO = plantPO; x.firm = firmOf_(po, S); x.ownBuyer = !!(so && isFirm_(so.buyer, S)); x.rateUsed = soRate;
  x.purEx = r2(L * poRate); x.purTot = r2(x.purEx * (1 + poG));
  x.saleWt = U || L;
  var gIncl = !!(so && so.gstMode === 'incl');
  x.fBuyer = !!(so && so.freightMode === 'buyer');
  x.soBase = gIncl ? soRate / (1 + soG) : soRate;
  x.saleEx = so ? r2(x.saleWt * x.soBase) : 0;
  x.saleTot = so ? r2(gIncl ? x.saleWt * soRate : x.saleEx * (1 + soG)) : 0;
  x.short = U ? r2(Math.max(0, L - U)) : 0;
  x.allow = L * n(S.shortageAllowancePct);
  x.shortDed = !U || x.fBuyer ? 0 : plantPO ? r2(Math.max(0, x.short - x.allow) * poRate * (1 + poG)) : so ? r2(Math.max(0, x.short - x.allow) * x.soBase * (1 + soG)) : 0;
  x.frAmt = x.fBuyer ? 0 : r2(U * FR);
  x.trip = t.date ? days_(t.date, t.unloadDate || today) : 0;
  x.detDays = Math.max(0, x.trip - n(S.freeDays === undefined || S.freeDays === '' ? 3 : S.freeDays));
  x.detSuggest = x.fBuyer ? 0 : x.detDays * n(S.detentionPerDay === undefined || S.detentionPerDay === '' ? 500 : S.detentionPerDay);
  // Detention is only a suggestion: it counts only when someone enters an amount (decided per truck when paying freight).
  x.det = x.fBuyer || !U ? 0 : (t.detention === '' || t.detention == null ? 0 : n(t.detention));
  x.netFr = U && !x.fBuyer ? r2(x.frAmt - x.shortDed - A + x.det) : 0;
  x.bal = U && so ? r2(Math.max(0, x.saleTot - R - DED)) : 0;
  // Sales to your own firm: freight and detention are not taken off the margin (shortage recovered from the transporter still counts).
  x.profit = U && so && po ? r2(x.saleEx - x.purEx - (x.ownBuyer ? -x.shortDed : x.frAmt - x.shortDed + x.det)) : 0;
  x.cx = t.status === 'Cancelled' || t.status === 'Returned';
  var full = U && so && (R > 0 || DED > 0) && R + DED >= x.saleTot - 1;
  var st;
  if (x.cx) st = -1;
  else if (plantPO) st = U && t.freightPaid ? 6 : U ? 3 : t.plantPaid ? 2 : L ? 1 : 0;
  else if (full && (t.freightPaid || x.fBuyer)) st = 6;
  else if (full) st = 5;
  else if (R > 0 || DED > 0) st = 4;
  else if (U) st = 3;
  else if (t.plantPaid) st = 2;
  else if (L) st = 1;
  else st = 0;
  x.st = st; x.stage = st < 0 ? (t.status === 'Returned' ? 'Returned' : 'Cancelled') : plantPO && st === 3 ? 'Received' : STAGES_[st];
  x.credit = so ? (so.creditDays === '' || so.creditDays == null ? n(S.defaultCreditDays || 7) : n(so.creditDays)) : 0;
  x.overdue = U && so && x.bal > 0 && t.unloadDate ? Math.max(0, days_(t.unloadDate, today) - x.credit) : 0;
  x.placed = t.placedOn || t.date;
  x.noSlip = L > 0 && !t.slipPhoto && (!S.slipCheckFrom || String(t.date) >= String(S.slipCheckFrom));
  return x;
}

/* A driver's advance is adjusted across all trips of the same truck: extra advance on one trip reduces what is paid on its next trips. */
function carry_(list) {
  var by = {}, r = function (v) { return Math.round(v * 100) / 100; };
  list.forEach(function (t) {
    t.netPay = t.netFr; t.carryIn = 0; t.carryOut = 0; t.carryLeft = 0;
    if (t.cx || t.fBuyer || !t.U) return;
    var k = String(t.truck || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    (by[k] = by[k] || []).push(t);
  });
  Object.keys(by).forEach(function (k) {
    var run = 0, trips = by[k].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)); });
    trips.forEach(function (t) {
      if (t.netFr < 0) { t.netPay = 0; t.carryOut = r(-t.netFr); run = r(run - t.netFr); return; }
      var use = Math.min(run, t.netFr);
      t.carryIn = r(use); t.netPay = r(t.netFr - use); run = r(run - use);
    });
    trips[trips.length - 1].carryLeft = run;
  });
  return list;
}

function deriveAll_() {
  var po = {}, so = {}, S = readSettings_(), today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  rows_(T.PO).forEach(function (r) { po[r.id] = r; });
  rows_(T.SO).forEach(function (r) { so[r.id] = r; });
  return { po: po, so: so, S: S, today: today, trucks: carry_(rows_(T.TR).map(function (t) { return derive_(t, po[t.po], so[t.so], S, today); })) };
}

/* ---------------- Excel export ---------------- */

function truckColumns_(can) {
  var c = [['Dispatch No.', 'id'], ['Status', 'status'], ['Firm', 'firm'], ['Dispatch Date', 'date'], ['Vehicle Placed On', 'placedOn'], ['PO', 'po'], ['Supplier', 'plant'], ['SO', 'so'], ['Customer', 'buyer'],
    ['Vehicle No', 'truck'], ['Transporter', 'transporter'], ['Driver', 'driver'], ['RST / Weighment Slip No', 'slip'], ['Slip Photo Link', 'slipPhoto'], ['Dispatch Wt (qtl)', 'L'], ['Supplier Invoice No', 'billNo'], ['Supplier Invoice Qty', 'billQty'],
    ['Unload Date', 'unloadDate'], ['Received Wt (qtl)', 'U'], ['Shortage (qtl)', 'short'], ['Days on trip', 'trip'], ['Stage', 'stage']];
  if (can.money) c = c.concat([['Supplier Amount incl GST', 'purTot'], ['Supplier Paid', 'plantPaid'], ['Supplier Paid Date', 'plantPaidDate'], ['Supplier UTR', 'plantUTR'],
    ['Sale Rate', 'rateUsed'], ['Sale Total', 'saleTot'], ['Received', 'R'], ['Deduction', 'DED'], ['Outstanding', 'bal'], ['Overdue Days', 'overdue'],
    ['Freight Rate', 'FR'], ['Freight Amount', 'frAmt'], ['Shortage Deduction', 'shortDed'], ['Detention', 'det'],
    ['Freight Advance', 'A'], ['Trip Net Freight', 'netFr'], ['Earlier Advance Adjusted', 'carryIn'], ['Net Freight Payable', 'netPay'], ['Freight Paid', 'freightPaid'], ['Freight Paid Date', 'freightPaidDate'], ['Freight UTR', 'freightUTR']]);
  if (can.profit) c.push(['Profit before GST', 'profit']);
  c.push(['Note', 'note']);
  return c;
}

function tab_(name, cols, list) {
  return { name: name, rows: [cols.map(function (c) { return c[0]; })].concat(list.map(function (r) {
    return cols.map(function (c) { var v = r[c[1]]; return v === undefined || v === null ? '' : (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v); });
  })) };
}

function exportTabs_(kind, key, ids, can, firm) {
  var A = deriveAll_();
  if (firm) {
    firm = normName_(firm);
    A.trucks = A.trucks.filter(function (t) { return t.firm === firm; });
    [A.po, A.so].forEach(function (m) { Object.keys(m).forEach(function (id) { if (firmOf_(m[id], A.S) !== firm) delete m[id]; }); });
  }
  var live = A.trucks.filter(function (t) { return !t.cx; });
  var tc = truckColumns_(can), tabs = [];
  var orderRows = function (map, k) {
    return Object.keys(map).map(function (id) {
      var o = map[id], tr = live.filter(function (t) { return t[k] === id; }), done = 0;
      tr.forEach(function (t) { done += t.L; });
      var r = { id: id, takenIn: o.takenIn || '', firm: firmOf_(o, A.S), type: k === 'po' ? (o.poType === 'plant' ? 'Own plant' : 'Trading') : (isFirm_(o.buyer, A.S) ? 'To group company' : 'Trading'), link: o.linkSO || '', party: o.plant || o.buyer, date: o.date, qty: o.qty, done: Math.round(done * 100) / 100,
        bal: Math.round((Number(o.qty || 0) - done) * 100) / 100, trucks: tr.length, status: o.status, rate: o.rate,
        terms: o.gstMode ? (o.gstMode === 'incl' ? 'GST incl' : 'GST extra') + ', ' + (o.freightMode === 'buyer' ? 'buyer pays freight' : 'freight incl') : '' };
      return r;
    });
  };
  var oc = [['ID', 'id'], ['Firm', 'firm'], ['Booked in the name of', 'takenIn'], ['Type', 'type'], ['Party', 'party'], ['Sells To SO', 'link'], ['Date', 'date'], ['Quantity', 'qty'], ['Done', 'done'], ['Balance', 'bal'], ['Trucks', 'trucks'], ['Status', 'status']];
  if (can.money) oc = oc.concat([['Rate', 'rate'], ['Terms', 'terms']]);
  var pick = function (list) { return ids ? list.filter(function (t) { return ids.indexOf(t.id) >= 0; }) : list; };
  if (kind === 'full') {
    tabs.push(tab_('Trucks', tc, A.trucks));
    tabs.push(tab_('Purchase Orders', oc, orderRows(A.po, 'po')));
    tabs.push(tab_('Sale Orders', oc, orderRows(A.so, 'so')));
    if (can.money) {
      var by = {};
      live.filter(function (t) { return t.L && !t.fBuyer; }).forEach(function (t) {
        var k = t.transporter || '(none)';
        by[k] = by[k] || { name: k, trucks: 0, freight: 0, short: 0, det: 0, adv: 0, payable: 0, paid: 0 };
        var b = by[k]; b.trucks++; b.freight += t.frAmt; b.short += t.shortDed; b.det += t.det; b.adv += t.A;
        if (t.U && !t.freightPaid) b.payable += t.netPay; if (t.freightPaid) b.paid += t.netPay;
      });
      tabs.push(tab_('Transporters', [['Transporter', 'name'], ['Trucks', 'trucks'], ['Freight', 'freight'], ['Shortage Deduction', 'short'], ['Detention', 'det'], ['Freight Advance', 'adv'], ['Net Paid', 'paid'], ['Net Payable Now', 'payable']], Object.keys(by).map(function (k) { return by[k]; })));
      var pays = (sheet_(T.PAY) ? rows_(T.PAY) : []).filter(function (p) { return !firm || A.so[p.so]; });
      tabs.push(tab_('Customer Payments', [['Payment ID', 'id'], ['Date', 'date'], ['Dispatch No.', 'truck'], ['SO', 'so'], ['Customer', 'buyer'], ['Amount', 'amount'], ['Deduction', 'deduction'], ['Note', 'note'], ['Entered By', 'by']], pays));
    }
  } else {
    var match = {
      trucks: function () { return true; },
      po: function (t) { return t.po === key; }, so: function (t) { return t.so === key; },
      buyer: function (t) { return normName_(t.buyer) === normName_(key); }, plant: function (t) { return normName_(t.plant) === normName_(key); },
      transporter: function (t) { return normName_(t.transporter || '(none)') === normName_(key); }
    }[kind];
    if (!match) throw new Error('Unknown export');
    tabs.push(tab_(kind === 'transporter' ? 'Statement' : 'Trucks', tc, pick(A.trucks.filter(match))));
    if (kind === 'po') tabs.push(tab_('PO', oc, orderRows(A.po, 'po').filter(function (r) { return r.id === key; })));
    if (kind === 'so') tabs.push(tab_('SO', oc, orderRows(A.so, 'so').filter(function (r) { return r.id === key; })));
    if (kind === 'buyer') tabs.push(tab_('Sale Orders', oc, orderRows(A.so, 'so').filter(function (r) { return normName_(r.party) === normName_(key); })));
    if (kind === 'plant') tabs.push(tab_('Purchase Orders', oc, orderRows(A.po, 'po').filter(function (r) { return normName_(r.party) === normName_(key); })));
  }
  return tabs;
}

function folder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function buildXlsx_(name, tabs) {
  var tmp = SpreadsheetApp.create(name);
  tabs.forEach(function (tb, i) {
    var sh = i === 0 ? tmp.getSheets()[0].setName(tb.name) : tmp.insertSheet(tb.name);
    var w = tb.rows[0].length;
    var rows = tb.rows.map(function (r) { var a = r.slice(0, w); while (a.length < w) a.push(''); return a; });
    sh.getRange(1, 1, rows.length, w).setValues(rows);
    sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#0f6b5c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  SpreadsheetApp.flush();
  var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  var blob = resp.getBlob().setName(name + '.xlsx');
  DriveApp.getFileById(tmp.getId()).setTrashed(true);
  return blob;
}

/** kind: full | trucks | po | so | buyer | plant | transporter. ids: optional list of Dispatch IDs (the list on screen). */
function api_export(token, kind, key, ids, firm) {
  auth_(token); need_('exportX');
  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HHmm');
  var name = 'DDGS ' + (firm ? firm + ' ' : '') + (kind === 'full' ? 'Full export' : (key ? key + ' ' : '') + (kind === 'trucks' ? 'Trucks' : kind)) + ' ' + stamp;
  var blob = buildXlsx_(name, exportTabs_(kind, key, ids, ME.can, firm || ''));
  var file = folder_('DDGS Exports').createFile(blob);
  log_('Export', kind, name);
  return { name: blob.getName(), url: file.getUrl(), b64: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------------- daily report and weekly backup ---------------- */

function ensureTriggers_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('triggers_v4') === 'on') return;
    var have = {};
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = 1; });
    if (!have.dailyReport) ScriptApp.newTrigger('dailyReport').timeBased().atHour(21).everyDays(1).inTimezone(tz_()).create();
    if (!have.weeklyBackup) ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).inTimezone(tz_()).create();
    props.setProperty('triggers_v4', 'on');
  } catch (e) { if (ME === null) throw e; /* from the app: permissions not granted yet, try again next time */ }
}

function money_(x) { var s = Math.round(Math.abs(x)).toString(), last = s.slice(-3), rest = s.slice(0, -3); if (rest) last = ',' + last; return (x < 0 ? '-' : '') + 'Rs ' + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last; }

/** Runs every evening around 9 pm (time trigger). Sends the owner a summary and the full Excel. */
function dailyReport(e) {
  if (!e || !e.triggerUid) return;
  ME = { id: 'auto-report', role: 'Owner', can: ROLES.Owner };
  var A = deriveAll_(), today = A.today, live = A.trucks.filter(function (t) { return !t.cx; });
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  var q = function (x) { return (Math.round(x * 100) / 100).toFixed(2); };
  var table = function (head, rows) {
    if (!rows.length) return '<p style="color:#5d6b68">None.</p>';
    return '<table cellpadding="6" style="border-collapse:collapse;font-size:13px"><tr>' + head.map(function (h) { return '<th style="background:#0f6b5c;color:#fff;text-align:left">' + h + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td style="border-bottom:1px solid #dfe6e3">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  };
  var sum = function (a, f) { return a.reduce(function (s, t) { return s + f(t); }, 0); };
  var added = live.filter(function (t) { return (t.placedOn || t.date) === today; });
  var unloaded = live.filter(function (t) { return t.unloadDate === today; });
  var plantPaid = live.filter(function (t) { return t.plantPaidDate === today; });
  var frPaid = live.filter(function (t) { return t.freightPaidDate === today; });
  var pays = (sheet_(T.PAY) ? rows_(T.PAY) : []).filter(function (p) { return p.date === today; });
  var h = '<div style="font-family:Arial,sans-serif;color:#14201e"><h2 style="color:#0f6b5c">Daily report · ' + today.split('-').reverse().join('-') + '</h2>';
  h += '<p><b>Today:</b> ' + added.length + ' new trucks · ' + unloaded.length + ' unloaded · paid plants ' + money_(sum(plantPaid, function (t) { return t.purTot; })) +
    ' · freight paid ' + money_(sum(frPaid, function (t) { return t.netPay; })) + ' · received from customers ' + money_(sum(pays, function (p) { return Number(p.amount || 0); })) + '</p>';
  var ownDue = sum(live.filter(function (t) { return t.ownBuyer; }), function (t) { return t.bal; });
  h += '<p><b>Position now:</b> outside customers owe ' + money_(sum(live.filter(function (t) { return !t.ownBuyer; }), function (t) { return t.bal; })) + (ownDue ? ' · group company owes ' + money_(ownDue) : '') + ' (overdue ' + money_(sum(live.filter(function (t) { return t.overdue > 0; }), function (t) { return t.bal; })) + ') · suppliers unpaid ' +
    money_(sum(live.filter(function (t) { return t.L && !t.plantPaid; }), function (t) { return t.purTot; })) + ' · freight payable ' +
    money_(sum(live.filter(function (t) { return t.U && !t.freightPaid; }), function (t) { return t.netPay; })) + ' · on the road ' +
    q(sum(live.filter(function (t) { return t.L && !t.U; }), function (t) { return t.L; })) + ' qtl</p>';
  var dest = function (t) { return t.plantPO ? 'Own plant' : t.buyer || 'not assigned'; };
  h += '<h3>Trucks added today</h3>' + table(['Dispatch', 'Firm', 'Truck', 'PO / Supplier', 'Going to', 'Loaded qtl'], added.map(function (t) { return [t.id, t.firm, t.truck, t.po + ' ' + t.plant, dest(t), t.L ? q(t.L) : '-']; }));
  h += '<h3>Unloaded / received today</h3>' + table(['Dispatch', 'Firm', 'Truck', 'At', 'Loaded', 'Unloaded', 'Short', 'Days'], unloaded.map(function (t) { return [t.id, t.firm, t.truck, dest(t), q(t.L), q(t.U), q(t.short), t.trip]; }));
  h += '<h3>Money today</h3>' + table(['What', 'Dispatch / Payment', 'Party', 'Amount'],
    plantPaid.map(function (t) { return ['Supplier paid', t.id, t.plant, money_(t.purTot)]; })
      .concat(frPaid.map(function (t) { return ['Freight paid', t.id, t.transporter, money_(t.netPay)]; }))
      .concat(pays.map(function (p) { return ['Received' + (p.deduction ? ' (+ ' + p.note + ' ' + p.deduction + ')' : ''), p.id + ' / ' + p.truck, p.buyer, money_(Number(p.amount || 0))]; })));
  var bal = function (map, k) {
    return Object.keys(map).filter(function (id) { return map[id].status !== 'Cancelled' && map[id].status !== 'Settled'; }).map(function (id) {
      var o = map[id], done = sum(live.filter(function (t) { return t[k] === id; }), function (t) { return t.L; });
      return [id, firmOf_(o, A.S), o.plant || o.buyer, q(Number(o.qty || 0)), q(done), q(Number(o.qty || 0) - done)];
    });
  };
  h += '<h3>Purchase orders</h3>' + table(['PO', 'Firm', 'Supplier', 'Ordered', 'Loaded', 'Outstanding'], bal(A.po, 'po'));
  h += '<h3>Sale orders</h3>' + table(['SO', 'Firm', 'Customer', 'Ordered', 'Dispatched', 'Outstanding'], bal(A.so, 'so'));
  var probs = [];
  live.forEach(function (t) {
    if (t.overdue) probs.push([t.id, t.truck, 'Customer payment overdue ' + t.overdue + ' days, balance ' + money_(t.bal)]);
    if (t.L && !t.U && t.detDays > 0) probs.push([t.id, t.truck, 'On the road ' + t.trip + ' days (over the free days: detention claim possible, ' + money_(t.detSuggest) + ' if agreed)']);
    if (t.L && !t.so && !t.plantPO) probs.push([t.id, t.truck, 'Loaded, no customer assigned']);
    if (t.L && t.billQty !== '' && t.billQty != null && Math.abs(Number(t.billQty) - t.L) >= 0.005) probs.push([t.id, t.truck, 'Slip weight ' + q(t.L) + ' but plant bill ' + q(Number(t.billQty))]);
    if (t.noSlip) probs.push([t.id, t.truck, 'No slip photo']);
    if (t.carryLeft > 0) probs.push([t.id, t.truck, 'Advance ' + money_(t.carryLeft) + ' still to adjust on the next trip of this truck']);
  });
  h += '<h3>Needs attention</h3>' + table(['Dispatch', 'Truck', 'Problem'], probs);
  var staff = {};
  (sheet_(T.LOG) ? rows_(T.LOG) : []).forEach(function (r) {
    if (String(r.time).indexOf(today) !== 0 || ['Created', 'Updated'].indexOf(r.action) < 0) return;
    staff[r.user] = staff[r.user] || { n: 0 }; staff[r.user].n++;
  });
  h += '<h3>Staff activity today</h3>' + table(['User', 'Entries'], Object.keys(staff).map(function (u) { return [u, staff[u].n]; }));
  h += '<p style="color:#5d6b68;font-size:12px">The full Excel is attached. Sent automatically by DDGS Trade Control.</p></div>';
  var set = readSettings_();
  var to = set.reportEmail || Session.getEffectiveUser().getEmail();
  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var blob = buildXlsx_('DDGS Daily ' + stamp, exportTabs_('full', '', null, ROLES.Owner));
  MailApp.sendEmail({ to: to, subject: 'DDGS daily report ' + today.split('-').reverse().join('-'), htmlBody: h, attachments: [blob] });
  log_('Daily report', '-', 'Sent to ' + to);
}

/** Runs every Sunday night (time trigger). Keeps the last 12 copies in Drive > DDGS Backups. */
function weeklyBackup(e) {
  if (!e || !e.triggerUid) return;
  var folder = folder_('DDGS Backups');
  var name = 'DDGS Backup ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss_().getId()).makeCopy(name, folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(12).forEach(function (f) { f.setTrashed(true); });
  ME = { id: 'auto-backup' };
  log_('Backup', '-', name);
}

/* ---------------- the screen (Index.html), included so no HTML file is needed ---------------- */
var INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>DDGS Trade Control</title>\n<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap\">\n<style>\n/* Layout: laptop = top tabs + wide list rows; phone = slim top bar + fixed bottom bar + compact cards. One page per PO, SO, buyer, plant, transporter, truck. */\n:root{\n  --bg:#f4f6f5; --card:#ffffff; --fg:#14201e; --mu:#5d6b68; --bd:#dfe6e3; --soft:#f8faf9;\n  --ac:#0f7a5f; --acs:#e3f3ed; --ink:#13201d;\n  --ok:#137a4b; --oks:#e2f5ea; --wn:#9a5a00; --wns:#fdf1dc; --bad:#b3261e; --bads:#fde8e6; --info:#3b4fb8; --infos:#eceffd;\n  --f:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; --m:'JetBrains Mono',ui-monospace,Consolas,monospace;\n  --navh:64px;\n}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 var(--f)}\nbutton,input,select,textarea{font:inherit;color:inherit}\nbutton{cursor:pointer}\na{color:var(--ac);text-decoration:none}\na:hover{text-decoration:underline}\n:focus-visible{outline:2px solid var(--ac);outline-offset:2px}\n[hidden]{display:none!important}\n.wrap{max-width:1240px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}\nheader{background:var(--card);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:30}\n.top{display:flex;align-items:center;gap:12px;padding:10px 0}\n.logo{width:36px;height:36px;border-radius:10px;background:var(--ac);display:grid;place-items:center;flex:none}\n.logo svg{width:21px;height:21px}\n.ttl{min-width:0;flex:1}\n.ttl b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.ttl span{font-size:12px;color:var(--mu)}\n.sync::before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:5px;vertical-align:1px}\n.who{border:1px solid var(--bd);background:var(--card);border-radius:99px;padding:7px 12px;font-size:13px;font-weight:600;white-space:nowrap;min-height:36px}\n.who span{color:var(--mu);font-weight:500}\n#nav{display:flex;gap:2px;padding-bottom:8px;overflow-x:auto;scrollbar-width:none}\n#nav::-webkit-scrollbar{display:none}\n#nav button{flex:none;border:0;background:transparent;padding:9px 13px;border-radius:9px;font-weight:600;color:var(--mu);white-space:nowrap}\n#nav button.on{background:var(--acs);color:var(--ac)}\n#nav .cnt{font-weight:500;opacity:.75}\n.firmbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}\n.firmbar .seg{margin:0}\n.ftag{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;border:1px solid currentColor;white-space:nowrap;vertical-align:1px}\n.ftag.f0{color:#0f7a5f}.ftag.f1{color:#3b4fb8}.ftag.f2{color:#9b2c66}\n.tag.own{background:var(--infos);color:var(--info)}\n.ntsm{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--mu);vertical-align:-5px;margin-left:2px}\n.ntsm:hover{background:var(--soft);color:var(--ac)}\n.ntsm svg{width:13px;height:13px}\n.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}\n.bar .sp{flex:1}\n.bar .search{flex:1 1 260px;margin:0}\n.tbl{background:var(--card);border:1px solid var(--bd);border-radius:12px}\n.tbl > .tr:first-child{border-radius:12px 12px 0 0}\n.tbl > .tr:last-child{border-radius:0 0 12px 12px}\n.tr{display:grid;grid-template-columns:var(--cols);gap:10px;align-items:center;padding:10px 14px;border-top:1px solid var(--bd)}\n.tr:first-child{border-top:0}\n.th{position:sticky;top:var(--hh,0px);z-index:5;box-shadow:0 1px 0 var(--bd);background:var(--soft);font-size:11.5px;font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.05em;padding:9px 14px}\n.tr.cx{opacity:.5}\n.td{min-width:0;overflow-wrap:anywhere}\n.td.r,.th .r{text-align:right}\n.td small,.td .sm{display:block;color:var(--mu);font-size:12px}\n.tfoot{background:var(--soft);font-weight:700}\n.pill{display:inline-flex;align-items:center;gap:5px;border-radius:99px;padding:6px 11px;font-size:12.5px;font-weight:600;border:1px solid var(--bd);background:var(--card);white-space:nowrap;min-height:32px;color:var(--fg)}\n.pill.ok{background:var(--oks);color:var(--ok);border-color:#bfe5d0}\n.pill.wait{color:var(--mu)}\n.pill.add{background:#fff9e8;color:#8a5a00;border-color:#f3dca2}\n.pill.info{background:var(--infos);color:var(--info);border-color:#cfd6f7}\n.nx{border:0;border-radius:9px;padding:7px 11px;font-weight:600;font-size:12.5px;background:var(--ac);color:#fff;white-space:nowrap;min-height:34px}\n.nx.money{background:#1f5f99}\n.acts{display:flex;gap:2px;justify-content:flex-end}\n.ib{border:1px solid var(--bd);background:var(--card);width:34px;height:34px;border-radius:8px;color:var(--mu);font-size:17px;line-height:1}\n.neg{color:var(--bad)}\n.stages{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}\n.stages button{border:1px solid var(--bd);background:var(--card);border-radius:11px;padding:10px 12px;text-align:left}\n.stages b{display:block;font-size:20px;font-variant-numeric:tabular-nums}\n.stages span{font-size:12.5px;color:var(--mu)}\nmain{padding:16px 0 40px}\n.sp{flex:1}\nh2{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--mu);margin:20px 0 10px;font-weight:600}\nh2:first-child{margin-top:0}\n.ph{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}\n.ph h1{font-size:20px;margin:0;letter-spacing:-.01em}\n.ph .sub{color:var(--mu);font-size:13px;width:100%}\n.ph .sp{flex:1}\n.back{border:1px solid var(--bd);background:var(--card);border-radius:9px;padding:8px 12px;font-weight:600;min-height:40px}\n.btn{border:1px solid var(--bd);background:var(--card);padding:9px 14px;border-radius:10px;font-weight:600;font-size:14px;min-height:42px;white-space:nowrap}\n.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff}\n.btn.ghost{border-color:transparent;background:transparent;color:var(--mu)}\n.btn.danger{color:var(--bad);border-color:#f2c4c0;background:var(--card)}\n.btn.sm{min-height:34px;padding:6px 11px;font-size:13px}\n.newtab{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid var(--bd);border-radius:9px;background:var(--card);color:var(--mu)}\n.newtab svg{width:16px;height:16px}\n.seg{display:inline-flex;background:var(--card);border:1px solid var(--bd);border-radius:11px;padding:3px;margin-bottom:12px}\n.seg button{border:0;background:transparent;padding:8px 16px;border-radius:8px;font-weight:600;color:var(--mu);min-height:38px}\n.seg button.on{background:var(--ink);color:#fff}\n.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;margin-bottom:10px}\n.chips::-webkit-scrollbar{display:none}\n.chip{flex:none;border:1px solid var(--bd);background:var(--card);padding:7px 12px;border-radius:99px;font-size:13px;font-weight:500;white-space:nowrap;min-height:36px}\n.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}\n.chip b{font-weight:700;margin-left:2px}\n.search{position:relative;margin-bottom:10px}\n.search input{width:100%;padding:11px 12px 11px 38px;border:1px solid var(--bd);border-radius:11px;background:var(--card);min-height:44px}\n.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--mu)}\n.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}\n.kpi{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;min-width:0}\n.kpi .l{font-size:12.5px;color:var(--mu)}\n.kpi .v{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px;letter-spacing:-.01em;overflow-wrap:anywhere}\n.kpi .s{font-size:12px;color:var(--mu)}\n.kpi.warn .v{color:var(--wn)} .kpi.bad .v{color:var(--bad)} .kpi.good .v{color:var(--ok)}\nbutton.kpi{text-align:left;cursor:pointer}\n.panel{background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}\n.two{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-top:20px}\n.prob{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-top:1px solid var(--bd);width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0}\n.prob:first-child{border-top:0}\n.prob:hover{background:var(--soft)}\n.dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--bad)}\n.prob small{display:block;color:var(--mu)}\n.todo{display:flex;flex-wrap:wrap;gap:8px}\n.todo button{border:1px solid var(--bd);background:var(--card);border-radius:11px;padding:10px 12px;text-align:left;min-width:150px;flex:1}\n.todo b{display:block;font-size:20px;font-variant-numeric:tabular-nums}\n.todo span{font-size:12.5px;color:var(--mu)}\n.empty{padding:22px 14px;color:var(--mu);text-align:center}\n.prog{height:6px;background:var(--bd);border-radius:9px;overflow:hidden;margin:7px 0 5px}\n.prog i{display:block;height:100%;background:var(--ac)}\n.prog.over i{background:var(--bad)}\n.oc{display:flex;gap:12px;align-items:center;padding:12px 14px;border-top:1px solid var(--bd)}\n.oc:first-child{border-top:0}\n.oc .m{flex:1;min-width:0}\n.oc .r{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}\n.mu{color:var(--mu)} .num{font-variant-numeric:tabular-nums} .over{color:var(--bad)}\n.idb{display:inline-block;background:var(--ink);color:#fff;font:700 11.5px/1.2 var(--m);padding:4px 7px;border-radius:6px;white-space:nowrap}\n/* truck list */\n.tl{display:flex;flex-direction:column;gap:8px}\n.tc{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:11px 12px}\n.tc.cx{opacity:.55}\n.tc .info{flex:1;min-width:0;cursor:pointer}\n.tc .l1{display:flex;align-items:center;gap:7px;flex-wrap:wrap}\n.tc .truck{font-weight:700;font-size:15px;letter-spacing:.02em}\n.tc .l2{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.tc .l3{margin-top:2px;font-size:12.5px;color:var(--mu);display:flex;gap:8px;flex-wrap:wrap}\n.tc .money{text-align:right;min-width:120px;font-size:13px}\n.tc .acts{display:flex;gap:6px;align-items:center;flex:none}\n.next{background:var(--ac);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:600;min-height:44px;white-space:nowrap}\n.next.money{background:#1f5f99}\n.done{color:var(--ok);font-weight:600;font-size:13px;padding:0 6px;white-space:nowrap}\n.more{width:44px;height:44px;border:1px solid var(--bd);background:var(--card);border-radius:10px;font-size:20px;line-height:1;color:var(--mu)}\n.stage{font-size:12px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap;display:inline-block}\n.s0{background:#eef1f0;color:#4a5753}.s1{background:#fdf1dc;color:#9a5a00}.s2{background:#e9eefc;color:#3b4fb8}.s3{background:#e6f1fb;color:#1f5f99}.s4{background:#fbeaf3;color:#9b2c66}.s5{background:#e2f5ea;color:#137a4b}.s6{background:#d7efe2;color:#0b5a36}.sx{background:#eee;color:#777}\n.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;background:var(--bads);color:var(--bad)}\n.tag.wn{background:var(--wns);color:var(--wn)}\n.tag.ok{background:var(--oks);color:var(--ok)}\n.blist{max-height:46vh;overflow:auto;border:1px solid var(--bd);border-radius:10px;margin:0 18px}\n.blist label{display:flex;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--bd);cursor:pointer}\n.blist label:first-child{border-top:0}\n.blist input{width:20px;height:20px;flex:none}\n.blist .m{flex:1;min-width:0}\n.btot{margin:10px 18px 0;padding:10px 12px;background:var(--soft);border-radius:9px;font-weight:600}\n.showmore{display:block;margin:10px auto 0}\n/* tables (laptop pages) */\n.tblw{overflow:auto;max-height:calc(100vh - var(--hh,0px) - 24px);background:var(--card);border:1px solid var(--bd);border-radius:12px}\ntable.t{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}\ntable.t th{position:sticky;top:0;z-index:2;background:var(--soft);color:var(--mu);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;text-align:left;padding:9px 10px;white-space:nowrap;border-bottom:1px solid var(--bd)}\ntable.t td{padding:9px 10px;border-bottom:1px solid var(--bd);white-space:nowrap}\ntable.t tr:last-child td{border-bottom:0}\ntable.t .r{text-align:right}\ntable.t tfoot td{font-weight:700;background:var(--soft)}\n/* detail grid */\n.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin:0}\n.dl div{padding:10px 14px;border-bottom:1px solid var(--bd);border-right:1px solid var(--bd);min-width:0}\n.dl dt{font-size:11.5px;color:var(--mu);text-transform:uppercase;letter-spacing:.04em}\n.dl dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}\n.alist{display:flex;flex-wrap:wrap;gap:8px}\n/* modal / bottom sheet */\n#modal{position:fixed;inset:0;background:rgba(10,20,18,.45);z-index:60;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}\n.sheet{background:var(--card);border-radius:14px;width:100%;max-width:560px;box-shadow:0 20px 50px rgba(0,0,0,.25);position:relative}\n.sheet h3{margin:0;padding:16px 18px 4px;font-size:17px}\n.sheet .sub{padding:0 18px;color:var(--mu);font-size:13.5px}\n.sheet .sub b{color:var(--fg)}\n.fg{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;padding:14px 18px}\n.fg .full{grid-column:1/-1}\n.fg label{display:block;font-size:12.5px;color:var(--mu);font-weight:500;margin-bottom:4px}\n.fg input,.fg select,.fg textarea{width:100%;padding:10px;border:1px solid var(--bd);border-radius:9px;background:#fff;min-height:44px}\n.fg .ck{display:flex;align-items:center;gap:8px;padding-top:20px}\n.fg .ck input{width:20px;height:20px;min-height:0}\n.fg .sec{grid-column:1/-1;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ac);border-top:1px solid var(--bd);padding-top:12px;margin-top:4px}\n.help{font-size:12px;color:var(--mu);margin-top:3px}\n.hint{font-size:12.5px;color:var(--ac);font-weight:600;margin-top:3px;min-height:1em}\n.fill{border:1px dashed var(--ac);background:var(--acs);color:var(--ac);border-radius:99px;padding:3px 10px;font-size:12px;font-weight:600;margin-top:5px}\n.msg{margin:0 18px;padding:10px 12px;border-radius:9px;font-size:13px}\n.msg.err{background:var(--bads);color:var(--bad)}\n.msg.warn{background:var(--wns);color:var(--wn)}\n.foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px 14px;position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--bd);border-radius:0 0 14px 14px}\n.menu{display:flex;flex-direction:column;padding:8px 10px 4px}\n.menu button,.menu a{display:block;text-align:left;border:0;background:none;padding:13px 10px;border-radius:9px;font-weight:500;font-size:15px;color:var(--fg)}\n.menu button:hover,.menu a:hover{background:var(--soft);text-decoration:none}\n.menu .danger{color:var(--bad)}\n#toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:#fff;padding:11px 16px;border-radius:10px;z-index:70;font-weight:500;max-width:92%}\n.undo{background:none;border:0;color:#8ff0c8;font-weight:700;margin-left:12px;padding:0}\n#load{padding:60px 0;text-align:center;color:var(--mu)}\n.note{background:var(--infos);color:#28367f;border:1px solid #cfd6f7;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px}\n.auth{max-width:400px;margin:40px auto;background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:22px}\n.auth h3{margin:0 0 4px;font-size:18px}\n.auth p{margin:0 0 14px;color:var(--mu);font-size:13px}\n.auth label{display:block;font-size:12.5px;color:var(--mu);font-weight:500;margin:12px 0 4px}\n.auth input{width:100%;padding:11px;border:1px solid var(--bd);border-radius:9px;min-height:44px}\n.auth .btn{width:100%;margin-top:16px}\n.list{background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}\n.list .row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid var(--bd)}\n.list .row:first-child{border-top:0}\n.list .row .m{flex:1;min-width:0}\n.fab{display:none}\n@media (max-width:860px){\n  .top{padding:8px 0}\n  .ttl b{font-size:15px}\n  #nav{padding-bottom:6px}\n  #nav button{padding:8px 11px;font-size:13.5px}\n  main{padding-bottom:calc(90px + env(safe-area-inset-bottom,0px))}\n  .th{display:none}\n  .tr{grid-template-columns:1fr 1fr;gap:8px 12px;padding:12px 14px}\n  .td[data-l]::before{content:attr(data-l);display:block;font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.04em}\n  .td.wide{grid-column:1/-1}\n  .td.r{text-align:left}\n  .acts{justify-content:flex-start;grid-column:1/-1}\n  .stages{grid-template-columns:repeat(4,1fr)}\n  .two{grid-template-columns:1fr}\n  .tc{flex-wrap:wrap;padding:10px 12px}\n  .tc .info{flex:1 1 100%}\n  .tc .money{text-align:left;min-width:0;flex:1}\n  .tc .acts{flex:1 1 100%}\n  .tc .next{flex:1}\n  .tc .done{flex:1}\n  .dl{grid-template-columns:1fr 1fr}\n  #toast{top:calc(10px + env(safe-area-inset-top,0px));bottom:auto}\n  .kpis{grid-template-columns:1fr 1fr}\n  .kpi .v{font-size:18px}\n  .todo button{min-width:calc(50% - 4px)}\n  .fg{grid-template-columns:1fr}\n  #modal{padding:0;align-items:flex-end}\n  .sheet{border-radius:16px 16px 0 0;max-height:92vh;overflow:auto;padding-bottom:env(safe-area-inset-bottom,0px)}\n  .foot{border-radius:0}\n  .fab{display:block;position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:35;background:var(--ac);color:#fff;border:0;border-radius:99px;padding:14px 20px;font-weight:700;box-shadow:0 6px 18px rgba(15,122,95,.35)}\n  .hide-phone{display:none}\n  .ph h1{font-size:18px}\n}\n@media (min-width:861px){ .hide-laptop{display:none} }\n@media (max-width:420px){ .stages{grid-template-columns:repeat(3,1fr)} }\n@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n\n.flow{margin:6px 0 14px;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px}\n.fl-root{display:inline-flex;flex-direction:column;gap:2px;background:var(--acs);border:1px solid var(--ac);border-radius:10px;padding:10px 14px;max-width:100%}\n.fl-root b{font-size:15px}.fl-root span{font-size:12.5px;color:var(--mu)}\n.fl-br{display:flex;flex-wrap:wrap;gap:14px 18px;margin-top:8px}\n.fl-arm{display:flex;flex-direction:column;align-items:flex-start;max-width:100%}\n.fl-line{display:block;height:24px;background:var(--ac);opacity:.5;border-radius:3px;margin-left:10px;position:relative}\n.fl-line::after{content:\"\";position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid var(--ac);opacity:.8}\n.fb{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;border:1px solid var(--bd);background:var(--soft);border-radius:10px;padding:9px 11px;min-width:150px;max-width:260px;margin-top:10px}\n.fb b{font-size:14px}.fb span{font-size:12px;color:var(--mu)}\n.fb.on{border-color:var(--ac);box-shadow:0 0 0 2px var(--acs)}\n.fb.none{border-style:dashed;background:var(--wns);border-color:var(--wn)}\n.fb.own{border-color:var(--info)}\n.fl-note{margin-top:12px;font-size:12.5px;color:var(--mu)}\n.link{border:0;background:none;color:var(--ac);font-weight:600;padding:0;cursor:pointer}\n.tag.no{background:var(--bads);color:var(--bad);border-color:var(--bad)}\n.bank{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--soft)}\n.bk-h{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);font-weight:600;margin-bottom:4px}\n.bk{display:grid;grid-template-columns:110px 1fr auto;gap:8px;align-items:center;padding:4px 0;font-size:14px}\n.bk span{color:var(--mu);font-size:12.5px}\n.bk b{overflow-wrap:anywhere}\n.mono{font-family:var(--m)}\n.cp{border:1px solid var(--bd);background:var(--card);border-radius:8px;padding:5px 10px;font-size:12.5px;font-weight:600}\n.bank-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}\n.ps{border:1px dashed var(--bd);border-radius:10px;padding:10px 12px;margin:10px 0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}\n.ps.miss{border-color:var(--bad)}\n.upl{display:inline-block;border:1px solid var(--bd);background:var(--card);border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer;font-size:13px}\n.upl input{position:absolute;width:1px;height:1px;opacity:0}\n.photos{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}\n.rv{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-bottom:8px}\n.rv.flag{border-color:var(--bad);background:var(--bads)}\n.rh{font-size:14px}\n.flags{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}\n.chg{margin:6px 0 2px;padding-left:18px;font-size:13px}\n.chg s{color:var(--mu)}\n.rd{font-size:12.5px;margin-top:4px}\n.vfy{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;color:var(--mu)}\n.inl{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--mu)}\n</style>\n</head>\n<body>\n<header>\n  <div class=\"wrap\">\n    <div class=\"top\">\n      <div class=\"logo\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 6h11v9H3z\"/><path d=\"M14 9h4l3 3v3h-7z\"/><circle cx=\"7\" cy=\"17.5\" r=\"1.8\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.8\"/></svg></div>\n      <div class=\"ttl\"><b id=\"co\">DDGS Trade Control</b><span class=\"sync\" id=\"sync\">Connecting…</span></div>\n      <div id=\"who\"></div>\n    </div>\n    <nav id=\"nav\"></nav>\n  </div>\n</header>\n<main class=\"wrap\" id=\"view\"><div id=\"load\">Opening…</div></main>\n<button type=\"button\" class=\"fab\" id=\"fab\" hidden data-act=\"newTruck\">+ New truck</button>\n<div id=\"modal\" hidden><form class=\"sheet\" id=\"mform\" novalidate autocomplete=\"off\"></form></div>\n<div id=\"toast\" hidden></div>\n\n<script>\nvar D = null, P = {}, T = [], PO = {}, SO = {}, BUSY = false, TOKEN = null, PENDING_IMPORT = null;\nvar ROUTE = { v: 'home' }, HIST = [], LIMIT = 60, QS = '', FILTER = 'todo', FIRM = 'all', SUBF = { settle: 'all', freight: 'all' }, LASTIDS = [];\nvar STAGES = ['Vehicle placed', 'Loaded', 'Supplier paid', 'Unloaded', 'Part paid', 'Customer paid', 'Closed'];\nvar ROLE_HELP = { Owner: 'Everything, including users, profit and closed trucks', Accounts: 'Trucks, orders, payments, freight, Excel', Dispatch: 'Trucks, weights, unloading, choose customer. No money', Viewer: 'Sees everything, changes nothing' };\nvar ICON = {\n  home: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 11 12 4l9 7\"/><path d=\"M5 10v10h14V10\"/></svg>',\n  trucks: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 6h11v9H3z\"/><path d=\"M14 9h4l3 3v3h-7z\"/><circle cx=\"7\" cy=\"17.5\" r=\"1.8\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.8\"/></svg>',\n  orders: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 3h10v18H7z\"/><path d=\"M10 8h4M10 12h4M10 16h2\"/></svg>',\n  money: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\"/></svg>',\n  more: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><circle cx=\"5\" cy=\"12\" r=\"1.3\"/><circle cx=\"12\" cy=\"12\" r=\"1.3\"/><circle cx=\"19\" cy=\"12\" r=\"1.3\"/></svg>',\n  newtab: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h6v6\"/><path d=\"M20 4 11 13\"/><path d=\"M18 14v6H4V6h6\"/></svg>',\n  search: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/></svg>'\n};\n\n/* ---------- helpers ---------- */\nfunction $(s) { return document.querySelector(s); }\nfunction esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\nfunction n(x) { var v = parseFloat(x); return isNaN(v) ? 0 : v; }\nfunction r2(x) { return Math.round(x * 100) / 100; }\nfunction inr(x) { var neg = x < 0; return (neg ? '-' : '') + '₹' + Math.round(Math.abs(x)).toLocaleString('en-IN'); }\nfunction qt(x) { return n(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }\nfunction dmy(s) { if (!s) return ''; var p = String(s).split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : s; }\nfunction dm(s) { var x = dmy(s); return x ? x.slice(0, 5) : ''; }\nfunction days(a, b) { if (!a || !b) return 0; return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }\nfunction normTruck(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }\nfunction normName(s) { return String(s || '').toUpperCase().replace(/\\s+/g, ' ').trim(); }\nfunction trk(k) { return k + (k === 1 ? ' truck' : ' trucks'); }\nfunction sum(a, f) { return a.reduce(function (x, y) { return x + f(y); }, 0); }\nfunction liveAll() { return T.filter(function (t) { return !t.cx; }); }\nfunction live() { return T.filter(function (t) { return !t.cx && (FIRM === 'all' || t.firm === FIRM); }); }\n/* ---------- firms ---------- */\nfunction firms() { var l = String(D && D.settings.firms || '').split(',').map(normName).filter(String); return l.length ? l : ['']; }\nfunction multiFirm() { return firms().filter(String).length > 1; }\nfunction plantFirm() { return normName(D && D.settings.plantFirm || ''); }\nfunction firmOf(o) { return o && o.firm ? normName(o.firm) : firms()[0]; }\nfunction isFirm(name) { return !!name && firms().indexOf(normName(name)) >= 0; }\nfunction shortFirm(f) {\n  f = normName(f); if (!f) return '';\n  var w = f.split(' '), keep = [];\n  for (var i = 0; i < w.length; i++) { if (i > 0 && /^(SOLVEX|TRADING|TRADERS|AND|&|COMPANY|CO\\.?|PVT|LTD|PRIVATE|LIMITED)$/.test(w[i])) break; keep.push(w[i]); }\n  return keep.map(function (x) { return x.charAt(0) + x.slice(1).toLowerCase(); }).join(' ');\n}\nfunction inFirm(o) { return FIRM === 'all' || firmOf(o) === FIRM; }\nfunction tInFirm(t) { return FIRM === 'all' || t.firm === FIRM; }\nfunction firmTag(f) { if (!multiFirm() || !f) return ''; var i = firms().indexOf(normName(f)); return '<span class=\"ftag f' + (i < 0 ? 2 : i % 3) + '\">' + esc(shortFirm(f)) + '</span>'; }\nfunction isPhone() { try { return window.matchMedia('(max-width:860px)').matches; } catch (e) { return window.innerWidth <= 860; } }\nfunction toPlant(t) { var pf = plantFirm(); return !t.cx && !!pf && (t.plantPO || (!!t.so && normName(t.buyer) === pf)); }\nfunction toast(m, undo) {\n  var t = $('#toast'); t.innerHTML = esc(m) + (undo ? '<button type=\"button\" class=\"undo\" id=\"undoBtn\">Undo</button>' : ''); t.hidden = false;\n  if (undo) $('#undoBtn').onclick = function () { t.hidden = true; undo(); };\n  clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, undo ? 7000 : 2800);\n}\nfunction terms(o) {\n  if (!o) return '';\n  var g = o.gstMode === 'incl' ? 'GST incl.' : o.gstMode === 'excl' ? '+ GST' : 'GST not set';\n  var f = o.freightMode === 'ours' ? 'freight incl.' : o.freightMode === 'buyer' ? 'customer pays freight' : 'freight not set';\n  return g + ', ' + f;\n}\n/* Weight helper: 5 digits (e.g. 38450) = kg, 3 digits with decimal (384.50) = quintal */\nfunction toQtl(v) { var t = String(v).replace(/,/g, '').trim(); if (t === '') return ''; var x = Number(t); if (isNaN(x)) return NaN; return x >= 1000 ? r2(x / 100) : x; }\n\n/* ---------- links ---------- */\nfunction newTab(view, id) {\n  if (!window.APP_URL) return '';\n  return '<a class=\"newtab\" href=\"' + esc(APP_URL + '?view=' + encodeURIComponent(view) + '&id=' + encodeURIComponent(id)) + '\" target=\"_blank\" rel=\"noopener\" title=\"Open in new tab\">' + ICON.newtab + '</a>';\n}\nfunction ntsm(view, id) { return window.APP_URL && id ? '<a class=\"ntsm\" href=\"' + esc(APP_URL + '?view=' + encodeURIComponent(view) + '&id=' + encodeURIComponent(id)) + '\" target=\"_blank\" rel=\"noopener\" title=\"Open in new tab\">' + ICON.newtab + '</a>' : ''; }\nfunction lnk(view, id, text) { return id ? '<a href=\"#\" data-go=\"' + esc(view) + '\" data-id=\"' + esc(id) + '\">' + esc(text == null ? id : text) + '</a>' : '<span class=\"mu\">—</span>'; }\n\n/* ---------- server calls and login ---------- */\nfunction getTok() { try { return localStorage.getItem('ddgs_token'); } catch (e) { return TOKEN; } }\nfunction setTok(t) { TOKEN = t; try { if (t) localStorage.setItem('ddgs_token', t); else localStorage.removeItem('ddgs_token'); } catch (e) {} }\nvar OPEN_CALLS = { api_authState: 1, api_login: 1, api_createOwner: 1 };\nfunction call(fn) {\n  var args = Array.prototype.slice.call(arguments, 1);\n  if (!OPEN_CALLS[fn]) args.unshift(TOKEN || getTok());\n  return new Promise(function (res, rej) {\n    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {\n      var msg = (e && e.message) || String(e);\n      if (/LOGIN/.test(msg)) { cacheClear(); setTok(null); D = null; closeForm(); showAuth('Please log in again.'); rej(new Error('Please log in again.')); return; }\n      rej(new Error(msg));\n    });\n    r[fn].apply(r, args);\n  });\n}\nfunction showAuth(note) {\n  $('#toast').hidden = true; D = null; $('#nav').innerHTML = ''; $('#who').innerHTML = ''; $('#fab').hidden = true; $('#sync').textContent = 'Not logged in';\n  $('#view').innerHTML = '<div id=\"load\">Opening…</div>';\n  call('api_authState').then(function (s) {\n    if (s.company) $('#co').textContent = s.company;\n    if (s.importReport) PENDING_IMPORT = s.importReport;\n    if (s.needsOwner && s.isOwnerGoogle) {\n      $('#view').innerHTML = '<form class=\"auth\" id=\"authForm\" autocomplete=\"off\"><h3>Create your owner login</h3><p>This is the first login for the app. You will use it to add your staff later.</p>' +\n        '<label for=\"a_user\">Username</label><input id=\"a_user\" placeholder=\"e.g. nitish\" autocomplete=\"off\" autocapitalize=\"none\">' +\n        '<label for=\"a_name\">Your name</label><input id=\"a_name\" autocomplete=\"off\">' +\n        '<label for=\"a_pw\">Password (6+ characters)</label><input id=\"a_pw\" type=\"password\" autocomplete=\"new-password\">' +\n        '<label for=\"a_pw2\">Repeat password</label><input id=\"a_pw2\" type=\"password\" autocomplete=\"new-password\">' +\n        '<div class=\"msg err\" id=\"aerr\" hidden style=\"margin:12px 0 0\"></div><button class=\"btn pri\" type=\"submit\">Create owner login</button></form>';\n      $('#authForm').onsubmit = function (ev) {\n        ev.preventDefault();\n        if ($('#a_pw').value !== $('#a_pw2').value) return authErr('The two passwords do not match.');\n        authSubmit(call('api_createOwner', $('#a_user').value, $('#a_name').value, $('#a_pw').value));\n      };\n    } else if (s.needsOwner) {\n      $('#view').innerHTML = '<div class=\"auth\"><h3>Setup not finished</h3><p>The owner has to open this link first and create the owner login. Ask the owner, then reload this page.</p></div>';\n    } else {\n      $('#view').innerHTML = '<form class=\"auth\" id=\"authForm\"><h3>Log in</h3><p>' + esc(note || 'Use the username and password the owner gave you.') + '</p>' +\n        '<label for=\"a_user\">Username</label><input id=\"a_user\" autocomplete=\"username\" autocapitalize=\"none\">' +\n        '<label for=\"a_pw\">Password</label><input id=\"a_pw\" type=\"password\" autocomplete=\"current-password\">' +\n        '<div class=\"msg err\" id=\"aerr\" hidden style=\"margin:12px 0 0\"></div><button class=\"btn pri\" type=\"submit\">Log in</button></form>';\n      $('#authForm').onsubmit = function (ev) { ev.preventDefault(); authSubmit(call('api_login', $('#a_user').value, $('#a_pw').value)); };\n    }\n  }).catch(function (e) { $('#view').innerHTML = '<div class=\"note\">Could not open the app: ' + esc(e.message) + '. Reload the page to try again.</div>'; });\n}\nfunction authErr(m) { var e = $('#aerr'); e.textContent = m; e.hidden = false; }\nfunction authSubmit(p) {\n  var b = $('#authForm .btn'); b.disabled = true; b.textContent = 'Please wait…';\n  p.then(function (r) { setTok(r.token); load(); }).catch(function (e) { b.disabled = false; b.textContent = 'Try again'; authErr(e.message); });\n}\n\n/* ---------- data ---------- */\n/* Saved copy: the app shows the last data at once, then refreshes from the sheet in the background. */\nfunction cacheGet() { try { var c = JSON.parse(localStorage.getItem('ddgs_cache') || 'null'); return c && c.tok === (TOKEN || getTok()) ? c.d : null; } catch (e) { return null; } }\nfunction cachePut(d) { try { localStorage.setItem('ddgs_cache', JSON.stringify({ tok: TOKEN || getTok(), d: d })); } catch (e) {} }\nfunction cacheClear() { try { localStorage.removeItem('ddgs_cache'); } catch (e) {} }\nfunction load(silent) {\n  if (BUSY) return;\n  if (!(TOKEN || getTok())) { showAuth(); return; }\n  if (!D) { var c = cacheGet(); if (c) { setData(c, true); $('#sync').textContent = 'Updating…'; } }\n  call('api_getData').then(function (d) {\n    setData(d);\n    if (PENDING_IMPORT) { showImport(PENDING_IMPORT); PENDING_IMPORT = null; }\n  }).catch(function (e) {\n    if (silent) return;\n    if (D) toast(e.message);\n    else if (!/log in/i.test(e.message)) $('#view').innerHTML = '<div class=\"note\">Could not load data: ' + esc(e.message) + '. Reload the page to try again.</div>';\n  });\n}\nfunction setData(d, fromCache) {\n  if (!fromCache) cachePut(d);\n  D = d; P = d.perm || {}; PO = {}; SO = {};\n  d.po.forEach(function (p) { PO[p.id] = p; });\n  d.so.forEach(function (s) { SO[s.id] = s; });\n  T = CARRY(d.trucks.map(derive));\n  flagIssues();\n  $('#sync').textContent = 'Synced ' + d.syncedAt.slice(11);\n  if (d.settings.company) $('#co').textContent = d.settings.company;\n  $('#who').innerHTML = d.me ? '<button type=\"button\" class=\"who\" data-act=\"me\">' + esc((d.me.name || d.me.id).split(' ')[0]) + ' <span class=\"hide-phone\">· ' + esc(d.me.role) + '</span></button>' : '';\n  render();\n}\n\nfunction derive(t) {\n  var po = PO[t.po], so = SO[t.so], S = D.settings;\n  var plantPO = !!(po && po.poType === 'plant');\n  if (plantPO) so = null;\n  var L = n(t.loadWt), U = n(t.unloadWt), R = n(t.received), A = n(t.advance), FR = n(t.frate), DED = n(t.deduction);\n  var own = t.saleRate === '' || t.saleRate == null ? null : n(t.saleRate);\n  var poRate = po ? n(po.rate) : 0, poG = po ? n(po.gst) : 0, soRate = so ? (own !== null ? own : n(so.rate)) : 0, soG = so ? n(so.gst) : 0;\n  var x = Object.assign({}, t);\n  x.L = L; x.U = U; x.R = R; x.A = A; x.FR = FR; x.DED = DED;\n  x.plant = po ? po.plant : ''; x.buyer = so ? so.buyer : '';\n  x.plantPO = plantPO; x.firm = firmOf(po); x.ownBuyer = !!(so && isFirm(so.buyer)); x.rateUsed = soRate; x.rateOwn = own !== null;\n  x.purEx = r2(L * poRate); x.purTot = r2(x.purEx * (1 + poG));\n  x.saleWt = U || L;\n  var gIncl = !!(so && so.gstMode === 'incl');\n  x.fBuyer = !!(so && so.freightMode === 'buyer');\n  x.soBase = gIncl ? soRate / (1 + soG) : soRate;\n  x.saleEx = so ? r2(x.saleWt * x.soBase) : 0;\n  x.saleTot = so ? r2(gIncl ? x.saleWt * soRate : x.saleEx * (1 + soG)) : 0;\n  x.short = U ? r2(Math.max(0, L - U)) : 0;\n  x.allow = L * n(S.shortageAllowancePct);\n  x.shortDed = !U || x.fBuyer ? 0 : plantPO ? r2(Math.max(0, x.short - x.allow) * poRate * (1 + poG)) : so ? r2(Math.max(0, x.short - x.allow) * x.soBase * (1 + soG)) : 0;\n  x.frAmt = x.fBuyer ? 0 : r2(U * FR);\n  x.trip = t.date ? days(t.date, t.unloadDate || D.today) : 0;\n  x.freeDays = S.freeDays === undefined || S.freeDays === '' ? 3 : n(S.freeDays);\n  x.perDay = S.detentionPerDay === undefined || S.detentionPerDay === '' ? 500 : n(S.detentionPerDay);\n  x.detDays = Math.max(0, x.trip - x.freeDays);\n  x.detSuggest = x.fBuyer ? 0 : x.detDays * x.perDay;\n  // Detention is only a suggestion: it counts only when someone enters an amount (decided per truck when paying freight).\n  x.det = x.fBuyer || !U ? 0 : (t.detention === '' || t.detention == null ? 0 : n(t.detention));\n  x.netFr = U && !x.fBuyer ? r2(x.frAmt - x.shortDed - A + x.det) : 0;\n  x.bal = U && so ? r2(Math.max(0, x.saleTot - R - DED)) : 0;\n  // Sales to your group company: freight and detention are not taken off the margin (shortage recovered from the transporter still counts).\n  x.profit = U && so && po ? r2(x.saleEx - x.purEx - (x.ownBuyer ? -x.shortDed : x.frAmt - x.shortDed + x.det)) : 0;\n  x.cx = t.status === 'Cancelled' || t.status === 'Returned'; x.returned = t.status === 'Returned';\n  var full = U && so && (R > 0 || DED > 0) && R + DED >= x.saleTot - 1;\n  var st;\n  if (x.cx) st = -1;\n  else if (plantPO) st = U && t.freightPaid ? 6 : U ? 3 : t.plantPaid ? 2 : L ? 1 : 0;\n  else if (full && (t.freightPaid || x.fBuyer)) st = 6;\n  else if (full) st = 5;\n  else if (R > 0 || DED > 0) st = 4;\n  else if (U) st = 3;\n  else if (t.plantPaid) st = 2;\n  else if (L) st = 1;\n  else st = 0;\n  if (!P.money && t._st !== undefined && t._st !== '') st = n(t._st);\n  x.billQ = t.billQty === '' || t.billQty == null ? null : n(t.billQty);\n  x.billOk = x.billQ !== null && L > 0 && Math.abs(x.billQ - L) < 0.005;\n  x.st = st; x.stage = st < 0 ? (x.returned ? 'Returned' : 'Cancelled') : plantPO && st === 3 ? 'Received' : STAGES[st];\n  x.stuck = st >= 0 && st <= 2 && x.trip > n(S.stuckDays || 3);\n  x.credit = so ? (so.creditDays === '' || so.creditDays == null ? n(S.defaultCreditDays || 7) : n(so.creditDays)) : 0;\n  x.overdue = U && so && x.bal > 0 && t.unloadDate ? Math.max(0, days(t.unloadDate, D.today) - x.credit) : 0;\n  x.placed = t.placedOn || t.date;\n  x.noSlip = L > 0 && !t.slipPhoto && (!S.slipCheckFrom || String(t.date) >= String(S.slipCheckFrom));\n  x.issues = [];\n  return x;\n}\n\n/* A driver's advance is adjusted across all trips of the same truck: extra advance on one trip reduces what is paid on its next trips. */\nfunction CARRY(list) {\n  var by = {}, r = function (v) { return Math.round(v * 100) / 100; };\n  list.forEach(function (t) {\n    t.netPay = t.netFr; t.carryIn = 0; t.carryOut = 0; t.carryLeft = 0;\n    if (t.cx || t.fBuyer || !t.U) return;\n    var k = String(t.truck || '').toUpperCase().replace(/[^A-Z0-9]/g, '');\n    (by[k] = by[k] || []).push(t);\n  });\n  Object.keys(by).forEach(function (k) {\n    var run = 0, trips = by[k].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)); });\n    trips.forEach(function (t) {\n      if (t.netFr < 0) { t.netPay = 0; t.carryOut = r(-t.netFr); run = r(run - t.netFr); return; }\n      var use = Math.min(run, t.netFr);\n      t.carryIn = r(use); t.netPay = r(t.netFr - use); run = r(run - use);\n    });\n    trips[trips.length - 1].carryLeft = run;\n  });\n  return list;\n}\nfunction flagIssues() {\n  var L = liveAll();\n  L.forEach(function (t) {\n    if (t.L && t.billQ !== null && !t.billOk) t.issues.push({ bad: 1, msg: 'Slip weight ' + qt(t.L) + ' but supplier invoice ' + qt(t.billQ) + ' qtl. Check the slip and correct one of them' });\n    var tn = normTruck(t.truck);\n    L.forEach(function (o) {\n      if (o.id === t.id) return;\n      if (normTruck(o.truck) === tn && o.date === t.date && o.id < t.id) t.issues.push({ bad: 1, msg: 'Same truck entered twice on ' + dmy(t.date) + ' (also ' + o.id + ')' });\n      else if (normTruck(o.truck) === tn && o.id < t.id && !o.U) t.issues.push({ bad: 1, msg: 'Same truck is on trip ' + o.id + ' (' + dmy(o.date) + ') which was never unloaded' });\n      if (t.L && o.L === t.L && o.po === t.po && o.id < t.id && !(t.billQ !== null && t.billOk)) t.issues.push({ bad: 1, msg: 'Same loaded weight (' + qt(t.L) + ' qtl) as ' + o.id + '. Copied by mistake?' });\n    });\n    if (t.L && !t.U && t.detDays > 0 && !t.fBuyer) t.issues.push({ bad: 1, msg: 'On the road ' + t.trip + ' days, over the ' + t.freeDays + ' free days' + (P.money ? ' (detention claim possible: ' + inr(t.detSuggest) + ' if agreed)' : '') });\n    if (P.money) {\n      if (t.carryOut > 0) t.issues.push({ bad: 0, msg: 'Advance ' + inr(t.carryOut) + ' more than this trip\\u2019s freight. Adjusted on the next trip of ' + t.truck });\n      if (t.carryIn > 0) t.issues.push({ bad: 0, msg: inr(t.carryIn) + ' extra advance from an earlier trip of this truck adjusted here' });\n      if (t.fBuyer && t.A) t.issues.push({ bad: 1, msg: 'Customer pays freight, but you gave ' + inr(t.A) + ' freight advance. Recover it' });\n      if (t.overdue) t.issues.push({ bad: 1, msg: 'Customer payment overdue ' + t.overdue + ' days · ' + inr(t.bal) });\n    }\n    if (!t.po || !PO[t.po]) t.issues.push({ bad: 1, msg: 'PO ' + (t.po || '(blank)') + ' not found' });\n    if (t.so && !SO[t.so]) t.issues.push({ bad: 1, msg: 'SO ' + t.so + ' not found' });\n  });\n}\n\nfunction orderStats(kind, o) {\n  var key = kind === 'po' ? 'po' : 'so';\n  var tr = liveAll().filter(function (t) { return t[key] === o.id; });\n  var done = sum(tr, function (t) { return t.L; });\n  return { tr: tr, done: r2(done), unl: r2(sum(tr, function (t) { return t.U; })), short: r2(sum(tr, function (t) { return t.short; })), bal: r2(n(o.qty) - done), pct: n(o.qty) ? Math.min(100, done / n(o.qty) * 100) : 0 };\n}\n\n/* What this person should do next on this truck */\nfunction nextStep(t) {\n  if (t.cx) return null;\n  if (!t.L) return P.trucks ? { a: 'load', l: 'Enter weight' } : null;\n  if (!t.so && !t.plantPO) return P.trucks ? { a: 'assign', l: 'Choose customer' } : null;\n  if (!t.plantPaid && P.truckMoney) return { a: 'paid', l: 'Mark supplier paid', m: 1 };\n  if (!t.U) return P.trucks ? { a: 'unload', l: toPlant(t) ? 'Mark received' : 'Record unloading' } : null;\n  if (t.bal > 0 && P.truckMoney) return { a: 'receive', l: 'Add payment', m: 1 };\n  if (!t.fBuyer && !t.freightPaid && P.truckMoney) return { a: 'fpaid', l: 'Pay freight', m: 1 };\n  return null;\n}\n/* ---------- routing ---------- */\nvar DETAIL = ['po', 'so', 'buyer', 'plant', 'transporter', 'truck', 'users', 'notes'];\nfunction mainTabs() {\n  var notCx = function (o) { return o.status !== 'Cancelled'; };\n  var tabs = [['home', 'Overview'], ['pos', 'Purchase Orders', D.po.filter(inFirm).filter(notCx).length], ['sos', 'Sale Orders', D.so.filter(inFirm).filter(notCx).length], ['dispatch', 'Dispatch Register', live().length]];\n  if (plantFirm()) tabs.push(['receive', 'Plant Inward (' + shortFirm(plantFirm()) + ')', live().filter(function (t) { return toPlant(t) && t.L && !t.U; }).length]);\n  if (P.money) tabs.push(['settle', 'Sales & Receivables', live().filter(function (t) { return t.so && !t.plantPO; }).length], ['freight', 'Freight & Transport', live().filter(function (t) { return t.L && !t.fBuyer; }).length]);\n  if (P.review) tabs.push(['activity', 'Activity']);\n  tabs.push(['more', 'More']);\n  return tabs;\n}\nfunction go(v, id) {\n  if (DETAIL.indexOf(v) >= 0) HIST.push(ROUTE); else HIST = [];\n  ROUTE = { v: v, id: id }; LIMIT = 60; FLOWSEL = '';\n  render(); window.scrollTo(0, 0);\n}\nfunction back() { ROUTE = HIST.pop() || { v: 'home' }; render(); window.scrollTo(0, 0); }\n\nfunction render() {\n  if (!D) return;\n  if (!P.money && (ROUTE.v === 'settle' || ROUTE.v === 'freight')) ROUTE = { v: 'home' };\n  if (!P.review && ROUTE.v === 'activity') ROUTE = { v: 'home' };\n  var tab = { po: 'pos', so: 'sos', buyer: 'sos', plant: 'pos', transporter: P.money ? 'freight' : 'dispatch', truck: 'dispatch', users: 'more' }[ROUTE.v] || ROUTE.v;\n  $('#nav').innerHTML = mainTabs().map(function (v) { return '<button type=\"button\" class=\"' + (tab === v[0] ? 'on' : '') + '\" data-tab=\"' + v[0] + '\">' + v[1] + (v[2] != null ? ' <span class=\"cnt\">' + v[2] + '</span>' : '') + '</button>'; }).join('');\n  var on = $('#nav .on'); if (on) { var nv = $('#nav'); if (on.offsetLeft < nv.scrollLeft || on.offsetLeft + on.offsetWidth > nv.scrollLeft + nv.clientWidth) nv.scrollLeft = on.offsetLeft - 16; }\n  $('#fab').hidden = !(P.trucks && ROUTE.v === 'dispatch');\n  var f = { home: vHome, pos: function () { return orderTable('po'); }, sos: function () { return orderTable('so'); }, dispatch: vDispatch, receive: vReceive, settle: vSettle, freight: vFreight,\n    more: vMore, activity: vActivity, users: P.users ? vUsers : vMore, notes: vNotes, po: function () { return vOrder('po', ROUTE.id); }, so: function () { return vOrder('so', ROUTE.id); },\n    buyer: function () { return vParty('buyer', ROUTE.id); }, plant: function () { return vParty('plant', ROUTE.id); }, transporter: function () { return vParty('transporter', ROUTE.id); }, truck: function () { return vTruck(ROUTE.id); } }[ROUTE.v] || vHome;\n  var bar = multiFirm() && DETAIL.indexOf(ROUTE.v) < 0 && ROUTE.v !== 'more' && ROUTE.v !== 'activity' ? firmBar() : '';\n  $('#view').innerHTML = bar + f();\n}\nfunction firmBar() {\n  var f = firms();\n  return '<div class=\"firmbar\"><span class=\"mu\">Firm</span><div class=\"seg\"><button type=\"button\" class=\"' + (FIRM === 'all' ? 'on' : '') + '\" data-firm=\"all\">' + (f.length > 2 ? 'All' : 'Both') + '</button>' +\n    f.map(function (x) { return '<button type=\"button\" class=\"' + (FIRM === x ? 'on' : '') + '\" data-firm=\"' + esc(x) + '\" title=\"' + esc(x) + '\">' + esc(shortFirm(x)) + '</button>'; }).join('') + '</div></div>';\n}\nfunction searchBox() { return '<div class=\"search\">' + ICON.search + '<input id=\"q\" type=\"search\" placeholder=\"Search truck, DISP, PO, buyer…\" value=\"' + esc(QS) + '\" autocomplete=\"off\"></div>'; }\nfunction more(list) { return list.length > LIMIT ? '<button type=\"button\" class=\"btn showmore\" data-act=\"showmore\">Show more (' + (list.length - LIMIT) + ' left)</button>' : ''; }\nfunction subChips(view, opts, list) {\n  return '<div class=\"chips\">' + opts.map(function (o) { var c = list.filter(o[2]).length; if (!c && o[0] !== 'all' && SUBF[view] !== o[0]) return ''; return '<button type=\"button\" class=\"chip ' + (SUBF[view] === o[0] ? 'on' : '') + '\" data-sf=\"' + o[0] + '\">' + o[1] + ' <b>' + c + '</b></button>'; }).join('') + '</div>';\n}\nfunction kpi(l, v, s, cls, go2) { return (go2 ? '<button type=\"button\" class=\"kpi ' + (cls || '') + '\" ' + go2 + '>' : '<div class=\"kpi ' + (cls || '') + '\">') + '<div class=\"l\">' + l + '</div><div class=\"v\">' + v + '</div><div class=\"s\">' + (s || '&nbsp;') + '</div>' + (go2 ? '</button>' : '</div>'); }\nfunction pageHead(title, sub, extra, nt) {\n  return '<div class=\"ph\"><button type=\"button\" class=\"back\" data-act=\"back\">← Back</button><h1>' + title + '</h1><span class=\"sp\"></span>' + (extra || '') + (nt ? '<span class=\"hide-phone\">' + nt + '</span>' : '') + (sub ? '<div class=\"sub\">' + sub + '</div>' : '') + '</div>';\n}\n\n/* ---------- Home ---------- */\nvar TODO = [\n  ['billpending', 'Supplier invoice pending', function (t) { return t.L && t.billQ === null; }, 'trucks'],\n  ['noweight', 'Enter weight', function (t) { return !t.L; }, 'trucks'],\n  ['nobuyer', 'Choose customer', function (t) { return t.L && !t.so && !t.plantPO; }, 'trucks'],\n  ['plantunpaid', 'Pay supplier', function (t) { return t.L && !t.plantPaid; }, 'truckMoney'],\n  ['onroad', 'On the road', function (t) { return t.L && !t.U; }, 'trucks'],\n  ['paydue', 'Collect payment', function (t) { return t.bal > 0; }, 'truckMoney'],\n  ['freightdue', 'Pay freight', function (t) { return t.U && !t.fBuyer && !t.freightPaid; }, 'truckMoney'],\n  ['notransporter', 'No transporter', function (t) { return t.L && !t.transporter; }, 'trucks'],\n  ['noslip', 'No slip photo', function (t) { return t.noSlip; }, 'trucks']\n];\nfunction vHome() {\n  var L = live(), h = '';\n  if (P.money) {\n    var road = L.filter(function (t) { return t.L && !t.U; });\n    var out = L.filter(function (t) { return !t.ownBuyer; }), own = L.filter(function (t) { return t.ownBuyer && t.bal > 0; });\n    var ownNames = Object.keys(own.reduce(function (m, t) { m[shortFirm(t.buyer) + ' owes ' + shortFirm(t.firm)] = 1; return m; }, {})).join(', ');\n    var unp = L.filter(function (t) { return t.L && !t.plantPaid; });\n    var prof = L.filter(function (t) { return t.U && t.so && t.po && !t.plantPO && (FIRM !== 'all' || !t.ownBuyer); });\n    h += '<h2>Money</h2><div class=\"kpis\">' +\n      kpi('To pay suppliers', inr(sum(unp, function (t) { return t.purTot; })), trk(unp.length) + ' loaded, unpaid', 'warn', 'data-filter=\"plantunpaid\"') +\n      kpi('Customers owe you', inr(sum(out, function (t) { return t.bal; })), trk(out.filter(function (t) { return t.bal > 0; }).length), '', 'data-tab=\"settle\"') +\n      (own.length ? kpi('Group company owes', inr(sum(own, function (t) { return t.bal; })), esc(ownNames), '', 'data-tab=\"settle\"') : '') +\n      kpi('Overdue from customers', inr(sum(out.filter(function (t) { return t.overdue > 0; }), function (t) { return t.bal; })), 'past credit days', 'bad', 'data-tab=\"settle\"') +\n      kpi('Freight to pay', inr(sum(L.filter(function (t) { return t.U && !t.freightPaid; }), function (t) { return t.netPay; })), 'after advance, shortage, detention', '', 'data-tab=\"freight\"') +\n      kpi('On the road', qt(sum(road, function (t) { return t.L; })) + ' qtl', trk(road.length), '', 'data-filter=\"onroad\"') +\n      (P.profit ? kpi('Trading profit before GST', inr(sum(prof, function (t) { return t.profit; })), FIRM === 'all' ? 'outside buyers, unloaded trucks' : 'unloaded trucks', 'good') : '') +\n      '</div>';\n  } else {\n    h += '<div class=\"kpis\">' + kpi('Trucks in progress', L.filter(function (t) { return t.st < 3; }).length, 'not unloaded yet', '', 'data-filter=\"todo\"') +\n      kpi('On the road', qt(sum(L.filter(function (t) { return t.L && !t.U; }), function (t) { return t.L; })) + ' qtl', '', '', 'data-filter=\"onroad\"') + '</div>';\n  }\n  h += '<h2>Where the trucks are</h2><div class=\"stages\">' + STAGES.map(function (s, i) { return '<button type=\"button\" data-filter=\"st' + i + '\"><b>' + L.filter(function (t) { return t.st === i; }).length + '</b><span>' + (i === 3 ? 'Unloaded / received' : s) + '</span></button>'; }).join('') + '</div>';\n  var todo = TODO.filter(function (x) { return P[x[3]]; }).map(function (x) { return { k: x[0], l: x[1], c: L.filter(x[2]).length }; }).filter(function (x) { return x.c; });\n  if (P.money) { var nt = D.so.filter(inFirm).filter(function (o) { return o.status !== 'Cancelled' && (!o.gstMode || !o.freightMode); }).length; if (nt) todo.push({ k: 'rate', l: 'Set rate type on SO', c: nt }); }\n  h += '<h2>To do</h2>' + (todo.length ? '<div class=\"todo\">' + todo.map(function (x) { return '<button type=\"button\" ' + (x.k === 'rate' ? 'data-tab=\"sos\"' : 'data-filter=\"' + x.k + '\"') + '><b>' + x.c + '</b><span>' + x.l + '</span></button>'; }).join('') + '</div>' : '<div class=\"panel empty\">Nothing pending.</div>');\n  var probs = [];\n  L.forEach(function (t) { var m = t.issues.filter(function (i) { return i.bad; }).map(function (i) { return i.msg; }); if (m.length) probs.push({ t: t, msg: m.join(' · ') }); });\n  [['po', D.po], ['so', D.so]].forEach(function (k) {\n    k[1].filter(function (o) { return o.status !== 'Cancelled' && o.status !== 'Settled' && inFirm(o); }).forEach(function (o) { var s = orderStats(k[0], o); if (s.bal < 0) probs.unshift({ o: o, kind: k[0], msg: 'Over the ordered quantity by ' + qt(-s.bal) + ' qtl' }); });\n  });\n  h += '<div class=\"two\"><div><h2>Problems (' + probs.length + ')</h2><div class=\"panel\">' + (probs.length ? probs.slice(0, 30).map(function (p) {\n    if (p.o) return '<button type=\"button\" class=\"prob\" data-go=\"' + p.kind + '\" data-id=\"' + esc(p.o.id) + '\"><span class=\"dot\"></span><span><b>' + esc(p.o.id) + ' · ' + esc(p.o.plant || p.o.buyer) + '</b><small>' + esc(p.msg) + '</small></span></button>';\n    return '<button type=\"button\" class=\"prob\" data-go=\"truck\" data-id=\"' + esc(p.t.id) + '\"><span class=\"dot\"></span><span><b>' + esc(p.t.truck) + ' · ' + esc(p.t.id) + '</b> ' + firmTag(p.t.firm) + p.msg.split(' · ').map(function (m) { return '<small>' + esc(m) + '</small>'; }).join('') + '</span></button>';\n  }).join('') : '<div class=\"empty\">No problems. All clear.</div>') + '</div></div>';\n  h += '<div><h2>Orders</h2><div class=\"panel\">' + orderRows('po', true) + orderRows('so', true) + '</div></div></div>';\n  return h;\n}\n/* ---------- Trucks ---------- */\nvar FILTERS = [['todo', 'My to do'], ['all', 'All']].concat(TODO.map(function (x) { return [x[0], x[1]]; })).concat([['problems', 'Problems'], ['closed', 'Closed'], ['returned', 'Returned'], ['cx', 'Cancelled']]);\nfunction filterFn(k) {\n  if (/^st\\d$/.test(k)) return function (t) { return !t.cx && t.st === +k.slice(2); };\n  if (k === 'all') return function (t) { return !t.cx; };\n  if (k === 'todo') return function (t) { return !t.cx && !!nextStep(t); };\n  if (k === 'problems') return function (t) { return !t.cx && t.issues.some(function (i) { return i.bad; }); };\n  if (k === 'closed') return function (t) { return t.st === 6; };\n  if (k === 'cx') return function (t) { return t.status === 'Cancelled'; };\n  if (k === 'returned') return function (t) { return t.returned; };\n  var x = TODO.filter(function (y) { return y[0] === k; })[0];\n  return x ? function (t) { return !t.cx && x[2](t); } : function () { return true; };\n}\nfunction matchQ(t) {\n  if (!QS) return true;\n  var q = QS.replace(/\\s+/g, '');\n  return [t.id, t.truck, t.po, t.so, t.buyer, t.plant, t.transporter, t.firm, t.driver, t.plantUTR, t.freightUTR, t.billNo].join('|').toLowerCase().replace(/\\s+/g, '').indexOf(q) >= 0;\n}\nfunction sortT(a, b) { return (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id); }\nfunction vDispatch() {\n  var avail = FILTERS.filter(function (f) { var x = TODO.filter(function (y) { return y[0] === f[0]; })[0]; return !x || P[x[3]]; });\n  if (/^st\\d$/.test(FILTER)) avail = avail.concat([[FILTER, STAGES[+FILTER.slice(2)]]]);\n  var base = T.filter(tInFirm);\n  var list = base.filter(filterFn(FILTER)).filter(matchQ).sort(sortT);\n  LASTIDS = list.map(function (t) { return t.id; });\n  var h = '<div class=\"bar\">' + searchBox() + (P.truckMoney ? '<button type=\"button\" class=\"btn\" data-act=\"payPlantBatch\">Pay supplier (several trucks)</button>' : '') + (P.trucks ? '<button type=\"button\" class=\"btn pri hide-phone\" data-act=\"newTruck\">+ New truck</button>' : '') + '</div>';\n  h += '<div class=\"chips\">' + avail.map(function (f) { var c = base.filter(filterFn(f[0])).length; if (!c && f[0] !== 'todo' && f[0] !== 'all' && f[0] !== FILTER) return ''; return '<button type=\"button\" class=\"chip ' + (FILTER === f[0] ? 'on' : '') + '\" data-filter=\"' + f[0] + '\">' + f[1] + ' <b>' + c + '</b></button>'; }).join('') + '</div>';\n  h += '<div class=\"bar\"><span class=\"mu\">' + trk(list.length) + '</span><span class=\"sp\"></span>' + (P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportList\">Download this list</button>' : '') + '</div>';\n  if (isPhone()) return h + truckList(list);\n  if (!list.length) return h + '<div class=\"panel empty\">No trucks here.</div>';\n  var M = P.money;\n  var cols = M ? '112px 1fr 1.15fr 1.35fr .8fr .9fr 98px 128px 150px 40px' : '112px 1fr 1.2fr 1.5fr .9fr 1.1fr 150px 40px';\n  h += '<div class=\"tbl\" style=\"--cols:' + cols + '\"><div class=\"tr th\"><div>Dispatch</div><div>PO / plant</div><div>Truck</div><div>Going to</div><div class=\"r\">Loaded</div>' + (M ? '<div class=\"r\">Supplier amount</div><div>Supplier</div><div>Freight adv.</div>' : '<div>Transporter</div>') + '<div>Next step</div><div></div></div>';\n  h += list.slice(0, LIMIT).map(function (t) {\n    var lv = !t.cx, ns = nextStep(t);\n    var go2 = t.plantPO ? '<span class=\"tag own\">Own plant</span> ' + esc(shortFirm(plantFirm())) : t.so ? lnk('buyer', t.buyer) + '<small>' + lnk('so', t.so) + (t.ownBuyer ? ' · group company' : '') + '</small>' : (lv && P.trucks ? '<button class=\"pill add\" type=\"button\" data-act=\"assign\" data-id=\"' + esc(t.id) + '\">+ Choose customer</button>' : '—');\n    var row = '<div class=\"td\">' + lnk('truck', t.id) + ntsm('truck', t.id) + '<small>' + dmy(t.date) + '</small></div>' +\n      '<div class=\"td\" data-l=\"PO\">' + lnk('po', t.po) + ' ' + firmTag(t.firm) + '<small>' + lnk('plant', t.plant) + '</small></div>' +\n      '<div class=\"td wide\" data-l=\"Truck\"><b>' + esc(t.truck) + '</b> ' + (t.noSlip ? '<span class=\"tag no\">No slip</span> ' : '') + (t.billOk ? '<span class=\"tag ok\" title=\"Slip weight matches supplier invoice\">Checked</span> ' : '') + (t.issues.some(function (i) { return i.bad; }) ? '<span class=\"tag\" title=\"' + esc(t.issues.map(function (i) { return i.msg; }).join(' · ')) + '\">Check</span>' : '') +\n        '<div style=\"margin-top:3px\"><span class=\"stage ' + (t.st < 0 ? 'sx' : 's' + t.st) + '\">' + t.stage + '</span>' + (t.L && !t.U && t.detDays > 0 && !t.fBuyer ? ' <span class=\"tag wn\">' + t.trip + ' days</span>' : '') + '</div></div>' +\n      '<div class=\"td wide\" data-l=\"Going to\">' + go2 + '</div>' +\n      '<div class=\"td r num\" data-l=\"Loaded\">' + (t.L ? '<b>' + qt(t.L) + '</b>' + (t.U ? '<small>unl. ' + qt(t.U) + '</small>' : '') : (lv && P.trucks ? '<button class=\"pill wait\" type=\"button\" data-act=\"load\" data-id=\"' + esc(t.id) + '\">+ Weight</button>' : '—')) + '</div>';\n    if (M) row += '<div class=\"td r num\" data-l=\"Supplier amount\">' + (t.L ? inr(t.purTot) : '—') + '</div>' +\n      '<div class=\"td\" data-l=\"Supplier\">' + (!lv || !t.L ? '' : P.truckMoney && !t.plantPaid ? '<button class=\"pill wait\" type=\"button\" data-act=\"paid\" data-id=\"' + esc(t.id) + '\">◷ Unpaid</button>' : '<span class=\"pill ' + (t.plantPaid ? 'ok' : 'wait') + '\">' + (t.plantPaid ? '✓ Paid' : '◷ Unpaid') + '</span>') + '</div>' +\n      '<div class=\"td\" data-l=\"Freight adv.\">' + (!lv || t.fBuyer ? (t.fBuyer ? '<span class=\"mu\">Customer pays</span>' : '') : P.truckMoney ? '<button class=\"pill ' + (t.A ? 'info' : 'wait') + '\" type=\"button\" data-act=\"advance\" data-id=\"' + esc(t.id) + '\">' + (t.A ? inr(t.A) : '+ Advance') + '</button>' : (t.A ? inr(t.A) : '—')) + '</div>';\n    else row += '<div class=\"td\" data-l=\"Transporter\">' + lnk('transporter', t.transporter) + '</div>';\n    row += '<div class=\"td\" data-l=\"Next step\">' + (ns ? '<button type=\"button\" class=\"nx ' + (ns.m ? 'money' : '') + '\" data-act=\"' + ns.a + '\" data-id=\"' + esc(t.id) + '\">' + ns.l + '</button>' : (t.cx ? '' : '<span class=\"done\">' + (t.st === 6 ? '✓ Closed' : '✓ Done') + '</span>')) + '</div>' +\n      '<div class=\"td acts\"><button type=\"button\" class=\"ib\" data-act=\"menu\" data-id=\"' + esc(t.id) + '\" aria-label=\"More actions\">⋯</button></div>';\n    return '<div class=\"tr ' + (t.cx ? 'cx' : '') + '\">' + row + '</div>';\n  }).join('') + '</div>' + more(list);\n  return h;\n}\nfunction vReceive() {\n  var pf = plantFirm(), base = T.filter(function (t) { return toPlant(t) && tInFirm(t); });\n  var arriving = base.filter(function (t) { return t.L && !t.U; }).filter(matchQ).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });\n  var notLoaded = base.filter(function (t) { return !t.L; }).filter(matchQ);\n  var month = D.today.slice(0, 7);\n  var recd = base.filter(function (t) { return t.U && t.unloadDate; });\n  var recent = recd.filter(function (t) { return days(t.unloadDate, D.today) <= 7; }).filter(matchQ).sort(function (a, b) { return (b.unloadDate || '').localeCompare(a.unloadDate || '') || b.id.localeCompare(a.id); });\n  var mon = recd.filter(function (t) { return t.unloadDate.slice(0, 7) === month; }), tod = recd.filter(function (t) { return t.unloadDate === D.today; });\n  LASTIDS = arriving.concat(recent).map(function (t) { return t.id; });\n  var h = '<div class=\"ph\" style=\"margin-bottom:6px\"><h1>Plant Inward (' + esc(pf) + ')</h1><div class=\"sub\">Every truck coming to the plant, whichever firm bought it. Tap Mark received and type the weighbridge weight.</div></div>';\n  h += '<div class=\"kpis\" style=\"margin-bottom:14px\">' + kpi('Arriving', trk(arriving.length), qt(sum(arriving, function (t) { return t.L; })) + ' qtl loaded') +\n    kpi('Received today', qt(sum(tod, function (t) { return t.U; })) + ' qtl', trk(tod.length)) +\n    kpi('Received this month', qt(sum(mon, function (t) { return t.U; })) + ' qtl', trk(mon.length)) +\n    kpi('Shortage this month', qt(sum(mon, function (t) { return t.short; })) + ' qtl', '', sum(mon, function (t) { return t.short; }) > 0 ? 'warn' : '') + '</div>';\n  h += '<div class=\"bar\">' + searchBox() + (P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportList\">Download this list</button>' : '') + '</div>';\n  var cols = '1.3fr 1.2fr .8fr 1fr 1.2fr 160px';\n  var head = '<div class=\"tr th\"><div>Truck</div><div>From</div><div class=\"r\">Loaded</div><div>Dispatched</div><div>Transporter / driver</div><div></div></div>';\n  var row = function (t) {\n    return '<div class=\"tr\"><div class=\"td wide\"><b>' + esc(t.truck) + '</b> ' + firmTag(t.firm) + '<small>' + lnk('truck', t.id) + '</small></div>' +\n      '<div class=\"td\" data-l=\"From\">' + lnk('plant', t.plant) + '<small>' + lnk('po', t.po) + '</small></div>' +\n      '<div class=\"td r num\" data-l=\"Loaded\">' + (t.L ? '<b>' + qt(t.L) + '</b> qtl' : '—') + '</div>' +\n      '<div class=\"td\" data-l=\"Dispatched\">' + dmy(t.date) + '<small class=\"' + (t.detDays > 0 ? 'over' : '') + '\">' + (t.trip === 1 ? '1 day' : t.trip + ' days') + ' on road</small></div>' +\n      '<div class=\"td\" data-l=\"Transporter\">' + (esc(t.transporter) || '<span class=\"mu\">—</span>') + (t.driver ? '<small>' + esc(t.driver) + '</small>' : '') + '</div>' +\n      '<div class=\"td acts\">' + (P.trucks && t.L ? '<button type=\"button\" class=\"nx\" data-act=\"unload\" data-id=\"' + esc(t.id) + '\">Mark received</button>' : P.trucks ? '<button type=\"button\" class=\"pill wait\" data-act=\"load\" data-id=\"' + esc(t.id) + '\">+ Weight</button>' : '') + '</div></div>';\n  };\n  h += '<h2>On the way (' + arriving.length + ')</h2>' + (arriving.length ? '<div class=\"tbl\" style=\"--cols:' + cols + '\">' + head + arriving.map(row).join('') + '</div>' : '<div class=\"panel empty\">No trucks on the way.</div>');\n  if (notLoaded.length) h += '<h2>Booked, weight not entered yet (' + notLoaded.length + ')</h2><div class=\"tbl\" style=\"--cols:' + cols + '\">' + head + notLoaded.map(row).join('') + '</div>';\n  h += '<h2>Received in the last 7 days (' + recent.length + ')</h2>' + (recent.length ? '<div class=\"tbl\" style=\"--cols:1.3fr .9fr 1.1fr .8fr .8fr .7fr .6fr\"><div class=\"tr th\"><div>Truck</div><div>Received</div><div>From</div><div class=\"r\">Loaded</div><div class=\"r\">Received</div><div class=\"r\">Short</div><div class=\"r\">Days</div></div>' +\n    recent.map(function (t) {\n      return '<div class=\"tr\"><div class=\"td wide\"><b>' + esc(t.truck) + '</b> ' + firmTag(t.firm) + '<small>' + lnk('truck', t.id) + '</small></div><div class=\"td\" data-l=\"Received\">' + dmy(t.unloadDate) + '</div>' +\n        '<div class=\"td\" data-l=\"From\">' + lnk('plant', t.plant) + '</div><div class=\"td r num\" data-l=\"Loaded\">' + qt(t.L) + '</div><div class=\"td r num\" data-l=\"Received\"><b>' + qt(t.U) + '</b></div>' +\n        '<div class=\"td r num ' + (t.short > t.allow ? 'over' : '') + '\" data-l=\"Short\">' + qt(t.short) + '</div><div class=\"td r num\" data-l=\"Days\">' + t.trip + '</div></div>';\n    }).join('') + '</div>' : '<div class=\"panel empty\">Nothing received in the last 7 days.</div>');\n  return h;\n}\nfunction truckList(list, noLimit) {\n  if (!list.length) return '<div class=\"panel empty\">No trucks here.</div>';\n  var shown = noLimit ? list : list.slice(0, LIMIT);\n  return '<div class=\"tl\">' + shown.map(truckCard).join('') + '</div>' + (shown.length < list.length ? '<button type=\"button\" class=\"btn showmore\" data-act=\"showmore\">Show more (' + (list.length - shown.length) + ' left)</button>' : '');\n}\nfunction truckCard(t) {\n  var ns = nextStep(t);\n  var bad = t.issues.some(function (i) { return i.bad; });\n  var money = '';\n  if (P.money && !t.cx) {\n    if (t.U && t.so) money = '<div class=\"money hide-phone\"><div class=\"mu\">Balance</div><b>' + inr(t.bal) + '</b></div>';\n    else if (t.L) money = '<div class=\"money hide-phone\"><div class=\"mu\">Supplier</div><b>' + inr(t.purTot) + '</b> ' + (t.plantPaid ? '<span class=\"stage s5\">Paid</span>' : '') + '</div>';\n  }\n  return '<div class=\"tc ' + (t.cx ? 'cx' : '') + '\"><div class=\"info\" data-go=\"truck\" data-id=\"' + esc(t.id) + '\">' +\n    '<div class=\"l1\"><span class=\"truck\">' + esc(t.truck) + '</span>' + (t.noSlip ? '<span class=\"tag no\">No slip</span>' : '') + (t.billOk ? '<span class=\"tag ok\">Checked</span>' : '') + '<span class=\"stage ' + (t.st < 0 ? 'sx' : 's' + t.st) + '\">' + t.stage + '</span>' + (bad ? '<span class=\"tag\">Check</span>' : '') + (t.L && !t.U && t.detDays > 0 && !t.fBuyer ? '<span class=\"tag wn\">' + t.trip + ' days</span>' : '') + '</div>' +\n    '<div class=\"l2\">' + esc(t.plant || t.po) + ' → ' + (t.plantPO ? esc(shortFirm(plantFirm())) + ' plant' : t.so ? esc(t.buyer || t.so) : '<span class=\"mu\">no customer yet</span>') + (t.L ? ' · <b>' + qt(t.U || t.L) + '</b> qtl' : '') + '</div>' +\n    '<div class=\"l3\"><span>' + esc(t.id) + '</span>' + firmTag(t.firm) + '<span>' + dmy(t.date) + '</span>' + (t.transporter ? '<span>' + esc(t.transporter) + '</span>' : '') + '</div></div>' + money +\n    '<div class=\"acts\">' + (ns ? '<button type=\"button\" class=\"next ' + (ns.m ? 'money' : '') + '\" data-act=\"' + ns.a + '\" data-id=\"' + esc(t.id) + '\">' + ns.l + '</button>' : (t.cx ? '' : '<span class=\"done\">' + (t.st === 6 ? '✓ Closed' : '✓ Done') + '</span>')) +\n    '<button type=\"button\" class=\"more\" data-act=\"menu\" data-id=\"' + esc(t.id) + '\" aria-label=\"More actions\">⋯</button></div></div>';\n}\n\n/* ---------- Truck page ---------- */\nfunction vTruck(id) {\n  var t = T.filter(function (x) { return x.id === id; })[0];\n  if (!t) return pageHead('Not found') + '<div class=\"panel empty\">Truck ' + esc(id) + ' was not found.</div>';\n  var ns = nextStep(t);\n  var row = function (l, v) { return '<div><dt>' + l + '</dt><dd>' + v + '</dd></div>'; };\n  var h = pageHead(esc(t.truck) + ' <span class=\"stage ' + (t.st < 0 ? 'sx' : 's' + t.st) + '\" style=\"vertical-align:4px\">' + t.stage + '</span>', esc(t.id) + ' · dispatched ' + dmy(t.date), '', newTab('truck', t.id));\n  if (ns) h += '<div style=\"margin-bottom:12px\"><button type=\"button\" class=\"next ' + (ns.m ? 'money' : '') + '\" style=\"width:100%;max-width:360px\" data-act=\"' + ns.a + '\" data-id=\"' + esc(t.id) + '\">' + ns.l + '</button></div>';\n  if (t.issues.length) h += '<div class=\"panel\" style=\"margin-bottom:12px\">' + t.issues.map(function (i) { return '<div class=\"prob\"><span class=\"dot\" style=\"' + (i.bad ? '' : 'background:var(--wn)') + '\"></span><span>' + esc(i.msg) + '</span></div>'; }).join('') + '</div>';\n  h += '<h2>Trip</h2><dl class=\"dl\">' + (multiFirm() ? row('Firm', esc(t.firm)) : '') + row('Purchase order', lnk('po', t.po)) + row('Supplier', lnk('plant', t.plant)) +\n    (t.plantPO ? row('Going to', 'Own plant · ' + esc(plantFirm()) + ' <span class=\"mu\">(no sale)</span>') : row('Sale order', lnk('so', t.so)) + row('Customer', lnk('buyer', t.buyer) + (t.ownBuyer ? ' <span class=\"tag own\">group company</span>' : ''))) +\n    row('Vehicle placed on', dmy(t.placed)) + row('Transporter', lnk('transporter', t.transporter)) + row('Driver', esc(t.driver) || '—') + row('RST / Weighment Slip No.', esc(t.slip) || '—') +\n    row('Loaded', t.L ? qt(t.L) + ' qtl' : '—') + row('Supplier invoice', t.billQ === null ? (t.L ? '<span class=\"mu\">not entered</span>' : '—') : esc(t.billNo || '') + ' · ' + qt(t.billQ) + ' qtl ' + (t.billOk ? '<span class=\"tag ok\">matches slip</span>' : '<span class=\"tag\">does not match slip</span>')) + row('Unloaded', t.U ? qt(t.U) + ' qtl on ' + dmy(t.unloadDate) : '—') + row('Shortage', t.U ? qt(t.short) + ' qtl' : '—') +\n    row('Days on trip', t.trip + (t.detDays && !t.fBuyer ? ' <span class=\"over\">(' + t.detDays + ' over ' + t.freeDays + ' free)</span>' : '')) + '</dl>';\n  if (P.money) {\n    h += '<h2>Money</h2><dl class=\"dl\">' + (t.plantUTR ? row('Supplier payment UTR', esc(t.plantUTR)) : '') + (t.freightUTR ? row('Freight payment UTR', esc(t.freightUTR)) : '') + row('Supplier amount', !t.L ? '— <span class=\"mu\">(after weight)</span>' : inr(t.purTot) + (t.plantPaid ? ' · <span style=\"color:var(--ok)\">paid ' + dmy(t.plantPaidDate) + '</span>' : ' · <span class=\"over\">unpaid</span>')) +\n      (t.plantPO ? '' : row('Invoice rate', t.so ? inr(t.rateUsed) + '/qtl' + (t.rateOwn ? ' <span class=\"tag wn\">this truck only</span>' : '') : '—') + row('Sale total', t.so ? inr(t.saleTot) + (t.U ? '' : ' <span class=\"mu\">(on loaded wt)</span>') : '—') + row('Received', inr(t.R) + (t.DED ? ' + ' + inr(t.DED) + ' deducted' : '')) +\n      row('Outstanding', t.U ? inr(t.bal) + (t.overdue ? ' <span class=\"over\">· ' + t.overdue + ' days overdue</span>' : '') : '—')) +\n      (t.fBuyer ? row('Freight', 'Paid by buyer') : row('Freight', t.U ? inr(t.frAmt) + ' (' + inr(t.FR) + '/qtl)' : (t.FR ? inr(t.FR) + '/qtl' : '—')) + row('Shortage deduction', inr(t.shortDed)) +\n        row('Detention', (t.det ? inr(t.det) : '₹0') + (t.detSuggest && !t.det ? ' <span class=\"mu\">(suggested ' + inr(t.detSuggest) + ' if you agree to pay)</span>' : '')) + row('Freight advance', inr(t.A)) +\n        row('Net freight', t.U ? '<span class=\"' + (t.netFr < 0 ? 'over' : '') + '\">' + inr(t.netFr) + '</span>' + (t.carryIn ? ' − ' + inr(t.carryIn) + ' earlier advance = <b>' + inr(t.netPay) + '</b>' : '') + (t.carryOut ? ' <span class=\"mu\">(' + inr(t.carryOut) + ' carried to next trip)</span>' : '') + (t.freightPaid ? ' · <span style=\"color:var(--ok)\">paid ' + dmy(t.freightPaidDate) + '</span>' : '') : '—')) +\n      (P.profit && t.U && !t.plantPO ? row('Profit before GST', inr(t.profit)) : '') + '</dl>';\n  }\n  h += truckPhotos(t);\n  if (t.note) h += '<h2>Note</h2><div class=\"panel\" style=\"padding:12px 14px\">' + esc(t.note) + '</div>';\n  var acts = menuItems(t);\n  if (acts.length) h += '<h2>Actions</h2><div class=\"alist\">' + acts.map(function (m) { return '<button type=\"button\" class=\"btn ' + (m.danger ? 'danger' : '') + '\" data-act=\"' + m.a + '\" data-id=\"' + esc(t.id) + '\">' + m.l + '</button>'; }).join('') + '</div>';\n  return h;\n}\nfunction menuItems(t) {\n  var m = [];\n  if (t.cx) { if (t.returned ? P.trucks : P.cancelTruck) m.push({ a: 'restore', l: t.returned ? 'Undo returned' : 'Restore truck' }); return m; }\n  if (t.st === 6 && !P.editClosed) return m;\n  if (P.trucks) m.push({ a: 'editTruck', l: 'Edit details' });\n  if (P.trucks && t.L) m.push({ a: 'load', l: 'Change loaded weight' });\n  if (P.trucks && t.L) m.push({ a: 'bill', l: t.billQ === null ? 'Enter supplier invoice' : 'Change supplier invoice' });\n  if (P.trucks && !t.L) m.push({ a: 'returned', l: 'Returned empty', danger: 1 });\n  if (P.trucks && !t.plantPO) m.push({ a: 'assign', l: t.so ? 'Change customer' : 'Choose customer' });\n  if (P.trucks && t.L) m.push({ a: 'unload', l: toPlant(t) ? (t.U ? 'Change received weight' : 'Mark received') : t.U ? 'Change unloading' : 'Record unloading' });\n  if (P.truckMoney) {\n    if (t.L && !t.plantPaid) m.push({ a: 'paid', l: 'Mark supplier paid' });\n    if (t.plantPaid) m.push({ a: 'unpaid', l: 'Undo supplier payment' });\n    if (!t.fBuyer) m.push({ a: 'advance', l: 'Freight advance' });\n    if (t.U && t.bal > 0) m.push({ a: 'receive', l: 'Add customer payment' });\n    if (t.U && !t.fBuyer && !t.freightPaid) m.push({ a: 'fpaid', l: 'Pay freight' });\n    if (t.freightPaid) m.push({ a: 'funpaid', l: 'Undo freight payment' });\n  }\n  if (P.cancelTruck) m.push({ a: 'cancelTruck', l: 'Cancel this truck', danger: 1 });\n  return m;\n}\n\n/* ---------- Orders ---------- */\nfunction orderRows(kind, compact) {\n  var list = (kind === 'po' ? D.po : D.so).filter(inFirm).filter(function (o) { return compact ? o.status !== 'Cancelled' && o.status !== 'Settled' : true; });\n  if (!list.length) return compact ? '' : '<div class=\"empty\">No orders yet.</div>';\n  return list.map(function (o) {\n    var s = orderStats(kind, o), cx = o.status === 'Cancelled', party = kind === 'po' ? o.plant : o.buyer;\n    return '<div class=\"oc\" style=\"' + (cx ? 'opacity:.55' : '') + '\"><div class=\"m\"><div class=\"r\"><span>' + lnk(kind, o.id) + ' ' + firmTag(firmOf(o)) + ' · ' + lnk(kind === 'po' ? 'plant' : 'buyer', party) + (kind === 'po' && o.poType === 'plant' ? ' <span class=\"tag own\">own plant</span>' : '') + '</span>' +\n      (cx ? '<span class=\"tag\">Cancelled</span>' : '') + (o.status === 'Settled' ? '<span class=\"tag ok\">Short-closed</span>' : '') + (P.money && kind === 'so' && !cx && (!o.gstMode || !o.freightMode) ? '<span class=\"tag wn\">Set rate type</span>' : '') + '</div>' +\n      '<div class=\"prog ' + (s.bal < 0 ? 'over' : '') + '\"><i style=\"width:' + s.pct.toFixed(1) + '%\"></i></div>' +\n      '<div class=\"r mu num\"><span>' + qt(s.done) + ' of ' + qt(o.qty) + ' qtl · ' + s.tr.length + ' trucks</span><span class=\"' + (s.bal < 0 ? 'over' : '') + '\">Balance <b>' + qt(s.bal) + '</b></span></div>' +\n      (!compact && P.money ? '<div class=\"mu\" style=\"font-size:12.5px;margin-top:3px\">' + inr(o.rate) + (kind === 'so' ? ' · ' + terms(o) + (o.creditDays !== '' && o.creditDays != null ? ' · ' + o.creditDays + ' days credit' : '') : ' + GST ' + Math.round(n(o.gst) * 100) + '%') + ' · ' + dmy(o.date) + '</div>' : '') +\n      '</div>' + (!compact ? '<button type=\"button\" class=\"more\" data-act=\"ordermenu\" data-kind=\"' + kind + '\" data-id=\"' + esc(o.id) + '\" aria-label=\"More\">⋯</button>' : '') + '</div>';\n  }).join('');\n}\nfunction orderTable(kind) {\n  var list = (kind === 'po' ? D.po : D.so).filter(inFirm), M = P.money, mf = multiFirm();\n  var h = '<div class=\"bar\"><span class=\"mu\">' + list.length + (kind === 'po' ? ' purchase orders' : ' sale orders') + '</span><span class=\"sp\"></span>' + (P.orders ? '<button type=\"button\" class=\"btn pri\" data-act=\"' + (kind === 'po' ? 'newPO' : 'newSO') + '\">+ New ' + (kind === 'po' ? 'purchase order' : 'sale order') + '</button>' : '') + '</div>';\n  if (!list.length) return h + '<div class=\"panel empty\">No orders yet.</div>';\n  var cols = [['ID', '120px'], mf ? ['Firm', '.7fr'] : null, [kind === 'po' ? 'Supplier' : 'Customer', '1.6fr'], [kind === 'po' ? 'Goes to' : 'Terms', '1.2fr'], ['Date', '.8fr'], ['Quantity', '.9fr', 1], M ? ['Rate', '.8fr', 1] : null,\n    [kind === 'po' ? 'Loaded' : 'Dispatched', '.9fr', 1], ['Balance', '.9fr', 1], ['Trucks', '.55fr', 1], ['', '40px']].filter(Boolean);\n  h += '<div class=\"tbl\" style=\"--cols:' + cols.map(function (c) { return c[1]; }).join(' ') + '\"><div class=\"tr th\">' + cols.map(function (c) { return '<div class=\"' + (c[2] ? 'r' : '') + '\">' + c[0] + '</div>'; }).join('') + '</div>';\n  h += list.map(function (o) {\n    var s = orderStats(kind, o), cx = o.status === 'Cancelled', party = kind === 'po' ? o.plant : o.buyer;\n    var via = kind === 'po' && o.takenIn && normName(o.takenIn) !== firmOf(o) ? '<small>' + esc(o.plant) + ' → ' + esc(shortFirm(o.takenIn)) + ' → ' + esc(shortFirm(firmOf(o))) + '</small>' : '';\n    var goes = kind === 'po' ? (o.poType === 'plant' ? '<span class=\"tag own\">Own plant</span> ' + esc(shortFirm(plantFirm())) : o.linkSO && SO[o.linkSO] ? 'Sells to ' + lnk('buyer', SO[o.linkSO].buyer) + '<small>' + lnk('so', o.linkSO) + '</small>' : '<span class=\"mu\">Customer per truck</span>') :\n      (isFirm(o.buyer) ? '<span class=\"tag own\">Group company</span> ' : '') + (M ? '<span class=\"sm\">' + terms(o) + (o.creditDays !== '' && o.creditDays != null ? ' · ' + o.creditDays + ' days' : '') + '</span>' : '');\n    return '<div class=\"tr ' + (cx ? 'cx' : '') + '\"><div class=\"td\">' + lnk(kind, o.id) + ntsm(kind, o.id) + '</div>' + (mf ? '<div class=\"td\" data-l=\"Firm\">' + firmTag(firmOf(o)) + '</div>' : '') +\n      '<div class=\"td wide\" data-l=\"' + (kind === 'po' ? 'Supplier' : 'Customer') + '\">' + lnk(kind === 'po' ? 'plant' : 'buyer', party) + via + (cx ? ' <span class=\"tag\">Cancelled</span>' : '') + (o.status === 'Settled' ? ' <span class=\"tag ok\">Short-closed</span>' : '') + (M && kind === 'so' && !cx && (!o.gstMode || !o.freightMode) ? ' <span class=\"tag wn\">Set rate type</span>' : '') + (s.bal < 0 && !cx && o.status !== 'Settled' ? ' <span class=\"tag\">Over by ' + qt(-s.bal) + '</span>' : '') + '<div class=\"prog ' + (s.bal < 0 ? 'over' : '') + '\"><i style=\"width:' + s.pct.toFixed(1) + '%\"></i></div></div>' +\n      '<div class=\"td\" data-l=\"' + (kind === 'po' ? 'Goes to' : 'Terms') + '\">' + goes + '</div>' +\n      '<div class=\"td\" data-l=\"Date\">' + dmy(o.date) + '</div><div class=\"td r num\" data-l=\"Quantity\">' + qt(o.qty) + '</div>' +\n      (M ? '<div class=\"td r num\" data-l=\"Rate\">' + inr(o.rate) + (kind === 'po' ? '<small>+ GST ' + Math.round(n(o.gst) * 100) + '%</small>' : '') + '</div>' : '') +\n      '<div class=\"td r num\" data-l=\"' + (kind === 'po' ? 'Loaded' : 'Dispatched') + '\">' + qt(s.done) + '</div><div class=\"td r num ' + (s.bal < 0 ? 'over' : '') + '\" data-l=\"Balance\"><b>' + qt(s.bal) + '</b></div>' +\n      '<div class=\"td r num\" data-l=\"Trucks\">' + s.tr.length + '</div><div class=\"td acts\"><button type=\"button\" class=\"ib\" data-act=\"ordermenu\" data-kind=\"' + kind + '\" data-id=\"' + esc(o.id) + '\" aria-label=\"More\">⋯</button></div></div>';\n  }).join('') + '</div>';\n  return h;\n}\nfunction vOrder(kind, id) {\n  var o = (kind === 'po' ? D.po : D.so).filter(function (x) { return x.id === id; })[0];\n  if (!o) return pageHead('Not found') + '<div class=\"panel empty\">' + esc(id) + ' was not found.</div>';\n  var s = orderStats(kind, o), tr = s.tr.slice().sort(sortT), party = kind === 'po' ? o.plant : o.buyer;\n  var extra = (P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportPage\" data-kind=\"' + kind + '\" data-id=\"' + esc(id) + '\">Excel</button>' : '') + (P.orders ? '<button type=\"button\" class=\"btn sm\" data-act=\"' + (kind === 'po' ? 'editPO' : 'editSO') + '\" data-id=\"' + esc(id) + '\">Edit</button>' : '');\n  var goes = (kind === 'po' && o.takenIn ? ' · booked in the name of ' + esc(o.takenIn) : '') + (kind === 'po' ? (o.poType === 'plant' ? ' · goes to own plant (' + esc(plantFirm()) + ')' : o.linkSO && SO[o.linkSO] ? ' · sells to ' + lnk('so', o.linkSO) + ' ' + lnk('buyer', SO[o.linkSO].buyer) : '') : (isFirm(o.buyer) ? ' · <span class=\"tag own\">group company</span>' : ''));\n  var h = pageHead(esc(id) + ' ' + firmTag(firmOf(o)), (multiFirm() ? esc(firmOf(o)) + ' · ' : '') + (kind === 'po' ? 'Supplier ' : 'Customer ') + lnk(kind === 'po' ? 'plant' : 'buyer', party) + ' · ' + dmy(o.date) + (P.money ? ' · ' + inr(o.rate) + (kind === 'so' ? ' ' + terms(o) : ' + GST') : '') + goes + (o.status === 'Cancelled' ? ' · <span class=\"over\">Cancelled</span>' : '') + (o.status === 'Settled' ? ' · <span class=\"tag ok\">Short-closed</span>' : ''), extra, newTab(kind, id));\n  h += '<div class=\"kpis\">' + kpi('Ordered', qt(o.qty) + ' qtl') + kpi(kind === 'po' ? 'Loaded' : 'Dispatched', qt(s.done) + ' qtl', trk(s.tr.length)) + kpi('Balance', qt(s.bal) + ' qtl', '', s.bal < 0 ? 'bad' : '') +\n    kpi('Unloaded', qt(s.unl) + ' qtl') + kpi('Shortage', qt(s.short) + ' qtl', '', s.short > 0 ? 'warn' : '');\n  if (P.money) {\n    if (kind === 'po') h += kpi('Supplier amount', inr(sum(tr, function (t) { return t.purTot; }))) + kpi('Unpaid to supplier', inr(sum(tr.filter(function (t) { return !t.plantPaid; }), function (t) { return t.purTot; })), '', 'warn') +\n      kpi('Freight to pay', inr(sum(tr.filter(function (t) { return t.U && !t.freightPaid && !t.fBuyer; }), function (t) { return t.netPay; })));\n    else h += kpi('Sale total', inr(sum(tr.filter(function (t) { return t.U; }), function (t) { return t.saleTot; })), 'unloaded trucks') + kpi('Outstanding', inr(sum(tr, function (t) { return t.bal; })), '', 'warn') +\n      kpi('Freight paid', inr(sum(tr.filter(function (t) { return t.freightPaid; }), function (t) { return t.netPay; })));\n  }\n  h += '</div>' + (kind === 'po' ? poFlow(o, tr) : '') + '<h2>Trucks</h2>' + truckTable(kind === 'po' && FLOWSEL ? tr.filter(flowMatch()) : tr, kind);\n  return h;\n}\nfunction truckTable(tr, kind) {\n  if (!tr.length) return '<div class=\"panel empty\">No trucks yet.</div>';\n  var M = P.money;\n  var mf = multiFirm() && tr.some(function (t) { return t.firm !== tr[0].firm; });\n  var head = [['Dispatch'], ['Date']].concat(mf ? [['Firm']] : []).concat([['Truck'], [kind === 'po' || kind === 'plant' ? 'Going to' : 'Supplier'], ['Transporter']]).concat([ ['Loaded', 1], ['Unloaded', 1], ['Short', 1], ['Days', 1], ['Stage']]);\n  if (M) head = head.concat([['Supplier amt', 1], ['Freight', 1], ['Short ded.', 1], ['Detention', 1], ['Freight adv.', 1], ['Net freight', 1], ['Freight paid'], ['Outstanding', 1]]);\n  var cell = function (v, r) { return '<td' + (r ? ' class=\"r\"' : '') + '>' + v + '</td>'; };\n  var body = tr.map(function (t) {\n    var c = cell(lnk('truck', t.id)) + cell(dm(t.date)) + (mf ? cell(firmTag(t.firm)) : '') + cell('<b>' + esc(t.truck) + '</b>') + cell(kind === 'po' || kind === 'plant' ? (t.plantPO ? '<span class=\"tag own\">Own plant</span>' : lnk('buyer', t.buyer)) : lnk('plant', t.plant)) + cell(lnk('transporter', t.transporter)) +\n      cell(t.L ? qt(t.L) : '—', 1) + cell(t.U ? qt(t.U) : '—', 1) + cell(t.U ? qt(t.short) : '—', 1) + cell(t.trip + (t.detDays && !t.fBuyer ? ' <span class=\"over\">+' + t.detDays + '</span>' : ''), 1) + cell('<span class=\"stage ' + (t.st < 0 ? 'sx' : 's' + t.st) + '\">' + t.stage + '</span>');\n    if (M) c += cell(t.L ? inr(t.purTot) : '—', 1) + cell(t.fBuyer ? 'customer' : t.U ? inr(t.frAmt) : '—', 1) + cell(t.shortDed ? inr(t.shortDed) : '—', 1) + cell(t.det ? inr(t.det) : '—', 1) + cell(t.A ? inr(t.A) : '—', 1) +\n      cell(t.U && !t.fBuyer ? inr(t.netPay) + (t.carryIn || t.carryOut ? ' <span class=\"mu\">*</span>' : '') : '—', 1) + cell(t.fBuyer ? '—' : t.freightPaid ? '✓ ' + dm(t.freightPaidDate) : (t.U ? 'unpaid' : '—')) + cell(t.U ? inr(t.bal) : '—', 1);\n    return '<tr>' + c + '</tr>';\n  }).join('');\n  var foot = '<tr><td colspan=\"' + (mf ? 6 : 5) + '\">Total ' + trk(tr.length) + '</td>' + cell(qt(sum(tr, function (t) { return t.L; })), 1) + cell(qt(sum(tr, function (t) { return t.U; })), 1) + cell(qt(sum(tr, function (t) { return t.short; })), 1) + '<td></td><td></td>';\n  if (M) foot += cell(inr(sum(tr, function (t) { return t.purTot; })), 1) + cell(inr(sum(tr, function (t) { return t.frAmt; })), 1) + cell(inr(sum(tr, function (t) { return t.shortDed; })), 1) + cell(inr(sum(tr, function (t) { return t.det; })), 1) +\n    cell(inr(sum(tr, function (t) { return t.A; })), 1) + cell(inr(sum(tr, function (t) { return t.netPay; })), 1) + '<td></td>' + cell(inr(sum(tr, function (t) { return t.bal; })), 1);\n  return '<div class=\"tblw\"><table class=\"t\"><thead><tr>' + head.map(function (x) { return '<th' + (x[1] ? ' class=\"r\"' : '') + '>' + x[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tr></tfoot></table></div>';\n}\n\n/* ---------- Buyer / plant / transporter pages ---------- */\nfunction vParty(kind, name) {\n  var key = normName(name);\n  var tr = liveAll().filter(function (t) { return normName(kind === 'buyer' ? t.buyer : kind === 'plant' ? t.plant : (t.transporter || '(none)')) === key; }).sort(sortT);\n  var extra = P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportPage\" data-kind=\"' + kind + '\" data-id=\"' + esc(name) + '\">' + (kind === 'transporter' ? 'Statement Excel' : 'Excel') + '</button>' : '';\n  var h = pageHead(esc(name), { buyer: 'Customer', plant: 'Supplier', transporter: 'Transporter' }[kind] + ' · ' + trk(tr.length), extra, newTab(kind, name));\n  h += '<div class=\"kpis\">' + kpi('Loaded', qt(sum(tr, function (t) { return t.L; })) + ' qtl') + kpi('Unloaded', qt(sum(tr, function (t) { return t.U; })) + ' qtl') + kpi('Shortage', qt(sum(tr, function (t) { return t.short; })) + ' qtl');\n  if (P.money) {\n    if (kind === 'buyer') h += kpi('Sale total', inr(sum(tr.filter(function (t) { return t.U; }), function (t) { return t.saleTot; }))) + kpi('Received', inr(sum(tr, function (t) { return t.R + t.DED; }))) +\n      kpi('Outstanding', inr(sum(tr, function (t) { return t.bal; })), '', 'warn') + kpi('Overdue', inr(sum(tr.filter(function (t) { return t.overdue > 0; }), function (t) { return t.bal; })), '', 'bad');\n    if (kind === 'plant') h += kpi('Supplier amount', inr(sum(tr, function (t) { return t.purTot; }))) + kpi('Unpaid', inr(sum(tr.filter(function (t) { return !t.plantPaid; }), function (t) { return t.purTot; })), '', 'warn');\n    if (kind === 'transporter') {\n      var f = tr.filter(function (t) { return !t.fBuyer; });\n      h += kpi('Freight earned', inr(sum(f, function (t) { return t.frAmt; }))) + kpi('Shortage / detention', inr(sum(f, function (t) { return t.shortDed; })) + ' / ' + inr(sum(f, function (t) { return t.det; }))) +\n        kpi('Freight advance open', inr(sum(f.filter(function (t) { return !t.freightPaid; }), function (t) { return t.A; }))) +\n        kpi('Returned empty', T.filter(function (t) { return t.returned && normName(t.transporter || '(none)') === key; }).length, 'trucks sent back without loading') +\n        kpi('Advance to adjust', inr(sum(f, function (t) { return t.carryLeft; })), 'extra advance waiting for next trips') +\n        kpi('Payable now', inr(sum(f.filter(function (t) { return t.U && !t.freightPaid; }), function (t) { return t.netPay; })), 'unloaded, not paid', 'warn');\n    }\n  }\n  h += '</div>';\n  if (kind !== 'transporter') {\n    var ord = (kind === 'buyer' ? D.so : D.po).filter(function (o) { return normName(kind === 'buyer' ? o.buyer : o.plant) === key; });\n    h += '<h2>' + (kind === 'buyer' ? 'Sale orders' : 'Purchase orders') + '</h2><div class=\"panel\">' + (ord.length ? ord.map(function (o) {\n      var s = orderStats(kind === 'buyer' ? 'so' : 'po', o);\n      return '<div class=\"oc\"><div class=\"m\"><div class=\"r\"><span>' + lnk(kind === 'buyer' ? 'so' : 'po', o.id) + (P.money ? ' · ' + inr(o.rate) : '') + '</span><span class=\"mu\">Balance <b>' + qt(s.bal) + '</b> of ' + qt(o.qty) + '</span></div><div class=\"prog\"><i style=\"width:' + s.pct.toFixed(1) + '%\"></i></div></div></div>';\n    }).join('') : '<div class=\"empty\">No orders.</div>') + '</div>';\n  }\n  if (kind === 'buyer') h += buyerFlow(name, tr);\n  h += '<h2>' + (kind === 'transporter' ? 'Statement' : 'Trucks') + '</h2>' + truckTable(kind === 'buyer' && FLOWSEL ? tr.filter(flowMatch()) : tr, kind === 'buyer' ? 'so' : kind === 'plant' ? 'po' : 'transporter');\n  return h;\n}\n\n/* ---------- Money ---------- */\nfunction vSettle() {\n  var base = T.filter(function (t) { return t.so && !t.plantPO && tInFirm(t); }), lv = base.filter(function (t) { return !t.cx; });\n  var opts = [['all', 'All', function (t) { return !t.cx; }], ['due', 'To collect', function (t) { return !t.cx && t.bal > 0; }], ['overdue', 'Overdue', function (t) { return !t.cx && t.overdue > 0; }],\n    ['road', 'Not unloaded', function (t) { return !t.cx && !t.U; }], ['done', 'Short-closed', function (t) { return !t.cx && t.U && t.bal <= 0; }], ['cx', 'Cancelled', function (t) { return t.cx; }]];\n  var fn = (opts.filter(function (o) { return o[0] === SUBF.settle; })[0] || opts[0])[2];\n  var list = base.filter(fn).filter(matchQ).sort(sortT);\n  LASTIDS = list.map(function (t) { return t.id; });\n  var out = lv.filter(function (t) { return !t.ownBuyer; }), own = lv.filter(function (t) { return t.ownBuyer; });\n  var h = '<div class=\"kpis\" style=\"margin-bottom:14px\">' + kpi('Sale value (incl. GST)', inr(sum(lv.filter(function (t) { return t.U; }), function (t) { return t.saleTot; })), 'unloaded trucks') +\n    kpi('Received', inr(sum(lv, function (t) { return t.R; })), 'deductions ' + inr(sum(lv, function (t) { return t.DED; }))) +\n    kpi('Outside customers owe', inr(sum(out, function (t) { return t.bal; })), '', 'warn') +\n    (own.length ? kpi('Group company owes', inr(sum(own, function (t) { return t.bal; })), 'between your firms') : '') +\n    kpi('Overdue', inr(sum(out.filter(function (t) { return t.overdue > 0; }), function (t) { return t.bal; })), 'past credit days', 'bad') + '</div>';\n  h += '<div class=\"bar\">' + searchBox() + (P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportList\">Download this list</button>' : '') + '</div>' + subChips('settle', opts, base);\n  if (!list.length) return h + '<div class=\"panel empty\">No trucks here.</div>';\n  var cols = '112px 1.05fr 1.5fr .75fr .75fr .6fr 1fr 1fr .95fr 128px 40px';\n  h += '<div class=\"tbl\" style=\"--cols:' + cols + '\"><div class=\"tr th\"><div>Dispatch</div><div>Truck</div><div>Customer</div><div class=\"r\">Loaded</div><div class=\"r\">Unloaded</div><div class=\"r\">Short</div><div class=\"r\">Sale total</div><div class=\"r\">Received</div><div class=\"r\">Balance</div><div>Next step</div><div></div></div>';\n  h += list.slice(0, LIMIT).map(function (t) {\n    var next = t.cx ? '' : !t.U ? (P.trucks ? '<button class=\"pill wait\" type=\"button\" data-act=\"unload\" data-id=\"' + esc(t.id) + '\">' + (toPlant(t) ? '+ Received' : '+ Unloading') + '</button>' : '') :\n      t.bal > 0 ? (P.truckMoney ? '<button class=\"nx money\" type=\"button\" data-act=\"receive\" data-id=\"' + esc(t.id) + '\">+ Payment</button>' : '') + (t.overdue ? '<small class=\"over\">' + t.overdue + ' days overdue</small>' : '') : '<span class=\"pill ok\">✓ Short-closed</span>';\n    return '<div class=\"tr ' + (t.cx ? 'cx' : '') + '\"><div class=\"td\">' + lnk('truck', t.id) + ntsm('truck', t.id) + '<small>' + dmy(t.date) + '</small></div>' +\n      '<div class=\"td\" data-l=\"Truck\"><b>' + esc(t.truck) + '</b> ' + firmTag(t.firm) + '<div style=\"margin-top:3px\"><span class=\"stage ' + (t.st < 0 ? 'sx' : 's' + t.st) + '\">' + t.stage + '</span></div></div>' +\n      '<div class=\"td wide\" data-l=\"Customer\">' + lnk('buyer', t.buyer) + (t.ownBuyer ? ' <span class=\"tag own\">group company</span>' : '') + '<small>' + lnk('so', t.so) + ' · ' + inr(t.rateUsed) + '/qtl' + (t.rateOwn ? ' (this truck)' : '') + '</small></div>' +\n      '<div class=\"td r num\" data-l=\"Loaded\">' + (t.L ? qt(t.L) : '—') + '</div><div class=\"td r num\" data-l=\"Unloaded\">' + (t.U ? qt(t.U) : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Short\">' + (t.U ? qt(t.short) : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Sale total\">' + (t.saleTot ? inr(t.saleTot) : '—') + (t.U || !t.saleTot ? '' : '<small>on loaded wt</small>') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Received\">' + (t.R ? inr(t.R) : '—') + (t.DED ? '<small>+ ' + inr(t.DED) + ' deducted</small>' : '') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Balance\"><b>' + (t.U ? inr(t.bal) : '—') + '</b></div>' +\n      '<div class=\"td\" data-l=\"Next step\">' + next + '</div><div class=\"td acts\"><button type=\"button\" class=\"ib\" data-act=\"menu\" data-id=\"' + esc(t.id) + '\" aria-label=\"More actions\">⋯</button></div></div>';\n  }).join('') + '</div>' + more(list);\n  return h;\n}\nfunction vFreight() {\n  var base = T.filter(function (t) { return t.L && tInFirm(t); }), lv = base.filter(function (t) { return !t.cx && !t.fBuyer; });\n  var opts = [['all', 'All', function (t) { return !t.cx; }], ['topay', 'To pay', function (t) { return !t.cx && t.U && !t.fBuyer && !t.freightPaid; }], ['road', 'On the road', function (t) { return !t.cx && !t.U; }],\n    ['paid', 'Paid', function (t) { return !t.cx && t.freightPaid; }], ['neg', 'Advance carried forward', function (t) { return !t.cx && (t.carryOut > 0 || t.carryIn > 0); }], ['buyer', 'Customer pays', function (t) { return !t.cx && t.fBuyer; }]];\n  var fn = (opts.filter(function (o) { return o[0] === SUBF.freight; })[0] || opts[0])[2];\n  var list = base.filter(fn).filter(matchQ).sort(sortT);\n  LASTIDS = list.map(function (t) { return t.id; });\n  var by = {};\n  lv.forEach(function (t) {\n    var k = t.transporter || '(none)';\n    by[k] = by[k] || { n: 0, due: 0, adv: 0 };\n    by[k].n++; if (t.U && !t.freightPaid) by[k].due += t.netPay; if (!t.freightPaid) by[k].adv += t.A;\n  });\n  var h = '<h2>By transporter</h2><div class=\"kpis\" style=\"margin-bottom:14px\">' + (Object.keys(by).sort().map(function (k) {\n    return kpi(lnk('transporter', k), inr(by[k].due), trk(by[k].n) + ' · advance ' + inr(by[k].adv), by[k].due < 0 ? 'bad' : '');\n  }).join('') || '<div class=\"panel empty\">No loaded trucks.</div>') + '</div>';\n  h += '<div class=\"bar\">' + searchBox() + (P.truckMoney ? '<button type=\"button\" class=\"btn\" data-act=\"payFreightBatch\">Pay freight (several trucks)</button>' : '') + (P.exportX ? '<button type=\"button\" class=\"btn sm\" data-act=\"exportList\">Download this list</button>' : '') + '</div>' + subChips('freight', opts, base);\n  if (!list.length) return h + '<div class=\"panel empty\">No trucks here.</div>';\n  var cols = '112px 1fr 1fr .75fr .6fr .85fr .8fr .8fr .85fr .95fr 112px 40px';\n  h += '<div class=\"tbl\" style=\"--cols:' + cols + '\"><div class=\"tr th\"><div>Dispatch</div><div>Truck</div><div>Transporter</div><div class=\"r\">Unloaded</div><div class=\"r\">Rate</div><div class=\"r\">Freight</div><div class=\"r\">Short ded.</div><div class=\"r\">Detention</div><div class=\"r\">Freight adv.</div><div class=\"r\">Net freight payable</div><div>Freight</div><div></div></div>';\n  h += list.slice(0, LIMIT).map(function (t) {\n    var pay = t.cx ? '' : t.fBuyer ? '<span class=\"pill info\">Customer pays</span>' : !t.U ? (P.trucks ? '<button class=\"pill wait\" type=\"button\" data-act=\"unload\" data-id=\"' + esc(t.id) + '\">' + (toPlant(t) ? '+ Received' : '+ Unloading') + '</button>' : '') :\n      t.freightPaid ? '<span class=\"pill ok\">✓ Paid</span><small>' + dmy(t.freightPaidDate) + '</small>' : P.truckMoney ? '<button class=\"nx money\" type=\"button\" data-act=\"fpaid\" data-id=\"' + esc(t.id) + '\">Pay freight</button>' : '<span class=\"pill wait\">◷ Unpaid</span>';\n    return '<div class=\"tr ' + (t.cx ? 'cx' : '') + '\"><div class=\"td\">' + lnk('truck', t.id) + ntsm('truck', t.id) + '<small>' + dmy(t.date) + '</small></div>' +\n      '<div class=\"td\" data-l=\"Truck\"><b>' + esc(t.truck) + '</b> ' + firmTag(t.firm) + '<small>' + (t.trip === 1 ? '1 day' : t.trip + ' days') + (t.detDays && !t.fBuyer ? ' · <span class=\"over\">+' + t.detDays + ' over free</span>' : '') + '</small></div>' +\n      '<div class=\"td\" data-l=\"Transporter\">' + lnk('transporter', t.transporter || '(none)', t.transporter || '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Unloaded\">' + (t.U ? qt(t.U) : '—') + '</div><div class=\"td r num\" data-l=\"Rate\">' + (t.FR ? inr(t.FR) : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Freight\">' + (t.U && !t.fBuyer ? inr(t.frAmt) : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Short ded.\">' + (t.shortDed ? inr(t.shortDed) + '<small>' + qt(t.short) + ' qtl</small>' : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Detention\">' + (t.det ? inr(t.det) : t.detSuggest ? '<span class=\"mu\" title=\"Suggestion only, not added\">' + inr(t.detSuggest) + '?</span>' : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Freight adv.\">' + (t.A ? inr(t.A) : '—') + '</div>' +\n      '<div class=\"td r num\" data-l=\"Net freight payable\"><b>' + (t.fBuyer ? '<span class=\"mu\">—</span>' : t.U ? inr(t.netPay) : '—') + '</b>' + (t.carryIn ? '<small>after ' + inr(t.carryIn) + ' earlier adv.</small>' : '') + (t.carryOut ? '<small class=\"over\">' + inr(t.carryOut) + ' extra adv. → next trip</small>' : '') + '<b>' + '</b></div>' +\n      '<div class=\"td\" data-l=\"Freight\">' + pay + '</div><div class=\"td acts\"><button type=\"button\" class=\"ib\" data-act=\"menu\" data-id=\"' + esc(t.id) + '\" aria-label=\"More actions\">⋯</button></div></div>';\n  }).join('') + '</div>' + more(list);\n  h += '<p class=\"mu\" style=\"font-size:12.5px;margin-top:10px\">Net freight payable = freight − shortage deduction − freight advance + detention. Shortage above ' + (n(D.settings.shortageAllowancePct) * 100).toFixed(2) + '% of loaded weight is cut at the sale rate (at the purchase rate for own-plant trucks). Detention: ' + n(D.settings.freeDays === undefined ? 3 : D.settings.freeDays) + ' free days, then ' + inr(n(D.settings.detentionPerDay === undefined ? 500 : D.settings.detentionPerDay)) + ' a day.</p>';\n  return h;\n}\n/* ---------- More ---------- */\nfunction vMore() {\n  var open = (D.notes || []).filter(function (x) { return x.status !== 'Done'; }).length;\n  var h = '<div class=\"list\">';\n  h += '<div class=\"row\"><div class=\"m\"><b>Design notes</b><div class=\"mu\" style=\"font-size:12.5px\">Write what would make the app easier to use' + (open ? ' · ' + open + ' open' : '') + '</div></div><button type=\"button\" class=\"btn sm\" data-go=\"notes\" data-id=\"\">Open</button></div>';\n  if (P.users) h += '<div class=\"row\"><div class=\"m\"><b>Users</b><div class=\"mu\" style=\"font-size:12.5px\">Add staff, set roles, reset passwords</div></div><button type=\"button\" class=\"btn sm\" data-go=\"users\" data-id=\"\">Open</button></div>';\n  if (P.exportX) h += '<div class=\"row\"><div class=\"m\"><b>Download everything (Excel)</b><div class=\"mu\" style=\"font-size:12.5px\">Trucks, orders, freight, transporters and payments in one file' + (multiFirm() ? ' · ' + (FIRM === 'all' ? 'all firms' : esc(FIRM) + ' only') : '') + '</div></div><button type=\"button\" class=\"btn sm\" data-act=\"exportFull\">Download</button></div>';\n  h += '<div class=\"row\"><div class=\"m\"><b>' + esc(D.me.name || D.me.id) + '</b><div class=\"mu\" style=\"font-size:12.5px\">' + esc(D.me.role) + ' · ' + esc(ROLE_HELP[D.me.role] || '') + '</div></div><button type=\"button\" class=\"btn sm\" data-act=\"me\">Password</button></div>';\n  h += '<div class=\"row\"><div class=\"m\"><b>Log out</b></div><button type=\"button\" class=\"btn sm danger\" data-act=\"logout\">Log out</button></div></div>';\n  if (D.me.role === 'Owner') h += '<p class=\"mu\" style=\"font-size:12.5px;margin-top:12px\">Automatic: a daily report comes to your Gmail around 9 pm with the full Excel attached, and a backup copy of the sheet is saved every Sunday night to Google Drive › DDGS Backups (last 12 kept). Detention: ' + n(D.settings.freeDays === undefined ? 3 : D.settings.freeDays) + ' free days, then ' + inr(n(D.settings.detentionPerDay === undefined ? 500 : D.settings.detentionPerDay)) + ' a day. Change these in the APP_SETTINGS tab.</p>';\n  return h;\n}\nvar NOTE_AREAS = ['Overview', 'Master PO', 'Sale Orders', 'Dispatch Board', 'Receiving', 'Sale & Settlement', 'Freight & Shortage', 'Truck page', 'Forms / entry', 'Phone', 'Other'];\nfunction vNotes() {\n  var list = D.notes || [], owner = D.me.role === 'Owner';\n  var h = pageHead('Design notes', 'Write what is hard to use, or what would make a screen easier. Each note is kept with your name and the date.');\n  h += '<div class=\"panel\" style=\"padding:14px;margin-bottom:14px\"><div class=\"fg\" style=\"padding:0\"><div><label for=\"n_area\">Which screen</label><select id=\"n_area\">' + NOTE_AREAS.map(function (a) { return '<option>' + a + '</option>'; }).join('') + '</select></div>' +\n    '<div class=\"full\"><label for=\"n_text\">Note</label><textarea id=\"n_text\" rows=\"3\" placeholder=\"e.g. On the phone the Dispatch Register buttons are too small\"></textarea></div></div>' +\n    '<div style=\"margin-top:10px;text-align:right\"><button type=\"button\" class=\"btn pri\" data-act=\"addNote\">Add note</button></div></div>';\n  if (!list.length) return h + '<div class=\"panel empty\">No notes yet.</div>';\n  return h + '<div class=\"list\">' + list.map(function (x) {\n    var done = x.status === 'Done';\n    return '<div class=\"row\" style=\"' + (done ? 'opacity:.6' : '') + '\"><div class=\"m\"><div><span class=\"stage ' + (done ? 's5' : 's1') + '\">' + (done ? 'Done' : 'Open') + '</span> <b>' + esc(x.area) + '</b> <span class=\"mu\">· ' + esc(x.by) + ' · ' + dmy(x.date) + ' · ' + esc(x.id) + '</span></div>' +\n      '<div style=\"margin-top:4px;white-space:pre-wrap\">' + esc(x.text) + '</div></div>' + (owner ? '<button type=\"button\" class=\"btn sm\" data-act=\"noteStatus\" data-id=\"' + esc(x.id) + '\" data-kind=\"' + (done ? 'Open' : 'Done') + '\">' + (done ? 'Reopen' : 'Mark done') + '</button>' : '') + '</div>';\n  }).join('') + '</div>';\n}\nfunction vUsers() {\n  var h = pageHead('Users', 'Staff log in with the username and password you set here. They never need the Google Sheet.', '<button type=\"button\" class=\"btn pri sm\" data-act=\"newUser\">+ Add user</button>');\n  h += '<div class=\"list\">' + (D.users || []).map(function (u) {\n    return '<div class=\"row\" style=\"' + (u.active ? '' : 'opacity:.55') + '\"><div class=\"m\"><b>' + esc(u.name) + '</b> <span class=\"mu\">(' + esc(u.id) + ')</span><div class=\"mu\" style=\"font-size:12.5px\"><span class=\"stage s2\">' + esc(u.role) + '</span> ' + esc(ROLE_HELP[u.role] || '') + (u.active ? '' : ' · <span class=\"over\">Blocked</span>') + '</div></div><button type=\"button\" class=\"btn sm\" data-act=\"editUser\" data-id=\"' + esc(u.id) + '\">Edit</button></div>';\n  }).join('') + '</div>';\n  return h;\n}\n\n/* ---------- forms ---------- */\nvar FORM = null;\nfunction openForm(cfg) {\n  FORM = cfg; FORM.warned = false;\n  var v = cfg.values || {};\n  var h = '<h3>' + esc(cfg.title) + '</h3>' + (cfg.sub ? '<div class=\"sub\">' + cfg.sub + '</div>' : '') + '<div class=\"fg\">';\n  (cfg.fields || []).forEach(function (f) {\n    if (f.sec) { h += '<div class=\"sec\">' + esc(f.sec) + '</div>'; return; }\n    var val = v[f.k] == null ? (f.def == null ? '' : f.def) : v[f.k];\n    var id = 'f_' + f.k, cls = f.full ? 'full' : '';\n    if (f.type === 'check') { h += '<div class=\"ck ' + cls + '\"><input type=\"checkbox\" id=\"' + id + '\"' + (val ? ' checked' : '') + '><label for=\"' + id + '\" style=\"margin:0;color:var(--fg)\">' + esc(f.label) + '</label></div>'; return; }\n    h += '<div class=\"' + cls + '\"><label for=\"' + id + '\">' + esc(f.label) + (f.req ? ' *' : '') + '</label>';\n    if (f.type === 'select') {\n      h += '<select id=\"' + id + '\">' + (f.blank ? '<option value=\"\">' + esc(f.blank) + '</option>' : '') + f.options.map(function (o) { return '<option value=\"' + esc(o[0]) + '\"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';\n    } else if (f.type === 'textarea') {\n      h += '<textarea id=\"' + id + '\" rows=\"2\">' + esc(val) + '</textarea>';\n    } else {\n      var t = f.type === 'weight' ? 'text' : (f.type || 'text');\n      h += '<input id=\"' + id + '\" name=\"' + id + '_x\" autocomplete=\"' + (f.type === 'password' ? 'new-password' : 'off') + '\" type=\"' + t + '\"' + (f.type === 'number' || f.type === 'weight' ? ' inputmode=\"decimal\"' : '') + (f.type === 'number' ? ' step=\"any\" min=\"0\"' : '') + (f.list ? ' list=\"dl_' + f.k + '\"' : '') + ' value=\"' + esc(val) + '\"' + (f.ph ? ' placeholder=\"' + esc(f.ph) + '\"' : '') + (f.ro ? ' readonly' : '') + '>';\n      if (f.list) h += '<datalist id=\"dl_' + f.k + '\">' + f.list.map(function (o) { return '<option value=\"' + esc(o) + '\">'; }).join('') + '</datalist>';\n      if (f.type === 'weight') h += '<div class=\"hint\" id=\"hint_' + f.k + '\"></div>';\n      if (f.fill != null) h += '<button type=\"button\" class=\"fill\" data-fill=\"' + id + '\" data-val=\"' + esc(f.fill) + '\">' + esc(f.fillLabel || 'Fill') + '</button>';\n    }\n    if (f.help) h += '<div class=\"help\">' + esc(f.help) + '</div>';\n    h += '</div>';\n  });\n  h += '</div><div class=\"msg warn\" id=\"fwarn\" hidden></div><div class=\"msg err\" id=\"ferr\" hidden></div><div class=\"foot\">' + (cfg.extra || '') + '<button type=\"button\" class=\"btn ghost\" data-act=\"close\">Go back</button>' + (cfg.noSave ? '' : '<button type=\"submit\" class=\"btn ' + (cfg.danger ? 'danger' : 'pri') + '\" id=\"fsave\">' + esc(cfg.submit || 'Save') + '</button>') + '</div>';\n  $('#mform').innerHTML = h;\n  $('#modal').hidden = false;\n  (cfg.fields || []).forEach(function (f) { if (f.type === 'weight') weightHint(f.k); });\n  var first = $('#mform input:not([type=checkbox]):not([readonly]),#mform select');\n  if (first && window.innerWidth > 860) first.focus();\n}\nfunction weightHint(k) {\n  var el = document.getElementById('f_' + k), h = document.getElementById('hint_' + k);\n  if (!el || !h) return;\n  var raw = el.value.trim(), q = toQtl(raw);\n  var bad = raw !== '' && (q !== q);\n  h.textContent = raw === '' ? 'Type as on the slip: 38450 (kg) or 384.50 (qtl)' : bad ? 'Type numbers only, e.g. 38450 or 384.50' : (n(raw.replace(/,/g, '')) >= 1000 ? raw + ' kg = ' : '') + qt(q) + ' qtl';\n  h.style.color = bad || (raw !== '' && (q < 150 || q > 500)) ? 'var(--wn)' : '';\n}\nfunction closeForm() { $('#modal').hidden = true; FORM = null; }\nfunction formVals() {\n  var o = {};\n  (FORM.fields || []).forEach(function (f) {\n    if (!f.k) return;\n    var el = document.getElementById('f_' + f.k);\n    o[f.k] = f.type === 'check' ? el.checked : f.type === 'weight' ? (el.value.trim() === '' ? '' : String(toQtl(el.value))) : el.value.trim();\n  });\n  return o;\n}\nfunction normField(f, v) {\n  if (f.type === 'check') return !!v;\n  if (f.type === 'number' || f.type === 'weight') return v === '' || v == null ? '' : Number(v);\n  return String(v == null ? '' : v).trim();\n}\nfunction changedOnly(vals) {\n  var orig = FORM.values || {}, out = {};\n  (FORM.fields || []).forEach(function (f) { if (f.k && normField(f, vals[f.k]) !== normField(f, orig[f.k])) out[f.k] = vals[f.k]; });\n  return out;\n}\nfunction showErr(m) { var e = $('#ferr'); if (!e) return; e.textContent = m; e.hidden = !m; }\nfunction submitForm(ev) {\n  ev.preventDefault();\n  if (!FORM || BUSY || FORM.noSave) return;\n  if (FORM.batch) { FORM.batch(); return; }\n  var vals = formVals();\n  for (var i = 0; i < (FORM.fields || []).length; i++) {\n    var f = FORM.fields[i];\n    if (f.req && (vals[f.k] === '' || vals[f.k] == null)) { showErr('Fill in ' + f.label + '.'); return; }\n    if ((f.type === 'number' || f.type === 'weight') && vals[f.k] !== '' && (isNaN(Number(vals[f.k])) || Number(vals[f.k]) < 0)) { showErr(f.label + ' must be a number.'); return; }\n  }\n  if (FORM.check) { var c = FORM.check(vals); if (c) { showErr(c); return; } }\n  var send = vals;\n  if (FORM.onlyChanged) { send = changedOnly(vals); if (!Object.keys(send).length) { closeForm(); toast('No changes'); return; } }\n  if (!FORM.warned) {\n    var w = FORM.warn ? FORM.warn(send) : null;\n    if (!w) (FORM.fields || []).forEach(function (f) { if (!w && f.type === 'weight' && send[f.k] !== undefined && send[f.k] !== '' && (n(send[f.k]) < 150 || n(send[f.k]) > 500)) w = qt(send[f.k]) + ' qtl is unusual for one truck (normally 150–500 qtl).'; });\n    if (w) { FORM.warned = true; var el = $('#fwarn'); el.textContent = w + ' Tap Save again if it is correct.'; el.hidden = false; return; }\n  }\n  var payload = FORM.build ? FORM.build(send) : send;\n  if (FORM.warned && FORM.fn === 'api_saveTruck' && D.me.role === 'Owner' && payload && typeof payload === 'object') payload._force = true;\n  BUSY = true; $('#fsave').disabled = true; $('#fsave').textContent = 'Saving…'; showErr('');\n  var done = FORM.done || 'Saved';\n  var p = FORM.custom ? FORM.custom(payload) : call(FORM.fn, payload);\n  p.then(function (d) { BUSY = false; closeForm(); if (d && d.trucks) setData(d); toast(done); })\n    .catch(function (e) { BUSY = false; if (!FORM) return; $('#fsave').disabled = false; $('#fsave').textContent = FORM.submit || 'Save'; showErr(e.message || String(e)); });\n}\nfunction openMenu(title, sub, items) {\n  FORM = { noSave: true };\n  $('#mform').innerHTML = '<h3>' + title + '</h3>' + (sub ? '<div class=\"sub\">' + sub + '</div>' : '') + '<div class=\"menu\">' + items.map(function (m) { return '<button type=\"button\" class=\"' + (m.danger ? 'danger' : '') + '\" data-act=\"' + m.a + '\" data-id=\"' + esc(m.id) + '\"' + (m.kind ? ' data-kind=\"' + m.kind + '\"' : '') + '>' + m.l + '</button>'; }).join('') + '</div><div class=\"foot\"><button type=\"button\" class=\"btn ghost\" data-act=\"close\">Go back</button></div>';\n  $('#modal').hidden = false;\n}\n\n/* ---------- actions ---------- */\nfunction poOpts() { return D.po.filter(function (p) { return p.status !== 'Cancelled' && p.status !== 'Settled'; }).map(function (p) { var s = orderStats('po', p); return [p.id, p.id + (multiFirm() ? ' · ' + shortFirm(firmOf(p)) : '') + ' · ' + p.plant + (p.takenIn && normName(p.takenIn) !== firmOf(p) ? ' via ' + shortFirm(p.takenIn) : '') + (p.poType === 'plant' ? ' (own plant)' : '') + ' · bal ' + qt(s.bal)]; }); }\nfunction soOpts() { return D.so.filter(function (s) { return s.status !== 'Cancelled' && s.status !== 'Settled'; }).map(function (o) { var s = orderStats('so', o); return [o.id, o.id + (multiFirm() ? ' · ' + shortFirm(firmOf(o)) : '') + ' · ' + o.buyer + (P.money ? ' · ' + inr(o.rate) + ' ' + terms(o) : '') + ' · bal ' + qt(s.bal)]; }); }\nfunction tradingFirms() { return String(D && D.settings.tradingFirms || '').split(',').map(normName).filter(String); }\nfunction firmOpts() { return firms().filter(String).map(function (f) { return [f, f]; }); }\nfunction names(list, key) { var m = {}; list.forEach(function (x) { if (x[key]) m[normName(x[key])] = 1; }); return Object.keys(m).sort(); }\nfunction transporters() { return D ? names(D.trucks, 'transporter') : []; }\nfunction getT(id) { return T.filter(function (t) { return t.id === id; })[0]; }\n/* Warnings before saving a truck. v = only the fields being saved; orig = the truck as it is now (blank for a new truck). */\nfunction truckWarn(id, orig) {\n  return function (v) {\n    var cur = function (k) { return k in v ? v[k] : (orig ? orig[k] : ''); };\n    var tn = normTruck(cur('truck')), date = cur('date');\n    if (tn && (!orig || 'truck' in v || 'date' in v)) {\n      var open = T.filter(function (t) { return !t.cx && t.id !== id && normTruck(t.truck) === tn && (!t.U || t.date === date); });\n      if (open.length) return open[0].date === date ? 'Truck ' + tn + ' is already entered on ' + dmy(date) + ' as ' + open[0].id + '.' : 'Truck ' + tn + ' is already on trip ' + open[0].id + ', which is not unloaded yet.';\n    }\n    var po = cur('po'), so = cur('so'), lw = n(cur('loadWt'));\n    if ('loadWt' in v && lw) { var same = T.filter(function (t) { return !t.cx && t.id !== id && t.L === lw && t.po === po; }); if (same.length) return 'Another truck (' + same[0].id + ') on this PO has the same loaded weight.'; }\n    if (lw && ('loadWt' in v || 'po' in v || 'so' in v || !orig)) {\n      var checks = [['po', po, PO], ['so', so, SO]];\n      for (var i = 0; i < checks.length; i++) {\n        var c = checks[i], o = c[2][c[1]];\n        if (!o) continue;\n        var counted = orig && orig[c[0]] === c[1] ? orig.L : 0;\n        var bal = orderStats(c[0], o).bal + counted - lw;\n        if (bal < 0) return o.id + ' would go over its quantity by ' + qt(-bal) + ' qtl.';\n      }\n    }\n    if (v.transporter && transporters().indexOf(normName(v.transporter)) < 0) return 'New transporter name \"' + normName(v.transporter) + '\". Check the spelling matches the one you normally use.';\n    return null;\n  };\n}\nfunction actNewTruck() {\n  var recent = live().filter(function (t) { return PO[t.po] && PO[t.po].status !== 'Cancelled'; }).sort(sortT)[0];\n  var lastPo = recent ? PO[recent.po] : D.po.filter(function (p) { return p.status !== 'Cancelled'; }).slice(-1)[0];\n  var fields = [\n    { k: 'truck', label: 'Vehicle No', req: 1, ph: 'PB29X0297', full: 1 }, { k: 'po', label: 'Purchase order', type: 'select', options: poOpts(), blank: 'Choose PO', req: 1 },\n    { k: 'date', label: 'Date out (from the slip)', type: 'date', help: 'Leave blank until the slip comes. Needed once the weight is entered.' }, { k: 'placedOn', label: 'Vehicle placed on', type: 'date', req: 1 }, { k: 'transporter', label: 'Transporter', list: transporters() }, { k: 'driver', label: 'Driver name / phone' },\n    { k: 'so', label: 'Customer (sale order)', type: 'select', options: soOpts(), blank: 'Choose later / set by the PO', full: 1, help: 'Leave blank for own-plant POs, or when the PO already sells to a sale order.' },\n    { sec: 'If the slip has already come' }, { k: 'loadWt', label: 'Dispatch weight', type: 'weight' }, { k: 'slip', label: 'RST / Weighment Slip No.' }\n  ];\n  fields.push({ k: 'frate', label: 'Freight rate per qtl (needed with weight)', type: 'number' });\n  if (P.truckMoney) fields.push({ k: 'advance', label: 'Freight advance (₹)', type: 'number' });\n  openForm({ title: 'New truck', sub: 'The dispatch number is created automatically.', fn: 'api_saveTruck', done: 'Truck added', warn: truckWarn('', null), submit: 'Save truck',\n    check: function (v) { var p = PO[v.po]; return weightNeeds(v) || (p && p.poType === 'plant' && v.so ? v.po + ' goes to your own plant. Leave the customer blank.' : null); },\n    values: { placedOn: D.today, po: lastPo ? lastPo.id : '', frate: D.settings.defaultFreightRate || '' }, fields: fields });\n}\nfunction actEditTruck(id) {\n  var t = getT(id);\n  var fields = [\n    { k: 'truck', label: 'Vehicle No', req: 1 }, { k: 'placedOn', label: 'Vehicle placed on', type: 'date' }, { k: 'date', label: 'Date out (from the slip)', type: 'date', help: 'Needed once the weight is entered.' },\n    { k: 'po', label: 'Purchase order', type: 'select', options: poOpts(), blank: 'Choose PO', req: 1 }, { k: 'so', label: 'Customer (sale order)', type: 'select', options: soOpts(), blank: 'No customer yet' },\n    { k: 'transporter', label: 'Transporter', list: transporters() }, { k: 'driver', label: 'Driver name / phone' },\n    { sec: 'Loading' }, { k: 'loadWt', label: 'Dispatch weight', type: 'weight' }, { k: 'slip', label: 'RST / Weighment Slip No.' },\n    { sec: 'Unloading' }, { k: 'unloadDate', label: 'Unloading date', type: 'date' }, { k: 'unloadWt', label: 'Received weight', type: 'weight' }\n  ];\n  if (!P.truckMoney) fields.push({ k: 'frate', label: 'Freight rate per qtl (needed with weight)', type: 'number' });\n  if (P.truckMoney) fields = fields.concat([{ sec: 'Freight' }, { k: 'frate', label: 'Freight rate per qtl', type: 'number' }, { k: 'advance', label: 'Freight advance (₹)', type: 'number' }, { k: 'detention', label: 'Detention (₹)', type: 'number', help: 'Only if agreed with the transporter. Suggestion: ' + t.freeDays + ' free days, then ' + inr(t.perDay) + '/day' + (t.detSuggest ? ' = ' + inr(t.detSuggest) : '') + '.' }]);\n  if (P.truckMoney && !t.plantPO) fields.push({ k: 'saleRate', label: 'Invoice rate for this vehicle (₹/qtl)', type: 'number', help: 'Only if this invoice has a different rate. Blank = sale order rate' + (SO[t.so] ? ' (' + inr(SO[t.so].rate) + ')' : '') + '.' });\n  if (P.editClosed) fields = fields.concat([{ sec: 'Owner corrections only' }, { k: 'received', label: 'Total received from customer (₹)', type: 'number' }, { k: 'deduction', label: 'Total deduction (₹)', type: 'number' }]);\n  fields.push({ k: 'note', label: 'Note', type: 'textarea', full: 1 });\n  openForm({ title: 'Edit ' + t.truck, sub: esc(t.id) + ' · ' + t.stage, fn: 'api_saveTruck', warn: truckWarn(id, t), check: weightNeeds, values: t, onlyChanged: true,\n    build: function (v) { v.id = id; return v; }, fields: fields });\n}\nfunction quick(id, title, sub, fields, done, values, warn, check) {\n  var t = getT(id);\n  openForm({ title: title, sub: sub, fn: 'api_saveTruck', fields: fields, values: values || t, done: done, warn: warn, check: check, onlyChanged: true,\n    build: function (v) { v.id = id; return v; } });\n}\nfunction actAssign(id) {\n  var t = getT(id);\n  quick(id, t.so ? 'Change customer' : 'Choose customer', esc(t.truck + ' · ' + t.id + (t.L ? ' · ' + qt(t.L) + ' qtl' : '')), [{ k: 'so', label: 'Sale order', type: 'select', options: soOpts(), blank: 'Choose sale order', req: 1, full: 1 }], 'Customer saved', null, truckWarn(id, t));\n}\nfunction actLoad(id) {\n  var t = getT(id);\n  quick(id, 'Dispatch weight', esc(t.truck + ' · ' + t.id), [{ k: 'loadWt', label: 'Weight on the slip', type: 'weight', req: 1, full: 1 }, { k: 'date', label: 'Date out (from the slip)', type: 'date', req: 1 }, { k: 'transporter', label: 'Transporter', list: transporters(), req: 1 }, { k: 'frate', label: 'Freight rate per qtl', type: 'number' }, { k: 'slip', label: 'RST / Weighment Slip No.' }], 'Weight saved', Object.assign({}, t, { date: t.date || D.today, frate: t.frate === '' || t.frate == null ? (D.settings.defaultFreightRate || '') : t.frate }), truckWarn(id, t), weightNeeds);\n}\nfunction actUnload(id) {\n  var t = getT(id);\n  var fields = [{ k: 'unloadDate', label: 'Unloading date', type: 'date', req: 1 }, { k: 'unloadWt', label: 'Received weight', type: 'weight', req: 1 }];\n  if (!t.so && !t.plantPO) fields.unshift({ k: 'so', label: 'Customer (sale order)', type: 'select', options: soOpts(), blank: 'Choose customer', req: 1, full: 1 });\n  if (P.truckMoney && !t.fBuyer) fields.push({ k: 'frate', label: 'Freight rate per qtl', type: 'number', req: 1 });\n  fields.push({ k: 'transporter', label: 'Transporter', list: transporters() });\n  fields[fields.length - (P.truckMoney && !t.fBuyer ? 3 : 2)].label = toPlant(t) ? 'Received weight (weighbridge)' : 'Received weight';\n  quick(id, toPlant(t) ? 'Received at ' + shortFirm(plantFirm()) : 'Record unloading', esc(t.truck + ' · ' + t.id) + ' · loaded ' + qt(t.L) + ' qtl' + (multiFirm() ? ' · ' + esc(shortFirm(t.firm)) + ' truck' : ''), fields, toPlant(t) ? 'Marked received' : 'Unloading saved',\n    Object.assign({}, t, { unloadDate: t.unloadDate || D.today, frate: t.frate === '' || t.frate == null ? (D.settings.defaultFreightRate || '') : t.frate }), truckWarn(id, t),\n    function (v) { return n(v.unloadWt) > t.L * 1.05 ? 'Received weight is more than dispatch weight. Check the slip.' : null; });\n  FORM.onlyChanged = false;\n}\nfunction actUnpaid(id) { var t = getT(id); openForm({ title: 'Undo supplier payment?', sub: esc(t.truck + ' · ' + t.id + ' · ' + inr(t.purTot)), fn: 'api_saveTruck', danger: 1, submit: 'Mark unpaid', done: 'Marked unpaid', fields: [], build: function () { return { id: id, plantPaid: false, plantPaidDate: '' }; } }); }\nfunction actFUnpaid(id) { var t = getT(id); openForm({ title: 'Undo freight payment?', sub: esc(t.truck + ' · ' + t.id), fn: 'api_saveTruck', danger: 1, submit: 'Mark unpaid', done: 'Marked unpaid', fields: [], build: function () { return { id: id, freightPaid: false, freightPaidDate: '' }; } }); }\nfunction actAdvance(id) {\n  var t = getT(id);\n  quick(id, 'Freight advance', esc(t.truck + ' · ' + t.id), [{ k: 'advance', label: 'Total freight advance paid (₹)', type: 'number', req: 1, help: 'The total for this truck, not just today’s amount.' }, { k: 'transporter', label: 'Transporter', list: transporters() }], 'Freight advance saved', null, truckWarn(id, t));\n}\nfunction actFPaid(id) {\n  var t = getT(id);\n  var fields = [{ k: 'detention', label: 'Detention (₹) – only if you agree to pay', type: 'number', help: t.detDays > 0 ? t.trip + ' days on trip, ' + t.freeDays + ' free, so ' + t.detDays + ' extra day' + (t.detDays > 1 ? 's' : '') + '. Suggestion: ' + inr(t.detSuggest) + ' (' + inr(t.perDay) + '/day). Leave 0 if not paying.' : 'Trip within the ' + t.freeDays + ' free days. Leave 0.', fill: t.detSuggest || null, fillLabel: 'Add suggested ' + inr(t.detSuggest) }, { k: 'freightPaidDate', label: 'Payment date', type: 'date', req: 1 }, { k: 'freightUTR', label: 'UTR (bank reference)', req: 1, ph: 'e.g. SBIN52345678901', full: 1, help: 'Needed for every freight payment.' }];\n  openForm({ title: 'Pay freight', sub: esc(t.truck + ' · ' + t.id + ' · ' + (t.transporter || 'no transporter')) + '<br>Freight ' + inr(t.frAmt) + ' − shortage ' + inr(t.shortDed) + ' − advance ' + inr(t.A) + ' + detention' + (t.carryIn ? ' − ' + inr(t.carryIn) + ' extra advance from earlier trip' : '') + '<br>Net to pay <b id=\"fnet\">' + inr(t.netPay) + '</b>' + (t.transporter ? bankBox(bankFor('transporter', t.transporter), 'transporter', t.transporter) : '<div class=\"mu\">No transporter on this truck.</div>') + payPhotoInput('freightPay', t) + (t.carryOut ? '<br><span class=\"mu\">Advance is more than freight: ' + inr(t.carryOut) + ' will be adjusted on this truck\\u2019s next trip.</span>' : ''),\n    fn: 'api_saveTruck', submit: 'Confirm freight paid', done: 'Freight marked paid', values: { detention: t.det || 0, freightPaidDate: D.today }, fields: fields,\n    check: function (v) { return v.detention === '' ? 'Enter the detention amount (0 if none).' : null; },\n    build: function (v) { return { id: id, freightPaid: true, freightPaidDate: v.freightPaidDate, detention: v.detention, freightUTR: v.freightUTR }; } });\n  $('#f_detention').addEventListener('input', function (e) { $('#fnet').textContent = inr(Math.max(0, t.frAmt - t.shortDed - t.A + n(e.target.value) - t.carryIn)); });\n}\nfunction actReceive(id) {\n  var t = getT(id);\n  openForm({\n    title: 'Payment from customer', sub: esc(t.buyer) + ' · ' + esc(t.truck + ' · ' + t.id) + '<br>Sale total <b>' + inr(t.saleTot) + '</b> · received ' + inr(t.R) + (t.DED ? ' · deducted ' + inr(t.DED) : '') + ' · balance <b>' + inr(t.bal) + '</b>',\n    values: { receivedDate: D.today }, done: 'Payment recorded', submit: 'Save payment',\n    fields: [\n      { k: 'amt', label: 'Amount received (₹)', type: 'number', fill: t.bal, fillLabel: 'Full balance ' + inr(t.bal) }, { k: 'receivedDate', label: 'Date', type: 'date', req: 1 },\n      { sec: 'Only if the customer cut something' },\n      { k: 'deduction', label: 'Deduction (₹)', type: 'number', help: 'TDS, weight claim or rate difference.' },\n      { k: 'deductionNote', label: 'Reason', type: 'select', options: [['TDS', 'TDS'], ['Weight claim', 'Weight claim'], ['Rate difference', 'Rate difference'], ['Other', 'Other']], blank: 'Choose…' }\n    ],\n    check: function (v) {\n      if (!(n(v.amt) > 0) && !(n(v.deduction) > 0)) return 'Enter the amount received, or a deduction.';\n      if (n(v.deduction) > 0 && !v.deductionNote) return 'Choose the reason for the deduction.';\n      return null;\n    },\n    warn: function (v) { var over = n(v.amt) + n(v.deduction) - t.bal; return over > 1 ? 'This is ' + inr(over) + ' more than the balance.' : null; },\n    custom: function (v) { return call('api_addPayment', id, v.amt, v.receivedDate, v.deduction, v.deductionNote); }\n  });\n}\nfunction actOrder(kind, id) {\n  var defFirm = FIRM !== 'all' ? FIRM : firms()[0];\n  var o = id ? (kind === 'po' ? D.po : D.so).filter(function (x) { return x.id === id; })[0] : { date: D.today, commodity: 'DDGS', gst: D.settings.defaultGst || 0.05, creditDays: D.settings.defaultCreditDays || 7, gstMode: 'incl', freightMode: 'ours', firm: defFirm, poType: 'trade' };\n  var party = kind === 'po' ? 'plant' : 'buyer';\n  var vals = Object.assign({}, o, { gstPct: Math.round(n(o.gst) * 10000) / 100, firm: firmOf(o), poType: o.poType || 'trade' });\n  var known = names(kind === 'po' ? D.po : D.so, party);\n  var suggest = kind === 'so' ? known.concat(firms().filter(function (f) { return f && known.indexOf(f) < 0; })) : known;\n  var top = multiFirm() ? [{ k: 'firm', label: 'Firm', type: 'select', options: firmOpts(), req: 1, full: 1 }] : [];\n  var poExtra = kind === 'po' ? [\n    { sec: 'Where the goods go' },\n    { k: 'takenIn', label: 'Booked in the name of (whose name the plant gave the order)', type: 'select', options: tradingFirms().map(function (f) { return [f, f]; }), blank: 'Same as the firm above' },\n    { k: 'poType', label: 'This PO is for', type: 'select', options: [['trade', 'Trading – we sell it to a customer'], ['plant', 'Own plant – ' + (plantFirm() || 'our plant') + ' (no sale)']], req: 1 },\n    { k: 'linkSO', label: 'Sells to (sale order)', type: 'select', options: soOpts(), blank: 'Choose customer on each truck', help: 'Trucks on this PO get this buyer automatically. Not used for own-plant POs.' }\n  ] : [];\n  openForm({\n    title: id ? 'Edit ' + id : (kind === 'po' ? 'New purchase order' : 'New sale order'), sub: id ? '' : 'The ' + (kind === 'po' ? 'PO' : 'SO') + ' number is created automatically.',\n    fn: kind === 'po' ? 'api_savePO' : 'api_saveSO', values: vals, done: id ? 'Order saved' : 'Order created', onlyChanged: !!id,\n    check: function (v) {\n      var f = 'firm' in v ? v.firm : vals.firm;\n      if (kind === 'so' && normName(v.buyer || vals.buyer) === f) return 'A firm cannot sell to itself. Check the firm and the customer.';\n      var lk = 'linkSO' in v ? v.linkSO : vals.linkSO, ty = 'poType' in v ? v.poType : vals.poType;\n      if (kind === 'po' && ty !== 'plant' && lk && SO[lk] && firmOf(SO[lk]) !== f) return lk + ' belongs to ' + firmOf(SO[lk]) + '. Choose a sale order of ' + f + '.';\n      return null;\n    },\n    warn: function (v) {\n      if (v[party] && suggest.indexOf(normName(v[party])) < 0 && !(id && normName(o[party]) === normName(v[party]))) return 'New ' + party + ' name \"' + normName(v[party]) + '\". Check the spelling matches earlier orders.';\n      if (id && v.qty !== undefined && v.qty !== '' && n(v.qty) < orderStats(kind, o).done) return 'Quantity is less than the ' + qt(orderStats(kind, o).done) + ' qtl already loaded.';\n      return null;\n    },\n    build: function (v) { var r = {}; ['date', 'commodity', 'qty', 'rate', 'note', party, 'gstMode', 'freightMode', 'creditDays', 'firm', 'poType', 'linkSO', 'takenIn'].forEach(function (k) { if (k in v) r[k] = v[k]; }); if ('gstPct' in v) r.gst = n(v.gstPct) / 100; if (r.poType === 'plant') r.linkSO = ''; if (id) r.id = id; return r; },\n    fields: top.concat([\n      { k: party, label: kind === 'po' ? 'Supplier' : 'Customer', req: 1, full: 1, list: suggest, help: kind === 'so' && multiFirm() ? 'To sell to your group company, type its name (e.g. ' + firms()[firms().length - 1] + ').' : '' }, { k: 'date', label: kind === 'po' ? 'Contract date' : 'Order date', type: 'date', req: 1 },\n      { k: 'qty', label: 'Quantity (qtl)', type: 'number', req: 1 }, { k: 'rate', label: kind === 'po' ? 'Rate per qtl (GST extra)' : 'Sale rate per qtl', type: 'number', req: 1 }, { k: 'gstPct', label: 'GST %', type: 'number' }\n    ]).concat(kind === 'so' ? [\n      { k: 'gstMode', label: 'Does the rate include GST?', type: 'select', options: [['incl', 'Yes, GST included (usual)'], ['excl', 'No, GST extra']], blank: 'Choose…', req: 1 },\n      { k: 'freightMode', label: 'Does the rate include freight?', type: 'select', options: [['ours', 'Yes, we pay the transporter (usual)'], ['buyer', 'No, customer pays the transporter']], blank: 'Choose…', req: 1 },\n      { k: 'creditDays', label: 'Credit days', type: 'number', help: 'Customer pays within these days after unloading.' }\n    ] : poExtra).concat([{ k: 'commodity', label: 'Commodity' }, { k: 'note', label: 'Note', type: 'textarea', full: 1 }])\n  });\n}\nfunction actBill(id) {\n  var t = getT(id);\n  openForm({ title: 'Supplier invoice', sub: esc(t.truck + ' · ' + t.id + ' · ' + t.plant) + '<br>Type the quantity exactly as printed on the plant\\u2019s bill. The app checks it against the slip weight.',\n    fn: 'api_saveTruck', done: 'Supplier invoice saved', values: { billNo: t.billNo || '', billQty: t.billQ === null ? '' : t.billQ },\n    fields: [{ k: 'billNo', label: 'Bill / invoice no.', req: 1 }, { k: 'billQty', label: 'Quantity on the bill', type: 'weight', req: 1 }],\n    build: function (v) { return { id: id, billNo: v.billNo, billQty: v.billQty }; },\n    custom: function (v) { return call('api_saveTruck', v).then(function (d) { var x = d.trucks.filter(function (r) { return r.id === id; })[0]; if (x && Math.abs(n(x.billQty) - n(x.loadWt)) >= 0.005) setTimeout(function () { toast('Bill ' + qt(x.billQty) + ' does not match slip ' + qt(x.loadWt) + '. Marked red.'); }, 50); return d; }); } });\n}\nfunction actReturned(id) {\n  var t = getT(id);\n  openForm({ title: 'Returned empty?', sub: esc(t.truck + ' · ' + t.id + ' · ' + t.plant) + '<br>The truck stays on record as Returned and stops counting against ' + esc(t.po) + '.', danger: 1, submit: 'Yes, mark returned', done: 'Marked returned',\n    fields: [{ k: 'reason', label: 'Reason', full: 1, ph: 'e.g. waited 3 days, not called inside', req: 1 }], custom: function (v) { return call('api_returned', id, v.reason); } });\n}\nfunction actBatch(kind) {\n  var plant = kind === 'plant';\n  var elig = live().filter(function (t) { return plant ? t.L && !t.plantPaid : t.U && !t.fBuyer && !t.freightPaid; });\n  var amt = function (t) { return plant ? t.purTot : t.netPay; };\n  var party = function (t) { return plant ? t.plant : (t.transporter || '(none)'); };\n  var parties = names(elig.map(function (t) { return { p: party(t) }; }), 'p');\n  if (!parties.length) { toast(plant ? 'No loaded trucks waiting for supplier payment.' : 'No unloaded trucks waiting for freight payment.'); return; }\n  FORM = { batchKind: kind, warned: false };\n  $('#mform').innerHTML = '<h3>' + (plant ? 'Pay supplier for several trucks' : 'Pay freight for several trucks') + '</h3><div class=\"sub\">Tick the trucks this one bank payment covers.</div>' +\n    '<div class=\"fg\"><div class=\"full\"><label for=\"b_party\">' + (plant ? 'Supplier' : 'Transporter') + '</label><select id=\"b_party\">' + parties.map(function (p) { return '<option value=\"' + esc(p) + '\">' + esc(p) + '</option>'; }).join('') + '</select></div></div>' +\n    '<div id=\"b_bank\"></div><div class=\"blist\" id=\"b_list\"></div><div class=\"btot\" id=\"b_tot\"></div>' +\n    '<div class=\"fg\"><div><label for=\"b_amt\">Amount paid (₹)</label><input id=\"b_amt\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\"></div><div><label for=\"b_date\">Payment date</label><input id=\"b_date\" type=\"date\" value=\"' + D.today + '\"></div>' +\n    '<div class=\"full\"><label for=\"b_utr\">UTR / bank reference</label><input id=\"b_utr\" autocomplete=\"off\" placeholder=\"e.g. SBIN52345678901\"></div></div>' +\n    '<div class=\"msg warn\" id=\"fwarn\" hidden></div><div class=\"msg err\" id=\"ferr\" hidden></div><div class=\"foot\"><button type=\"button\" class=\"btn ghost\" data-act=\"close\">Go back</button><button type=\"submit\" class=\"btn pri\" id=\"fsave\">Save payment</button></div>';\n  $('#modal').hidden = false;\n  var total = function () { var ids = [], q = 0, a = 0; document.querySelectorAll('#b_list input:checked').forEach(function (c) { var t = getT(c.value); ids.push(t.id); q += plant ? t.L : t.U; a += amt(t); }); return { ids: ids, q: r2(q), a: r2(a) }; };\n  var show = function () { var x = total(); $('#b_tot').textContent = trk(x.ids.length) + ' ticked · ' + qt(x.q) + ' qtl · ' + inr(x.a); FORM.warned = false; $('#fwarn').hidden = true; };\n  var list = function () {\n    var p = $('#b_party').value;\n    $('#b_list').innerHTML = elig.filter(function (t) { return party(t) === p; }).sort(sortT).map(function (t) {\n      return '<label><input type=\"checkbox\" value=\"' + esc(t.id) + '\"><span class=\"m\"><b>' + esc(t.truck) + '</b> <span class=\"mu\">' + esc(t.id) + ' · ' + dmy(plant ? t.date : t.unloadDate) + ' · ' + esc(t.po) + '</span></span><span class=\"num\">' + qt(plant ? t.L : t.U) + ' qtl<br><b>' + inr(amt(t)) + '</b></span></label>';\n    }).join('');\n    $('#b_bank').innerHTML = bankBox(bankFor(plant ? 'supplier' : 'transporter', p), plant ? 'supplier' : 'transporter', p);\n    show();\n  };\n  $('#b_party').onchange = list; $('#b_list').onchange = show; $('#b_amt').oninput = function () { FORM.warned = false; $('#fwarn').hidden = true; };\n  list();\n  FORM.batch = function () {\n    var x = total(), a = $('#b_amt').value.trim(), utr = $('#b_utr').value.trim(), date = $('#b_date').value;\n    showErr('');\n    if (!x.ids.length) return showErr('Tick at least one truck.');\n    if (a === '' || isNaN(Number(a))) return showErr('Enter the amount paid.');\n    if (!utr) return showErr('Enter the UTR / bank reference.');\n    if (!date) return showErr('Enter the payment date.');\n    var diff = r2(Number(a) - x.a);\n    if (Math.abs(diff) > 1 && !FORM.warned) { FORM.warned = true; var el = $('#fwarn'); el.textContent = 'Ticked trucks come to ' + inr(x.a) + ' but the amount paid is ' + inr(Number(a)) + ' (difference ' + inr(diff) + '). Check the trucks, or tap Save again if it is correct.'; el.hidden = false; return; }\n    BUSY = true; $('#fsave').disabled = true; $('#fsave').textContent = 'Saving…';\n    call('api_payBatch', kind, x.ids, date, utr, Number(a)).then(function (d) { BUSY = false; closeForm(); setData(d); toast(trk(x.ids.length) + ' marked paid · UTR ' + utr.toUpperCase()); })\n      .catch(function (e) { BUSY = false; if (!FORM) return; $('#fsave').disabled = false; $('#fsave').textContent = 'Save payment'; showErr(e.message || String(e)); });\n  };\n}\nfunction actCancel(kind, id) {\n  openForm({ title: 'Cancel ' + (kind === 'truck' ? 'truck ' + (getT(id) || {}).truck : id) + '?', sub: 'It stays in the sheet marked Cancelled and stops counting in totals. You can restore it later.', danger: 1, submit: 'Yes, cancel it', done: 'Cancelled',\n    fields: [{ k: 'reason', label: 'Reason', full: 1, ph: 'e.g. duplicate entry', req: 1 }], custom: function (v) { return call('api_cancel', kind, id, v.reason); } });\n}\nfunction actRestore(kind, id) {\n  BUSY = true; closeForm();\n  call('api_restore', kind, id).then(function (d) { BUSY = false; setData(d); toast('Restored'); }).catch(function (e) { BUSY = false; toast(e.message || 'Could not restore'); });\n}\nfunction actUser(id) {\n  var u = id ? D.users.filter(function (x) { return x.id === id; })[0] : { role: 'Dispatch', active: true };\n  var fields = [\n    { k: 'id', label: 'Username', req: !id, ro: !!id, ph: 'e.g. ravi', help: id ? '' : 'Small letters and numbers. Staff type this to log in.' }, { k: 'name', label: 'Full name', req: 1 },\n    { k: 'role', label: 'Role', type: 'select', options: Object.keys(ROLE_HELP).map(function (r) { return [r, r + ' – ' + ROLE_HELP[r]]; }), req: 1, full: 1 },\n    { k: 'password', label: id ? 'New password (leave blank to keep)' : 'Password (6+ characters)', type: 'password', req: !id }\n  ];\n  if (id) fields.push({ k: 'active', label: 'Active (untick to block this user)', type: 'check' });\n  openForm({ title: id ? 'Edit user ' + id : 'Add user', fn: 'api_saveUser', values: u, done: id ? 'User saved' : 'User added',\n    build: function (v) { var o = { id: id || v.id, name: v.name, role: v.role }; if (v.password) o.password = v.password; if (id) o.active = v.active; else o._new = true; return o; }, fields: fields });\n}\nfunction actMe() {\n  openForm({ title: D.me.name || D.me.id, sub: 'Logged in as <b>' + esc(D.me.id) + '</b> · ' + esc(D.me.role), submit: 'Change password', done: 'Password changed',\n    extra: '<button type=\"button\" class=\"btn danger\" data-act=\"logout\" style=\"margin-right:auto\">Log out</button>',\n    fields: [{ k: 'old', label: 'Current password', type: 'password', req: 1 }, { k: 'pw', label: 'New password (6+ characters)', type: 'password', req: 1 }, { k: 'pw2', label: 'Repeat new password', type: 'password', req: 1 }],\n    check: function (v) { return v.pw !== v.pw2 ? 'The new passwords do not match.' : v.pw.length < 6 ? 'New password must be at least 6 characters.' : null; },\n    custom: function (v) { return call('api_changePassword', v.old, v.pw); } });\n}\nfunction logout() { var t = TOKEN || getTok(); closeForm(); cacheClear(); setTok(null); ROUTE = { v: 'home' }; HIST = []; QS = ''; FILTER = 'todo'; FIRM = 'all'; call('api_logout', t).catch(function () {}); showAuth('You are logged out.'); }\nfunction doExport(kind, key, ids) {\n  if (BUSY) return;\n  BUSY = true; closeForm(); toast('Preparing Excel… this takes a few seconds');\n  call('api_export', kind, key || '', ids || null, kind === 'full' && FIRM !== 'all' ? FIRM : '').then(function (r) {\n    BUSY = false; $('#toast').hidden = true;\n    var href = '';\n    try { var bin = atob(r.b64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); href = URL.createObjectURL(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); } catch (e) {}\n    FORM = { noSave: true };\n    $('#mform').innerHTML = '<h3>Excel is ready</h3><div class=\"sub\">' + esc(r.name) + '</div><div class=\"menu\">' + (href ? '<a href=\"' + href + '\" download=\"' + esc(r.name) + '\">⬇ Download to this device</a>' : '') +\n      '<a href=\"' + esc(r.url) + '\" target=\"_blank\" rel=\"noopener\">Open in Google Drive › DDGS Exports</a></div><div class=\"foot\"><button type=\"button\" class=\"btn ghost\" data-act=\"close\">Done</button></div>';\n    $('#modal').hidden = false;\n  }).catch(function (e) { BUSY = false; toast(e.message || 'Could not create the Excel'); });\n}\nfunction showImport(r) {\n  var h = '<h3>Your data is set up</h3><div class=\"sub\">Imported ' + r.pos + ' purchase orders, ' + r.sos + ' sale orders and ' + r.trucks + ' trucks from your existing tabs. Your old tabs were not changed.</div>';\n  var items = (r.skipped || []).concat(r.notes || []);\n  if (items.length) h += '<div class=\"fg\"><div class=\"full\"><b>Check these:</b><ul style=\"margin:6px 0 0;padding-left:18px\">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div></div>';\n  h += '<div class=\"foot\"><button type=\"button\" class=\"btn pri\" data-act=\"close\">Open the app</button></div>';\n  $('#mform').innerHTML = h; $('#modal').hidden = false; FORM = { noSave: true };\n}\n\n\n/* ---------- round 1: required fields, pay popup, photos, activity review, flow charts ---------- */\nvar FLOWSEL = '';\nvar REV = null, REVOK = '', REVKEY = '', REVDATE = '', REVWHO = '';\nfunction exactRs(x) { return '₹' + Number(x || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }\n/* Once a weight is entered, the transporter and the freight rate are needed (the server checks the same rule). */\nfunction weightNeeds(v) {\n  var o = FORM && FORM.values ? FORM.values : {};\n  if (o.id && n(v.loadWt) === n(o.loadWt) && String(v.transporter || '') === String(o.transporter || '')) return null;\n  if (!(n(v.loadWt) > 0)) return null;\n  if (!v.date) return 'Enter the date the truck left (date out, from the slip).';\n  if (!String(v.transporter || '').trim()) return 'Enter the transporter. It is required once the weight is entered.';\n  if (P.truckMoney && !(n(v.frate) > 0)) return 'Enter the freight rate per qtl. It is required once the weight is entered.';\n  return null;\n}\nfunction bankFor(kind, name) { var key = kind + ': ' + normName(name); return (D && D.banks || []).filter(function (b) { return b.id === key; })[0] || null; }\nfunction bankBox(b, kind, name) {\n  var can = !!P.bank, nm = esc(name);\n  if (!b) return '<div class=\"bank\"><div class=\"mu\">No bank details saved for ' + nm + ' yet.' + (can ? ' Add them once; they stay for the next payment.' : ' Ask the Owner or Accounts to add them.') + '</div>' +\n    (can ? '<div class=\"bank-act\"><button type=\"button\" class=\"btn sm\" data-act=\"bankAdd\" data-kind=\"' + kind + '\" data-id=\"' + nm + '\">+ Add bank details</button></div>' : '') + '</div>';\n  var cp = function (label, val, cls) { return '<div class=\"bk\"><span>' + label + '</span><b class=\"' + (cls || '') + '\">' + esc(val) + '</b><button type=\"button\" class=\"cp\" data-copy=\"' + esc(val) + '\">Copy</button></div>'; };\n  return '<div class=\"bank\"><div class=\"bk-h\">Pay to</div>' + cp('Account name', b.accName) + cp('Account no.', b.accNo, 'mono') + cp('IFSC', b.ifsc, 'mono') +\n    '<div class=\"bank-act\"><button type=\"button\" class=\"btn sm\" data-act=\"openBank\">Open bank ↗</button>' + (can ? '<button type=\"button\" class=\"btn sm ghost\" data-act=\"bankAdd\" data-kind=\"' + kind + '\" data-id=\"' + nm + '\">Edit details</button>' : '') + '</div></div>';\n}\nfunction payHead(t, label, amt, extra) {\n  return esc(t.truck + ' · ' + t.id) + '<br>' + label + ' <b>' + exactRs(amt) + '</b>' + (extra ? ' <span class=\"mu\">(' + esc(extra) + ')</span>' : '');\n}\nfunction photoUrl(t, kind) { return t[kind === 'plantPay' ? 'plantPayPhoto' : kind === 'freightPay' ? 'freightPayPhoto' : 'slipPhoto']; }\nfunction payPhotoInput(kind, t) {\n  var url = photoUrl(t, kind);\n  return '<div class=\"ps\"><b>Payment screenshot (optional)</b>' + (url ? '<a href=\"' + esc(url) + '\" target=\"_blank\" rel=\"noopener\">View uploaded photo ↗</a>' : '<span class=\"mu\">Not uploaded</span>') +\n    '<label class=\"upl\">Choose photo<input type=\"file\" accept=\"image/*\" data-kind=\"' + kind + '\" data-id=\"' + esc(t.id) + '\"></label></div>';\n}\nfunction truckPhotos(t) {\n  var slot = function (kind, label, url, canUp) {\n    return '<div class=\"ps' + (kind === 'slip' && !url ? ' miss' : '') + '\"><b>' + label + '</b>' +\n      (url ? '<a href=\"' + esc(url) + '\" target=\"_blank\" rel=\"noopener\">View photo ↗</a>' : kind === 'slip' ? '<span class=\"tag no\">No slip</span>' : '<span class=\"mu\">Not uploaded</span>') +\n      (canUp ? '<label class=\"upl\">Take or choose photo<input type=\"file\" accept=\"image/*\" capture=\"environment\" data-kind=\"' + kind + '\" data-id=\"' + esc(t.id) + '\"></label>' : '') + '</div>';\n  };\n  var h = '<h2>Photos</h2><div class=\"photos\">' + slot('slip', 'Weighment slip photo', t.slipPhoto, !!P.trucks);\n  if (P.truckMoney) h += slot('plantPay', 'Supplier payment screenshot', t.plantPayPhoto, true);\n  if (P.truckMoney && !t.fBuyer) h += slot('freightPay', 'Freight payment screenshot', t.freightPayPhoto, true);\n  return h + '</div>';\n}\nfunction copyText(s) {\n  var fallback = function () {\n    var ta = document.createElement('textarea');\n    ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';\n    document.body.appendChild(ta); ta.select();\n    try { document.execCommand('copy'); toast('Copied: ' + s); } catch (e) { toast('Could not copy. Select the text and copy it.'); }\n    document.body.removeChild(ta);\n  };\n  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(function () { toast('Copied: ' + s); }, fallback); return; } } catch (e) {}\n  fallback();\n}\nfunction openBank() {\n  var u = D && D.settings.bankUrl;\n  if (!u) { toast('Bank link not set. The Owner can add it in Settings (bankUrl).'); return; }\n  window.open(String(u), '_blank', 'noopener');\n}\nfunction actPaid(id) {\n  var t = getT(id);\n  if (!t.L) { toast('Enter the dispatch weight first.'); return; }\n  openForm({ title: 'Pay supplier', sub: payHead(t, 'Amount to pay (incl. GST)', t.purTot, qt(t.L) + ' qtl · ' + t.plant) + bankBox(bankFor('supplier', t.plant), 'supplier', t.plant) + payPhotoInput('plantPay', t),\n    fn: 'api_saveTruck', submit: 'Confirm paid', done: t.truck + ' marked paid', values: { plantPaidDate: D.today },\n    fields: [{ k: 'plantPaidDate', label: 'Payment date', type: 'date', req: 1 }, { k: 'plantUTR', label: 'UTR (bank reference)', req: 1, ph: 'e.g. SBIN52345678901', full: 1, help: 'Copy it from the bank confirmation. Needed for every supplier payment.' }],\n    build: function (v) { return { id: id, plantPaid: true, plantPaidDate: v.plantPaidDate, plantUTR: v.plantUTR }; } });\n}\nfunction actBank(kind, name) {\n  var k = kind === 'supplier' ? 'supplier' : 'transporter', b = bankFor(k, name) || {};\n  openForm({ title: 'Bank details: ' + name, sub: 'Saved once for this ' + (k === 'supplier' ? 'supplier' : 'transporter') + '. Only the Owner and Accounts can see them.', submit: 'Save bank details', done: 'Bank details saved', fn: 'api_saveBank',\n    values: { accName: b.accName || '', accNo: b.accNo || '', ifsc: b.ifsc || '' },\n    fields: [{ k: 'accName', label: 'Account name', req: 1, full: 1 }, { k: 'accNo', label: 'Account number', req: 1, ph: '6 to 20 digits' }, { k: 'ifsc', label: 'IFSC', req: 1, ph: 'SBIN0001234' }],\n    custom: function (v) { return call('api_saveBank', k, name, v.accName, v.accNo, v.ifsc); } });\n}\nfunction shrinkImage(file, cb) {\n  var img = new Image(), url = URL.createObjectURL(file);\n  img.onload = function () {\n    var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');\n    c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));\n    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);\n    URL.revokeObjectURL(url);\n    cb(null, c.toDataURL('image/jpeg', 0.8).split(',')[1]);\n  };\n  img.onerror = function () { cb(new Error('Could not read that picture. Use a JPG or PNG photo.')); };\n  img.src = url;\n}\nfunction uploadPhoto(kind, id, file) {\n  if (BUSY) { toast('Please wait a moment and try again.'); return; }\n  toast('Saving photo…');\n  shrinkImage(file, function (err, b64) {\n    if (err) { toast(err.message); return; }\n    BUSY = true;\n    call('api_savePhoto', id, kind, b64, 'image/jpeg').then(function (d) { BUSY = false; setData(d); toast('Photo saved'); })\n      .catch(function (e) { BUSY = false; toast(e.message); });\n  });\n}\n/* ---------- activity review (Owner) ---------- */\nfunction yesterday(d) { var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); }\nfunction loadReview(date, who) {\n  var key = date + '|' + who; REVKEY = key;\n  call('api_getReview', date, who).then(function (r) { if (REVKEY !== key) return; REV = r; REVOK = key; render(); })\n    .catch(function (e) { if (REVKEY !== key) return; REV = { err: e.message }; REVOK = key; render(); });\n}\nfunction revRow(e) {\n  var lk = e.view ? lnk(e.view, e.record) : esc(e.record);\n  var ch = e.changes.length ? '<ul class=\"chg\">' + e.changes.map(function (c) { return '<li><b>' + esc(c.f) + '</b> <s>' + esc(c.o) + '</s> → ' + esc(c.n) + '</li>'; }).join('') + '</ul>' : (e.details && e.details !== 'New record' ? '<div class=\"mu rd\">' + esc(e.details) + '</div>' : '');\n  var fl = e.flags.length ? '<div class=\"flags\">' + e.flags.map(function (f) { return '<span class=\"tag no\">' + esc(f) + '</span>'; }).join('') + '</div>' : '';\n  var vf = '<label class=\"vfy\"><input type=\"checkbox\" data-ver=\"1\" data-row=\"' + e.row + '\" data-time=\"' + esc(e.time) + '\" data-user=\"' + esc(e.user) + '\" data-record=\"' + esc(e.record) + '\"' + (e.verified ? ' checked' : '') + '> ' + (e.verified ? 'Checked by ' + esc(e.verifiedBy) : 'Checked') + '</label>';\n  var what = e.action === 'Created' ? 'added' : e.action === 'Updated' ? 'changed' : e.action;\n  return '<div class=\"rv' + (e.flags.length ? ' flag' : '') + '\"><div class=\"rh\"><span class=\"mono\">' + esc(String(e.time).slice(11)) + '</span> <b>' + esc(e.user) + '</b> · ' + esc(what) + ' ' + lk + '</div>' + fl + ch + vf + '</div>';\n}\nfunction verifyItems(items, on) {\n  if (BUSY) return;\n  BUSY = true;\n  call('api_verifyEntries', items, on).then(function () { BUSY = false; REVKEY = ''; REVOK = ''; render(); toast(on ? 'Checked' : 'Unchecked'); })\n    .catch(function (e) { BUSY = false; REVKEY = ''; REVOK = ''; render(); toast(e.message); });\n}\nfunction verifyAllShown() {\n  var items = (REV && REV.entries || []).filter(function (e) { return !e.verified; }).map(function (e) { return { row: e.row, time: e.time, user: e.user, record: e.record }; });\n  if (!items.length) { toast('Everything shown is already checked.'); return; }\n  verifyItems(items, true);\n}\nfunction vActivity() {\n  var date = REVDATE || yesterday(D.today), who = REVWHO || '', key = date + '|' + who;\n  var head = '<div class=\"ph\" style=\"margin-bottom:8px\"><h1>Activity review</h1><div class=\"sub\">Every entry and change for one day. Red flags come first. Tick each line once you have checked it.</div></div>';\n  var ctl = '<div class=\"bar\"><label class=\"inl\">Day <input type=\"date\" id=\"rv_date\" value=\"' + date + '\" max=\"' + D.today + '\"></label>' +\n    '<label class=\"inl\">Person <select id=\"rv_who\"><option value=\"\">Everyone</option>' + (D.users || []).filter(function (u) { return u.active; }).map(function (u) { return '<option value=\"' + esc(u.id) + '\"' + (u.id === who ? ' selected' : '') + '>' + esc(u.name || u.id) + '</option>'; }).join('') + '</select></label>' +\n    '<span class=\"sp\"></span><button type=\"button\" class=\"btn sm\" data-act=\"revRefresh\">Refresh</button></div>';\n  if (REVOK !== key) {\n    if (REVKEY !== key) loadReview(date, who);\n    return head + ctl + '<div class=\"panel empty\">Loading…</div>';\n  }\n  if (REV.err) return head + ctl + '<div class=\"panel empty\">' + esc(REV.err) + '</div>';\n  var r = REV, h = head + ctl;\n  h += '<div class=\"kpis\">' + kpi('Entries that day', r.total, '') + kpi('Not checked yet', r.unverified, 'tick each line once checked', r.unverified ? 'warn' : '') + kpi('Red flags', r.flagged, 'shown first below', r.flagged ? 'bad' : '') + '</div>';\n  var flagged = r.entries.filter(function (e) { return e.flags.length; });\n  h += '<h2>Red flags (' + flagged.length + ')</h2>' + (flagged.length ? flagged.map(revRow).join('') : '<div class=\"panel empty\">No red flags for this day.</div>');\n  h += '<h2>By person</h2><div class=\"tblw\"><table class=\"t\"><thead><tr><th>Person</th><th class=\"r\">Entries</th><th class=\"r\">Edits to others’ entries</th><th class=\"r\">Not checked</th><th class=\"r\">Red flags</th></tr></thead><tbody>' +\n    (r.people.length ? r.people.map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b></td><td class=\"r\">' + p.entries + '</td><td class=\"r\">' + p.corrections + '</td><td class=\"r\">' + p.unverified + '</td><td class=\"r\">' + p.flagged + '</td></tr>'; }).join('') : '<tr><td colspan=\"5\" class=\"mu\">No entries on this day.</td></tr>') + '</tbody></table></div>';\n  h += '<h2>Spot check (5 picked for this day)</h2>' + (r.spot.length ? r.spot.map(revRow).join('') : '<div class=\"panel empty\">Nothing to spot-check.</div>');\n  h += '<h2>All entries' + (who ? ' · ' + esc(who) : '') + ' (' + r.entries.length + ')</h2>' +\n    (r.entries.length ? '<div class=\"bar\"><button type=\"button\" class=\"btn sm\" data-act=\"verifyAll\">Check all lines shown</button></div>' + r.entries.slice(0, 300).map(revRow).join('') + (r.entries.length > 300 ? '<div class=\"mu\">Only the first 300 lines are shown.</div>' : '') : '<div class=\"panel empty\">No entries.</div>');\n  return h;\n}\n/* ---------- flow charts (PO page and customer page) ---------- */\nfunction flowMatch() {\n  return function (t) {\n    var k = FLOWSEL;\n    if (k === '__plant') return !!t.plantPO;\n    if (k === '__none') return !t.so && !t.plantPO;\n    if (k.indexOf('so:') === 0) return t.so === k.slice(3);\n    if (k.indexOf('po:') === 0) return t.po === k.slice(3);\n    return true;\n  };\n}\nfunction flowChart(rootTitle, rootLines, groups) {\n  if (!groups.length) return '';\n  var maxQ = Math.max.apply(null, [1].concat(groups.map(function (g) { return g.qty; })));\n  var sel = groups.filter(function (g) { return g.key === FLOWSEL; })[0];\n  return '<div class=\"flow\"><div class=\"fl-root\"><b>' + rootTitle + '</b>' + rootLines.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div>' +\n    '<div class=\"fl-br\">' + groups.map(function (g) {\n      var w = Math.max(3, Math.round(g.qty / maxQ * 18));\n      return '<div class=\"fl-arm\"><span class=\"fl-line\" style=\"width:' + w + 'px\"></span><button type=\"button\" class=\"fb' + (g.cls ? ' ' + g.cls : '') + (FLOWSEL === g.key ? ' on' : '') + '\" data-flow=\"' + esc(g.key) + '\"><b>' + esc(g.title) + '</b>' + g.lines.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</button></div>';\n    }).join('') + '</div>' +\n    (sel ? '<div class=\"fl-note\">Showing only the trucks for <b>' + esc(sel.title) + '</b>. <button type=\"button\" class=\"link\" data-flow=\"' + esc(sel.key) + '\">Show all</button></div>' : '<div class=\"fl-note\">Tap a box to see only its trucks below. Line thickness shows the quantity.</div>') + '</div>';\n}\nfunction poFlow(o, tr) {\n  var G = {};\n  tr.forEach(function (t) {\n    if (t.cx) return;\n    var key = t.plantPO ? '__plant' : t.so ? 'so:' + t.so : '__none';\n    var g = G[key] || (G[key] = { key: key, title: t.plantPO ? 'Own plant · ' + shortFirm(plantFirm()) : t.so ? (t.buyer || t.so) : 'No customer yet', cls: key === '__none' ? 'none' : key === '__plant' ? 'own' : '', qty: 0, n: 0, done: 0, road: 0, sos: {} });\n    g.qty = r2(g.qty + t.L); g.n++; g.done = r2(g.done + t.U); if (t.L && !t.U) g.road = r2(g.road + t.L); if (t.so) g.sos[t.so] = 1;\n  });\n  var groups = Object.keys(G).map(function (k) { var g = G[k], sos = Object.keys(g.sos); g.lines = [qt(g.qty) + ' qtl · ' + trk(g.n), sos.length ? 'SO ' + sos.join(', ') : 'no sale order', 'delivered ' + qt(g.done) + ' · on road ' + qt(g.road)]; return g; })\n    .sort(function (a, b) { return b.qty - a.qty; });\n  var loaded = r2(sum(tr.filter(function (t) { return !t.cx; }), function (t) { return t.L; }));\n  var rem = Math.max(0, r2(n(o.qty) - loaded));\n  return flowChart(esc(o.id) + ' · ' + esc(o.plant), ['Ordered ' + qt(o.qty) + ' qtl', 'Loaded ' + qt(loaded) + ' qtl', 'Remaining ' + qt(rem) + ' qtl'], groups);\n}\nfunction buyerFlow(name, tr) {\n  var G = {};\n  tr.forEach(function (t) {\n    if (t.cx) return;\n    var key = 'po:' + t.po;\n    var g = G[key] || (G[key] = { key: key, title: t.po + ' · ' + (t.plant || ''), cls: '', qty: 0, n: 0, done: 0, road: 0 });\n    g.qty = r2(g.qty + t.L); g.n++; g.done = r2(g.done + t.U); if (t.L && !t.U) g.road = r2(g.road + t.L);\n  });\n  var groups = Object.keys(G).map(function (k) { var g = G[k]; g.lines = [qt(g.qty) + ' qtl · ' + trk(g.n), 'delivered ' + qt(g.done) + ' · on road ' + qt(g.road)]; return g; })\n    .sort(function (a, b) { return b.qty - a.qty; });\n  var disp = r2(sum(tr.filter(function (t) { return !t.cx; }), function (t) { return t.L; }));\n  var recv = r2(sum(tr.filter(function (t) { return !t.cx; }), function (t) { return t.U; }));\n  return flowChart(esc(name), ['Dispatched ' + qt(disp) + ' qtl', 'Received ' + qt(recv) + ' qtl'], groups);\n}\n/* ---------- events for the new controls ---------- */\ndocument.addEventListener('change', function (e) {\n  var f = e.target;\n  if (!f) return;\n  if (f.type === 'file' && f.dataset && f.dataset.kind) { if (f.files && f.files[0]) uploadPhoto(f.dataset.kind, f.dataset.id, f.files[0]); f.value = ''; return; }\n  if (f.id === 'rv_date') { REVDATE = f.value; render(); return; }\n  if (f.id === 'rv_who') { REVWHO = f.value; render(); return; }\n  if (f.dataset && f.dataset.ver) { verifyItems([{ row: +f.dataset.row, time: f.dataset.time, user: f.dataset.user, record: f.dataset.record }], f.checked); }\n});\n\n/* ---------- events ---------- */\ndocument.addEventListener('click', function (e) {\n  var b = e.target.closest('[data-tab],[data-go],[data-act],[data-filter],[data-firm],[data-sf],[data-fill],[data-copy],[data-flow]');\n  if (!b) { if (e.target.id === 'modal' && !BUSY) closeForm(); return; }\n  if (b.hasAttribute('data-copy')) { copyText(b.dataset.copy); return; }\n  if (b.hasAttribute('data-flow')) { FLOWSEL = b.dataset.flow === FLOWSEL ? '' : b.dataset.flow; LIMIT = 60; render(); return; }\n  if (b.dataset.fill) { var inp = document.getElementById(b.dataset.fill); inp.value = b.dataset.val; inp.dispatchEvent(new Event('input', { bubbles: true })); return; }\n  if (b.tagName === 'A' && b.target === '_blank') return;\n  if (b.dataset.go) { e.preventDefault(); closeForm(); go(b.dataset.go, b.dataset.id); return; }\n  if (b.dataset.firm) { FIRM = b.dataset.firm; LIMIT = 60; render(); return; }\n  if (b.dataset.filter && !b.dataset.act) { FILTER = b.dataset.filter; if (ROUTE.v !== 'dispatch') { QS = ''; go('dispatch'); } else { LIMIT = 60; render(); } return; }\n  if (b.dataset.sf && !b.dataset.act) { SUBF[ROUTE.v] = b.dataset.sf; LIMIT = 60; render(); return; }\n  if (b.dataset.tab) { if (b.dataset.tab !== ROUTE.v) QS = ''; go(b.dataset.tab); return; }\n  var a = b.dataset.act, id = b.dataset.id, kind = b.dataset.kind;\n  if (a === 'close') { if (!BUSY) closeForm(); return; }\n  if (a === 'logout') { logout(); return; }\n  if (a === 'back') { back(); return; }\n  if (!D) return;\n  if (FORM && FORM.noSave && a !== 'menu' && a !== 'ordermenu') closeForm();\n  ({\n    newTruck: actNewTruck, editTruck: function () { actEditTruck(id); }, assign: function () { actAssign(id); }, load: function () { actLoad(id); },\n    paid: function () { actPaid(id); }, unpaid: function () { actUnpaid(id); }, advance: function () { actAdvance(id); }, unload: function () { actUnload(id); },\n    receive: function () { actReceive(id); }, fpaid: function () { actFPaid(id); }, funpaid: function () { actFUnpaid(id); },\n    newPO: function () { actOrder('po'); }, newSO: function () { actOrder('so'); }, editPO: function () { actOrder('po', id); }, editSO: function () { actOrder('so', id); },\n    addNote: function () {\n      var t = $('#n_text').value.trim(); if (!t) { toast('Write the note first.'); return; }\n      BUSY = true; call('api_addNote', $('#n_area').value, t).then(function (d) { BUSY = false; setData(d); toast('Note added'); }).catch(function (e) { BUSY = false; toast(e.message); });\n    },\n    noteStatus: function () { BUSY = true; call('api_noteStatus', id, kind).then(function (d) { BUSY = false; setData(d); toast(kind === 'Done' ? 'Marked done' : 'Reopened'); }).catch(function (e) { BUSY = false; toast(e.message); }); },\n    bill: function () { actBill(id); }, returned: function () { actReturned(id); }, payPlantBatch: function () { actBatch('plant'); }, payFreightBatch: function () { actBatch('freight'); },\n    cancelTruck: function () { actCancel('truck', id); }, cancelOrder: function () { actCancel(kind, id); }, restore: function () { actRestore(kind || 'truck', id); }, restoreOrder: function () { actRestore(kind, id); },\n    newUser: function () { actUser(); }, editUser: function () { actUser(id); }, me: actMe, showmore: function () { LIMIT += 60; render(); },\n    menu: function () { var t = getT(id); openMenu(esc(t.truck), esc(t.id) + ' · ' + t.stage, [{ a: 'open', l: 'Open full details', id: id }].concat(menuItems(t).map(function (m) { return { a: m.a, l: m.l, id: id, danger: m.danger }; }))); },\n    open: function () { go('truck', id); },\n    ordermenu: function () {\n      var o = (kind === 'po' ? D.po : D.so).filter(function (x) { return x.id === id; })[0], cx = o.status === 'Cancelled', it = [{ a: 'openOrder', l: 'Open ' + id, id: id, kind: kind }];\n      if (P.orders && !cx) it.push({ a: kind === 'po' ? 'editPO' : 'editSO', l: 'Edit', id: id });\n      if (P.exportX) it.push({ a: 'exportPage', l: 'Download Excel', id: id, kind: kind });\n      if (P.orders && !cx) it.push(o.status === 'Settled' ? { a: 'unsettle', l: 'Undo short-close', id: id, kind: kind } : { a: 'settle', l: 'Mark short-closed (order complete)', id: id, kind: kind });\n      if (P.orders) it.push(cx ? { a: 'restoreOrder', l: 'Restore order', id: id, kind: kind } : { a: 'cancelOrder', l: 'Cancel order', id: id, kind: kind, danger: 1 });\n      openMenu(esc(id), esc(o.plant || o.buyer), it);\n    },\n    openOrder: function () { go(kind, id); },\n    settle: function () { var o = (kind === 'po' ? PO : SO)[id], st = orderStats(kind, o); openForm({ title: 'Mark ' + id + ' short-closed?', sub: 'Ordered ' + qt(o.qty) + ' qtl, ' + (kind === 'po' ? 'loaded ' : 'dispatched ') + qt(st.done) + ' qtl (' + (st.bal >= 0 ? qt(st.bal) + ' short' : qt(-st.bal) + ' over') + '). The order is closed: no new trucks, and the difference is accepted.', submit: 'Yes, short-close', done: id + ' settled', fields: [], custom: function () { return call('api_settle', kind, id, true); } }); },\n    unsettle: function () { BUSY = true; closeForm(); call('api_settle', kind, id, false).then(function (d) { BUSY = false; setData(d); toast(id + ' open again'); }).catch(function (e) { BUSY = false; toast(e.message); }); },\n    openBank: openBank, bankAdd: function () { actBank(kind, id); }, verifyAll: verifyAllShown, revRefresh: function () { REVKEY = ''; REVOK = ''; render(); },\n    exportFull: function () { doExport('full'); }, exportPage: function () { doExport(kind, id); },\n    exportList: function () { if (!LASTIDS.length) { toast('No trucks in this list.'); return; } doExport('trucks', '', LASTIDS.slice()); }\n  }[a] || function () {})();\n});\n$('#mform').addEventListener('submit', submitForm);\n$('#mform').addEventListener('input', function (e) {\n  if (FORM && FORM.warned) { FORM.warned = false; $('#fwarn').hidden = true; }\n  if (e.target.id && e.target.id.indexOf('f_') === 0 && document.getElementById('hint_' + e.target.id.slice(2))) weightHint(e.target.id.slice(2));\n});\ndocument.addEventListener('input', function (e) { if (e.target.id === 'q') { QS = e.target.value.trim().toLowerCase(); LIMIT = 60; var pos = e.target.selectionStart; render(); var q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } } });\ndocument.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#modal').hidden && !BUSY) closeForm(); });\ntry { window.matchMedia('(max-width:860px)').addEventListener('change', function () { render(); }); } catch (e) {}\nfunction setHH() { var h = document.querySelector('header'); if (h) document.documentElement.style.setProperty('--hh', h.offsetHeight + 'px'); }\nwindow.addEventListener('resize', setHH); setInterval(setHH, 1500); setHH();\nsetInterval(function () { if (D && document.visibilityState === 'visible' && $('#modal').hidden && !BUSY && !(document.activeElement && document.activeElement.id === 'q')) load(true); }, 60000);\n(function boot() {\n  var init = window.INIT || {};\n  if (init.view && ['po', 'so', 'buyer', 'plant', 'transporter', 'truck'].indexOf(init.view) >= 0) { ROUTE = { v: init.view, id: init.id }; HIST = [{ v: 'home' }]; }\n  else if (init.view && ['pos', 'sos', 'dispatch', 'receive', 'settle', 'freight'].indexOf(init.view) >= 0) ROUTE = { v: init.view };\n  TOKEN = getTok();\n  if (TOKEN) load(); else showAuth();\n})();\n</script>\n</body>\n</html>\n";
