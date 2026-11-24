/**
 * DDGS Trade Control - Google Apps Script web app
 * ------------------------------------------------
 * Files: Code.gs (this file, the server) and Index.html (the screen). Synced with clasp.
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

var T = { PO: 'APP_PO', SO: 'APP_SO', TR: 'APP_TRUCKS', LOG: 'APP_LOG', SET: 'APP_SETTINGS', US: 'APP_USERS', PAY: 'APP_PAYMENTS', NOTE: 'APP_NOTES', BANK: 'APP_BANK', ADV: 'APP_ADVANCES' };

// What each role may do. Change here if needed.
var ROLES = {
  Owner:    { money: true,  trucks: true,  truckMoney: true,  orders: true,  users: true,  cancelTruck: true,  profit: true,  exportX: true,  editClosed: true },
  Accounts: { money: true,  trucks: true,  truckMoney: true,  orders: true,  users: false, cancelTruck: true,  profit: false, exportX: true,  editClosed: false },
  Dispatch: { money: false, trucks: true,  truckMoney: false, orders: false, users: false, cancelTruck: false, profit: false, exportX: false, editClosed: false },
  Viewer:   { money: true,  trucks: false, truckMoney: false, orders: false, users: false, cancelTruck: false, profit: false, exportX: false, editClosed: false }
};
Object.keys(ROLES).forEach(function (r) { ROLES[r].review = r === 'Owner'; ROLES[r].bank = r === 'Owner' || r === 'Accounts'; });
var TRUCK_MONEY = ['plantPaid', 'plantPaidDate', 'frate', 'advance', 'freightPaid', 'freightPaidDate', 'received', 'receivedDate', 'deduction', 'deductionNote', 'detention', 'saleRate', 'plantUTR', 'freightUTR', 'zohoBill', 'zohoInvoice', 'zohoFreight', 'tAdv'];
var ORDER_MONEY = ['rate', 'gst', 'gstMode', 'freightMode', 'creditDays'];
// Amounts hidden from roles without money access (paid / not paid status stays visible).
var TRUCK_HIDE = ['frate', 'advance', 'received', 'receivedDate', 'deduction', 'deductionNote', 'detention', 'saleRate', 'plantUTR', 'freightUTR', 'zohoBill', 'zohoInvoice', 'zohoFreight', 'tAdv'];
// Changed only through their own actions (Cancel, Returned, Restore, photo upload), which check the role. A normal truck save ignores them.
var TRUCK_LOCKED = ['status', 'returnedDate', 'slipPhoto', 'plantPayPhoto', 'freightPayPhoto', 'tAdv']; // tAdv: set only when freight is paid
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
    ['placedOn', 'Vehicle Placed On', 'date'], ['slipPhoto', 'Slip Photo Link', 'text'], ['plantPayPhoto', 'Supplier Payment Screenshot', 'text'], ['freightPayPhoto', 'Freight Payment Screenshot', 'text'],
    ['tAdv', 'Transporter Advance Used', 'num'] // what this truck took from its transporter's advance, saved when its freight is paid
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
                 ['note', 'Note', 'text'], ['by', 'Entered By', 'text'], ['at', 'Entered At', 'text'],
                 ['firm', 'Firm', 'text']], // which firm got the money (blank on old lines = the first firm, Raghav)
  APP_NOTES: [['id', 'Note ID', 'text'], ['date', 'Date', 'date'], ['area', 'Screen', 'text'], ['text', 'Note', 'text'],
              ['status', 'Status', 'text'], ['by', 'Written By', 'text'], ['at', 'Written At', 'text']],
  APP_BANK: [['id', 'Key', 'text'], ['kind', 'Type', 'text'], ['name', 'Party', 'text'], ['accName', 'Account Name', 'text'],
             ['accNo', 'Account Number', 'text'], ['ifsc', 'IFSC', 'text'], ['by', 'Updated By', 'text'], ['at', 'Updated At', 'text']],
  // Advances given to a transporter that are not tied to a truck (e.g. before loading). A wrong one is reversed by a minus line.
  APP_ADVANCES: [['id', 'Advance No.', 'text'], ['date', 'Date', 'date'], ['transporter', 'Transporter', 'text'], ['vehicle', 'Vehicle No', 'text'], ['driver', 'Driver', 'text'],
                 ['amount', 'Amount', 'num'], ['ref', 'UTR / Ref', 'text'], ['note', 'Note', 'text'], ['by', 'Entered By', 'text'], ['at', 'Entered At', 'text'],
                 ['firm', 'Firm', 'text']]
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
  ['firms', 'RAGHAV TRADING AND COMPANY, DEVAN TRADING AND COMPANY, SARASWATI SOLVEX, JAI MAHAVIR TRADING AND COMPANY, SHREE RAM SOLVEX', 'Your firms, separated by commas: each has its own window (buttons at the top). Orders with no firm count under the first one'],
  ['plantFirm', 'SHREE RAM SOLVEX', 'Your firm that owns the solvent plant: its POs only receive trucks, no sales'],
  ['tradingFirms', 'RAGHAV TRADING AND COMPANY, DEVAN TRADING AND COMPANY, SARASWATI SOLVEX, JAI MAHAVIR TRADING AND COMPANY', 'Firms an order can be taken in (shown on the PO as Booked in the name of)'],
  ['bankUrl', '', 'Internet banking login. The Open bank button on payment popups goes here'],
  ['slipCheckFrom', '', 'Trucks dispatched on or after this date need a weighment slip photo. Blank = all trucks'],
  ['qtyTolerancePct', 0.01, 'Order quantity tolerance (0.01 = 1%). A PO/SO is complete from 99% of its quantity; going above 101% needs the Owner'],
  ['hiddenFirms', 'SHREE RAM SOLVEX', 'Firms whose own POs/SOs and trucks are kept out of this app (their rows stay in the sheet). Clear to show them again']
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
  var key = String(no).replace(/[^A-Z0-9]/g, ''), H = hiddenSets_();
  return rows_(T.TR).filter(function (t) { return t.id !== obj.id && !isOff_(t) && !hidTruck_(t, H) && String(t.truck).replace(/[^A-Z0-9]/g, '') === key && String(t.date) === String(date); })[0] || null;
}
function firmOf_(o, S) { return o && o.firm ? normName_(o.firm) : firms_(S)[0]; }
function isFirm_(name, S) { return !!name && firms_(S).indexOf(normName_(name)) >= 0; }

/* ---------------- firms kept out of this app (setting hiddenFirms) ----------------
   Nov 2026: Shree Ram Solvex's own business (its POs/SOs and the trucks on them) will get its own Apps Script.
   Those rows stay in the sheet untouched; this app neither shows, counts nor changes them.
   Raghav's sales TO Shree Ram are Raghav's business and stay (Shree Ram remains a group-company customer). */
function hiddenFirms_(S) { return String((S || readSettings_()).hiddenFirms || '').split(',').map(function (f) { return normName_(f); }).filter(String); }
/* The hidden firms and the ids of their POs and SOs (tabs are read once per call, so this is cheap). */
function hiddenSets_(S) {
  S = S || readSettings_();
  var H = { firms: hiddenFirms_(S), po: {}, so: {} };
  if (!H.firms.length) return H;
  rows_(T.PO).forEach(function (o) { if (H.firms.indexOf(firmOf_(o, S)) >= 0) H.po[o.id] = 1; });
  rows_(T.SO).forEach(function (o) { if (H.firms.indexOf(firmOf_(o, S)) >= 0) H.so[o.id] = 1; });
  return H;
}
function hidTruck_(t, H) { return !!t && (!!H.po[t.po] || !!H.so[t.so]); }
function hiddenErr_(what, H) { return new Error(what + ' belongs to ' + H.firms.join(', ') + ', which is kept out of this app.'); }
/* POs, SOs and trucks without the hidden ones. */
function visibleRows_(S) {
  var H = hiddenSets_(S);
  return {
    po: rows_(T.PO).filter(function (o) { return !H.po[o.id]; }),
    so: rows_(T.SO).filter(function (o) { return !H.so[o.id]; }),
    trucks: rows_(T.TR).filter(function (t) { return !hidTruck_(t, H); })
  };
}
/* Refuses any change to a hidden truck / order. */
function guardTruck_(id) {
  var H = hiddenSets_(), t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
  if (hidTruck_(t, H)) throw hiddenErr_(id, H);
}
function guardOrder_(table, id) {
  var H = hiddenSets_();
  if ((table === 'po' && H.po[id]) || (table === 'so' && H.so[id])) throw hiddenErr_(id, H);
}

/* ---------------- web app entry ---------------- */

function doGet(e) {
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent();
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
  editorOnly_();
  PropertiesService.getScriptProperties().deleteProperty('schema_v'); // running setup always re-checks the tabs
  CacheService.getScriptCache().removeAll(['schema_ok', 'trig_ok', 'tz']);
  var r = ensureSetup_();
  var auto = '';
  try { PropertiesService.getScriptProperties().deleteProperty('triggers_v4'); ensureTriggers_(); auto = ' | Daily 9 pm report and Sunday backup are switched on.'; }
  catch (e) { auto = ' | Could not switch on the daily report: ' + e.message; }
  Logger.log(JSON.stringify(r || 'Already set up') + auto + (users_().length ? '' : ' | Now open the app link to create your owner login.'));
}

/** Run from the editor to get today's report by email right now (to check it works). */
function testDailyReport() {
  editorOnly_();
  ensureSetup_();
  sendDailyReport_();
  Logger.log('Report sent to ' + (readSettings_().reportEmail || Session.getEffectiveUser().getEmail()));
}

/* Every function without "_" at the end can be called from a browser through the app link.
   These two checks keep the editor-only and timer-only functions from being started that way. */
function editorOnly_() {
  if (!isOwnerGoogle_()) throw new Error('Run this from the Apps Script editor with the owner account.');
}
function fromTrigger_(e) {
  if (!e || !e.triggerUid) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === String(e.triggerUid); });
  } catch (x) { return false; }
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
  token = tok_(token);
  if (token) { PropertiesService.getScriptProperties().deleteProperty('s_' + token); CacheService.getScriptCache().remove('sess_' + token); }
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

/** Background refresh from an open screen. v = the data version the screen has.
    Nothing changed since then: a tiny "same" answer and no tab is read. Otherwise (or full = true) all data, like api_getData. */
function api_sync(token, v, full) {
  auth_(token);
  ensureSetup_();
  if (ME.role === 'Owner') ensureTriggers_();
  var cur = dataVersion_();
  if (!full && !REQ_.upgraded && v && String(v) === cur) return { same: true, v: cur, today: today_(), syncedAt: nowStr_() };
  return readAll_();
}

function api_saveTruck(token, obj) {
  auth_(token); need_('trucks');
  obj = obj || {};
  TRUCK_LOCKED.forEach(function (k) { delete obj[k]; });
  if (!ME.can.truckMoney) {
    // Dispatch may enter the freight rate together with the weight (it is required then). Other money fields stay hidden.
    var keepRate = num_(obj.loadWt) > 0;
    TRUCK_MONEY.forEach(function (k) { if (!(keepRate && k === 'frate')) delete obj[k]; });
  }
  var force = obj._force === true && ME.role === 'Owner';
  var rid = cleanRid_(obj._rid);
  delete obj._force; delete obj._rid;
  return withLock_(function () {
    // Trucks and orders of a firm kept out of this app (hiddenFirms) cannot be changed or used here.
    var H = hiddenSets_(), was = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
    if (hidTruck_(was, H)) throw hiddenErr_(obj.id, H);
    if (obj.po && H.po[obj.po]) throw hiddenErr_(obj.po, H);
    if (obj.so && H.so[obj.so]) throw hiddenErr_(obj.so, H);
    [['po', T.PO], ['so', T.SO]].forEach(function (k) {
      if (!(k[0] in obj) || !obj[k[0]]) return;
      var cur = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
      if (cur && cur[k[0]] === obj[k[0]]) return;
      var o = rows_(k[1]).filter(function (r) { return r.id === obj[k[0]]; })[0];
      if (o && o.status === 'Settled') throw new Error(o.id + ' is marked Short-closed. Undo short-close on it first to add more trucks.');
    });
    if (!obj.id) checkNewTruck_(obj);
    var dup = sameDayTruck_(obj);
    if (dup && !force) throw new Error('Vehicle ' + dup.truck + ' is already entered on ' + dmy_(dup.date) + ' as ' + dup.id + '. A vehicle cannot be entered twice on the same day.' + (ME.role === 'Owner' ? '' : ' Ask the Owner if this is a real second trip.'));
    linkTruckOrders_(obj);
    checkQty_(obj, force);
    if (obj.id) checkTruckRules_(obj);
    if (obj.id && obj.freightPaid === true && !(was && was.freightPaid)) obj.tAdv = advForPay_(obj);
    if (obj.id && obj.freightPaid === false) obj.tAdv = '';
    return saveRecord_(T.TR, obj);
  }, rid);
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
  // Each firm keeps its own books: a truck's sale order is in the same firm as its PO (24-11-2026).
  // (Selling to another of your firms is a sale order whose customer is that firm.)
  var soNow = 'so' in obj ? obj.so : so;
  if (soNow && ('so' in obj || 'po' in obj)) {
    var sx = rows_(T.SO).filter(function (r) { return r.id === soNow; })[0];
    if (sx && firmOf_(sx) !== firmOf_(po)) throw new Error(soNow + ' is in ' + firmOf_(sx) + ' but ' + po.id + ' is in ' + firmOf_(po) + '. A truck\'s sale order must be in the same firm as its PO.');
  }
}
var SUPPLIER_SIDE_ = ['plantPaid', 'plantPaidDate', 'plantUTR', 'billNo', 'billQty'];
function checkTruckRules_(obj) {
  var t = rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0];
  if (!t) return;
  var get = function (k) { return (k in obj) ? obj[k] : t[k]; };
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (!ME.can.editClosed) {
    var po = rows_(T.PO).filter(function (r) { return r.id === t.po; })[0];
    var so = rows_(T.SO).filter(function (r) { return r.id === t.so; })[0];
    var d = derive_(t, po, so, readSettings_(), today);
    // A closed truck may still have its supplier unpaid: staff can pay the supplier and enter the supplier invoice on it.
    // Paying freight closes a truck: staff can still undo a freight payment made today (that reopens the truck).
    var undoFr = obj.freightPaid === false && t.freightPaid && t.freightPaidDate === today;
    if (d.st === 6 && Object.keys(obj).some(function (k) { return k !== 'id' && SUPPLIER_SIDE_.indexOf(k) < 0 && !(undoFr && ['freightPaid', 'freightPaidDate', 'freightUTR'].indexOf(k) >= 0); })) throw new Error(t.id + ' is closed. Only the Owner can change it.');
    if (obj.plantPaid === false && t.plantPaid && t.plantPaidDate !== today) throw new Error('Only the Owner can undo a supplier payment from an earlier day.');
    if (obj.freightPaid === false && t.freightPaid && t.freightPaidDate !== today) throw new Error('Only the Owner can undo a freight payment from an earlier day.');
    if ('received' in obj || 'deduction' in obj) throw new Error('Only the Owner can correct customer payments. Use + Payment to add money received.');
  }
  requireWeight_(obj, t);
  if (get('plantPaid') === true && !(num_(get('loadWt')) > 0)) throw new Error('Enter the dispatch weight before marking the supplier paid.');
  var tpo = rows_(T.PO).filter(function (r) { return r.id === get('po'); })[0];
  if (num_(get('unloadWt')) > 0 && !get('so') && !(tpo && tpo.poType === 'plant')) throw new Error('Choose the customer (sale order) before recording unloading.');
}

/* Once a weight is entered, the freight rate is required (checked on the values after this save).
   The transporter is optional (Nitish, 23-11-2026): it can be added later. */
function requireWeight_(obj, cur) {
  if (!('loadWt' in obj) && !('frate' in obj)) return;
  var get = function (k) { return (k in obj) ? obj[k] : cur[k]; };
  if (!(num_(get('loadWt')) > 0)) return;
  if (!(num_(get('frate')) > 0)) throw new Error('Enter the freight rate per qtl. It is required once the weight is entered.');
}
/* Order quantity window (setting qtyTolerancePct, 1%). Example PO-01-BCL of 10,000 qtl: complete from 9,900 qtl,
   limit 10,100 qtl. Staff cannot take a PO or SO over the limit, or put a new truck on a complete order;
   the Owner can (the screen warns first, Save again sends force). Same rule on the screen in truckWarn / qtyProblem. */
function qtyTol_(S) { var x = num_(S.qtyTolerancePct); return x === '' ? 0.01 : x; }
function checkQty_(obj, force) {
  if (force) return;
  var cur = obj.id ? rows_(T.TR).filter(function (r) { return r.id === obj.id; })[0] : null;
  if (cur && isOff_(cur)) return;
  var get = function (k) { return (k in obj) ? obj[k] : cur ? cur[k] : ''; };
  var H = hiddenSets_(), tol = qtyTol_(readSettings_()), L = num_(get('loadWt')) || 0, trucks = rows_(T.TR).filter(function (t) { return !hidTruck_(t, H); });
  if (L > 1000) return; // looks like kg: the save is refused with the clear "looks like kg" message instead
  var owner = ME && ME.role === 'Owner';
  [['po', T.PO, 'loaded'], ['so', T.SO, 'dispatched']].forEach(function (k) {
    var id = get(k[0]);
    if (!id) return;
    var o = rows_(k[1]).filter(function (r) { return r.id === id; })[0], qty = o ? num_(o.qty) : '';
    if (!o || !(qty > 0) || o.status === 'Cancelled' || o.status === 'Settled') return;
    var onIt = !!cur && cur[k[0]] === id; // this truck was already on this order before the save
    var others = 0;
    trucks.forEach(function (t) { if (t.id !== obj.id && t[k[0]] === id && !isOff_(t)) others += num_(t.loadWt) || 0; });
    others = Math.round(others * 100) / 100;
    var before = onIt ? (num_(cur.loadWt) || 0) : 0, limit = qty * (1 + tol), full = qty * (1 - tol);
    if (L > before && others + L > limit + 0.005) {
      throw new Error(id + ' would go over its limit of ' + qtl_(limit) + ' qtl (' + qtl_(qty) + ' + ' + Math.round(tol * 10000) / 100 + '%) by ' + qtl_(others + L - limit) + ' qtl.' +
        (owner ? ' Open it again and tap Save twice to accept.' : ' Ask the Owner.'));
    }
    if (!onIt && others >= full - 0.005) {
      throw new Error(id + ' is complete (' + qtl_(others) + ' of ' + qtl_(qty) + ' qtl ' + k[2] + ').' +
        (owner ? ' Short-close it, or open this again and tap Save twice to add the truck anyway.' : ' Ask the Owner.'));
    }
  });
}
function qtl_(x) {
  var p = (Math.round(x * 100) / 100).toFixed(2).split('.'), i = p[0], last = i.slice(-3), rest = i.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last + '.' + p[1];
}

/* The bank UTR is optional for supplier and freight payments (Nitish, Nov 2026). It is saved when it is entered. */
function checkNewTruck_(obj) {
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (!obj.placedOn) obj.placedOn = today;
  if (!obj.date) {
    if (num_(obj.loadWt) > 0) throw new Error('Enter the date the truck left the plant, from the slip.');
    obj.date = obj.placedOn;
  }
  requireWeight_(obj, {});
  if (obj.plantPaid === true && !(num_(obj.loadWt) > 0)) throw new Error('Enter the dispatch weight before marking the supplier paid.');
}

/** Adds a buyer payment (and any TDS/claim deduction) on the server, so two people entering at once never lose an amount. */
function api_addPayment(token, id, amount, date, deduction, note, rid) {
  auth_(token); need_('truckMoney');
  return withLock_(function () {
    var t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
    if (!t) throw new Error('Truck ' + id + ' was not found.');
    guardTruck_(id);
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
      truck: id, so: t.so, buyer: so ? so.buyer : '', amount: a || '', deduction: d || '', note: d ? (note || 'Deduction') : '', firm: firmOf_(so)
    })]);
    dropTab_(T.PAY); markChanged_(T.PAY);
  }, cleanRid_(rid));
}

/** Money received from a customer (factory). Customer money is kept per customer, not per truck (Nov 2026).
    One line in APP_PAYMENTS: Dispatch No. blank, Customer filled, deduction reason and bank reference in the Note. */
function api_addCustomerPayment(token, buyer, amount, date, deduction, reason, ref, note, rid, firm) {
  auth_(token); need_('truckMoney');
  buyer = normName_(buyer);
  var a = num_(amount) || 0, d = num_(deduction) || 0;
  reason = String(reason || '').trim(); ref = String(ref || '').trim().toUpperCase(); note = String(note || '').trim();
  if (!buyer) throw new Error('Choose the customer.');
  if (a < 0 || d < 0) throw new Error('Amounts must be 0 or more.');
  if (!a && !d) throw new Error('Enter the amount received, or a deduction.');
  if (d && !reason) throw new Error('Choose the reason for the deduction.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('Enter the date.');
  return withLock_(function () {
    // Customer money is kept per firm and customer (24-11-2026). A screen opened before this sends no firm: the first firm.
    var S = readSettings_();
    firm = firm ? normName_(firm) : firms_(S)[0];
    if (!isFirm_(firm, S) || hiddenFirms_(S).indexOf(firm) >= 0) throw new Error('Choose the firm that received the money.');
    if (!rows_(T.SO).some(function (o) { return normName_(o.buyer) === buyer && firmOf_(o, S) === firm; })) throw new Error('There is no sale order for ' + buyer + ' in ' + firm + '.');
    var parts = [];
    if (d) parts.push(reason);
    if (ref) parts.push('Ref ' + ref);
    if (note) parts.push(note);
    var id = appendPay_({ date: date, truck: '', so: '', buyer: buyer, amount: a || '', deduction: d || '', note: parts.join(' · '), firm: firm });
    log_('Customer payment', buyer, id + ' (' + firm + '): received ' + a + (d ? ', ' + reason + ' ' + d : '') + (ref ? ', ref ' + ref : ''));
  }, cleanRid_(rid));
}
function appendPay_(o) {
  var sh = sheet_(T.PAY) || makeTab_(T.PAY);
  o.id = nextId_(T.PAY, rows_(T.PAY), {});
  sh.getRange(sh.getLastRow() + 1, 1, 1, SCHEMA[T.PAY].length).setValues([rowFor_(T.PAY, o)]);
  dropTab_(T.PAY); markChanged_(T.PAY);
  return o.id;
}
/** A wrong payment is never deleted: a reversal line with the same amounts in minus is added (dated today).
    Accounts can reverse only what was entered today; the Owner any payment. */
function api_reversePayment(token, payId, reason) {
  auth_(token); need_('truckMoney');
  reason = String(reason || '').trim();
  if (!reason) throw new Error('Write why this payment is reversed.');
  return withLock_(function () {
    var all = rows_(T.PAY), p = all.filter(function (r) { return r.id === payId; })[0];
    if (!p) throw new Error('Payment ' + payId + ' was not found.');
    if (/^Reversal of /.test(String(p.note)) || (num_(p.amount) || 0) < 0 || (num_(p.deduction) || 0) < 0) throw new Error(payId + ' is itself a reversal.');
    if (all.some(function (r) { return String(r.note).indexOf('Reversal of ' + payId + ':') === 0; })) throw new Error(payId + ' is already reversed.');
    if (ME.role !== 'Owner' && String(p.at).slice(0, 10) !== today_()) throw new Error('Only the Owner can reverse a payment entered on an earlier day.');
    var a = num_(p.amount) || 0, d = num_(p.deduction) || 0;
    var id = appendPay_({ date: today_(), truck: p.truck, so: p.so, buyer: p.buyer, amount: a ? -a : '', deduction: d ? -d : '', note: 'Reversal of ' + payId + ': ' + reason, firm: p.firm });
    log_('Payment reversed', payId, id + ': ' + reason);
  });
}

/** An advance to a transporter that is not tied to a truck (e.g. given before loading). It is used automatically
    on that transporter's freight (transAdv_). Owner and Accounts. */
function api_addAdvance(token, o, rid) {
  auth_(token); need_('truckMoney');
  o = o || {};
  var tr = normName_(o.transporter), a = num_(o.amount), S = readSettings_(), firm = o.firm ? normName_(o.firm) : firms_(S)[0];
  if (!tr) throw new Error('Enter the transporter.');
  if (!isFirm_(firm, S) || hiddenFirms_(S).indexOf(firm) >= 0) throw new Error('Choose the firm that gave the advance.');
  if (!(a > 0)) throw new Error('Enter the amount of the advance.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || ''))) throw new Error('Enter the date.');
  return withLock_(function () {
    var id = appendAdv_({ date: o.date, transporter: tr, vehicle: normTruck_(o.vehicle), driver: String(o.driver || '').trim(), amount: a,
      ref: String(o.ref || '').trim().toUpperCase(), note: String(o.note || '').trim(), firm: firm });
    log_('Transporter advance', tr, id + ' (' + firm + '): ' + a + (o.vehicle ? ', vehicle ' + normTruck_(o.vehicle) : '') + (o.ref ? ', ref ' + String(o.ref).toUpperCase() : ''));
  }, cleanRid_(rid));
}
function appendAdv_(o) {
  var sh = sheet_(T.ADV) || makeTab_(T.ADV);
  o.id = nextId_(T.ADV, rows_(T.ADV), {});
  sh.getRange(sh.getLastRow() + 1, 1, 1, SCHEMA[T.ADV].length).setValues([rowFor_(T.ADV, o)]);
  dropTab_(T.ADV); markChanged_(T.ADV);
  return o.id;
}
/** A wrong advance is never deleted: a minus line is added (dated today). Accounts only for today's entries; the Owner any. */
function api_reverseAdvance(token, advId, reason) {
  auth_(token); need_('truckMoney');
  reason = String(reason || '').trim();
  if (!reason) throw new Error('Write why this advance is reversed.');
  return withLock_(function () {
    var all = rows_(T.ADV), p = all.filter(function (r) { return r.id === advId; })[0];
    if (!p) throw new Error('Advance ' + advId + ' was not found.');
    if (/^Reversal of /.test(String(p.note)) || (num_(p.amount) || 0) < 0) throw new Error(advId + ' is itself a reversal.');
    if (all.some(function (r) { return String(r.note).indexOf('Reversal of ' + advId + ':') === 0; })) throw new Error(advId + ' is already reversed.');
    if (ME.role !== 'Owner' && String(p.at).slice(0, 10) !== today_()) throw new Error('Only the Owner can reverse an advance entered on an earlier day.');
    var id = appendAdv_({ date: today_(), transporter: p.transporter, vehicle: p.vehicle, driver: p.driver, amount: -(num_(p.amount) || 0), ref: '', note: 'Reversal of ' + advId + ': ' + reason, firm: p.firm });
    log_('Advance reversed', advId, id + ': ' + reason);
  });
}

function api_savePO(token, obj) {
  auth_(token); need_('orders');
  obj = obj || {};
  delete obj.status; // Cancel / Short-close / Restore have their own checks
  return withLock_(function () {
    checkOrderFirm_(T.PO, obj);
    var id = saveRecord_(T.PO, obj);
    var po = rows_(T.PO).filter(function (r) { return r.id === id; })[0];
    if (po && po.linkSO && po.poType !== 'plant' && 'linkSO' in obj) {
      rows_(T.TR).filter(function (t) { return t.po === po.id && !t.so && !isOff_(t); }).forEach(function (t) { saveRecord_(T.TR, { id: t.id, so: po.linkSO }); });
    }
  });
}
function api_saveSO(token, obj) {
  auth_(token); need_('orders');
  obj = obj || {};
  delete obj.status; // Cancel / Short-close / Restore have their own checks
  return withLock_(function () { checkOrderFirm_(T.SO, obj); return saveRecord_(T.SO, obj); });
}
function checkOrderFirm_(name, obj) {
  var S = readSettings_(), cur = obj.id ? rows_(name).filter(function (r) { return r.id === obj.id; })[0] : null;
  var get = function (k) { return (k in obj) ? obj[k] : cur ? cur[k] : ''; };
  if ('firm' in obj) {
    obj.firm = normName_(obj.firm);
    if (obj.firm && !isFirm_(obj.firm, S)) throw new Error('Unknown firm "' + obj.firm + '". Your firms are: ' + firms_(S).join(', ') + '.');
  }
  var firm = get('firm') ? normName_(get('firm')) : firms_(S)[0], H = hiddenSets_(S);
  // Orders of a firm kept out of this app: no changes, no new ones; no own-plant POs when the plant firm is kept out.
  if (cur && ((name === T.PO && H.po[cur.id]) || (name === T.SO && H.so[cur.id]))) throw hiddenErr_(cur.id, H);
  if (H.firms.indexOf(firm) >= 0) throw new Error('Orders in ' + firm + ' are kept out of this app.');
  if (name === T.PO && get('poType') === 'plant' && H.firms.indexOf(normName_(S.plantFirm)) >= 0) throw new Error('Own-plant POs belong to ' + normName_(S.plantFirm) + ', which is kept out of this app.');
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
    if (table === 'truck') guardTruck_(id); else guardOrder_(table, id); // kept-out firms (hiddenFirms)
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
    guardOrder_(table, id);
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
    guardTruck_(id);
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
    dropTab_(T.NOTE); markChanged_(T.NOTE);
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
    dropTab_(T.NOTE); markChanged_(T.NOTE);
  });
}

/** One bank payment for several trucks: marks each paid with the same date and UTR. */
function api_payBatch(token, kind, ids, date, utr, amount, rid) {
  auth_(token); need_('truckMoney');
  if (kind !== 'plant' && kind !== 'freight') throw new Error('Unknown payment type.');
  ids = (ids || []).filter(String);
  if (!ids.length) throw new Error('Tick at least one truck.');
  utr = String(utr || '').trim().toUpperCase();
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
      else saveRecord_(T.TR, { id: id, freightPaid: true, freightPaidDate: date, freightUTR: utr, detention: t.det, tAdv: t.advUsed || '' });
    });
    log_(kind === 'plant' ? 'Plant payment' : 'Freight payment', utr || 'no UTR', ids.length + ' trucks: ' + ids.join(', ') + ' | amount entered ' + (amount === '' || amount == null ? '-' : amount));
  }, cleanRid_(rid));
}

function api_restore(token, table, id) {
  auth_(token);
  var ret = table === 'truck' && rows_(T.TR).some(function (r) { return r.id === id && r.status === 'Returned'; });
  need_(table === 'truck' ? (ret ? 'trucks' : 'cancelTruck') : 'orders');
  return withLock_(function () {
    if (table === 'truck') guardTruck_(id); else guardOrder_(table, id);
    var name = { truck: T.TR, po: T.PO, so: T.SO }[table];
    if (!name) throw new Error('Unknown record type');
    if (table === 'truck') {
      // Restoring a returned or cancelled truck must not create a second entry of the same vehicle on the same day.
      var t = rows_(T.TR).filter(function (r) { return r.id === id; })[0];
      if (!t) throw new Error('Truck ' + id + ' not found.');
      var dup = sameDayTruck_({ id: id, truck: t.truck });
      if (dup && ME.role !== 'Owner') throw new Error('This truck is already entered again that day as ' + dup.id + '. Only the Owner can undo this.');
      return saveRecord_(name, ret ? { id: id, status: '', returnedDate: '' } : { id: id, status: '' });
    }
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
      if (REVIEW_DATE_FIELDS_.indexOf(c.f) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.n) && days_(c.n, date) > 1) flags.push('Backdated: ' + c.f + ' set to ' + dmy_(c.n));
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
      dropTab_(T.LOG);
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
    dropTab_(T.BANK); markChanged_(T.BANK);
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
    guardTruck_(id);
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
  dropTab_(T.US); markChanged_(T.US);
  CacheService.getScriptCache().remove('users_v1'); // the login check must see this change at once
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

/* The new screen sends {t: token, d: 1}: after a save it takes back only what changed.
   A screen that was opened before this update sends the plain token and still gets everything, as before. */
function tok_(x) {
  if (x && typeof x === 'object') { REQ_.delta = x.d === 1; return String(x.t || ''); }
  return x ? String(x) : '';
}

/* Users for the login check, kept in Apps Script's cache for 5 minutes (one sheet read less on every call).
   Saving a user in the app clears it at once. */
function authUsers_() {
  var cache = CacheService.getScriptCache(), raw = cache.get('users_v1');
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  var list = users_().map(function (u) { return { id: u.id, name: u.name, role: u.role, active: u.active }; });
  try { cache.put('users_v1', JSON.stringify(list), 300); } catch (e) {}
  return list;
}

function auth_(token) {
  token = tok_(token);
  // The login is looked up in Apps Script's cache first (10 min): the screen checks for news every 15 s, and
  // script properties have a daily read limit. Logging out removes it from both.
  var cache = CacheService.getScriptCache(), raw = token ? cache.get('sess_' + token) : null;
  if (!raw && token) {
    raw = PropertiesService.getScriptProperties().getProperty('s_' + token);
    if (raw) { try { cache.put('sess_' + token, raw, 600); } catch (e) {} }
  }
  if (!raw) throw new Error('LOGIN');
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('s_' + token); cache.remove('sess_' + token); throw new Error('LOGIN'); }
  var u = authUsers_().filter(function (x) { return x.id === s.u && x.active; })[0];
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

/* Memory for ONE server call. Every call from the screen starts with fresh globals, so nothing here can go stale
   between calls. Inside a call, each tab is read from the sheet at most once; later reads use this copy. */
var REQ_ = { ss: null, tz: null, v: null, sheets: {}, tabs: {}, dates: {}, changed: {}, delta: false, inLock: false, logBuf: [] };

function ss_() { return REQ_.ss || (REQ_.ss = SpreadsheetApp.getActiveSpreadsheet()); }
function tz_() {
  if (REQ_.tz) return REQ_.tz;
  var c = CacheService.getScriptCache(), z = c.get('tz');
  if (!z) { z = ss_().getSpreadsheetTimeZone(); try { c.put('tz', z, 21600); } catch (e) {} }
  return (REQ_.tz = z);
}
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function user_() {
  if (ME && ME.id) return ME.id;
  try { return Session.getActiveUser().getEmail() || 'unknown'; } catch (e) { return 'unknown'; }
}
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

/* Every save runs here: one at a time (lock), fresh data, log lines written together, then the result for the screen.
   rid = the screen's id for this save. If the same save arrives twice (the reply was lost and the screen sent it again),
   the second one changes nothing. */
function withLock_(fn, rid) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  REQ_.inLock = true;
  try {
    REQ_.tabs = {}; REQ_.changed = {}; REQ_.v = null; // read fresh data now that we hold the lock
    REQ_.pv = dataVersion_(); // the version before this save: the screen checks it was up to date
    if (rid && seenRid_(rid)) return readAll_();
    try { fn(); } finally { flushLog_(); if (dataChanged_()) bumpVersion_(); }
    if (rid) CacheService.getScriptCache().put('rid_' + rid, '1', 21600);
    if (REQ_.delta) return changes_();
    Object.keys(REQ_.changed).forEach(dropTab_); // a screen opened before this update gets everything, read fresh from the sheet
    return readAll_();
  } finally {
    REQ_.inLock = false;
    lock.releaseLock();
  }
}

function sheet_(name) { return REQ_.sheets[name] || (REQ_.sheets[name] = ss_().getSheetByName(name)); }

function makeTab_(name) {
  var sh = sheet_(name) || ss_().insertSheet(name);
  REQ_.sheets[name] = sh;
  var heads = SCHEMA[name].map(function (c) { return c[1]; });
  sh.getRange(1, 1, 1, heads.length).setValues([heads])
    .setFontWeight('bold').setBackground('#0f6b5c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  dropTab_(name);
  return sh;
}

/* All rows of a tab as objects. The sheet is read once per call; each caller gets its own copies. */
function rows_(name) {
  var list = REQ_.tabs[name] || (REQ_.tabs[name] = readTab_(name));
  return list.map(function (o) { var c = {}; for (var k in o) c[k] = o[k]; return c; });
}
function readTab_(name) {
  var sh = sheet_(name);
  if (!sh) return [];
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    out.push(rowObj_(name, v[i], i + 1));
  }
  return out;
}
/* One sheet row (array) -> object with the SCHEMA keys. */
function rowObj_(name, v, rowNo) {
  var cols = SCHEMA[name], o = { _row: rowNo };
  for (var c = 0; c < cols.length; c++) {
    var x = v[c], type = cols[c][2];
    if (x === undefined || x === null) x = '';
    if (type === 'date') x = x instanceof Date ? fmtDate_(x, 'yyyy-MM-dd') : String(x);
    else if (type === 'num') x = x === '' ? '' : num_(x);
    else if (type === 'bool') x = x === true || String(x).toUpperCase() === 'TRUE';
    else x = x instanceof Date ? fmtDate_(x, 'yyyy-MM-dd HH:mm') : String(x);
    o[cols[c][0]] = x;
  }
  return o;
}
/* The same dates repeat on many rows, so each one is formatted only once per call. */
function fmtDate_(x, pattern) {
  var key = pattern + x.getTime();
  return REQ_.dates[key] || (REQ_.dates[key] = Utilities.formatDate(x, tz_(), pattern));
}
/* After writing to a tab: forget its copy (the next read gets the sheet again) and remember what changed. */
function dropTab_(name) { delete REQ_.tabs[name]; }
function markChanged_(name, id, rowNo) { var c = REQ_.changed[name] || (REQ_.changed[name] = {}); c[id || '*'] = rowNo || 0; }
/* After saveRecord_ writes a row, the copy in memory is updated too, so several saves in one call need no new read. */
function cacheRow_(name, row, rowNo) {
  var list = REQ_.tabs[name];
  if (!list) return;
  var o = rowObj_(name, row, rowNo);
  for (var i = 0; i < list.length; i++) if (list[i].id === o.id) { list[i] = o; return; }
  list.push(o);
}

/* ---------------- data version: lets an open screen ask "anything new?" without reading the tabs ---------------- */
var SCREEN_TABS_ = [T.PO, T.SO, T.TR, T.NOTE, T.BANK, T.US, T.PAY, T.ADV];
function dataChanged_() { return SCREEN_TABS_.some(function (n) { return !!REQ_.changed[n]; }); }
/* Kept in a script property (lasting) and mirrored in Apps Script's cache (fast, no daily read limit). */
function dataVersion_() {
  if (REQ_.v) return REQ_.v;
  var c = CacheService.getScriptCache(), v = c.get('data_v');
  if (!v) { v = PropertiesService.getScriptProperties().getProperty('data_v') || '0'; try { c.put('data_v', v, 21600); } catch (e) {} }
  return (REQ_.v = v);
}
function bumpVersion_() {
  var p = PropertiesService.getScriptProperties(), c = CacheService.getScriptCache();
  REQ_.v = String(Math.max((Number(p.getProperty('data_v')) || 0) + 1, Date.now()));
  p.setProperty('data_v', REQ_.v);
  try { c.put('data_v', REQ_.v, 21600); } catch (e) { try { c.remove('data_v'); } catch (x) {} }
}
function cleanRid_(rid) { rid = String(rid || ''); return /^[A-Za-z0-9_-]{8,64}$/.test(rid) ? rid : ''; }
function seenRid_(rid) { return CacheService.getScriptCache().get('rid_' + rid) !== null; }

function readSettings_() {
  var set = {};
  if (sheet_(T.SET)) rows_(T.SET).forEach(function (r) { set[r.key] = isNaN(Number(r.value)) || r.value === '' ? r.value : Number(r.value); });
  return set;
}

function readAll_() {
  var can = ME && ME.can ? ME.can : ROLES.Viewer;
  var v = dataVersion_(); // read before the tabs, so the data is never older than this version
  var S = readSettings_(), V = visibleRows_(S); // firms kept out of this app (hiddenFirms) are not sent
  var po = V.po, so = V.so, trucks = V.trucks;
  shape_(po, so, trucks, can);
  var out = {
    po: po, so: so, trucks: trucks, settings: S,
    me: ME ? { id: ME.id, name: ME.name, role: ME.role } : null, perm: can,
    today: today_(), syncedAt: nowStr_(), v: v
  };
  out.notes = sheet_(T.NOTE) ? rows_(T.NOTE).reverse() : [];
  if (can.money) out.pays = sheet_(T.PAY) ? rows_(T.PAY) : []; // customer payments (Receivables page)
  if (can.money) out.advances = sheet_(T.ADV) ? rows_(T.ADV) : []; // transporter advances (Freight & Transport)
  if (can.bank) out.banks = sheet_(T.BANK) ? rows_(T.BANK) : [];
  if (can.users) out.users = userList_();
  return out;
}
function userList_() { return users_().map(function (u) { return { id: u.id, name: u.name, role: u.role, active: u.active, at: u.at }; }); }

/* Role rules for what is sent to the screen. Staff without money access still need the correct stage,
   so it is worked out here before the amounts are removed. */
function shape_(po, so, trucks, can) {
  if (can.money || !(po.length || so.length || trucks.length)) return;
  var S = readSettings_(), today = today_(), pm = {}, sm = {};
  rows_(T.PO).forEach(function (r) { pm[r.id] = r; });
  rows_(T.SO).forEach(function (r) { sm[r.id] = r; });
  trucks.forEach(function (t) { t._st = derive_(t, pm[t.po], sm[t.so], S, today).st; });
  var strip = function (list, keys) { list.forEach(function (r) { keys.forEach(function (k) { delete r[k]; }); }); };
  strip(po, ORDER_MONEY); strip(so, ORDER_MONEY); strip(trucks, TRUCK_HIDE);
}

/* After a save: only the records this call changed (read back from the sheet), with the same role rules.
   The screen merges them into what it already has, instead of downloading everything again. */
function changes_() {
  var can = ME && ME.can ? ME.can : ROLES.Viewer, ch = REQ_.changed;
  var out = { delta: true, v: dataVersion_(), pv: REQ_.pv, today: today_(), syncedAt: nowStr_(),
    po: changedRows_(T.PO), so: changedRows_(T.SO), trucks: changedRows_(T.TR) };
  var H = hiddenSets_(); // never send records of firms kept out of this app
  out.po = out.po.filter(function (o) { return !H.po[o.id]; });
  out.so = out.so.filter(function (o) { return !H.so[o.id]; });
  out.trucks = out.trucks.filter(function (t) { return !hidTruck_(t, H); });
  shape_(out.po, out.so, out.trucks, can);
  if (ch[T.NOTE]) out.notes = rows_(T.NOTE).reverse();
  if (ch[T.PAY] && can.money) out.pays = rows_(T.PAY);
  if (ch[T.ADV] && can.money) out.advances = rows_(T.ADV);
  if (ch[T.BANK] && can.bank) out.banks = rows_(T.BANK);
  if (ch[T.US] && can.users) out.users = userList_();
  return out;
}
function changedRows_(name) {
  var c = REQ_.changed[name];
  if (!c) return [];
  var ids = Object.keys(c);
  if (c['*'] !== undefined || ids.length > 5) {
    dropTab_(name); // many rows: one fresh read of the tab is cheaper than reading them one by one
    return rows_(name).filter(function (r) { return c['*'] !== undefined || c.hasOwnProperty(r.id); });
  }
  var sh = sheet_(name), w = SCHEMA[name].length;
  return ids.map(function (id) { return rowObj_(name, sh.getRange(c[id], 1, 1, w).getValues()[0], c[id]); });
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

  var rowNo = isNew ? sh.getLastRow() + 1 : rec._row;
  sh.getRange(rowNo, 1, 1, cols.length).setValues([row]);
  cacheRow_(name, row, rowNo);
  markChanged_(name, obj.id, rowNo);

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
  var max = 0, re = name === T.PO ? /^PO-(\d+)/ : name === T.SO ? /^SO-(\d+)/ : name === T.PAY ? /^PAY-(\d+)/ : name === T.ADV ? /^ADV-(\d+)/ : /^DISP-(\d+)/;
  existing.forEach(function (r) { var m = String(r.id).match(re); if (m) max = Math.max(max, Number(m[1])); });
  var n = max + 1;
  if (name === T.PO) {
    var code = String(obj.plant || '').toUpperCase().split(/\s+/)[0].replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PLANT';
    return 'PO-' + pad_(n, 2) + '-' + code;
  }
  if (name === T.SO) return 'SO-' + pad_(n, 4);
  if (name === T.PAY) return 'PAY-' + pad_(n, 5);
  if (name === T.ADV) return 'ADV-' + pad_(n, 4);
  return 'DISP-' + pad_(n, 4);
}

function normName_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
/* yyyy-mm-dd -> dd-mm-yyyy for messages (dates are read as day-month-year). Anything else is returned as it is. */
function dmy_(s) { var m = String(s == null ? '' : s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s == null ? '' : s); }

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
  var line = [nowStr_(), user_(), action, record, String(details || '').slice(0, 2000), '', '', ''];
  if (REQ_.inLock) { REQ_.logBuf.push(line); return; } // written together when the save finishes (withLock_)
  writeLog_([line]);
}
function flushLog_() { if (REQ_.logBuf.length) { var b = REQ_.logBuf; REQ_.logBuf = []; writeLog_(b); } }
function writeLog_(lines) {
  var sh = sheet_(T.LOG);
  if (!sh) return;
  sh.getRange(sh.getLastRow() + 1, 1, lines.length, 8).setValues(lines);
  dropTab_(T.LOG);
}

/* ---------------- setup and import ---------------- */

var SCHEMA_V = '6.9'; // 6.9: open screens fetch everything once after an upgrade; 6.5: setting qtyTolerancePct; 6.6: setting hiddenFirms; 6.7: transporter advances (APP_ADVANCES, APP_TRUCKS tAdv); 6.8: four firms, Firm on payments and advances
function ensureSetup_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('schema_ok') === SCHEMA_V) return null; // checked in the last 6 hours (setup clears this)
  if (sheet_(T.TR)) {
    // Checking and upgrading the tabs is slow, so it runs only once after each new version of the code.
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('schema_v') !== SCHEMA_V) {
      upgradeHeaders_(); props.setProperty('schema_v', SCHEMA_V);
      bumpVersion_(); // settings may have changed (e.g. new firms): every open screen fetches everything at its next check
    }
    try { cache.put('schema_ok', SCHEMA_V, 21600); } catch (e) {}
    return null;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (sheet_(T.TR)) return null;
    [T.SET, T.PO, T.SO, T.TR, T.LOG, T.US, T.PAY, T.NOTE, T.BANK, T.ADV].forEach(makeTab_);
    var set = sheet_(T.SET);
    set.getRange(2, 1, SETTINGS_DEFAULT.length, 3).setValues(SETTINGS_DEFAULT);
    var report = importOld_();
    REQ_.tabs = {};
    PropertiesService.getScriptProperties().setProperty('schema_v', SCHEMA_V);
    log_('Setup', '-', JSON.stringify(report));
    return report;
  } finally {
    lock.releaseLock();
  }
}

/** Adds any new columns to existing APP_ tabs after an update. Old data stays where it is. */
function upgradeHeaders_() {
  [T.US, T.PAY, T.NOTE, T.BANK, T.ADV].forEach(function (name) { if (!sheet_(name)) makeTab_(name); });
  var set = sheet_(T.SET);
  if (set) {
    var have = {};
    rows_(T.SET).forEach(function (r) { have[r.key] = 1; });
    SETTINGS_DEFAULT.forEach(function (s) { if (!have[s[0]]) set.getRange(set.getLastRow() + 1, 1, 1, 3).setValues([s]); });
    dropTab_(T.SET);
    renameFirm_('SRIRAM SOLVEX', 'SHREE RAM SOLVEX');
    addTradingFirms_();
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
  REQ_.tabs = {}; REQ_.upgraded = true; // settings or firm names may have changed: read again, and send screens everything
}

/* 24-11-2026: Devan, Saraswati and Jai Mahavir (setting tradingFirms) become firms with their own window. Done once;
   the firms cell keeps its firms, adds the missing trading firms after the shown ones, and hidden firms stay last. */
function addTradingFirms_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('firms_added') === 'yes') return;
  var S = readSettings_(), cur = firms_(S).filter(String), hid = hiddenFirms_(S);
  var tf = String(S.tradingFirms || '').split(',').map(function (f) { return normName_(f); }).filter(String);
  var want = cur.filter(function (f) { return hid.indexOf(f) < 0; });
  tf.forEach(function (f) { if (want.indexOf(f) < 0) want.push(f); });
  cur.forEach(function (f) { if (want.indexOf(f) < 0) want.push(f); });
  var row = rows_(T.SET).filter(function (r) { return r.key === 'firms'; })[0];
  if (row && want.join(', ') !== cur.join(', ')) {
    sheet_(T.SET).getRange(row._row, 2).setValue(want.join(', '));
    dropTab_(T.SET);
    log_('Firms', 'firms', cur.join(', ') + ' -> ' + want.join(', '));
  }
  props.setProperty('firms_added', 'yes');
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

var STAGES_ = ['Vehicle placed', 'Loaded', 'Supplier paid', 'Unloaded', 'Part paid', 'Customer paid', 'Closed']; // same words as the screen

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
  // For showing the working: the charged shortage (above the free allowance) and the rate it is charged at (incl. GST)
  x.shortOver = U ? r2(Math.max(0, x.short - x.allow)) : 0;
  x.shortRate = !U || x.fBuyer ? 0 : plantPO ? r2(poRate * (1 + poG)) : so ? r2(x.soBase * (1 + soG)) : 0;
  x.frAmt = x.fBuyer ? 0 : r2(U * FR);
  x.trip = t.date ? days_(t.date, t.unloadDate || today) : 0;
  x.detDays = Math.max(0, x.trip - n(S.freeDays === undefined || S.freeDays === '' ? 3 : S.freeDays));
  x.detSuggest = x.fBuyer ? 0 : x.detDays * n(S.detentionPerDay === undefined || S.detentionPerDay === '' ? 500 : S.detentionPerDay);
  // Detention is only a suggestion: it counts only when someone enters an amount (decided per truck when paying freight).
  x.det = x.fBuyer || !U ? 0 : (t.detention === '' || t.detention == null ? 0 : n(t.detention));
  x.netFr = U && !x.fBuyer ? r2(x.frAmt - x.shortDed - A + x.det) : 0;
  // Sales to your own firm: freight and detention are not taken off the margin (shortage recovered from the transporter still counts).
  x.profit = U && so && po ? r2(x.saleEx - x.purEx - (x.ownBuyer ? -x.shortDed : x.frAmt - x.shortDed + x.det)) : 0;
  x.cx = t.status === 'Cancelled' || t.status === 'Returned';
  // Customer money is kept per customer (custAcc_), not per truck (Nov 2026). A truck is Closed when it is unloaded
  // and the freight is paid (or the customer pays the freight); the supplier payment does not count (Nitish, 24-11-2026).
  var st;
  if (x.cx) st = -1;
  else if (U && (t.freightPaid || x.fBuyer)) st = 6;
  else if (U) st = 3;
  else if (t.plantPaid) st = 2;
  else if (L) st = 1;
  else st = 0;
  x.st = st; x.stage = st < 0 ? (t.status === 'Returned' ? 'Returned' : 'Cancelled') : plantPO && st === 3 ? 'Received' : STAGES_[st];
  x.credit = so ? (so.creditDays === '' || so.creditDays == null ? n(S.defaultCreditDays || 7) : n(so.creditDays)) : 0;
  x.due = U && so && t.unloadDate ? days_(t.unloadDate, today) - x.credit : 0; // days past the credit period (above 0 = due)
  x.placed = t.placedOn || t.date;
  x.noSlip = L > 0 && !t.slipPhoto && (!S.slipCheckFrom || String(t.date) >= String(S.slipCheckFrom));
  return x;
}

/* Customer accounts. Customer money is kept per customer (factory), not per truck (Nitish, Nov 2026).
   Sales = sale totals of the customer's unloaded trucks; Received / Deducted = its APP_PAYMENTS lines (reversals are negative);
   Outstanding = Sales − Received − Deducted (below 0 = advance).
   Overdue = sales past their credit days, less everything received; oldest = most days among trucks not covered
   (trucks taken oldest unload date first). The screen has the same function (custAcc in Index.html). */
function custAcc_(trucks, pays, S) {
  var acc = {}, r2 = function (x) { return Math.round(x * 100) / 100; }, first = firms_(S)[0];
  // One account per firm and customer (24-11-2026), key "FIRM|CUSTOMER". Old payments without a firm: the first firm.
  var get = function (firm, name) {
    var f = normName_(firm) || first, k = normName_(name);
    return acc[f + '|' + k] || (acc[f + '|' + k] = { key: f + '|' + k, firm: f, name: k, own: isFirm_(k, S), trucks: 0, qty: 0, sales: 0, received: 0, deducted: 0, lastPaid: '', list: [] });
  };
  trucks.forEach(function (t) {
    if (t.cx || !t.U || !t.so || t.plantPO || !t.buyer) return;
    var a = get(t.firm, t.buyer);
    a.trucks++; a.qty += t.U; a.sales += t.saleTot; a.list.push(t);
  });
  (pays || []).forEach(function (p) {
    if (!p.buyer) return;
    var a = get(p.firm, p.buyer), amt = Number(p.amount) || 0;
    a.received += amt; a.deducted += Number(p.deduction) || 0;
    if (amt > 0 && String(p.date) > a.lastPaid) a.lastPaid = String(p.date);
  });
  Object.keys(acc).forEach(function (k) {
    var a = acc[k], pool = a.received + a.deducted, due = 0, run = 0;
    a.list.sort(function (x, y) { return String(x.unloadDate).localeCompare(String(y.unloadDate)) || String(x.id).localeCompare(String(y.id)); });
    a.oldest = 0;
    a.list.forEach(function (t) {
      if (t.due > 0) due += t.saleTot;
      run += t.saleTot;
      if (run > pool + 0.5 && t.due > a.oldest) a.oldest = t.due; // not (fully) covered by the money received
    });
    a.sales = r2(a.sales); a.received = r2(a.received); a.deducted = r2(a.deducted); a.qty = r2(a.qty);
    a.outstanding = r2(a.sales - a.received - a.deducted);
    a.overdue = r2(Math.max(0, due - pool));
    if (!a.overdue) a.oldest = 0;
    delete a.list;
  });
  return acc;
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

/* Transporter advances (Nitish, 23-11-2026): money given to a transporter that is not tied to a truck, used automatically.
   A truck whose freight is paid keeps what it took (saved in tAdv when paid). Unloaded, unpaid trucks of that transporter
   share what is left, oldest unload first. netPay (freight to pay) goes down by what is taken; left = given − used.
   The screen has the same function (transAdv in Index.html). */
function transAdv_(list, advs, first) {
  // Per firm and transporter (24-11-2026), key "FIRM|TRANSPORTER": an advance is used only on that firm's trucks.
  var r2 = function (x) { return Math.round(x * 100) / 100; }, acc = {}, open = {};
  var norm = function (s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); };
  var key = function (firm, tr) { var t = norm(tr); return t ? (norm(firm) || norm(first)) + '|' + t : ''; };
  var get = function (k) { return acc[k] || (acc[k] = { key: k, firm: k.split('|')[0], name: k.split('|')[1], given: 0, used: 0, left: 0 }); };
  (advs || []).forEach(function (a) { var k = key(a.firm, a.transporter); if (k) get(k).given += Number(a.amount) || 0; });
  list.forEach(function (t) {
    t.advUsed = 0; t.advAvail = 0;
    var k = key(t.firm, t.transporter);
    if (t.cx || t.fBuyer || !t.U || !k) return;
    if (t.freightPaid) {
      var u = Number(t.tAdv) || 0;
      if (u) { t.advUsed = r2(u); t.netPay = r2(t.netPay - u); get(k).used += u; }
      return;
    }
    (open[k] = open[k] || []).push(t);
  });
  Object.keys(acc).forEach(function (k) {
    var a = acc[k], pool = r2(a.given - a.used);
    (open[k] || []).sort(function (x, y) { return String(x.unloadDate).localeCompare(String(y.unloadDate)) || String(x.id).localeCompare(String(y.id)); }).forEach(function (t) {
      t.advAvail = Math.max(0, pool);
      var use = r2(Math.max(0, Math.min(pool, t.netPay)));
      if (use > 0) { t.advUsed = use; t.netPay = r2(t.netPay - use); pool = r2(pool - use); a.used += use; }
    });
    a.given = r2(a.given); a.used = r2(a.used); a.left = r2(a.given - a.used);
  });
  return acc;
}

/* patch (optional): one truck's unsaved changes, to work out what it would take from its transporter's advance
   when its freight is paid now (advForPay_). */
function deriveAll_(patch) {
  var po = {}, so = {}, S = readSettings_(), today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var V = visibleRows_(S); // firms kept out of this app (hiddenFirms) are not counted anywhere
  V.po.forEach(function (r) { po[r.id] = r; });
  V.so.forEach(function (r) { so[r.id] = r; });
  var list = V.trucks.map(function (t) {
    if (!patch || t.id !== patch.id) return t;
    var c = {}, k;
    for (k in t) c[k] = t[k];
    for (k in patch) if (['freightPaid', 'freightPaidDate', 'freightUTR', 'tAdv'].indexOf(k) < 0) c[k] = patch[k];
    return c;
  });
  var trucks = carry_(list.map(function (t) { return derive_(t, po[t.po], so[t.so], S, today); }));
  var pays = sheet_(T.PAY) ? rows_(T.PAY) : [], advs = sheet_(T.ADV) ? rows_(T.ADV) : [];
  var tadv = transAdv_(trucks, advs, firms_(S)[0]);
  return { po: po, so: so, S: S, today: today, trucks: trucks, pays: pays, accounts: custAcc_(trucks, pays, S), advs: advs, tadv: tadv };
}
/* What a truck takes from its transporter's advance if its freight is paid now (with the changes being saved). */
function advForPay_(obj) {
  var t = deriveAll_(obj).trucks.filter(function (x) { return x.id === obj.id; })[0];
  return t && t.advUsed ? t.advUsed : '';
}

/* ---------------- Excel export ---------------- */

function truckColumns_(can) {
  var c = [['Dispatch No.', 'id'], ['Status', 'status'], ['Firm', 'firm'], ['Dispatch Date', 'date'], ['Vehicle Placed On', 'placedOn'], ['PO', 'po'], ['Supplier', 'plant'], ['SO', 'so'], ['Customer', 'buyer'],
    ['Vehicle No', 'truck'], ['Transporter', 'transporter'], ['Driver', 'driver'], ['RST / Weighment Slip No', 'slip'], ['Slip Photo Link', 'slipPhoto'], ['Dispatch Wt (qtl)', 'L'], ['Supplier Invoice No', 'billNo'], ['Supplier Invoice Qty', 'billQty'],
    ['Unload Date', 'unloadDate'], ['Received Wt (qtl)', 'U'], ['Shortage (qtl)', 'short'], ['Days on trip', 'trip'], ['Stage', 'stage']];
  if (can.money) c = c.concat([['Supplier Amount incl GST', 'purTot'], ['Supplier Paid', 'plantPaid'], ['Supplier Paid Date', 'plantPaidDate'], ['Supplier UTR', 'plantUTR'],
    ['Sale Rate', 'rateUsed'], ['Sale Total', 'saleTot'],
    ['Freight Rate', 'FR'], ['Freight Amount', 'frAmt'], ['Free Shortage (qtl)', 'allowX'], ['Charged Shortage (qtl)', 'shortOver'], ['Shortage Rate incl GST', 'shortRate'], ['Shortage Deduction', 'shortDed'], ['Detention', 'det'],
    ['Freight Advance', 'A'], ['Trip Net Freight', 'netFr'], ['Earlier Advance Adjusted', 'carryIn'], ['Transporter Advance Used', 'advUsed'], ['Net Freight Payable', 'netPay'], ['Freight Paid', 'freightPaid'], ['Freight Paid Date', 'freightPaidDate'], ['Freight UTR', 'freightUTR']]);
  if (can.profit) c.push(['Profit before GST', 'profit']);
  c.push(['Note', 'note']);
  return c;
}

/* One Excel tab. S.No. comes first; yyyy-mm-dd values become real dates, shown as DD-MM-YYYY (format set in buildXlsx_). */
function tab_(name, cols, list) {
  var dateCols = {};
  var body = list.map(function (r, i) {
    return [i + 1].concat(cols.map(function (c, j) {
      var v = r[c[1]];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { dateCols[j + 1] = 1; return parseDate_(v); }
      return v;
    }));
  });
  return { name: name, rows: [['S.No.'].concat(cols.map(function (c) { return c[0]; }))].concat(body), dateCols: Object.keys(dateCols).map(Number) };
}

var ADV_COLS_ = [['Advance No.', 'id'], ['Firm', 'firm'], ['Date', 'date'], ['Transporter', 'transporter'], ['Vehicle No', 'vehicle'], ['Driver', 'driver'], ['Amount', 'amount'], ['UTR / Ref', 'ref'], ['Note', 'note'], ['Entered By', 'by']];
function exportTabs_(kind, key, ids, can, firm) {
  var A = deriveAll_();
  A.trucks.forEach(function (t) { t.allowX = Math.round((t.allow || 0) * 1000) / 1000; }); // free shortage, 3 decimals for Excel
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
        bal: Math.round((Number(o.qty || 0) - done) * 100) / 100, trucks: tr.length, status: o.status === 'Settled' ? 'Short-closed' : o.status, rate: o.rate,
        terms: o.gstMode ? (o.gstMode === 'incl' ? 'GST incl' : 'GST extra') + ', ' + (o.freightMode === 'buyer' ? 'buyer pays freight' : 'freight incl') : '' };
      return r;
    });
  };
  var oc = [['ID', 'id'], ['Firm', 'firm'], ['Type', 'type'], ['Party', 'party'], ['Sells To SO', 'link'], ['Date', 'date'], ['Quantity', 'qty'], ['Done', 'done'], ['Balance', 'bal'], ['Trucks', 'trucks'], ['Status', 'status']];
  if (can.money) oc = oc.concat([['Rate', 'rate'], ['Terms', 'terms']]);
  var pick = function (list) { return ids ? list.filter(function (t) { return ids.indexOf(t.id) >= 0; }) : list; };
  // Customer money is kept per firm and customer. With a firm chosen: that firm's accounts and payments only.
  var first = firms_(A.S)[0], fOf = function (x) { return normName_(x.firm) || first; };
  var pays = A.pays.filter(function (p) { return !firm || fOf(p) === firm; }).map(function (p) { var c = {}; for (var k in p) c[k] = p[k]; c.firm = fOf(p); return c; });
  var accRows = Object.keys(A.accounts).sort().filter(function (k) { return !firm || A.accounts[k].firm === firm; }).map(function (k) {
    var a = A.accounts[k];
    return { firm: a.firm, name: a.name, group: a.own ? 'Yes' : '', trucks: a.trucks, qty: a.qty, sales: a.sales, received: a.received, deducted: a.deducted,
      outstanding: a.outstanding, overdue: a.overdue, oldest: a.oldest || '', lastPaid: a.lastPaid };
  });
  var ac = [['Firm', 'firm'], ['Customer', 'name'], ['Group company', 'group'], ['Trucks unloaded', 'trucks'], ['Qty unloaded (qtl)', 'qty'], ['Sales incl GST', 'sales'], ['Received', 'received'],
    ['Deductions', 'deducted'], ['Outstanding', 'outstanding'], ['Overdue', 'overdue'], ['Oldest overdue (days)', 'oldest'], ['Last received', 'lastPaid']];
  var pc = [['Payment ID', 'id'], ['Firm', 'firm'], ['Date', 'date'], ['Dispatch No.', 'truck'], ['SO', 'so'], ['Customer', 'buyer'], ['Amount', 'amount'], ['Deduction', 'deduction'], ['Note', 'note'], ['Entered By', 'by']];
  var advRows = A.advs.filter(function (a) { return !firm || fOf(a) === firm; }).map(function (a) { var c = {}; for (var k in a) c[k] = a[k]; c.firm = fOf(a); return c; });
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
      Object.keys(A.tadv).forEach(function (k) {
        var x = A.tadv[k];
        if (firm && x.firm !== firm) return;
        var b = by[x.name] = by[x.name] || { name: x.name, trucks: 0, freight: 0, short: 0, det: 0, adv: 0, payable: 0, paid: 0, tGiven: 0, tUsed: 0, tLeft: 0 };
        b.tGiven = (b.tGiven || 0) + x.given; b.tUsed = (b.tUsed || 0) + x.used; b.tLeft = (b.tLeft || 0) + x.left;
      });
      tabs.push(tab_('Transporters', [['Transporter', 'name'], ['Trucks', 'trucks'], ['Freight', 'freight'], ['Shortage Deduction', 'short'], ['Detention', 'det'], ['Freight Advance', 'adv'], ['Net Paid', 'paid'], ['Net Payable Now', 'payable'],
        ['Transporter Advance Given', 'tGiven'], ['Transporter Advance Used', 'tUsed'], ['Transporter Advance Left', 'tLeft']], Object.keys(by).map(function (k) { return by[k]; })));
      tabs.push(tab_('Transporter Advances', ADV_COLS_, advRows));
      tabs.push(tab_('Customer Accounts', ac, accRows));
      tabs.push(tab_('Customer Payments', pc, pays));
    }
  } else if (kind === 'accounts') { // Receivables page: one row per customer, and all customer payments
    if (!can.money) throw new Error('Your role cannot download money figures.');
    tabs.push(tab_('Customer Accounts', ac, ids ? accRows.filter(function (r) { return ids.indexOf(r.firm + '|' + r.name) >= 0 || ids.indexOf(r.name) >= 0; }) : accRows));
    tabs.push(tab_('Customer Payments', pc, pays));
  } else if (kind === 'shortage') { // Disputes tab: loaded / unloaded weight and how each shortage deduction was worked out. key = transporter (or blank)
    if (!can.money) throw new Error('Your role cannot download money figures.');
    var shc = [['Dispatch No.', 'id'], ['Firm', 'firm'], ['Date Out', 'date'], ['Unload Date', 'unloadDate'], ['Vehicle No', 'truck'], ['Transporter', 'transporter'], ['Customer', 'buyer'],
      ['Loaded (qtl)', 'L'], ['Unloaded (qtl)', 'U'], ['Shortage (qtl)', 'short'], ['Free 0.2% (qtl)', 'allowX'], ['Charged Shortage (qtl)', 'shortOver'], ['Rate incl GST', 'shortRate'], ['Shortage Deduction', 'shortDed'],
      ['Freight Rate', 'FR'], ['Freight', 'frAmt'], ['Freight Advance', 'advTot'], ['Detention', 'det'], ['Net Freight', 'netPay'], ['Freight Paid', 'freightPaid'], ['Freight Paid Date', 'freightPaidDate']];
    var shl = pick(A.trucks.filter(function (t) { return !t.cx && t.U && !t.fBuyer && (!key || normName_(t.transporter || '(none)') === normName_(key)); }));
    tabs.push(tab_('Shortage', shc, shl.map(function (t) { var o = {}; for (var k in t) o[k] = t[k]; o.advTot = Math.round(((t.A || 0) + (t.carryIn || 0) + (t.advUsed || 0)) * 100) / 100; return o; })));
  } else if (kind === 'orders') { // a list of orders shown on screen (e.g. Closed & cancelled page): ids = the order ids
    tabs.push(tab_('Purchase Orders', oc, pick(orderRows(A.po, 'po'))));
    tabs.push(tab_('Sale Orders', oc, pick(orderRows(A.so, 'so'))));
  } else {
    var match = {
      trucks: function () { return true; },
      po: function (t) { return t.po === key; }, so: function (t) { return t.so === key; },
      buyer: function (t) { return normName_(t.buyer) === normName_(key); }, plant: function (t) { return normName_(t.plant) === normName_(key); },
      transporter: function (t) { return normName_(t.transporter || '(none)') === normName_(key); }
    }[kind];
    if (!match) throw new Error('Unknown export');
    tabs.push(tab_(kind === 'transporter' ? 'Statement' : 'Trucks', tc, pick(A.trucks.filter(match))));
    if (kind === 'transporter' && can.money) tabs.push(tab_('Advances', ADV_COLS_, advRows.filter(function (a) { return normName_(a.transporter) === normName_(key); })));
    if (kind === 'po') tabs.push(tab_('PO', oc, orderRows(A.po, 'po').filter(function (r) { return r.id === key; })));
    if (kind === 'so') tabs.push(tab_('SO', oc, orderRows(A.so, 'so').filter(function (r) { return r.id === key; })));
    if (kind === 'buyer') tabs.push(tab_('Sale Orders', oc, orderRows(A.so, 'so').filter(function (r) { return normName_(r.party) === normName_(key); })));
    if (kind === 'buyer' && can.money) {
      tabs.push(tab_('Account', ac, accRows.filter(function (r) { return r.name === normName_(key); })));
      tabs.push(tab_('Payments', pc, pays.filter(function (p) { return normName_(p.buyer) === normName_(key); })));
    }
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
    if (rows.length > 1) (tb.dateCols || []).forEach(function (c) { sh.getRange(2, c + 1, rows.length - 1, 1).setNumberFormat('dd-mm-yyyy'); });
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

/* ---------------- Dispatch report (PDF) ----------------
   For a from–to range: every open PO and SO (and any order with trucks in the range) with its balance, the trucks
   dispatched (date out) and the trucks unloaded, day by day. Rates and amounts only for money roles (Dispatch: weights only). */
function api_reportPdf(token, from, to, firm) {
  auth_(token);
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from || '')) || !re.test(String(to || ''))) throw new Error('Choose the from and to dates.');
  if (from > to) throw new Error('The from date is after the to date.');
  var day = function (s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; };
  if (day(to) - day(from) > 366) throw new Error('Choose at most one year.');
  var A = deriveAll_(), f = firm ? normName_(firm) : '';
  if (f && (firms_(A.S).indexOf(f) < 0 || hiddenFirms_(A.S).indexOf(f) >= 0)) throw new Error('Unknown firm: ' + f);
  var name = 'DDGS Dispatch report ' + (f ? shortFirm_(f) + ' ' : '') + dmy_(from) + (to !== from ? ' to ' + dmy_(to) : '');
  var html = reportHtml_(A, from, to, f, !!(ME.can && ME.can.money), ME.name || ME.id);
  var pdf = Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf');
  var file = folder_('DDGS Exports').createFile(pdf);
  log_('Report PDF', f || 'All firms', dmy_(from) + ' to ' + dmy_(to));
  return { name: pdf.getName(), url: file.getUrl(), b64: Utilities.base64Encode(pdf.getBytes()) };
}
function shortFirm_(f) {
  var w = normName_(f).split(' '), keep = [];
  for (var i = 0; i < w.length; i++) { if (i > 0 && /^(SOLVEX|TRADING|TRADERS|AND|&|COMPANY|CO\.?|PVT|LTD|PRIVATE|LIMITED)$/.test(w[i])) break; keep.push(w[i]); }
  return keep.map(function (x) { return x.charAt(0) + x.slice(1).toLowerCase(); }).join(' ');
}
function reportHtml_(A, from, to, f, money, who) {
  var S = A.S, all = !f && firms_(S).filter(function (x) { return hiddenFirms_(S).indexOf(x) < 0; }).length > 1;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var q = function (x) { return qtl_(Number(x) || 0); }, rs = function (x) { return money_(Number(x) || 0); };
  var nw = function (x) { return '<span class="nw">' + x + '</span>'; }, dt = function (d) { return nw(dmy_(d)); }, tk = function (k) { return k + (k === 1 ? ' truck' : ' trucks'); };
  var sum = function (a, fn) { return Math.round(a.reduce(function (s, t) { return s + (Number(fn(t)) || 0); }, 0) * 100) / 100; };
  var byId = function (a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); };
  var inR = function (d) { return !!d && d >= from && d <= to; };
  var live = A.trucks.filter(function (t) { return !t.cx && (!f || t.firm === f); });
  var disp = live.filter(function (t) { return t.L && inR(t.date); }).sort(function (a, b) { return byId(a.date, b.date) || byId(a.id, b.id); });
  var unl = live.filter(function (t) { return t.U && inR(t.unloadDate); }).sort(function (a, b) { return byId(a.unloadDate, b.unloadDate) || byId(a.id, b.id); });
  var fs = function (x) { return all ? '<br><span class="mu">' + esc(shortFirm_(x)) + '</span>' : ''; };
  var dest = function (t) { return t.plantPO ? 'Own plant' : t.buyer ? esc(t.buyer) + (t.so ? '<br><span class="mu">' + esc(t.so) + '</span>' : '') : '<span class="mu">not assigned</span>'; };
  // a table: cols = [[heading, right-aligned?]], rows = arrays of cell html, tot = totals row (or null)
  var table = function (cols, rows, tot) {
    if (!rows.length) return '<p class="mu">None.</p>';
    var cell = function (tag, c, i) { return '<' + tag + (cols[i][1] ? ' class="r"' : '') + '>' + c + '</' + tag + '>'; };
    return '<table><thead><tr>' + cols.map(function (c, i) { return cell('th', c[0], i); }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return cell('td', c, i); }).join('') + '</tr>'; }).join('') +
      (tot ? '<tr class="tot">' + tot.map(function (c, i) { return cell('td', c, i); }).join('') + '</tr>' : '') + '</tbody></table>';
  };
  var title = f || (all ? 'All firms' : firms_(S)[0]);
  var period = dmy_(from) + (to !== from ? ' to ' + dmy_(to) : '');
  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#14201e}.nw,td.r{white-space:nowrap}' +
    'h1{font-size:16pt;color:#0f6b5c;margin:0 0 2px}h2{font-size:11pt;color:#0f6b5c;margin:16px 0 5px;padding-bottom:2px;border-bottom:1.5px solid #0f6b5c}' +
    'table{border-collapse:collapse;width:100%;font-size:8pt}th{background:#0f6b5c;color:#fff;text-align:left;padding:4px 5px;font-size:7.5pt;font-weight:bold}' +
    'td{border-bottom:1px solid #dfe6e3;padding:3px 5px;vertical-align:top}.r{text-align:right}tr.tot td{font-weight:bold;background:#eef4f2;border-top:1px solid #14201e}' +
    '.mu{color:#5d6b68;font-size:7pt}.kp td{border:1px solid #cfdad6;padding:6px 8px;width:25%;vertical-align:top}.kp b{font-size:13pt}.top{color:#5d6b68;margin-bottom:10px}' +
    '</style></head><body>';
  h += '<h1>Dispatch report · ' + esc(title) + '</h1><div class="top">' + esc(period) + ' · made by ' + esc(who) + ' on ' + Utilities.formatDate(new Date(), tz_(), 'dd-MM-yyyy HH:mm') + (money ? '' : ' · weights only') + '</div>';
  var shortT = unl.filter(function (t) { return t.short > 0; });
  h += '<table class="kp"><tr>' +
    '<td>Trucks dispatched<br><b>' + disp.length + '</b><br>' + q(sum(disp, function (t) { return t.L; })) + ' qtl' + (money ? '<br><span class="mu">purchase ' + rs(sum(disp, function (t) { return t.purTot; })) + '</span>' : '') + '</td>' +
    '<td>Trucks unloaded<br><b>' + unl.length + '</b><br>' + q(sum(unl, function (t) { return t.U; })) + ' qtl received' + (money ? '<br><span class="mu">sale ' + rs(sum(unl, function (t) { return t.saleTot; })) + '</span>' : '') + '</td>' +
    '<td>Shortage<br><b>' + q(sum(unl, function (t) { return t.short; })) + '</b> qtl<br>' + shortT.length + ' trucks' + (money ? '<br><span class="mu">deducted ' + rs(sum(unl, function (t) { return t.shortDed; })) + '</span>' : '') + '</td>' +
    '<td>On the road now<br><b>' + live.filter(function (t) { return t.L && !t.U; }).length + '</b><br>' + q(sum(live.filter(function (t) { return t.L && !t.U; }), function (t) { return t.L; })) + ' qtl</td>' +
    '</tr></table>';
  if (to !== from) {
    var days = {};
    disp.forEach(function (t) { var d = days[t.date] = days[t.date] || { dn: 0, dq: 0, un: 0, uq: 0, sh: 0 }; d.dn++; d.dq += t.L; });
    unl.forEach(function (t) { var d = days[t.unloadDate] = days[t.unloadDate] || { dn: 0, dq: 0, un: 0, uq: 0, sh: 0 }; d.un++; d.uq += t.U; d.sh += t.short; });
    var dk = Object.keys(days).sort();
    h += '<h2>Day by day</h2>' + table([['Date'], ['Trucks dispatched', 1], ['Dispatched qtl', 1], ['Trucks unloaded', 1], ['Received qtl', 1], ['Shortage qtl', 1]],
      dk.map(function (k) { var d = days[k]; return [dt(k), d.dn || '—', d.dn ? q(d.dq) : '—', d.un || '—', d.un ? q(d.uq) : '—', d.sh ? q(d.sh) : '—']; }),
      ['Total', disp.length, q(sum(disp, function (t) { return t.L; })), unl.length, q(sum(unl, function (t) { return t.U; })), q(sum(unl, function (t) { return t.short; }))]);
  }
  // orders: every open one in this firm, plus closed ones that had trucks in the range
  var orders = function (map, k) {
    return Object.keys(map).map(function (id) { return map[id]; }).filter(function (o) {
      if (f && firmOf_(o, S) !== f) return false;
      var open = o.status !== 'Cancelled' && o.status !== 'Settled';
      return open || disp.some(function (t) { return t[k] === o.id; }) || unl.some(function (t) { return t[k] === o.id; });
    }).sort(function (a, b) { return byId(a.id, b.id); }).map(function (o) {
      var on = function (t) { return t[k] === o.id; }, done = sum(live.filter(on), function (t) { return t.L; }), qty = Number(o.qty) || 0;
      return { o: o, qty: qty, done: done, bal: Math.round((qty - done) * 100) / 100, dp: disp.filter(on), up: unl.filter(on) };
    });
  };
  var st = function (o) { return o.status === 'Settled' ? ' <span class="mu">short-closed</span>' : o.status === 'Cancelled' ? ' <span class="mu">cancelled</span>' : ''; };
  var pos = orders(A.po, 'po');
  h += '<h2>Purchase orders</h2>' + table([['PO'], ['Date'], ['Supplier']].concat(money ? [['Rate', 1]] : []).concat([['Ordered qtl', 1], ['Loaded qtl', 1], ['Balance qtl', 1], ['In period', 1]]),
    pos.map(function (x) {
      return [nw(esc(x.o.id)) + fs(firmOf_(x.o, S)) + st(x.o), dt(x.o.date), esc(x.o.plant)].concat(money ? [rs(x.o.rate) + '<br><span class="mu">+ GST ' + Math.round((Number(x.o.gst) || 0) * 100) + '%</span>'] : [])
        .concat([q(x.qty), q(x.done), '<b>' + q(x.bal) + '</b>', x.dp.length ? tk(x.dp.length) + '<br>' + q(sum(x.dp, function (t) { return t.L; })) + ' qtl' : '—']);
    }), ['Total', '', ''].concat(money ? [''] : []).concat([q(sum(pos, function (x) { return x.qty; })), q(sum(pos, function (x) { return x.done; })), q(sum(pos, function (x) { return x.bal; })), tk(disp.filter(function (t) { return t.po; }).length)]));
  var sos = orders(A.so, 'so');
  var terms = function (o) { return (o.gstMode === 'incl' ? 'GST incl.' : o.gstMode === 'excl' ? '+ GST' : '') + (o.freightMode === 'buyer' ? ', customer pays freight' : o.freightMode === 'ours' ? ', freight incl.' : ''); };
  h += '<h2>Sale orders</h2>' + table([['SO'], ['Date'], ['Customer']].concat(money ? [['Rate', 1]] : []).concat([['Ordered qtl', 1], ['Dispatched qtl', 1], ['Balance qtl', 1], ['Dispatched in period', 1], ['Unloaded in period', 1]]),
    sos.map(function (x) {
      return [nw(esc(x.o.id)) + fs(firmOf_(x.o, S)) + st(x.o), dt(x.o.date), esc(x.o.buyer)].concat(money ? [rs(x.o.rate) + '<br><span class="mu">' + esc(terms(x.o)) + '</span>'] : [])
        .concat([q(x.qty), q(x.done), '<b>' + q(x.bal) + '</b>', x.dp.length ? tk(x.dp.length) + '<br>' + q(sum(x.dp, function (t) { return t.L; })) + ' qtl' : '—',
          x.up.length ? tk(x.up.length) + '<br>' + q(sum(x.up, function (t) { return t.U; })) + ' qtl' : '—']);
    }), ['Total', '', ''].concat(money ? [''] : []).concat([q(sum(sos, function (x) { return x.qty; })), q(sum(sos, function (x) { return x.done; })), q(sum(sos, function (x) { return x.bal; })),
      tk(sum(sos, function (x) { return x.dp.length; })), tk(sum(sos, function (x) { return x.up.length; }))]));
  h += '<h2>Trucks dispatched (' + disp.length + ')</h2>' + table([['#'], ['Date out'], ['Dispatch No.'], ['Vehicle'], ['Supplier / PO'], ['Customer / SO'], ['Transporter'], ['Loaded qtl', 1]].concat(money ? [['Purchase incl. GST', 1]] : []),
    disp.map(function (t, i) {
      return [i + 1, dt(t.date), nw(esc(t.id)) + fs(t.firm), nw('<b>' + esc(t.truck) + '</b>'), esc(t.plant) + '<br><span class="mu">' + esc(t.po) + '</span>', dest(t), esc(t.transporter || '—'), q(t.L)].concat(money ? [rs(t.purTot)] : []);
    }), ['', 'Total', '', '', '', '', '', q(sum(disp, function (t) { return t.L; }))].concat(money ? [rs(sum(disp, function (t) { return t.purTot; }))] : []));
  h += '<h2>Trucks unloaded (' + unl.length + ')</h2>' + table([['#'], ['Unloaded'], ['Dispatch No.'], ['Vehicle'], ['Customer / SO'], ['Date out'], ['Loaded qtl', 1], ['Received qtl', 1], ['Shortage qtl', 1]].concat(money ? [['Sale amount', 1], ['Shortage deduction', 1]] : []),
    unl.map(function (t, i) {
      return [i + 1, dt(t.unloadDate), nw(esc(t.id)) + fs(t.firm), nw('<b>' + esc(t.truck) + '</b>'), dest(t), dt(t.date), q(t.L), q(t.U), t.short ? q(t.short) : '—'].concat(money ? [t.plantPO ? '—' : rs(t.saleTot), t.shortDed ? rs(t.shortDed) : '—'] : []);
    }), ['', 'Total', '', '', '', '', q(sum(unl, function (t) { return t.L; })), q(sum(unl, function (t) { return t.U; })), q(sum(unl, function (t) { return t.short; }))].concat(money ? [rs(sum(unl, function (t) { return t.saleTot; })), rs(sum(unl, function (t) { return t.shortDed; }))] : []));
  return h + '<p class="mu" style="margin-top:14px">Weights in quintals. Dispatched = date the truck left the plant (date out). Cancelled and returned trucks are not counted. DDGS Trade Control.</p></body></html>';
}

/* ---------------- daily report and weekly backup ---------------- */

function ensureTriggers_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('trig_ok') === 'on') return; // checked in the last 6 hours (setup clears this)
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('triggers_v4') === 'on') { try { cache.put('trig_ok', 'on', 21600); } catch (x) {} return; }
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
  if (!fromTrigger_(e)) return;
  sendDailyReport_();
}
function sendDailyReport_() {
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
  // Customer money is per customer (custAcc_): what each factory owes, not per truck.
  var accs = Object.keys(A.accounts).map(function (k) { return A.accounts[k]; });
  var owes = function (a) { return Math.max(0, a.outstanding); };
  var ownDue = sum(accs.filter(function (a) { return a.own; }), owes);
  h += '<p><b>Position now:</b> outside customers owe ' + money_(sum(accs.filter(function (a) { return !a.own; }), owes)) + (ownDue ? ' · group company owes ' + money_(ownDue) : '') + ' (overdue ' + money_(sum(accs, function (a) { return a.overdue; })) + ') · suppliers unpaid ' +
    money_(sum(live.filter(function (t) { return t.L && !t.plantPaid; }), function (t) { return t.purTot; })) + ' · freight payable ' +
    money_(sum(live.filter(function (t) { return t.U && !t.freightPaid; }), function (t) { return t.netPay; })) + ' · transporter advances left ' +
    money_(sum(Object.keys(A.tadv).map(function (k) { return A.tadv[k]; }), function (a) { return Math.max(0, a.left); })) + ' · on the road ' +
    q(sum(live.filter(function (t) { return t.L && !t.U; }), function (t) { return t.L; })) + ' qtl</p>';
  var shown = firms_(A.S).filter(function (f) { return f && hiddenFirms_(A.S).indexOf(f) < 0; });
  if (shown.length > 1) h += '<h3>By firm</h3>' + table(['Firm', 'New trucks', 'Unloaded', 'Customers owe', 'Overdue', 'Suppliers unpaid', 'Freight payable'], shown.map(function (f) {
    var tf = live.filter(function (t) { return t.firm === f; }), af = accs.filter(function (a) { return a.firm === f; });
    return [f, added.filter(function (t) { return t.firm === f; }).length, unloaded.filter(function (t) { return t.firm === f; }).length, money_(sum(af, owes)), money_(sum(af, function (a) { return a.overdue; })),
      money_(sum(tf.filter(function (t) { return t.L && !t.plantPaid; }), function (t) { return t.purTot; })), money_(sum(tf.filter(function (t) { return t.U && !t.freightPaid; }), function (t) { return t.netPay; }))];
  }));
  var dest = function (t) { return t.plantPO ? 'Own plant' : t.buyer || 'not assigned'; };
  h += '<h3>Trucks added today</h3>' + table(['Dispatch', 'Firm', 'Truck', 'PO / Supplier', 'Going to', 'Loaded qtl'], added.map(function (t) { return [t.id, t.firm, t.truck, t.po + ' ' + t.plant, dest(t), t.L ? q(t.L) : '-']; }));
  h += '<h3>Unloaded / received today</h3>' + table(['Dispatch', 'Firm', 'Truck', 'At', 'Loaded', 'Unloaded', 'Short', 'Days'], unloaded.map(function (t) { return [t.id, t.firm, t.truck, dest(t), q(t.L), q(t.U), q(t.short), t.trip]; }));
  h += '<h3>Money today</h3>' + table(['What', 'Dispatch / Payment', 'Party', 'Amount'],
    plantPaid.map(function (t) { return ['Supplier paid', t.id, t.plant, money_(t.purTot)]; })
      .concat(frPaid.map(function (t) { return ['Freight paid', t.id, t.transporter, money_(t.netPay)]; }))
      .concat(A.advs.filter(function (a) { return a.date === today; }).map(function (a) { return [Number(a.amount) < 0 ? 'Transporter advance reversed' : 'Transporter advance', a.id + (a.vehicle ? ' / ' + a.vehicle : ''), a.transporter, money_(Number(a.amount || 0))]; }))
      .concat(pays.map(function (p) { return [(Number(p.amount) < 0 || Number(p.deduction) < 0 ? 'Reversed' : 'Received') + (p.deduction ? ' (deduction ' + p.deduction + (p.note ? ': ' + p.note : '') + ')' : ''), p.id + (p.truck ? ' / ' + p.truck : ''), p.buyer, money_(Number(p.amount || 0))]; })));
  var bal = function (map, k) {
    return Object.keys(map).filter(function (id) { return map[id].status !== 'Cancelled' && map[id].status !== 'Settled'; }).map(function (id) {
      var o = map[id], done = sum(live.filter(function (t) { return t[k] === id; }), function (t) { return t.L; });
      return [id, firmOf_(o, A.S), o.plant || o.buyer, q(Number(o.qty || 0)), q(done), q(Number(o.qty || 0) - done)];
    });
  };
  h += '<h3>Purchase orders</h3>' + table(['PO', 'Firm', 'Supplier', 'Ordered', 'Loaded', 'Outstanding'], bal(A.po, 'po'));
  h += '<h3>Sale orders</h3>' + table(['SO', 'Firm', 'Customer', 'Ordered', 'Dispatched', 'Outstanding'], bal(A.so, 'so'));
  var probs = [];
  accs.forEach(function (a) {
    if (a.overdue > 0) probs.push([a.name, a.firm, 'Customer payment overdue ' + money_(a.overdue) + (a.oldest ? ', oldest ' + a.oldest + ' days past credit' : '') + ' · outstanding ' + money_(a.outstanding)]);
  });
  live.forEach(function (t) {
    if (t.L && !t.U && t.detDays > 0) probs.push([t.id, t.truck, 'On the road ' + t.trip + ' days (over the free days: detention claim possible, ' + money_(t.detSuggest) + ' if agreed)']);
    if (t.L && !t.so && !t.plantPO) probs.push([t.id, t.truck, 'Loaded, no customer assigned']);
    if (t.L && t.billQty !== '' && t.billQty != null && Math.abs(Number(t.billQty) - t.L) >= 0.005) probs.push([t.id, t.truck, 'Slip weight ' + q(t.L) + ' but plant bill ' + q(Number(t.billQty))]);
    if (t.noSlip) probs.push([t.id, t.truck, 'No slip photo']);
    if (t.carryLeft > 0) probs.push([t.id, t.truck, 'Advance ' + money_(t.carryLeft) + ' still to adjust on the next trip of this truck']);
  });
  h += '<h3>Needs attention</h3>' + table(['Dispatch / Customer', 'Truck', 'Problem'], probs);
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
  if (!fromTrigger_(e)) return;
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
