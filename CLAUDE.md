# CLAUDE.md – RAGHAV BUSY APP (rules for Claude)

Read this file fully before doing any work in this folder.

## 0. This is the BUSY app, not the DDGS app (read first)
- **RAGHAV BUSY APP** = a full copy of the DDGS Trade Control app (copied from `ddgs-app` main `a0ec10f`, 25-11-2026),
  with its **own Apps Script project and its own Google Sheet "RAGHAV BUSY APP"**, filled from Busy exports (section 3a).
  Everything in sections 1–8 below is the DDGS app's rules: they apply here too, except where section 0 / 3a says otherwise.
- **This app's own Google Sheet "RAGHAV BUSY APP"**: id `1_PW9EcKzVsHfP-s7PQa3B7KW-sK4PU534x7pjkssr2c`
  (https://docs.google.com/spreadsheets/d/1_PW9EcKzVsHfP-s7PQa3B7KW-sK4PU534x7pjkssr2c/edit).
  Script id `1uedyKQhl4U3AnxLxpO3tQdJF7i3TezKHkQuutGPA08U7KuQHkTNgKsHl` (in `busy-app/.clasp.json`).
  Test link (/dev, HEAD deployment `AKfycbxms48d-YdJ2LmYqiPaxgrHj1DvqnHlMBaheEPcVJH_`):
  https://script.google.com/macros/s/AKfycbxms48d-YdJ2LmYqiPaxgrHj1DvqnHlMBaheEPcVJH_/dev
  Live link: not made yet (made with `clasp deploy` from this folder only when Nitish says OK; then write its id here).
- **clasp searches parent folders**: without `busy-app/.clasp.json`, clasp run here would use the DDGS app's `.clasp.json`
  one folder up (it then pushes `..\Code.js`). Never delete `busy-app/.clasp.json`; run `clasp show-file-status` first:
  it must list `Code.js`, not `..\Code.js`.
- Folder: `ddgs-app/busy-app` (its own git repo, branch `main` / work branches). The DDGS app's `.clasp.json` must
  **never** come into this folder: `clasp push` / `clasp deploy` from here must only reach the Busy app's own script.
  Check `.clasp.json` here before any clasp command (its scriptId is NOT the DDGS one). The DDGS sheet/deployment ids in
  section 2 are the DDGS app's: never deploy to them from here.
- Differences from the DDGS app (all in `Code.js` / `Index.html`, marked "RAGHAV BUSY APP" / "Busy"):
  - Busy upload + builder (`busy*_`, `api_busyUpload`, `api_busy`), tabs `BUSY_UPLOADS`, `BUSY_VOUCHERS`, `BUSY_ITEMS`,
    `BUSY_LINES` (raw Busy data, never deleted), `BUSY_TRANSPORT`, `BUSY_WETCAKE` (rebuilt views).
  - Busy columns at the END of `APP_PO`, `APP_SO`, `APP_TRUCKS`, `APP_PAYMENTS`, `APP_ADVANCES` (SCHEMA_V `7.1-busy1`).
  - Pages Busy, Transport, Wet cake, Gaps (roles with `busy`: Owner, Accounts). Truck and order pages show their Busy bills.
  - Settings: `dailyReport` / `weeklyBackup` (default **no**: no double 9 pm email), `busyCompany`, `busyFirm`, `busyGapDays`,
    `busyPairQty`, `busyPairBefore`, `busyPairAfter`, `busyWetCakeItems`, `busyWetCakeAccounts`; company `RAGHAV BUSY APP`.
  - Drive folders `RAGHAV BUSY APP Exports / Slips / Backups` (kept apart from the DDGS app's).
  - New rows grow the sheet first (`ensureRows_`): Sheets refuses writing past its last grid row (the Busy tabs have ~6,000 rows).
- Tests: `cd tests && npm test` (all the DDGS tests, adjusted only for the Busy additions, + `busy-tests.js`). Old DDGS commits for
  the comparison tests are read from the `ddgs-app` repo (parent folder). `busy-tests.js` also runs the real exports in
  `Downloads\BusyExports\All Busy data\2026-27` when present. **Real Busy files are never copied into this folder or committed**
  (`.gitignore` has `*.xlsx`).

## 1. Who and what
- Owner: **Nitish** (login `nidhish23`). DDGS trading business. He is also a developer, but explain things simply and briefly.
- DDGS is bought from ethanol plants (BCL, Oasis Ethanol, MG Petrochem…) and sold to feed factories (Godrej Agrovet Khana, Jupiter by Khana Feed, Aman Feed Khana, King Food Malerkotla, Ahuja Industries…) or sent to his own plant **Shree Ram Solvex**.
- Firms: Raghav Trading and Company (main seller), Devan Trading and Company, Saraswati Solvex, Jai Mahavir Trading and Company, Shree Ram Solvex (own plant, its own app). **Since 24-11-2026 Raghav, Devan, Saraswati and Jai Mahavir each do their own business in this app**: setting `firms`; buttons at the top (All · Raghav · Devan · Saraswati · Jai Mahavir, remembered per phone) switch the "window"; each PO/SO is in one firm and its trucks follow the PO; a truck's SO must be in the same firm as its PO (selling to another of your firms = an SO whose customer is that firm). One numbering for all firms. Everyone sees all firms. "Booked in the name of" is no longer used (old values stay in the sheet).
- Staff: Keshav (`keshav12`, Accounts), Mohit (`mohit12`, Accounts), Vineet (`vineet12`, Dispatch). Up to ~50 trucks a day.
- **Accounting stays in Busy** (sale invoice + e-invoice + e-way bill, purchase bills, ledgers, GST). This app does NOT do accounting. Zoho is not used.

## 2. What this app is
- A **Google Apps Script web app** bound to the Google Sheet **RAGHAV DDGS APP**
  (sheet id `1gZND6UhbP8JvOCXMB50_e3tGsxg71wTuanRp5gQyzPM`).
- Live link (deployment id `AKfycbwkMGpJFppRvc4R3fPReCO5UfXuwAFAqcxLqN87zDuqKNijy7Q1_v6Wug2MnorJkl0STA`):
  https://script.google.com/macros/s/AKfycbwkMGpJFppRvc4R3fPReCO5UfXuwAFAqcxLqN87zDuqKNijy7Q1_v6Wug2MnorJkl0STA/exec
- Files here (synced with `clasp`):
  - `Code.js` – server code. `doGet` serves the screen; staff actions call `api_*` functions through `google.script.run`.
  - `Index.html` – the screen (HTML, CSS and screen code). `doGet` serves it. (The old one-file `INDEX_HTML` string is gone.)
  - `appsscript.json` – manifest (timezone Asia/Kolkata; web app executes as owner).
  - `.claspignore` – only `Code.js`, `Index.html`, `appsscript.json` are pushed. `tests/` stays local (see section 5).
- Data lives in sheet tabs: `APP_PO`, `APP_SO`, `APP_TRUCKS`, `APP_LOG`, `APP_SETTINGS`, `APP_USERS`, `APP_PAYMENTS`, `APP_NOTES` (+ any added later). Column lists are in `SCHEMA` in `Code.js`.
- Old tabs (`MASTER PO`, `SALE ORDER `, `DISPATCH`, `SALE `, `Freight`, Gemini dashboard) are history only; the app imported them once.
- Roles (`ROLES` in Code.js): **Owner** everything; **Accounts** money, no users/profit/closed-truck edits; **Dispatch** trucks only, no money (money fields are stripped on the server); **Viewer** read only.
- Every change is written to `APP_LOG` (time, user, action, record, old → new).

## 3a. Busy → app (Nitish, 25-11-2026)
- Upload: Busy page → choose the Excel registers (Sales, Purchase, Sales Return, Purchase Return, Credit Note, Debit Note, Payment,
  Receipt, Journal, Contra, Cash/Bank Book). Owner/Accounts. All files are read and checked first, then saved in one locked call.
  Refused with a plain message: another Busy company (`busyCompany`), not a register, Voucher Series not All, no period, Total row ≠
  what was read, an entry with Dr ≠ Cr, Sales/Purchase without item lines, same register twice. A file replaces its register for
  its own period; same file twice = no change; if more than 10% of a period's entries would leave, only the Owner can confirm.
- Raw: every voucher / item line / Dr-Cr line kept as Busy gave it; an entry no longer in Busy is marked "Not in Busy any more".
- Orders: bills (not cancelled, not wet cake, qty > 0) of the same party + item + exact rate; a gap of more than `busyGapDays`
  (15) days since that rate's previous bill starts a new order (his example: 2750 Godrej 12-05 = one, 2850 13-05 = another,
  2750 12-08 = a new one). Qty = the bills' total. Status Settled when the last bill is over 15 days before the newest Busy bill.
  Sale orders: rate before GST (`excl`), we pay freight (`ours`), credit days = defaultCreditDays (Owner can change).
- Trucks: a purchase line and a sale line of the same weight (±`busyPairQty` 0.05 qtl), the sale 3 days before .. 4 days after
  the purchase; nearest date wins. A bill without a partner is a truck on its own (sale only: on a "NO PURCHASE BILL" PO, rate 0).
  A bill returned whole (same party, same total, on or after the bill) is left out (the re-bill counts). Imported trucks:
  dispatch = purchase bill, received = sale bill (qty, date), freight done in Busy (closed). Supplier paid = the supplier's
  Busy payments + debit notes + returns cover its bills oldest first, or Busy status Cleared (Busy's "Pending" is not kept bill
  by bill, so it is only shown).
- Customer money (APP_PAYMENTS, per firm `busyFirm` + customer): receipts, refunds, credit notes, part returns, debit notes,
  journals of customers with DDGS sales. A party that is also a supplier keeps payments/journals on the supplier side; the Gaps
  page shows their one Busy account (Busy has one account per party).
- Transporters (APP_ADVANCES lines + BUSY_TRANSPORT): freight booked by journal (FREIGHT … Dr / transporter Cr, with TDS) = minus,
  payments = plus, moves between vehicle accounts ±. Left = paid − booked (minus = we owe). Vehicle accounts ("PB29R7103 GURJIT")
  are split into vehicle + name.
- Wet cake (`busyWetCakeItems`, `busyWetCakeAccounts`): only in BUSY_WETCAKE / Wet cake page (bills, receipts of wet-cake-only
  customers, payments to wet-cake-only suppliers, wet cake freight). Never in orders, trucks, Receivables or Advances.
- Re-upload: Busy fields follow Busy (`BUSY_OWN_`); fields staff typed are never overwritten (vehicle, transporter, driver,
  freight rate, advance, slip, placed on, notes, photos, UTRs). Busy can mark a supplier paid, never unpaid. A vanished order /
  truck → Cancelled "not in Busy any more"; a changed or vanished money line → reversed by a minus line + the new line. Busy money
  lines cannot be reversed by hand. Opening balances of last year are not in these files (balances start 01-04-2026).

## 3. Business rules (do not change without Nitish saying so)
- **Weights:** slips are in kg (5 digits, e.g. 38450) or quintal (e.g. 384.50). Store quintals. ≥1000 typed = kg ÷ 100.
- **Dispatch date** = date the truck left the plant (date out on the slip), not the placement date.
- **Purchase** = dispatch weight × PO rate × (1 + GST).
- **Sale** = received weight (or dispatch weight until received) × SO rate; SO says if GST is included and who pays freight. A per-truck invoice rate can override the SO rate.
- **Shortage deduction** = (shortage − 0.2% of dispatch weight) × sale rate **incl. GST** (Nitish, 24-11-2026), only if positive; own-plant trucks use the purchase rate incl. GST. The sale rate is the SO rate as agreed: when the SO rate includes freight, freight is not taken out of it. No deduction when the customer pays the freight. The working is shown on every truck (truck page, Freight & Transport, Pay freight, Excel).
- **Net freight = received weight × freight rate − freight advance − shortage deduction.**
- **Detention is only a suggestion** (3 free days, then ₹500/day). It is never added unless someone types an amount when paying freight.
- Extra freight advance on one trip carries forward to the same vehicle's next trip. On Freight & Transport (and the truck page and statements), the next trip's "Freight adv." shows it ("from earlier trip"), so every row reads freight − shortage − advance + detention = net payable. Statement totals count each advance once ("given").
- **Transporter is optional** (23-11-2026); the freight rate is still required once the weight is entered.
- **Transporter advances** (24-11-2026): money given to a transporter that is not tied to a truck (e.g. before loading) is entered on its own **Advances** tab (money roles; also "+ Transporter advance" in the Dispatch Register; sheet tab `APP_ADVANCES`; adding more = a new line; wrong ones reversed by a minus line, Accounts same day only). It is used **automatically**: unloaded, unpaid trucks of that transporter take from it, oldest unload first, and their freight to pay goes down. When freight is paid, what the truck took is saved on it (`APP_TRUCKS` "Transporter Advance Used", `tAdv`), so later advances never change a paid truck. Left = given − used. Same calculation on server (`transAdv_`) and screen (`transAdv`). The per-truck "Freight advance" asks "advance given now" and adds it to the truck's total (Owner can correct the total).
- Freight is paid by the last firm that sells (mostly Raghav). If the SO says the customer pays freight, there is no freight for us.
- Raghav's margin on sales to own group companies (e.g. to Shree Ram) is not reduced by freight.
- Same vehicle number cannot be entered twice on the same day (spaces ignored). Only Owner can override.
- Trucks are never deleted: **Cancel** (with reason) or **Returned empty**. Orders can be **Short-closed** (Settled) when quantity is slightly over/under.
- Payments: plant (supplier) and freight payments are done in internet banking outside the app; the app works out the amount and records the **UTR**. UTR is **optional for supplier and freight payments** (freight from 19-11-2026, supplier from 21-11-2026); it is saved when entered. The payment photo stays optional. Bank details never block a payment. One payment may cover several trucks.
- **Order quantity window ±1%** (APP_SETTINGS `qtyTolerancePct`, 0.01), for POs and SOs. Example PO 10,000 qtl: complete from 9,900 → shows "Complete" + **Short-close** button (never closes by itself); limit 10,100. Above the limit, or a new truck on a complete order: staff are refused ("Ask the Owner"), the Owner gets a warning and can accept with Save again. Same check on server (`checkQty_`) and screen (`qtyProblem`).
- **One truck on two orders** (Nitish, 24-11-2026; e.g. DISP-0055: 141.60 on PO-01-BCL + the rest on PO-07-BCL, 104.40 on SO-0005 + the rest on SO-0012). APP_TRUCKS `po2`/`poQty`/`po2Qty`, `so2`/`soQty`/`so2Qty`: the **first order keeps a fixed part** (poQty/soQty), the second takes the rest of the weight. **Both quantities are typed and must add up to the dispatch weight, or the save is refused** (Nitish, 25-11-2026; server `checkSplit_`, screen `splitMatch`, live total in the forms); changing the weight of a split truck needs both quantities changed in the same save (the Dispatch weight form shows them). A split saved before 25-11-2026 has no second qty: it counts as the rest of the weight until the weight changes. Purchase = part 1 × PO 1 rate + rest × PO 2 rate (each + its GST). Sale = soQty of the received weight (dispatch weight until received) at SO 1's rate + the rest at SO 2's, so a **shortage falls on SO 2 and is charged at SO 2's rate incl. GST**. A per-truck invoice rate still prices the whole truck. Customer, credit days, freight terms, firm come from the first order; the second must be the same supplier/customer, same firm, same PO type / freight terms. At most two orders per truck. **Older order first**: when the weight, PO or SO is saved and an older open order of the same supplier/customer (same firm) is not complete and has less left than the truck, the form offers "Split" (what is left + the rest on the next order) or "Move" (whole truck, when it fits); "No" keeps the ±1% rule. Order balances count only each order's part (`partOn_` server / `partOn` screen); Edit truck has a "Split between two orders" section; a blank second order removes the split.
- **Dates are shown and typed as DD-MM-YYYY everywhere** (screen, messages, Excel). Stored as yyyy-mm-dd / real dates as before.
- **Working lists show only open work.** Closed trucks, cancelled/returned trucks, short-closed and cancelled orders are on the **Closed & cancelled** page (nothing is moved or deleted in the sheet). Every list has an S.No. column.
- Stages: Vehicle placed → Loaded → Supplier paid → Received/Unloaded → Closed. **Closed = unloaded + freight paid (or customer pays freight); the supplier payment does not count** (Nitish, 24-11-2026); own-plant trucks the same. A closed truck with the supplier unpaid stays under "Pay supplier" and is marked "supplier not paid" on the Closed page; staff can still pay its supplier, enter its supplier invoice, and undo a freight payment made today. "Part paid" / "Customer paid" are no longer used.
- **Customer money is kept per firm and customer (factory), not per truck** (Nov 2026; per firm since 24-11-2026: Godrej-Raghav and Godrej-Devan are separate accounts, key "FIRM|CUSTOMER"; old payments without a firm count under the first firm, Raghav). Entered on the **Receivables** page ("+ Received": firm, amount, date, bank ref optional, deduction + reason), saved in APP_PAYMENTS with Dispatch No. blank and the Firm column. Transporter advances are per firm too (APP_ADVANCES Firm column; used only on that firm's trucks). Outstanding = sale totals of the customer's unloaded trucks − received − deductions (below 0 = advance). Overdue = sales past their credit days less everything received. A wrong entry is reversed (a minus line), never deleted; Accounts only same-day entries, Owner any. Same calculation on server (`custAcc_`) and screen (`custAcc`). No per-truck "+ Payment".
- **Shree Ram Solvex's own business is kept out of this app** (Nov 2026; it will get its own Apps Script). Setting `hiddenFirms` (APP_SETTINGS, default `SHREE RAM SOLVEX`): POs/SOs in that firm and the trucks on them are not sent, not counted and cannot be changed or created here; **their rows stay in the sheet untouched**. Raghav's sales TO Shree Ram stay (Shree Ram is still a group-company customer). Clearing the setting shows them again. The Plant Inward tab is removed. Helpers: `hiddenSets_`, `visibleRows_`, `guardTruck_`/`guardOrder_` (server), `visFirms` (screen).
- **Sales** tab = unloaded trucks not yet Closed (sale on the unloaded weight), no money columns. **Receivables** tab = one row per customer (incl. Shree Ram Solvex as group company) with statement per customer.
- **Reports** tab (25-11-2026; money roles, not Dispatch): purchase-order-wise (per sale order the trucks went to: rate, trucks, loaded, unloaded, sale amount; then each sale order's trucks, each line with the rate it was sold at and its amount) and sale-order-wise (the mirror, at the purchase rate and amount), plus a list of all orders (purchase amount per PO, sale amount per SO). On screen, PDF (summary first, then each sale/purchase order straight after it: no forced new pages, no wasted paper, Nitish 25-11-2026) and Excel (Order, Where it went/came from, one sheet per order). **No profit in Reports, amounts only** (incl. GST; Nitish works the profit out himself, 25-11-2026). Worked out on the server only (`truckPieces_`, `reportList_`, `orderReport_`): a truck on two orders is matched old with old, and its pieces add up to the truck's own numbers.
- Labels use proper terms (Supplier, Customer, Dispatch Register, Dispatch No., Vehicle No., Dispatch weight, Received weight, Short-closed, Supplier invoice, Outstanding…). Only labels change, never sheet column names.

## 4. Safety rules (always)
1. **Never change or delete live data in the sheet without asking Nitish first.** Code changes only.
2. **Never delete or rename a tab or a column.** Schema changes are **additive**: add new columns at the END of a tab in `SCHEMA`, and bump `SCHEMA_V` so `upgradeHeaders_` adds them once. Existing data must keep working.
3. **Keep server and screen calculations identical.** The truck calculation exists twice (`derive_` in Code.js and `derive` in the screen). If you change one, change the other the same way and test that both give the same numbers.
4. Keep role checks on the **server** (the screen can be bypassed). Money fields must stay hidden from Dispatch.
5. Keep every write going through the existing save/lock/log path (`withLock_`, `saveRecord_`, `log_`) so it is locked and logged.
6. Before risky or big changes, explain the plan in a few lines and wait for "yes". Small fixes can go ahead.
7. Never put passwords, tokens or bank details in code or in this file.

## 5. How to work (every change)
1. `git status` – make sure the working tree is clean; if not, ask.
2. `clasp pull` first if anyone might have edited the online editor.
3. `git checkout -b <short-change-name>`
4. Make the change. Keep the existing code style (plain functions, no frameworks, works on phone and laptop, buttons ≥ 44px on phone, no sideways scrolling).
5. Check syntax: `node -e "new Function(require('fs').readFileSync('Code.js','utf8'))"` (and the screen script if Index.html exists).
6. Test the logic you touched. Put any test scripts in `tests/` (never pushed – see `.claspignore`). For calculations, test with real-looking numbers from this file.
   `cd tests && npm install` (once), then `npm test`: old-vs-new comparison on a realistic day (fake sheet in `tests/fake-gas.js`; intended changes are listed in `EXPECTED` there), safety, server speed, the real screen in jsdom (`tests/browser.js`), round-2 rules, and server/screen calculation parity. All must pass.
7. `git add . && git commit -m "<what changed>"`
8. `clasp push` → tell Nitish to test on the **/dev** link (Deploy → Test deployments) before publishing.
9. Publish only when Nitish says OK:
   `clasp deploy -i AKfycbwkMGpJFppRvc4R3fPReCO5UfXuwAFAqcxLqN87zDuqKNijy7Q1_v6Wug2MnorJkl0STA -d "<what changed>"`
   (or Apps Script → Deploy → Manage deployments → pencil → New version). This keeps the same link.
10. If something breaks: `git checkout main -- .` then `clasp push` and redeploy.
- Apps Script holds only ONE copy of the code: whatever branch was pushed last. Check `git branch` before `clasp push`.
- If a change needs `setup` to run (new tabs/columns, triggers), tell Nitish to run `setup` once from the Apps Script editor.

## 6. Performance notes
- Every `google.script.run` call costs ~1–2 s. Keep saves to one call.
- Inside one request, read each tab **once** and reuse it (avoid calling `rows_()` for the same tab many times).
- After a save, return only what changed where possible instead of all data.
- Show the change on screen immediately and confirm when the save finishes.
- How it works now (Nov 2026):
  - Server: `REQ_` keeps each tab read once per call. The screen sends its token as `{t, d: 1}`, so saves return only the changed records. Older open screens send the plain token and still get all data.
  - **Any new code that writes to a tab must call `dropTab_(tab)` and `markChanged_(tab, id, row)`** (`saveRecord_` already does both). Otherwise the screen will not see the change.
  - `api_sync` + script property `data_v`: the background check reads no tabs when nothing changed. The screen checks every **15 s** (and at once after its own save if someone else saved meanwhile). To stay inside the free-account daily limits (script properties: 50,000 reads/day), the session, `data_v`, the setup check and the time zone are read from CacheService first; a "nothing new" check reads no properties.
  - Screen: truck saves and payments go into a queue `Q` and show at once (laid over `D`, the server-confirmed data). Each one carries an id `rid`, so a retried save is never counted twice. Refused saves are listed with "Open again".

## 7. Backlog (do only when Nitish asks)
- ~~Faster saving~~ – done Nov 2026 (see section 6).
- Busy invoice no. + e-way bill no. on each truck, with an "Invoice pending" warning.
- Activity / morning review page (who entered what, Verified tick, red flags).
- Pay popup: amount, payee bank details with Copy, "Open bank" link, UTR or screenshot.
- Upload slip photo and payment screenshot per truck (Google Drive folder).
- Flow chart on each PO page (supplier → customers).
- Party ledgers in the app: customers done (Receivables + statement, Nov 2026); suppliers, transporters still to do. Busy import file.
- Later: transporter app + plant board, WhatsApp bot (official API, forwarded slips), other firms' own books.

## 8. How to talk to Nitish
- Short, plain English. Say what changed and what he must do (push / test / deploy / run setup).
- Ask one clear question when something is unclear; don't guess on money rules.
- Collect small requests and do them together when he says so.
