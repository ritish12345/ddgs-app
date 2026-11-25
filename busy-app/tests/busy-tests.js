/*
 * RAGHAV BUSY APP: Busy upload tests (never pushed to Apps Script).
 * Part 1: small made-up Busy files (built here as real .xlsx) for every rule.
 * Part 2: the real Busy exports, when they are on this laptop (Downloads\BusyExports\All Busy data\2026-27); skipped otherwise.
 * Real Busy files are never copied into the project or committed.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { makeServer } = require('./fake-gas');
const { openApp, idle, sleep } = require('./browser');

let fails = 0, oks = 0;
const ok = (c, m) => { if (c) { oks++; console.log('  ok    ' + m); } else { fails++; console.log('  FAIL  ' + m); } };
const throws = (fn, re, m) => { try { fn(); ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.message), m + ': ' + e.message.slice(0, 150)); } };

/* ---------- a tiny .xlsx writer (zip + sheet XML), so the tests use real files ---------- */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  Object.keys(files).forEach(name => {
    const data = Buffer.from(files[name], 'utf8'), comp = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, comp); central.push(ch, nm); off += 30 + nm.length + comp.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}
const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xlsx(rows) {
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const body = rows.map((r, ri) => '<x:row r="' + (ri + 1) + '">' + r.map((v, ci) => v === '' || v == null ? '' : typeof v === 'number'
    ? '<x:c r="' + col(ci) + (ri + 1) + '"><x:v>' + v + '</x:v></x:c>' : '<x:c r="' + col(ci) + (ri + 1) + '" t="inlineStr"><x:is><x:t xml:space="preserve">' + xe(v) + '</x:t></x:is></x:c>').join('') + '</x:row>').join('');
  return zip({ 'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' + body + '</x:sheetData></x:worksheet>' }).toString('base64');
}
const CO = 'RAGHAV TRADING AND CO.';
const head = (title, from, to, series) => [[CO], [title], ['Voucher Series : ' + (series || 'All')], ['From ' + from + ' to ' + to]];
const itemLine = (item, qty, rate) => item.padEnd(22) + qty.toFixed(2).padStart(8) + ' QTL   @ ' + rate.toFixed(2).padStart(8) + ' =  ' + (qty * rate).toFixed(2);
/* bills: [date dd-mm-yyyy, no, party, item, qty, rate, gst (0.05), opts {cancelled, gstin, status}] */
function billFile(title, bills, opt) {
  opt = opt || {};
  const H = ['Date', 'Vch/Bill No', 'Account', 'TIN/GSTIN No.', 'Type', 'Total Amount', title === 'Sales Register' ? 'Sale Amount' : 'Purc. Amount', 'Taxable Amt', 'IGST', 'CGST', 'SGST', 'Other Amount', title === 'Sales Register' ? 'Rcpt. Amt.' : 'Pymt. Amt.', 'Status'];
  const rows = head(title, opt.from || '01-04-2026', opt.to || '25-11-2026', opt.series).concat([H]);
  let tot = 0;
  bills.forEach(b => {
    const o = b[7] || {};
    if (o.cancelled) { rows.push([b[0], b[1], '(C A N C E L L E D) - ' + b[2], '', 'Local-TaxIncl.']); rows.push(['', '', 'DATA ENTRY MISTAKE']); return; }
    const tx = Math.round(b[4] * b[5] * 100) / 100, g = Math.round(tx * (b[6] == null ? 0.05 : b[6]) * 100) / 100, total = Math.round(tx + g);
    tot += total;
    rows.push([b[0], b[1], b[2], o.gstin || '03AAAAA0000A1Z5', 'Local-TaxIncl.', total, tx, tx, '', g / 2, g / 2, '', '', o.status || 'N/A']);
    if (!opt.noItems) rows.push(['', '', itemLine(b[3], b[4], b[5])]);
    rows.push(['', '', '    + CGST                    @        2.50 % =  ' + (g / 2).toFixed(2)]);
    rows.push(['', '', '    + SGST                    @        2.50 % =  ' + (g / 2).toFixed(2)]);
    rows.push(['', '', ' **** Total Qty. = ' + b[4].toFixed(2) + ' QTL   : Amt. = ' + total + ' ****']);
  });
  rows.push(['Total', '', '', '', '', opt.badTotal ? tot + 999 : tot]);
  return { name: title.replace(/ /g, '') + '.xlsx', b64: xlsx(rows) };
}
/* Dr/Cr registers: vouchers = [date, no, [[account, dr, cr], ...]] */
function drcrFile(title, vouchers, opt) {
  opt = opt || {};
  const rows = head(title, '1-4-2026', '25-11-2026').concat([['Date', 'Vch/Bill No', 'Account', 'Debit(Rs.)', 'Credit(Rs.)']]);
  let d = 0, c = 0;
  vouchers.forEach(v => v[2].forEach((l, i) => { rows.push([i ? '' : v[0], i ? '' : v[1], l[0], l[1] || '', l[2] || '']); d += l[1] || 0; c += l[2] || 0; }));
  rows.push(['Total', '', '', d, c]);
  return { name: title.replace(/ /g, '') + '.xlsx', b64: xlsx(rows) };
}
const rowsOf = (s, tab) => { const sh = s.store.sheet(tab); if (!sh) return []; const d = sh.dump(), H = d[0]; return d.slice(1).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o; }); };
const ymd = d => d.split('-').reverse().join('-');

function newServer() {
  const s = makeServer();
  s.store.activeEmail = s.store.ownerEmail;
  s.run('api_authState');
  const own = s.run('api_createOwner', 'nidhish23', 'Nitish', 'secret1').token;
  s.store.activeEmail = '';
  s.run('api_saveUser', own, { _new: true, id: 'keshav12', name: 'Keshav', role: 'Accounts', password: 'secret2', active: true });
  s.run('api_saveUser', own, { _new: true, id: 'vineet12', name: 'Vineet', role: 'Dispatch', password: 'secret3', active: true });
  s.run('api_saveUser', own, { _new: true, id: 'view1', name: 'Viewer', role: 'Viewer', password: 'secret4', active: true });
  return { s, own, acc: s.run('api_login', 'keshav12', 'secret2').token, dis: s.run('api_login', 'vineet12', 'secret3').token, vw: s.run('api_login', 'view1', 'secret4').token };
}

console.log('1. Grouping bills into orders (party + item + exact rate; a gap of more than 15 days starts a new order)');
{
  const { s, own } = newServer();
  const sales = billFile('Sales Register', [
    ['12-05-2026', 'S1', 'GODREJ AGROVET LIMITED', 'DDGS', 300, 2750], // order 1
    ['13-05-2026', 'S2', 'GODREJ AGROVET LIMITED', 'DDGS', 310, 2850], // order 2 (other rate)
    ['14-05-2026', 'S3', 'GODREJ AGROVET LIMITED', 'DDGS', 320, 2750], // back to order 1 (2 days after S1)
    ['29-05-2026', 'S4', 'GODREJ AGROVET LIMITED', 'DDGS', 330, 2750], // 15 days after S3: still order 1
    ['14-06-2026', 'S5', 'GODREJ AGROVET LIMITED', 'DDGS', 340, 2750], // 16 days after S4: new order
    ['12-08-2026', 'S6', 'GODREJ AGROVET LIMITED', 'DDGS', 350, 2750], // months later: new order
    ['12-08-2026', 'S7', 'AMAN FEED INDUSTRIES', 'DDGS', 360, 2750], // other party: own order
    ['12-08-2026', 'S8', 'AMAN FEED INDUSTRIES', 'DDGS DOC- MAIZE', 370, 2750] // other item: own order
  ]);
  const r = s.run('api_busyUpload', own, [sales], false);
  const so = rowsOf(s, 'APP_SO').filter(o => o['Source'] === 'Busy');
  const by = id => so.find(o => o['SO ID'] === id);
  ok(so.length === 6, '8 bills make 6 sale orders (' + so.length + ')');
  const g = so.filter(o => /GODREJ/.test(o['Customer'])).map(o => [o['SO ID'], String(o['SO Date']).slice(0, 10), o['Rate ex-GST'], o['Quantity (qtl)']].join(' '));
  ok(g[0] === 'SO-0001 2026-05-12 2750 950', 'his example: 2750 @ Godrej 12-05 = SO-0001, with 14-05 and 29-05 (gap 15 days): 300 + 320 + 330 = 950 qtl (' + g[0] + ')');
  ok(g[1] === 'SO-0002 2026-05-13 2850 310', '2850 @ Godrej 13-05 = SO-0002 (' + g[1] + ')');
  ok(g[2] === 'SO-0003 2026-06-14 2750 340', '16 days after the last 2750 bill: a new order SO-0003 (' + g[2] + ')');
  ok(g[3] === 'SO-0006 2026-08-12 2750 350', '2750 again in August: a new order (SO-0006: the two Aman orders of the same day come first, by name) (' + g[3] + ')');
  ok(so.filter(o => /AMAN/.test(o['Customer'])).length === 2, 'another party or another item is its own order');
  ok(by('SO-0001')['Status'] === 'Settled' && by('SO-0006')['Status'] === '', 'orders quiet for over 15 days before the newest bill are short-closed; recent ones stay open');
  ok(by('SO-0001')['GST In Rate'] === 'excl' && by('SO-0001')['Freight Terms'] === 'ours' && by('SO-0001')['Credit Days'] === 7, 'sale orders from Busy: rate before GST, we pay freight, 7 days credit');
  ok(r.busy.files[0].added === 8 && /Total row/.test(r.busy.files[0].check), 'the upload reports 8 new bills and the Total-row check');
  const tr = rowsOf(s, 'APP_TRUCKS');
  ok(tr.length === 8 && tr.every(t => t['Match'] === 'Sale bill only' && /^PO-\d+-NO$/.test(t['PO ID'])), 'sale bills without purchase bills: 8 trucks on "NO PURCHASE BILL" POs');
}

console.log('2. Same truck: purchase bill + sale bill of the same weight, a few days apart; returns; wet cake kept apart');
{
  const { s, own } = newServer();
  const purc = billFile('Purchase Register', [
    ['05-11-2026', 'BCL/1', 'BCL INDUSTRIES LIMITED', 'DDGS DOC- MAIZE', 355.9, 2371],
    ['05-11-2026', 'BCL/2', 'BCL INDUSTRIES LIMITED', 'DDGS DOC- MAIZE', 400.0, 2371],
    ['06-11-2026', 'BCL/3', 'BCL INDUSTRIES LIMITED', 'DDGS DOC- MAIZE', 300.0, 2371],
    ['07-11-2026', 'OM/1', 'OM SONS MARKETING PVT LTD', 'WET CAKE', 312.7, 630],
    ['07-11-2026', 'OM/2', 'OM SONS MARKETING PVT LTD', 'DDGS', 341.3, 2800]
  ]);
  const sales = billFile('Sales Register', [
    ['06-11-2026', '101', 'AMAN FEED INDUSTRIES', 'DDGS DOC- MAIZE', 355.9, 2523.81], // pairs with BCL/1 (+1 day)
    ['09-11-2026', '102', 'AMAN FEED INDUSTRIES', 'DDGS DOC- MAIZE', 400.0, 2523.81], // BCL/2 + 4 days: still pairs
    ['11-11-2026', '103', 'AMAN FEED INDUSTRIES', 'DDGS DOC- MAIZE', 300.0, 2523.81], // BCL/3 + 5 days: too late
    ['08-11-2026', '104', 'CASH', 'WET CAKE', 100, 714.29], // wet cake: only on the Wet cake page
    ['07-11-2026', '105', 'SHREE RAM SOLVEX.', 'DDGS', 341.3, 3000], // pairs with OM/2
    ['07-11-2026', '106', 'SHREE RAM SOLVEX.', 'DDGS', 341.3, 3000] // the same bill again, returned whole below
  ]);
  const sret = (() => {
    const rows = head('Sales Return Register', '01-04-2026', '25-11-2026').concat([['Date', 'Vch/Bill No', 'Account', 'Type', 'Total Amount', 'Sale Amount', 'Taxable Amt', 'IGST', 'CGST', 'SGST', 'Other Amount']]);
    const tx = Math.round(341.3 * 3000 * 100) / 100, total = Math.round(tx * 1.05);
    rows.push(['08-11-2026', 'SR-1', 'SHREE RAM SOLVEX.', 'Local-TaxIncl.', total, tx, tx, '', tx * 0.025, tx * 0.025, '']);
    rows.push(['09-11-2026', 'SR-2', 'AMAN FEED INDUSTRIES', 'Local-TaxIncl.', 5000, 4761.9, 4761.9, '', 119.05, 119.05, '']); // part: a deduction
    rows.push(['Total', '', '', '', total + 5000]);
    return { name: 'SalesReturn.xlsx', b64: xlsx(rows) };
  })();
  const r = s.run('api_busyUpload', own, [purc, sales, sret], false);
  const tr = rowsOf(s, 'APP_TRUCKS'), find = (pb, sb) => tr.find(t => String(t['Supplier Invoice No']) === pb && String(t['Sale Bill No']) === sb);
  ok(!!find('BCL/1', '101') && !!find('BCL/2', '102'), 'same weight, sale 1 and 4 days after the purchase: one truck each');
  ok(!!tr.find(t => String(t['Supplier Invoice No']) === 'BCL/3' && !t['Sale Bill No']) && !!tr.find(t => String(t['Sale Bill No']) === '103' && !t['Supplier Invoice No']), 'a sale 5 days after the purchase is not the same truck (purchase only + sale only)');
  ok(!!find('OM/2', '105') && !tr.some(t => String(t['Sale Bill No']) === '106'), 'a sale bill returned whole (same party, same total) is left out; its twin pairs');
  ok(!tr.some(t => /OM\/1/.test(t['Supplier Invoice No']) || String(t['Sale Bill No']) === '104'), 'wet cake bills make no trucks');
  const po = rowsOf(s, 'APP_PO'), so = rowsOf(s, 'APP_SO');
  ok(!po.concat(so).some(o => o['Commodity'] === 'WET CAKE'), 'wet cake makes no orders');
  const wet = rowsOf(s, 'BUSY_WETCAKE');
  ok(wet.length === 2 && wet.some(w => w['What'] === 'Purchase' && w['Qty'] === 312.7) && wet.some(w => w['What'] === 'Sale' && w['Qty'] === 100), 'both wet cake bills are on the Wet cake tab');
  const t1 = find('BCL/1', '101');
  ok(t1['Dispatch Wt (qtl)'] === 355.9 && t1['Received Wt (qtl)'] === 355.9 && String(t1['Unload Date']).slice(0, 10) === '2026-11-06' && t1['Freight Paid'] === true, 'a paired truck: dispatch = purchase bill, received = sale bill (date), freight done in Busy');
  const pays = rowsOf(s, 'APP_PAYMENTS');
  ok(pays.length === 1 && pays[0]['Deduction'] === 5000 && /Sales return SR-2/.test(pays[0]['Note']), 'a part return is a deduction on the customer (' + pays.length + ' line)');
  ok(r.busy.info.returned === 1 && r.busy.info.pairs === 3, 'the upload says: 3 pairs, 1 bill returned whole');
}

console.log('3. Files that are refused, with a plain message');
{
  const { s, own, acc, dis, vw } = newServer();
  const good = billFile('Sales Register', [['06-11-2026', '1', 'AMAN FEED INDUSTRIES', 'DDGS', 300, 2500]]);
  throws(() => s.run('api_busyUpload', own, [billFile('Sales Register', [['06-11-2026', '1', 'AMAN', 'DDGS', 300, 2500]], { series: 'Main' })], false), /Voucher Series = All/, 'a register exported for one voucher series');
  throws(() => s.run('api_busyUpload', own, [billFile('Sales Register', [['06-11-2026', '1', 'AMAN', 'DDGS', 300, 2500]], { badTotal: 1 })], false), /Total row/, 'a file whose Total row is not what was read');
  throws(() => s.run('api_busyUpload', own, [billFile('Sales Register', [['06-11-2026', '1', 'AMAN', 'DDGS', 300, 2500]], { noItems: 1 })], false), /Show Items Details/, 'sales without item lines');
  throws(() => s.run('api_busyUpload', own, [drcrFile('Journal Register', [['05-11-2026', '', [['FREIGHT (DDGS ) WITH IN STATE', 1000, 0], ['UPPAL TRANSPORT COMPANY', 0, 900]]]])], false), /not balance/, 'a journal entry where Debit is not Credit');
  const other = JSON.parse(JSON.stringify(good)); other.b64 = xlsx([['DEVAN TRADING'], ['Sales Register'], ['Voucher Series : All'], ['From 01-04-2026 to 25-11-2026'], ['Date', 'Vch/Bill No', 'Account', 'Total Amount'], ['Total', '', '', 0]]);
  throws(() => s.run('api_busyUpload', own, [other], false), /is from "DEVAN TRADING"/, 'a file of another Busy company');
  throws(() => s.run('api_busyUpload', own, [{ name: 'photo.xlsx', b64: Buffer.from('not a zip').toString('base64') }], false), /not an Excel/, 'a file that is not Excel');
  throws(() => s.run('api_busyUpload', own, [good, good], false), /both Sales Register/, 'the same register twice in one upload');
  throws(() => s.run('api_busyUpload', dis, [good], false), /not allowed/, 'Dispatch cannot upload');
  throws(() => s.run('api_busyUpload', vw, [good], false), /not allowed/, 'Viewer cannot upload');
  ok(s.run('api_busyUpload', acc, [good], false).busy.files[0].added === 1, 'Accounts can upload');
  ok(!s.store.sheet('APP_TRUCKS') || rowsOf(s, 'APP_TRUCKS').length === 1, 'refused files changed nothing');
}

console.log('4. Upload again: no double counting; what staff typed is kept; Busy changes follow; nothing deleted');
{
  const { s, own, acc, dis } = newServer();
  const purc = [['05-11-2026', 'P1', 'BCL INDUSTRIES LIMITED', 'DDGS', 355.9, 2371], ['06-11-2026', 'P2', 'BCL INDUSTRIES LIMITED', 'DDGS', 300, 2371]];
  const sale = [['06-11-2026', '101', 'AMAN FEED INDUSTRIES', 'DDGS', 355.9, 2523.81, 0.05, { gstin: '=HYPERLINK("x")' }], ['07-11-2026', '102', 'AMAN FEED INDUSTRIES', 'DDGS', 300, 2523.81]];
  const rcpt = v => drcrFile('Receipt Register', [['10-11-2026', '', [['AMAN FEED INDUSTRIES', 0, v], ['IDFC FIRST BANK', v, 0]]]]);
  const jr = drcrFile('Journal Register', [['08-11-2026', '', [['FREIGHT (DDGS ) WITH IN STATE', 30000, 0], ['UPPAL TRANSPORT COMPANY', 0, 29700], ['TDS ON FREIGHT PAYABLE', 0, 300]]]]);
  const pay = drcrFile('Payment Register', [['09-11-2026', '', [['UPPAL TRANSPORT COMPANY', 29700, 0], ['IDFC FIRST BANK', 0, 29700]]], ['10-11-2026', '', [['BCL INDUSTRIES LIMITED', 886031, 0], ['IDFC FIRST BANK', 0, 886031]]]]);
  const files = [billFile('Purchase Register', purc), billFile('Sales Register', sale), rcpt(500000), jr, pay];
  s.run('api_busyUpload', own, files, false);
  const before = s.store.sheet('APP_LOG').getLastRow();
  const again = s.run('api_busyUpload', own, files, false);
  ok(again.busy.files.every(f => f.added + f.changed + f.gone === 0) && /POs 0 new, 0 changed.*trucks 0 new, 0 changed.*customer money 0 new lines.*transporter accounts 0 new lines/.test(again.busy.built), 'the same files again: nothing changes');
  ok(rowsOf(s, 'APP_LOG').slice(before - 1).every(l => /Busy upload|Busy build/.test(l['Action'])), '...and only the upload itself is logged');
  const t = rowsOf(s, 'APP_TRUCKS').find(x => String(x['Supplier Invoice No']) === 'P1');
  const tp2 = rowsOf(s, 'APP_TRUCKS').find(x => String(x['Supplier Invoice No']) === 'P2');
  ok(t['Supplier Paid'] === true && String(t['Supplier Paid Date']).slice(0, 10) === '2026-11-10' && tp2['Supplier Paid'] === false, 'supplier paid: the BCL payment (8,86,031) covers its oldest bill P1 (paid on 10-11), not P2');
  ok(rowsOf(s, 'BUSY_VOUCHERS').some(v => v['GSTIN'] === '=HYPERLINK("x")'), 'text that looks like a formula stays text');
  // staff add what Busy does not have (the Owner, as Busy trucks are closed history)
  s.run('api_saveTruck', own, { id: t['Dispatch No.'], truck: 'PB 10 AB 1234', transporter: 'Uppal Transport Company', frate: 85, note: 'checked' });
  // Busy: the sale bill weight corrected, the receipt changed, a purchase bill deleted
  const sale2 = [['06-11-2026', '101', 'AMAN FEED INDUSTRIES', 'DDGS', 355.86, 2523.81, 0.05, { gstin: '=HYPERLINK("x")' }]];
  const third = s.run('api_busyUpload', own, [billFile('Purchase Register', purc.slice(0, 1)), billFile('Sales Register', sale2), rcpt(450000)], false);
  const t2 = rowsOf(s, 'APP_TRUCKS').find(x => x['Dispatch No.'] === t['Dispatch No.']);
  ok(t2['Vehicle No'] === 'PB10AB1234' && t2['Transporter'] === 'UPPAL TRANSPORT COMPANY' && t2['Freight Rate'] === 85 && /checked/.test(t2['Note']), 'a re-upload keeps the vehicle no., transporter, freight rate and note typed in the app');
  ok(t2['Received Wt (qtl)'] === 355.86 && t2['Sale Bill Qty'] === 355.86, 'a weight changed in Busy (355.90 → 355.86, still the same truck) is changed on the truck');
  const gone = rowsOf(s, 'APP_TRUCKS').find(x => String(x['Supplier Invoice No']) === 'P2');
  ok(gone['Status'] === 'Cancelled' && /not in Busy any more/.test(gone['Note']), 'a truck whose bills left Busy is cancelled, not deleted');
  ok(rowsOf(s, 'BUSY_VOUCHERS').some(v => String(v['Vch/Bill No']) === 'P2' && v['In Busy'] === 'Not in Busy any more'), 'the Busy bill itself is kept, marked "Not in Busy any more"');
  const pays = rowsOf(s, 'APP_PAYMENTS');
  ok(pays.length === 3 && pays.some(p => p['Amount Received'] === -500000 && /Reversal of PAY-00001: (changed in Busy|not in Busy any more)/.test(p['Note'])) && pays.some(p => p['Amount Received'] === 450000),
    'a receipt changed in Busy: the old line is reversed by a minus line and the new amount added (' + pays.map(p => p['Amount Received']).join(', ') + ')');
  throws(() => s.run('api_reversePayment', own, 'PAY-00002', 'test'), /comes from Busy/, 'a Busy money line cannot be reversed by hand');
  ok(third.busy.files.some(f => f.gone === 1), 'the upload reports the bill that left Busy');
  const adv = rowsOf(s, 'APP_ADVANCES');
  ok(adv.length === 2 && adv.reduce((x, a) => x + a['Amount'], 0) === 0 && adv.some(a => a['Amount'] === -29700 && /freight booked/.test(a['Note'])), 'transporter account: freight booked (minus) and paid (plus) → left 0');
  const D = s.run('api_getData', dis);
  ok(D.trucks.every(x => !('bPAmt' in x) && !('bSAmt' in x)), 'Dispatch does not get the Busy amounts');
  s.run('api_saveTruck', own, { id: t['Dispatch No.'], bPKey: 'X', src: 'App' });
  ok(rowsOf(s, 'APP_TRUCKS').find(x => x['Dispatch No.'] === t['Dispatch No.'])['Source'] === 'Busy', 'the Busy keys cannot be changed by a truck save');
}

console.log('5. More than 10% of a period gone: only the Owner can upload it');
{
  const { s, own, acc } = newServer();
  const many = Array.from({ length: 12 }, (_, i) => ['0' + (1 + (i % 9)) + '-10-2026', 'B' + i, 'AMAN FEED INDUSTRIES', 'DDGS', 300 + i, 2500]);
  s.run('api_busyUpload', own, [billFile('Sales Register', many)], false);
  const half = billFile('Sales Register', many.slice(0, 6));
  throws(() => s.run('api_busyUpload', acc, [half], true), /^CONFIRM\|.*6 of the 12/, 'Accounts: refused, even with confirm');
  throws(() => s.run('api_busyUpload', own, [half], false), /^CONFIRM\|/, 'Owner without confirm: asked first');
  ok(s.run('api_busyUpload', own, [half], true).busy.files[0].gone === 6, 'Owner with confirm: uploaded, 6 marked "Not in Busy any more"');
}

/* ---------- Part 2: the real Busy exports (only on this laptop) ---------- */
const REAL = 'C:/Users/vansh/Downloads/BusyExports/All Busy data/2026-27';
(async function () {
  if (!fs.existsSync(REAL)) { console.log('6. Real Busy files: not on this computer, skipped'); return done(); }
  console.log('6. The real Busy files (2026-27)');
  const { s, own, acc } = newServer();
  const files = fs.readdirSync(REAL).filter(f => /\.xlsx$/i.test(f) && f.indexOf('~$') !== 0).map(f => ({ name: f, b64: fs.readFileSync(path.join(REAL, f)).toString('base64') }));
  ok(files.length === 11, '11 files');
  const t0 = Date.now(), r = s.run('api_busyUpload', own, files, false);
  const got = {}; r.busy.files.forEach(f => { got[f.regName] = f.vouchers; });
  ok(JSON.stringify(got) === JSON.stringify({ 'Sales Register': 643, 'Purchase Register': 512, 'Sales Return Register': 35, 'Purchase Return Register': 18, 'Credit Note Register': 87, 'Debit Note Register': 23,
    'Receipt Register': 355, 'Payment Register': 770, 'Journal Register': 337, 'Contra Register': 18, 'Cash/Bank Book': 437 }), 'every register read in full: ' + JSON.stringify(got));
  ok(r.busy.files.every(f => /Total row/.test(f.check)), 'each file\u2019s own Total row = what was read; every journal / payment / receipt / contra entry Dr = Cr');
  console.log('        ' + r.busy.built + ' (' + (Date.now() - t0) + ' ms here)');
  const A = s.run('deriveAll_'), T = A.trucks;
  ok(Object.keys(A.po).length === 85 && Object.keys(A.so).length === 83, 'orders: 85 purchase (83 + 2 "no purchase bill") and 83 sale');
  ok(T.length === 432 && r.busy.info.pairs === 411 && r.busy.info.saleOnly === 13 && r.busy.info.purchaseOnly === 8, 'trucks: 432 = 411 pairs + 13 sale only + 8 purchase only (' + JSON.stringify(r.busy.info) + ')');
  ok(T.every(t => !t.bSAmt || Math.abs(t.saleTot - t.bSAmt) <= 5), 'every truck\u2019s sale total = its Busy sale bill (to ₹5)');
  ok(T.filter(t => t.bPAmt && Math.abs(t.purTot - t.bPAmt) > 5).length <= 1, 'purchase totals = the Busy bills (one Om Sons bill has TCS on top)');
  ok(!Object.values(A.po).concat(Object.values(A.so)).some(o => o.commodity === 'WET CAKE'), 'no wet cake in orders or trucks');
  ok(Math.abs(A.tadv['RAGHAV TRADING AND COMPANY|SHREE BALAJI TRANSPORT MUNISH'].left) < 0.01, 'SHREE BALAJI TRANSPORT MUNISH: booked 31,65,671 = paid → 0');
  ok(!Object.keys(A.tadv).some(k => /HARYANA TRANSPORT|FREIGHT PAYABLE/.test(k)), 'wet cake transporters are not in the transporter accounts');
  ok(T.filter(t => t.st === 6).length >= 420, 'paired and sale-only trucks are closed history (' + T.filter(t => t.st === 6).length + ')');
  const again = s.run('api_busyUpload', own, files, false);
  ok(again.busy.files.every(f => f.added + f.changed + f.gone === 0) && /POs 0 new, 0 changed, 0 cancelled · SOs 0 new, 0 changed, 0 cancelled · trucks 0 new, 0 changed, 0 cancelled · customer money 0 new lines · transporter accounts 0 new lines/.test(again.busy.built), 'the same 11 files again: no change');
  // the screen, in a simulated browser: every Busy page and the usual pages open without errors
  const errs = [];
  const W = openApp(s, own, {}, m => errs.push(m));
  await idle(W, 20000);
  for (const v of ['home', 'pos', 'sos', 'dispatch', 'receivables', 'freight', 'advances', 'reports', 'closed', 'busy', 'transport', 'wetcake', 'gaps']) {
    W.win.go(v); await sleep(60); await idle(W, 20000); W.win.render();
    const txt = W.$('#view').textContent;
    ok(txt.length > 50 && !/Loading…$/.test(txt.trim()) && !errs.length, 'page "' + v + '" shows' + (errs.length ? ' — error: ' + errs[0] : ''));
  }
  W.win.go('gaps'); await idle(W, 20000); W.win.render();
  ok(/Customer and supplier at once \(4\)/.test(W.$('#view').textContent), 'Gaps lists the 4 parties that are customer and supplier at once');
  W.win.go('truck', T.find(t => t.bMatch === 'Pair').id); await sleep(30); W.win.render();
  ok(/From Busy/.test(W.$('#view').textContent) && /Purchase bill/.test(W.$('#view').textContent), 'a truck page shows its Busy bills');
  const tabs = W.$$('#nav button').map(b => b.dataset.tab);
  ok(['busy', 'transport', 'wetcake', 'gaps'].every(t => tabs.indexOf(t) >= 0), 'Owner sees the Busy, Transport, Wet cake and Gaps tabs');
  const V = openApp(s, s.run('api_login', 'view1', 'secret4').token, {}, m => errs.push(m));
  await idle(V, 20000);
  ok(!V.$$('#nav button').some(b => ['busy', 'transport', 'wetcake', 'gaps'].indexOf(b.dataset.tab) >= 0), 'Viewer does not see the Busy pages');
  done();
})().catch(e => { console.log('CRASH', e && e.stack || e); fails++; done(); });

function done() {
  console.log('\nBusy tests: ' + oks + ' ok, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}
