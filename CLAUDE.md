# CLAUDE.md – DDGS Trade Control app (rules for Claude)

Read this file fully before doing any work in this folder.

## 1. Who and what
- Owner: **Nitish** (login `nidhish23`). DDGS trading business. He is also a developer, but explain things simply and briefly.
- DDGS is bought from ethanol plants (BCL, Oasis Ethanol, MG Petrochem…) and sold to feed factories (Godrej Agrovet Khana, Jupiter by Khana Feed, Aman Feed Khana, King Food Malerkotla, Ahuja Industries…) or sent to his own plant **Shree Ram Solvex**.
- Firms: Raghav Trading and Company (main seller), Devan Trading and Company, Saraswati Solvex, Jai Mahavir Trading and Company, Shree Ram Solvex (own plant). **For now everything is kept in Raghav only**; a PO only shows which firm the order was booked in.
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

## 3. Business rules (do not change without Nitish saying so)
- **Weights:** slips are in kg (5 digits, e.g. 38450) or quintal (e.g. 384.50). Store quintals. ≥1000 typed = kg ÷ 100.
- **Dispatch date** = date the truck left the plant (date out on the slip), not the placement date.
- **Purchase** = dispatch weight × PO rate × (1 + GST).
- **Sale** = received weight (or dispatch weight until received) × SO rate; SO says if GST is included and who pays freight. A per-truck invoice rate can override the SO rate.
- **Shortage deduction** = (shortage − 0.2% of dispatch weight) × sale rate ex-GST, only if positive; own-plant trucks use the purchase rate.
- **Net freight = received weight × freight rate − freight advance − shortage deduction.**
- **Detention is only a suggestion** (3 free days, then ₹500/day). It is never added unless someone types an amount when paying freight.
- Extra freight advance on one trip carries forward to the same vehicle's next trip.
- Freight is paid by the last firm that sells (mostly Raghav). If the SO says the customer pays freight, there is no freight for us.
- Raghav's margin on sales to own group companies (e.g. to Shree Ram) is not reduced by freight.
- Same vehicle number cannot be entered twice on the same day (spaces ignored). Only Owner can override.
- Trucks are never deleted: **Cancel** (with reason) or **Returned empty**. Orders can be **Short-closed** (Settled) when quantity is slightly over/under.
- Payments: plant (supplier) and freight payments are done in internet banking outside the app; the app works out the amount and records the **UTR**. UTR is **required for supplier payments, optional for freight** (Nov 2026). The payment photo stays optional. Bank details never block a payment. One payment may cover several trucks.
- **Order quantity window ±1%** (APP_SETTINGS `qtyTolerancePct`, 0.01), for POs and SOs. Example PO 10,000 qtl: complete from 9,900 → shows "Complete" + **Short-close** button (never closes by itself); limit 10,100. Above the limit, or a new truck on a complete order: staff are refused ("Ask the Owner"), the Owner gets a warning and can accept with Save again. Same check on server (`checkQty_`) and screen (`qtyProblem`).
- **Dates are shown and typed as DD-MM-YYYY everywhere** (screen, messages, Excel). Stored as yyyy-mm-dd / real dates as before.
- **Working lists show only open work.** Closed trucks, cancelled/returned trucks, short-closed and cancelled orders are on the **Closed & cancelled** page (nothing is moved or deleted in the sheet). Every list has an S.No. column.
- Stages: Vehicle placed → Loaded → Supplier paid → Received/Unloaded → Closed. **Closed = unloaded + supplier paid + freight paid (or customer pays freight)**; own-plant trucks the same (Nov 2026). "Part paid" / "Customer paid" are no longer used.
- **Customer money is kept per customer (factory), not per truck** (Nov 2026). Entered on the **Receivables** page ("+ Received": amount, date, bank ref optional, deduction + reason), saved in APP_PAYMENTS with Dispatch No. blank. Outstanding = sale totals of the customer's unloaded trucks − received − deductions (below 0 = advance). Overdue = sales past their credit days less everything received. A wrong entry is reversed (a minus line), never deleted; Accounts only same-day entries, Owner any. Same calculation on server (`custAcc_`) and screen (`custAcc`). No per-truck "+ Payment".
- **Sales** tab = unloaded trucks not yet Closed (sale on the unloaded weight), no money columns. **Receivables** tab = one row per customer (incl. Shree Ram Solvex as group company) with statement per customer.
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
