# Smart Inventory Assistant — Review Speech Script

**How to read this script**

- Plain paragraphs are **what you say**, word for word or close to it.
- **[DO]** lines are what you click or show on screen while speaking.
- **In the database** boxes say exactly what the server and MongoDB do when that button is
  pressed. Say these out loud. They answer the panel's "what happens in the database?" questions.
- Sections marked *(optional)* can be skipped if time is short.
- The full run takes about **25–30 minutes**. Part 10 is a one-page table to keep open during
  questions.

**Before the panel arrives (5 minutes):**

```bash
cd server
npm run seed        # fresh, identical data every time (~10 s)
npm run verify      # should say 20/20 checks passed
cd ..
npm run dev         # starts API (port 5000) and screens (port 5173) together
```

Open `http://localhost:5173` in the browser. Keep a terminal open with `mongosh sia` ready.

---

## PART 1 — Introduction (2 minutes)

Good morning, ma'am / sir. We are Asigha K G and Nirupa K V, and our Mini Project III is the
**Smart Inventory Assistant**, which we call SIA for short.

**The problem.** A small supermarket usually keeps its stock in a notebook. Someone checks what
is on the shelf, calls the supplier when something runs out, and nothing is recorded. Nobody can
answer basic questions like "what sold most last month?", "what keeps running out?", or "who
changed this stock figure?"

**Our solution.** SIA puts stock, suppliers and reorder levels in one shared system. It has three
main ideas:

1. **Restocking starts itself.** When a sale takes a product below its reorder level, the
   server creates the restock request. Nobody has to notice or press a button.
2. **Billing records the customer without forcing it.** The cashier can enter a phone number,
   but a sale always completes without one.
3. **Customers give feedback by scanning a QR code**, with no account and no password.

In one sentence: *SIA is a centralised inventory system for a small supermarket where
restocking starts itself, billing captures the customer without ever demanding it, and feedback
arrives by QR with no login.*

---

## PART 2 — Architecture and technology (3 minutes)

The system has **three tiers**, the standard three-tier architecture.

```
   BROWSER                    SERVER                      DATABASE
┌──────────────┐        ┌────────────────┐          ┌──────────────┐
│  React       │ HTTP   │  Express API   │ Mongoose │   MongoDB    │
│  (Vite)      │ ─────► │  on Node.js    │ ───────► │  database    │
│  port 5173   │ ◄───── │  port 5000     │ ◄─────── │  "sia"       │
└──────────────┘  JSON  └────────────────┘          └──────────────┘
```

- **Presentation tier: React.** This draws the screens. It stores no important data. It only
  shows what the server sends back.
- **Application tier: Node.js with Express.** This is where every rule lives: who is allowed to
  do what, whether there is enough stock, and whether a reorder level was crossed. The browser
  talks to it through a **REST API**: URLs like `POST /api/sales` or
  `GET /api/products`, with data sent as JSON.
- **Data tier: MongoDB**, a NoSQL document database. We use **Mongoose**, which lets us define a
  **schema** for each collection, much like a table definition in SQL, with data types,
  required fields and validation.

**Why MongoDB and not SQL?** A bill is naturally one document: a header plus a list of items.
In MongoDB we store the items *inside* the bill document instead of in a separate table, so one
bill is read in one operation. We still use references, which work like foreign keys, for
everything else.

**Other libraries:**
- `bcryptjs` hashes passwords.
- `jsonwebtoken` creates the signed login token (JWT).
- `qrcode` generates QR images on the server.
- `recharts` draws the dashboard charts.
- `express-rate-limit` stops anyone flooding the login and the public feedback form.

Everything runs offline on one laptop. No internet is needed.

---

## PART 3 — The database design (4 minutes)

Our database is called `sia`. It has **10 collections**, which are like tables, plus **one
internal helper collection**. *(Since Phase 3 there are 11: `tasks` was added, alongside two ML
caches, `combocaches` and `predictions`. See `docs/PLAN.md` section 4.)*

| # | Collection | What one document represents | Seeded count |
|---|---|---|---|
| 1 | `users` | A staff login: Owner, Manager or Staff | 4 |
| 2 | `suppliers` | A company we order from | 10 |
| 3 | `products` | One item on the shelf: price, stock, reorder level, supplier | 169 |
| 4 | `stocklogs` | One stock movement: before, after, who and why | ~43,900 |
| 5 | `restockrequests` | One purchase request: pending → approved → received | ~588 |
| 6 | `sales` | One bill, with its items embedded inside | 9,835 |
| 7 | `customers` | A customer, identified by phone. **No password.** | ~309 |
| 8 | `notes` | Customer feedback, or an internal staff message | ~600 |
| 9 | `notifications` | An alert created by an event | (created live) |
| 10 | `issues` | A floor problem reported by staff | 6 |
| — | `counters` | *Internal.* Generates unique bill numbers | — |

**How DBMS theory concepts map onto our design.** This is how the theory you teach shows up in
our project:

| DBMS concept | Where it is in SIA |
|---|---|
| **Primary key** | Every document has an automatic `_id` (an ObjectId). |
| **Foreign key** | Fields like `product_id` and `supplier_id` store another document's `_id`. MongoDB does **not** enforce foreign keys, so we never delete records. We set `active: false` instead (a *soft delete*). |
| **Unique constraint** | Unique indexes on user `email`, customer `phone`, product `sku` and sale `bill_no`. |
| **Partial unique index** | Only one *open* restock request per product. Explained in Part 5. |
| **Check constraints / domain** | Schema validators: `stock` minimum 0, `rating` 1 to 5, `role` must be Owner/Manager/Staff, phone must match a 10-digit Indian mobile pattern. |
| **Derived attribute** | `is_low_stock` is *calculated* (stock ≤ threshold), never stored, so it can never disagree with the real figure. |
| **Controlled denormalisation** | Each bill keeps a copy of the product name and price at the time of sale, so changing a price tomorrow does not rewrite yesterday's bill. |
| **Embedding vs referencing** | Sale items are *embedded* in the bill. Everything else is *referenced*. |
| **Indexes** | On frequently searched fields, e.g. `products.category` and `stocklogs.product_id + createdAt`, plus a text index for product search. |
| **Atomicity / concurrency** | Stock changes use one atomic update (`$inc`) with a condition, so two tills can never oversell the last unit. |
| **Audit trail** | `stocklogs` is append-only: rows are never edited or deleted. |
| **Security** | Passwords are stored as a bcrypt hash, never as plain text. |
| **Aggregation** | The dashboard uses MongoDB aggregation pipelines: `$group` is like SQL `GROUP BY`, and `$lookup` is like a `JOIN`. |

**Money is stored in paise, as whole numbers.** ₹285.50 is stored as `28550`. Floating-point
numbers drift: in a computer, 0.1 + 0.2 is not exactly 0.3. Adding up thousands of bills
would make the totals wrong by a few paise. Integers never drift. We convert to rupees only when
showing a value on screen.

**The data is real.** The 9,835 sales come from the *Groceries* dataset in the R `arules`
package, which is real point-of-sale data from a grocery store. Which items are bought together is
real shopping behaviour. We mapped its 169 items onto Indian products, spread the sales over 90
days, and generated prices, customers and stock levels, because the original dataset does not
have them.

---

## PART 4 — Login and the three roles (3 minutes)

**[DO]** Show the login screen.

This is the login screen. There is **no "Sign up" button**, on purpose. Accounts are created
down a chain: the Owner creates Managers, and Managers create Staff. Nobody registers
themselves.

There are **three roles**:
- **Owner:** sees everything, but **cannot bill**. The person who reviews the takings should
  not be able to create them. That is a basic separation-of-duties control.
- **Manager:** products, suppliers, approving restock requests, staff accounts, and billing.
- **Staff:** the shop floor and the billing counter.

### Button: **Sign in** (email + password form)

**[DO]** Click the **Owner** row under "Demo accounts". It fills in and submits the same form.

> **In the database (when Sign in is pressed):**
> 1. The browser sends `POST /api/auth/login` with the email and password.
> 2. The server runs `findOne` on `users` by email. The password hash is hidden from all
>    queries by default, so this query asks for it explicitly.
> 3. `bcrypt.compare` checks the typed password against the stored hash. We never store or
>    compare plain passwords.
> 4. If the email or password is wrong, the error is always the same message: *"Email or
>    password is incorrect"*, so an attacker cannot find out which emails exist.
> 5. On success, the server **updates** the user's `last_login` field (one write).
> 6. It creates a **JWT**, a signed token that holds only the user id and role and expires
>    in 8 hours. The browser stores it and sends it with every later request.
> 7. Login is rate-limited to 40 attempts per 15 minutes to slow down password guessing.

**Why the token is secure.** On every request the server checks the token's **signature**
and then **reads the user again from the database**. If someone edits the token in the
browser, the signature breaks and they get **401 Unauthorized**. If a Staff user calls a
Manager-only URL, they get **403 Forbidden**. The screens hide buttons, but the **server
enforces the rules** independently.

### The sidebar

The sidebar menu and the page routes are **generated from one config file**. A role cannot see a
menu item for a page it is not allowed to open. If it types the URL directly, it gets "That
screen is not available".

**[DO]** Point out: **the Owner's sidebar has no Billing link.** That is the role system
working, not a missing feature.

### Button: **Sign out** (arrow icon next to your name, bottom-left)

> **In the database:** nothing. Signing out deletes the token from the browser, and the user
> returns to the login screen.

---

## PART 5 — Screen-by-screen walkthrough

### 5.1 Dashboard (Owner) (2 minutes)

This is the dashboard. Everything on it is **live from the database**. Nothing is hard-coded.

**[DO]** Point at each tile as you name it.

- **Revenue today / Last 30 days:** total of today's bills and of the last 30 days.
- **Below threshold:** how many products are at or below their reorder level.
- **Open restock requests:** requests that are pending or approved, and how many are waiting
  for approval.
- **Stock value:** stock × cost price, summed over all products.
- **Customers:** total customer records.
- **Revenue chart:** takings per day for 30 days.
- **Needs restocking:** low-stock products. Each shows "Requested" if a request is already open,
  or "Low" if not.
- **Best sellers:** top 8 products by units sold.
- **Revenue by aisle:** revenue grouped by category.
- **Latest customer feedback:** the 5 newest reviews.

> **In the database (when the dashboard opens):**
> The browser calls `GET /api/dashboard`. The server runs **about 13 queries in parallel**:
> - `countDocuments` for products, low stock, open/pending requests and customers.
> - Low stock uses `$expr: { $lte: ['$stock', '$threshold'] }`, which compares two fields of
>   the same document.
> - **Aggregation pipelines** on `sales`: `$match` (filter by date, like `WHERE`), `$group`
>   (sum per day, like `GROUP BY`), `$unwind` (split a bill into its items) and `$lookup`
>   (join each item to `products` to get its category, like a SQL `JOIN`).
> - All totals are added in paise and converted to rupees **once**, at the end.
>
> The **"View all"** and **"Open feedback"** buttons simply open the Restock and Feedback
> screens. They do not write anything.

### 5.2 The top bar: notification bell and sidebar badge

### Button: **Bell icon** (top-right)

The red number is the count of unread alerts. Clicking the bell opens the list.

> **In the database:**
> - The bell calls `GET /api/notifications` **every 15 seconds**. It fetches notifications
>   where `for_role` equals my role, or `for_user_id` equals me.
> - "Unread" means **my user id is not in that notification's `read_by` array**. Each user has
>   their own read status on a shared alert.
> - Clicking a notification **opens the related screen** (for example, Restock requests).
> - **Notifications are never typed in by a person.** Each one is created by the event that
>   caused it: an auto-restock, an approval, goods received, a bad review, or a stock count
>   needing approval.

### Button: **Mark all read**

> **In the database:** `updateMany` on `notifications` with `$addToSet: { read_by: myId }`.
> `$addToSet` adds my id only if it is not already there, so it never creates duplicates.

**The amber number on "Restock requests" in the sidebar** shows how many requests are pending.
It is refreshed every 20 seconds with `GET /api/restock?status=pending`.

### 5.3 Products (2 minutes)

**[DO]** Open **Products**.

This lists all 169 active products: price, current stock, reorder level (threshold), a status
chip, average customer rating and supplier.

The **status chip** is calculated from stock and threshold:
- **Out of stock:** stock is 0.
- **Low:** stock is at or below the threshold. The row is highlighted.
- **Watch:** stock is within 1.5 × the threshold.
- **Healthy:** anything above that.

**Controls on this screen:**
- **Search box:** filters by product name or SKU code.
- **"All aisles" dropdown:** filters by category.
- **Sort dropdown:** by name, lowest stock, highest price, or best rated.
- **"Below threshold" button:** shows only low-stock products. Press it again to show all.

> **In the database:** the page loads once with `GET /api/products` (only `active: true`
> products, with the supplier name filled in using `populate`, Mongoose's version of a join)
> and `GET /api/products/categories`, which uses `distinct`. **Search, filter and sort then
> run in the browser on the loaded list**, so pressing these buttons makes **no further
> database calls**.

**Stock is never edited on this screen.** Stock only changes through the stock service, so every
change leaves a row in the ledger. Even if someone sends a stock value in an edit request, the
server **deletes that field** before saving.

### 5.4 Billing: the headline demo (5 minutes)

**[DO]** **Sign out. Sign in as Manager** (click the Manager row). Billing now appears in the
sidebar.

*(Use the Manager for billing during the demo. See the note at the end of this file about the
receipt QR for Staff.)*

**[DO]** Open **Billing**.

This is the till. The left side lists products, the right side holds the customer and the cart.

### Search box (left)

Search by name or SKU. Only products with stock above zero are shown, because you cannot sell
what you do not have.

**[DO]** Type **Tata Tea**. Point at it: **stock 6, threshold 5**.

### Clicking a product (adds it to the cart)

**[DO]** Click **Tata Tea Premium 500g** once.

> **In the database:** nothing yet. The cart is kept in the browser until the sale is
> completed. The screen does not let the quantity go above the stock shown.

### Buttons: **+ / −** on a cart line

These change the quantity. Pressing **−** at 1 removes the line.
> **In the database:** nothing. This is still only the browser.

### Phone number field: three cases

The phone field is **optional**. It has three behaviours:

1. **Left blank:** the sale is a walk-in and completes normally. *A sale is never blocked for
   not giving a number.*
2. **A number we have never seen:** a small "New number" form appears for an optional name and
   address. The customer record is **created as part of this sale**.
3. **A known number:** "Returning customer · visit N" appears with their name and address,
   which can be corrected right here.

> **In the database (as the phone is typed):** when exactly 10 digits are entered, the screen
> waits about a third of a second, then calls `GET /api/customers/by-phone/<number>`. That
> is a `findOne` on `customers` using the **unique index on phone**, so it is instant.
> Nothing is written yet.

**[DO]** Leave the phone **blank** for this first sale.

### Buttons: **Cash / UPI / Card**

These choose the payment method, which is saved with the bill as `payment_method`.

### Button: **Complete sale** (the most important button in the project)

**[DO]** Click **Complete sale**.

An amber banner appears: **"A restock request was raised automatically."**

Nobody pressed anything to raise that request. This sale took Tata Tea from 6 down to 5, which
is its reorder level, and the server raised the request before it replied. The Manager has
already been notified.

> **In the database: what "Complete sale" does, step by step**
>
> The browser sends **`POST /api/sales`** with the items, the payment method, the phone (if
> any) and the login token.
>
> 1. **Authentication:** the token's signature is verified and the user is re-read from
>    `users`. A bad token gets **401**.
> 2. **Authorisation:** only Manager or Staff may bill. **The Owner gets 403.**
> 3. **Stock check first:** all products in the cart are loaded with one `find`, and stock is
>    checked for **every line before anything is written**. If any item is short, the whole
>    sale is refused with **409 Conflict** and nothing changes.
> 4. **Customer:** if a phone was given, `findOne` on `customers`. If found, the name and
>    address are corrected if they changed. If not found, a new customer document is prepared.
> 5. **For each item, `adjustStock()` is called. This is the only function in the whole
>    system that changes stock:**
>    - **a.** `findOneAndUpdate` on `products` with `$inc: { stock: -qty }` and the condition
>      `stock >= qty`. This is **one atomic operation**: the check and the decrease happen
>      together, so two tills selling the last unit at the same moment cannot both succeed.
>    - **b.** **Insert one row into `stocklogs`:** entry type `sale`, change −1,
>      `stock_before` 6, `stock_after` 5, and the user who sold it.
>    - **c.** **Threshold check:** is the new stock ≤ the threshold? 5 ≤ 5, yes. So:
>    - **d.** **Insert into `restockrequests`:** status `pending`, trigger `auto`, quantity =
>      the product's reorder quantity (12), and the stock and threshold *at that moment*.
>      **`raised_by` is `null`, because no person raised it.**
>    - **e.** **Insert into `notifications`:** "Restock request raised automatically", for
>      the Manager role.
> 6. **Bill number:** `findOneAndUpdate` on `counters` with `$inc: { seq: 1 }`. It is atomic,
>    so two tills can never get the same bill number. Format: `SIA-YYYYMMDD-00001`.
> 7. **Insert into `sales`:** the items (with name, SKU and price **copied in**), the
>    payment method, `customer_id`, `customer_phone` and `billed_by`. **Before saving, a
>    `pre-validate` hook recalculates every line total, the subtotal and the total from the
>    items.** The server never trusts totals sent by the browser, so a bill can never be
>    stored with numbers that do not add up.
> 8. **Update the customer** (if any): `visits + 1`, `total_spent` plus this bill, and
>    `last_seen` set to now.
> 9. **Reply** with the bill and a `restock_raised` list. That list is what shows the amber
>    banner.

**[DO] Prove it came from the server.** In the terminal:

```bash
mongosh sia --quiet --eval "db.restockrequests.find({status:'pending'}).sort({createdAt:-1}).limit(1)"
```

Point at **`raised_by: null`** and **`trigger: 'auto'`**. *"No user raised this. The null is
the proof."*

### The receipt screen

It shows the bill number, items, quantities, prices, total and payment method, and a
**Feedback QR**.

> **In the database:** the receipt calls `GET /api/feedback/qr?type=bill&id=<saleId>`. The
> server generates a QR image pointing to `/feedback?sale=<id>`. **Nothing is stored.** The
> QR is generated fresh each time.

This QR is the strongest of the three, because it reaches the customer while they still have an
opinion, and it already knows what they bought.

### Button: **Start the next sale**

> **In the database:** nothing. It clears the receipt and returns to an empty till. (The
> product list was already reloaded after the sale, so it shows the new stock.)

### Demo: no duplicate request

**[DO]** Sell **one more Tata Tea**. Stock goes to 4. **No second banner appears.**

A product can only ever have **one open request**. This is enforced in two ways:
1. In code, an open request is detected and skipped.
2. **In the database itself, with a *partial unique index*** on `restockrequests.product_id`
   that applies only when `status` is `pending` or `approved`. If two tills cross the threshold
   at the same instant, both could pass the check in code, but **the database refuses the
   second insert** with a duplicate-key error (code 11000), which the server treats as "already
   requested". A check in code can be raced by two requests. A unique index cannot.

**Why `approved` is included, not only `pending`:** after the Manager approves an order, the
goods take 2–4 days to arrive, and the product stays below its threshold the whole time. When
our first version covered only `pending`, every sale in that window raised **another** order.
Amul milk ordered itself again and again until it held about **510 days of stock**. Including
`approved` fixed it. Requests over 90 days dropped from 1,682 to about 588, and stock cover fell
to about 16 days. Our `npm run verify` now checks for this.

### Demo: customer capture

**[DO]** Start a new sale. Add any item. Type a phone number that does not exist, e.g.
**9876501234**. The "New number" form opens. Type a name and click **Complete sale**.

*"The customer record was created by the sale. There is no separate 'add customer' step, and we
never left this screen."*

> **In the database:** the same steps as above, plus **one insert into `customers`** (phone,
> name, `created_by` = me, `visits` = 1, `total_spent` = this bill). The sale stores **both**
> `customer_id` and `customer_phone`.

**[DO]** Bill the same number again. It shows **"Returning customer · visit 2"**.

**Why the sale stores both `customer_id` and `customer_phone`:**
- `customer_id` is the **permanent link**. If the Manager changes the customer's phone
  number, their history still follows them.
- `customer_phone` is a **snapshot of what was printed on that bill**. An old receipt shows the
  number that was actually on it.

If we stored only the phone, changing it would disconnect all past sales.

### 5.5 Restock requests: changing "pending" to "approved" (4 minutes)

**[DO]** Open **Restock requests** (still as Manager).

The four tiles show counts by status: **Awaiting approval**, **Approved (in transit)**,
**Received**, and **Rejected**.

> **In the database:** `GET /api/restock`, which runs a `find` on `restockrequests`, uses
> `populate` to fill in the product, supplier and approver names, and runs an aggregation
> `$group` by `status` for the tile counts.

**Tabs: Open / Pending / Approved / Received / All:** these change the filter. *Open* means
pending **or** approved. Each tab is a new query with a different `status` filter.

**Source column:** **"Automatic"** means `raised_by` is `null`, so the server raised it.
**"Manual"** means a person raised it (a stock-count adjustment; see 5.6).

The request's life cycle:

```
 pending  ──Approve──►  approved  ──Mark received──►  received
    │
    └──Reject──►  rejected
```

### Button: **Approve** (pending → approved), Manager only

**[DO]** Click **Approve** on the Tata Tea request.

> **In the database:**
> 1. `POST /api/restock/<id>/approve` with `{ approve: true }`. The server confirms the role
>    is **Manager** (anyone else gets 403).
> 2. `findById` on `restockrequests`. If the status is **not** `pending` (for example, already
>    approved), it is refused with *"This request is already approved"*. A request cannot be
>    approved twice.
> 3. **Update** the request: `status: 'approved'`, `approved_by` = the Manager's id,
>    `approved_at` = now.
> 4. **Insert into `notifications`:** "Restock approved", **for the Staff role**, so the
>    floor staff know a delivery is coming.
> 5. **Stock does not change yet.** Approving only means "order it". The goods have not arrived.
> 6. The request is still "open", so the unique index still blocks a duplicate order for this
>    product.

### Button: **Reject** (pending → rejected), Manager only

> **In the database:** the same endpoint with `{ approve: false }`. The request is updated to
> `status: 'rejected'`, with `approved_by` and `approved_at` recording **who decided and
> when**. A notification "Restock rejected" goes to Staff. Stock does not change. A rejected
> request is **no longer open**, so if the product is sold again while still below threshold,
> the system raises a **fresh** request.

### Button: **Mark received** (approved → received), Manager or Staff

**[DO]** Click **Mark received** on the approved request. Then open Products and show the stock
went up.

> **In the database:**
> 1. `POST /api/restock/<id>/receive`. Manager and Staff are both allowed, since whoever
>    unloads the delivery records it.
> 2. `findById`. It must be `approved`, otherwise it is refused with *"Only an approved
>    request can be received"*.
> 3. **The stock goes up through the same `adjustStock()` function:** `$inc: { stock: +12 }`
>    on the product, and **a new `stocklogs` row** with entry type `received`, source
>    `restock`, and a link to this request.
> 4. **Update** the request: `status: 'received'`, `received_at` = now, `received_qty` = 12.
> 5. **Insert into `notifications`:** "Stock received … stock now N", for the Manager.
> 6. The request is now closed, so the product can get a new request the next time it runs low.

**For Staff**, a pending request shows *"Manager decides"* instead of buttons. **For the Owner**,
there are no action buttons at all. The Owner only views.

### 5.6 Stock ledger and physical counts (3 minutes)

**[DO]** Open **Stock ledger**.

This is the **audit trail**. Every stock movement is one row: when, which product, the type
(Sale, Received, Count, Damage, Return, Adjustment), the change (+ or −), stock **before**,
stock **after**, **who** did it, and why.

It is **append-only**. Rows are never edited or deleted. A correction is a new row. Because
every row stores before and after, the ledger can be **reconciled**: the last "after" value for
a product must equal its current stock. `npm run verify` checks exactly this.

### Dropdown: **Every product / pick a product**

> **In the database:** `GET /api/stock/logs?product=<id>`, which runs a `find` on
> `stocklogs` filtered by product and sorted newest first. This is served by the **compound
> index on `product_id + createdAt`**.

**[DO]** Pick **Tata Tea**. Show the two sales you just made and the "Received" row.

### Button: **Record a count** (Manager or Staff)

This is for when someone physically counts the shelf and the number differs from the system.

**[DO]** Click **Record a count**, choose a product. "System says" shows the current stock.
Type a number into "You counted".

> **In the database (when a product is chosen):** `GET /api/stock/tolerance/<id>` returns
> the allowed difference: **5% of the system stock or 3 units, whichever is larger.**

As you type, the screen tells you what will happen:

- **Within tolerance** (e.g. system 40, counted 38): *"This will apply immediately."*
- **Beyond tolerance** (e.g. system 40, counted 20): *"This will raise an adjustment request
  rather than applying."*

### Button: **Record count**

> **In the database (`POST /api/stock/count`):**
> - **Difference is 0:** nothing is written.
> - **Within tolerance:** a small miscount. `adjustStock()` runs with entry type `count`:
>   stock is updated with `$inc` and a ledger row is written. (If the count lowers the stock
>   below threshold, the auto-restock check runs here too.)
> - **Beyond tolerance:** the stock is **not changed**. Instead a request is inserted into
>   `restockrequests` with `trigger: 'manual'`, `raised_by` = the person counting, and a note
>   explaining the difference. A notification *"Stock adjustment needs approval"* goes to the
>   Manager.

**Why this rule exists:** a small difference is an ordinary counting mistake. A large difference
could mean theft or damage, so a Manager should see it rather than someone quietly changing the
number. That is our **shrinkage control**. Because every movement records **who** did it, we did
not need a separate "Cashier" role to police "Helper". Accountability is per person.

### 5.7 Customers (3 minutes)

**[DO]** Open **Customers**.

Customers are **records keyed by phone number, not accounts**. There is **no password field in
the collection at all**, and `npm run verify` checks that none exists. Most customers are
created at the till.

### Search box

> **In the database:** about a quarter of a second after typing stops, the screen calls
> `GET /api/customers?q=...`, which runs a `find` with a case-insensitive **regex** on phone
> **or** name (`$or`), sorted by `last_seen`.

### Clicking a customer card

**[DO]** Click any customer.

> **In the database:** `GET /api/customers/<id>` runs `findById` on `customers`, plus
> `find` on `sales` where `customer_id` = this customer, using the index on
> `customer_id + createdAt`.

It shows **Visits, Total spent, First seen and Last seen**, the details, and the **Purchase
history**. Note the column **"Phone on the bill"**. That is the snapshot.

### Button: **Edit → Save changes / Cancel** (Manager only)

**[DO]** Click **Edit**, change the phone number to a new valid number, click **Save changes**.
Show the purchase history is **still there**.

> **In the database:** `PATCH /api/customers/<id>` (Manager only, others get 403):
> 1. `findById` on the customer.
> 2. If the phone changed, `findOne` to check **no other customer already has that number**.
>    If one does, the change is refused with **409** and the message *"…already uses this
>    number. Merge the records rather than duplicating the number."* The unique index would
>    also block it.
> 3. The schema **validates** the phone format (10 digits, starting with 6–9). If it is
>    invalid, the server returns **400**.
> 4. **Update** the customer document.
> 5. **Not one sale is touched.** History follows the `customer_id`, and old bills keep the
>    phone that was printed.
>
> **Cancel** writes nothing. It reloads the saved values.

### "Shop for this customer" and the **Proceed to billing** button

Type a product name. Click products to pick them out, then **Proceed to billing**.

> **In the database:** nothing is written. "Proceed to billing" opens the Billing screen with
> **this customer's phone already filled in**, so the till recognises them immediately. The
> Billing screen is the *same* component as the main till, so there is only one billing screen
> in the whole system. The **Clear** button empties the picked list.

*(Be precise if asked: it carries the customer across. The items are added at the till.)*

### 5.8 Suppliers (1 minute) *(optional)*

**[DO]** Open **Suppliers** (Owner and Manager only).

Each card shows a supplier, the aisles it covers, **how many products** it supplies and **how
many of them are low**.

> **In the database:** `find` on `suppliers` (active only), plus an aggregation on
> `products` that runs `$group` by `supplier_id` to count products and low-stock products
> (using `$cond`, like a SQL `CASE WHEN`). A restock request copies the product's
> `supplier_id`, so each request knows who to order from.

### 5.9 QR codes (2 minutes)

**[DO]** Open **QR codes** (Owner and Manager).

We generate three kinds of QR code:

| Code | Where it goes | What it opens |
|---|---|---|
| **Shop** | Counter / door | Feedback page with a product dropdown |
| **Shelf** | Each shelf label | Feedback page with that product already selected |
| **Bill** | The receipt | Feedback page listing the items they bought |

### Dropdown: **Product** (Shelf code)

> **In the database:** `GET /api/feedback/qr?type=product&id=<id>`. The server builds the
> URL `/feedback/<productId>` and the `qrcode` library turns it into a PNG image, which is sent
> back as text (a data URL). **Nothing is stored.**

### Button: **Print**

Opens the browser's print dialog to print the code. No server or database involved.

### Button: **Open it here**

Opens the feedback page in a new tab, exactly what a phone would open after scanning.

*(If the amber box "These codes point at localhost" shows: a phone cannot open `localhost`. For
a real phone, set `PUBLIC_BASE_URL` in `server/.env` to the laptop's Wi-Fi address. The phone
only needs the same Wi-Fi, not the internet.)*

### 5.10 The public feedback page: no login (2 minutes)

**[DO]** Click **Open it here** (or open `http://localhost:5173/feedback` in a **private
window**, to prove nobody is logged in).

*"No login screen, no redirect, no account prompt. A shopper holding a phone has no account
and never will. Asking them to make one would end the interaction."*

**Controls:**
- **Product dropdown:** "The shop overall" or a specific product. From a shelf QR, the product
  is already shown as "You scanned …".
- **Stars (1–5):** required. The Send button stays disabled until a star is chosen.
- **Comment:** optional.
- **Phone number:** optional. *"Only if you would like it linked to your visits."*

**[DO]** Give **2 stars**, type a short comment, click **Send feedback**.

### Button: **Send feedback**

> **In the database (`POST /api/feedback/public`, no token):**
> 1. **Rate limit:** at most 20 requests per 10 minutes from one device. This is an
>    *unauthenticated write*, so without a limit someone could flood the Manager with fake
>    bad-review alerts.
> 2. Validate the rating is a whole number from 1 to 5, otherwise **400**.
> 3. If a phone was given, `findOne` on `customers`. If it matches, the feedback is linked to
>    that customer. If not, it stays anonymous. Nothing is refused for not giving it.
> 4. **Insert into `notes`:** `type: 'feedback'`, the rating, comment, product, sale (if
>    from a bill QR), the source (`product_qr` / `shop_qr` / `bill_qr`), and
>    **`author_id: null`**. A null author means *a customer wrote this, not staff*.
> 5. **Recalculate the product's rating:** an aggregation `$avg` over all that product's
>    feedback, then **update** `products.rating_avg` and `rating_count`. We store the
>    average on the product (*denormalisation*) so the product list can sort by rating
>    without recalculating every time.
> 6. **If the rating is 2 or less:** **insert into `notifications`** a "bad review" alert for
>    the Manager.

**[DO]** Go back to the Manager window. The **bell** now shows the 2-star review alert.

### 5.11 Feedback (staff view) (1 minute)

**[DO]** Open **Feedback**.

Tiles: **average rating**, **4 stars and up**, **2 stars and under** (each one notified the
Manager), and **total reviews**. The table shows rating, product, comment, **source** (Shelf QR /
Shop QR / Receipt QR) and the customer, or **Anonymous**.

### Buttons: **All / 5★ / 4★ / 3★ / 2★ / 1★**

> **In the database:** `GET /api/feedback?rating=N`, a `find` on `notes` with
> `type: 'feedback'` and that rating, using `populate` for product and customer names, plus
> an aggregation `$group` by rating for the tiles.

### 5.12 Team: creating accounts (1 minute)

**[DO]** Open **Team**.

Each card shows the person, their role, whether they are active, **who created them**, and
when they last signed in. The Owner card says *"The founding account, created by the system"*,
because the first Owner has to come from the setup script. Nobody can register.

### Button: **Add an account → Create account**

As **Owner**, you can create **Manager or Staff**. As **Manager**, only **Staff**.

> **In the database (`POST /api/auth/users`):**
> 1. Only Owner or Manager may call it (others get 403).
> 2. The server checks the role being created is allowed for **your** role. A Manager trying
>    to create a Manager gets 403. This is enforced **on the server**, not only by the
>    dropdown.
> 3. The password is **hashed with bcrypt** (10 salt rounds). The plain password is never
>    saved.
> 4. **Insert into `users`** with `created_by` = your id. That is how the chain of
>    responsibility is recorded.
> 5. If the email is already used, the **unique index** rejects it and the user sees *"That
>    email is already in use"* (409).
> 6. The password hash is marked hidden, so **no API response ever includes it**.

---

## PART 6 — Data quality: `npm run verify` (1 minute)

**[DO]** In the terminal, run `cd server && npm run verify`.

These are **15 automatic checks against the live database**. Some of them:
- Each product's ledger **reconciles**: the last `stock_after` equals current stock.
- Ledger rows form an unbroken chain (each row's "before" equals the previous row's "after").
- No product has more than one **open** restock request.
- No product holds an absurd amount of stock (the Amul milk bug cannot come back).
- **No customer document contains a password field.**
- **Every sale's total equals the sum of its line items.**
- No negative stock, and no product points to a supplier that does not exist.
- Customer visits and total spent match their actual sales.
- The account chain is Owner → Manager → Staff.
- **No sale was ever billed by the Owner.**

*(Run `npm run seed` again afterwards if you want a clean database, because your demo sales
change the data.)*

---

## PART 7 — Security summary (1 minute)

1. **Passwords:** stored as bcrypt hashes, hidden from every query result.
2. **Login token (JWT):** signed by the server and expires in 8 hours. Editing it breaks the
   signature, giving 401.
3. **Roles are checked on the server** for every request (`requireAuth` + `requireRole`).
   Hidden buttons are only a convenience.
4. **The user is re-read from the database on every request**, so a deactivated account stops
   working immediately.
5. **Rate limiting** on login and on the public feedback form.
6. **Validation** in the schema: types, ranges, allowed values and phone format. Errors are
   returned as clear 400/409 messages, never as a crash.
7. **Customers have no password at all.** There is nothing to leak.

---

## PART 8 — What is not finished, and limitations (1 minute)

We would rather say this clearly ourselves:

- *(Updated after Phase 3: the ML, the forecast, the issues screen, tasks, the discussion board
  and the notification centre are now built. The remaining gaps are in `docs/PLAN.md` section 9.)*
  **Nothing appears in the menu without a working screen behind it.**
- **Adding or editing products and suppliers** exists in the API (Manager only, with soft delete
  for products), but the forms for it are not built yet.
- **No multi-document transaction for a sale.** MongoDB supports transactions only on a replica
  set, and ours runs as a single standalone server. We reduce the risk by **checking stock for
  every item before writing anything**, and each stock change is itself atomic. Converting to a
  single-node replica set would fix this properly.

---

## PART 9 — Closing (30 seconds)

To summarise: SIA replaces the shop notebook with one system where **stock only moves through
one audited function**, **restock requests raise themselves at runtime**, **the database itself
prevents duplicate orders**, **billing captures the customer without demanding it**, and
**customers give feedback by QR with no login**. Every movement and every bill records who was
responsible.

Thank you. We are happy to take questions.

---

## PART 10 — Quick-reference table for questions

Keep this open during questions. **"When I press ___, what happens in the database?"**

| Screen → Button | Who can | Collections written | What exactly |
|---|---|---|---|
| Login → **Sign in** | Anyone | `users` (update) | bcrypt check; `last_login` = now; JWT issued |
| Sidebar → **Sign out** | Anyone | — | Token removed from browser |
| Bell → **Mark all read** | Anyone | `notifications` | `updateMany` `$addToSet read_by` |
| Billing → click product / **+ −** / Cash-UPI-Card | Mgr, Staff | — | Browser only |
| Billing → type 10-digit phone | Mgr, Staff | — (read) | `findOne` customers by phone |
| Billing → **Complete sale** | Mgr, Staff | `products`, `stocklogs`, `counters`, `sales`, `customers`, and maybe `restockrequests` + `notifications` | Atomic `$inc −qty`; ledger row; threshold check → auto request (`raised_by: null`); bill no.; totals recomputed; customer visits/spent |
| Restock → **Approve** | Manager | `restockrequests`, `notifications` | pending → **approved**, `approved_by`, `approved_at`; alert to Staff; **stock unchanged** |
| Restock → **Reject** | Manager | `restockrequests`, `notifications` | pending → **rejected**; who/when recorded; alert to Staff |
| Restock → **Mark received** | Mgr, Staff | `products`, `stocklogs`, `restockrequests`, `notifications` | `$inc +qty`; ledger row `received`; approved → **received**, `received_at`, `received_qty`; alert to Manager |
| Stock → **Record count** (within tolerance) | Mgr, Staff | `products`, `stocklogs` | Stock corrected, ledger row `count` |
| Stock → **Record count** (beyond tolerance) | Mgr, Staff | `restockrequests`, `notifications` | **Stock NOT changed**; manual request for Manager |
| Customer → **Save changes** | Manager | `customers` | Phone clash check (409); format check (400); sales untouched |
| QR → dropdown / **Print** / **Open it here** | Owner, Mgr | — | QR generated on the fly; nothing stored |
| Public → **Send feedback** | Anyone (no login) | `notes`, `products`, maybe `notifications` | Note with `author_id: null`; rating avg recomputed; ≤2★ alerts Manager |
| Team → **Create account** | Owner, Manager | `users` | Role-chain check; bcrypt hash; `created_by` |
| Products / Feedback / Restock tabs and filters | All | — (read) | Products filters run in the browser; Feedback/Restock tabs re-query |

### Likely questions, with short answers

**"Is the restock logic only in your demo data?"**
No. It is inside `adjustStock()` in `server/services/stockService.js`, which runs on every
sale at runtime. The demo proves it: we sold Tata Tea and the request appeared with
`raised_by: null`. The rule itself is one small function, `shouldRestock()`, and both the live
server and the data seeder call it, so there is only one copy of the logic.

**"What if two people sell the last item at the same time?"**
The stock update is one atomic operation with the condition `stock >= qty`. The second sale
finds nothing to update and is refused with "Not enough stock". It never goes negative.

**"What if two sales cross the threshold at the same moment?"**
Both might try to insert a restock request, but the partial unique index lets only one succeed.
The second gets duplicate-key error 11000, which we treat as "already requested".

**"Why not delete products?"**
Old bills and ledger rows reference them by id, and MongoDB does not enforce foreign keys. If
we deleted a product, those references would point to nothing. So we set `active: false`.

**"Is your data normalised?"**
Mostly yes, with references between collections. We deliberately denormalise in two places:
sale items copy name and price (a bill must not change when a price changes later), and products
keep `rating_avg` (so lists can sort by rating quickly). The rating is recalculated every time
new feedback arrives, so it never gets out of step.

**"Why three roles and not separate Cashier and Helper?"**
In a small shop the same person bills and counts stock. Accountability comes from recording who
did every movement and every bill, and large stock differences need Manager approval.

**"Why is money in paise?"**
Floating-point arithmetic drifts (0.1 + 0.2 ≠ 0.3). Integers do not. We convert to rupees only
for display.

**"Does a sale use a transaction?"**
No, because transactions need a replica set and ours is standalone. Stock is checked for every
line before any write, and each stock update is atomic. That is our honest limitation.

**"Is this real data?"**
The 9,835 baskets are real (the Groceries dataset from R's `arules` package). Prices, dates,
customers and stock levels are generated because the source does not have them.

**"Where is the machine learning?"**
Phase 2. Because the seeded baskets are real, the association-rule model can run on the same
`sales` collection with no schema change. We measured that useful rules sit at 0.3–0.6% support,
so `min_support` needs to be about 0.003, not the textbook 0.01.

---

### If something breaks during the demo

| Problem | Fix |
|---|---|
| "Cannot reach the server" | API not running: `npm run dev` from the project root |
| Login fails | Data not loaded: `cd server && npm run seed` |
| Nothing works at all | MongoDB not running: `mongosh --eval "db.runCommand({ping:1})"` |
| Data got messy | `npm run seed`. About 10 seconds, always the same result |
| Phone cannot open the QR | Same Wi-Fi needed; otherwise use "Open it here" on the laptop |
