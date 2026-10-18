# Smart Inventory Assistant — Study & Demo Guide

Written for you, to revise from and to present from. Plain language, no jargon you have not met.
`docs/PLAN.md` is the design document; this is the one to read the night before.

---

## 1. What SIA is, in five sentences

A small supermarket runs its stock on paper — a notebook of what is on the shelf, a phone call to the
supplier when something runs out, and no record of either. Nobody can say what sold last month or what
keeps running out. Smart Inventory Assistant replaces that notebook with one shared system: stock,
suppliers and reorder levels in one place. **When a sale takes a product below its reorder level, the
system raises the restock request itself** — nobody has to notice. Customers can rate what they bought
by scanning a QR code, with no account and no password.

**The one sentence to memorise:** *SIA is a centralised inventory system for a small supermarket where
restocking starts itself, billing captures the customer without ever demanding it, and feedback
arrives by QR with no login.*

---

## 2. How the three tiers fit together

```
   BROWSER                    SERVER                      DATABASE
┌──────────────┐        ┌────────────────┐          ┌──────────────┐
│  React SPA   │ HTTP   │  Express API   │ Mongoose │   MongoDB    │
│  (Vite)      │ ─────► │  Node.js       │ ───────► │   `sia`      │
│  port 5173   │ ◄───── │  port 5000     │ ◄─────── │  port 27017  │
└──────────────┘  JSON  └────────────────┘          └──────────────┘
        │                    + JWT
        └── /feedback  (public route, no login — reached by QR)
```

**React** draws the screens and holds nothing important. It knows only what the API tells it.
**Express** owns every rule: who may do what, whether there is enough stock, whether a threshold was
crossed. **MongoDB** stores documents and enforces the constraints that must never be broken
(unique phone numbers, one open restock request per product).

### One request, traced end to end: clicking "Complete sale"

1. **React** posts to `POST /api/sales` with the cart lines, the optional phone, and the JWT in the
   `Authorization` header.
2. **`requireAuth`** verifies the token signature and loads the user from the database. A forged or
   edited token fails here with **401**.
3. **`requireRole('Manager','Staff')`** checks the role. An Owner gets **403** — the account that
   reviews the takings cannot create them.
4. The route **loads every product and checks stock up front**, before changing anything.
5. If a phone was given, the **customer is found or created** — as part of this sale, not as a
   separate step.
6. For each line it calls **`adjustStock()`**, which is the only place stock ever moves.
7. `adjustStock` decrements the product atomically, **writes a `StockLog` row** recording before,
   after and who did it, then **checks the threshold**.
8. If stock is now at or below the threshold, it **creates a `RestockRequest` and a `Notification`
   for the Manager** — with `raised_by: null`, because no person raised it.
9. The `Sale` is saved. A `pre('validate')` hook **recomputes the totals from the line items**, so a
   bill can never be stored with numbers that do not add up.
10. The response carries the receipt **and `restock_raised`**, which is what makes the amber banner
    appear on screen.

---

## 3. The database in one line each

Database `sia`, **11 collections plus three supporting ones** (the last three rows; `tasks` and the
two ML caches arrived in Phases 2 and 3).

| Collection | What it stores |
|---|---|
| `users` | Staff accounts — Owner, Manager, Staff. Passwords bcrypt-hashed, never returned by a query. |
| `suppliers` | Who each aisle is ordered from. |
| `products` | The 169 items: price, stock, reorder level, supplier, average rating. |
| `stocklogs` | Append-only ledger of every stock movement, with before, after and who. |
| `restockrequests` | Purchase requests, from raised → approved → received. Also stock counts that were too far off and wait for the Manager (`kind: adjustment`). |
| `sales` | Bills. Line items embedded; customer linked by id plus the phone as printed. |
| `customers` | Phone-keyed records. **No password field, ever.** |
| `notes` | Customer feedback and internal discussion. A null author means it came from a customer. |
| `notifications` | Written by the events that cause them, never seeded in bulk. |
| `issues` | Floor problems flagged by Staff. |
| `tasks` | Work the Manager gives a named person, with a due date. |
| `combocaches` | *(supporting)* The last combo analysis, so the screen works with Python off. |
| `predictions` | *(supporting)* Forecasts, later filled in with what actually sold. |
| `counters` | *(internal)* Supplies gap-free bill numbers atomically. |

---

## 4. How each feature actually works

### Auto-restock — the headline

**Where the check lives:** inside `adjustStock()` in `server/services/stockService.js`. Every path
that moves stock — a sale, a delivery, a count, a write-off — goes through that one function, so the
threshold is checked on every single movement.

**Why that matters:** the previous version ran its restock logic *once, while loading demo data*, over
products that were already low. At runtime it wrote a stock log but never re-checked. So the headline
feature only ever existed in the sample data. Moving the check inside the service is the entire fix.

**How duplicates are prevented:** two ways, deliberately.
1. The service skips if an open request already exists.
2. **The database refuses one anyway** — `restockrequests` has a *partial unique index* on
   `product_id`, covering `status: 'pending'` **and** `status: 'approved'`.

Why both? The check in code can be raced: two tills selling the last units at the same instant could
both look, both see nothing open, and both insert. The index cannot be raced. If you are asked one
sharp question about this system, it will probably be this one.

**Why the index covers `approved` and not just `pending`.** This was a real bug found during
testing, and it is worth being able to tell the story. A product stays below its threshold for the
whole lead time between the Manager approving an order and the goods actually arriving — often three
or four days. When the guard only covered `pending`, approval released it, so *every subsequent sale
in that window raised another order*. Fast-moving lines ordered themselves over and over: Amul milk
ended up holding **64,598 units, about 510 days of cover**. Extending the index to cover open orders
took the seeded 90 days from 1,682 restock requests down to 588, and stock from 510 days of cover to
about 16. `npm run verify` now includes a check for absurd stock cover, precisely so this cannot come
back unnoticed.

**The threshold rule is one pure function** — `shouldRestock()` in `services/stockRules.js` — and both
the live service *and* the data seeder call it. There is no second copy that can drift.

### Billing and customer capture

One component, two doors. The till opens it empty; a customer's record opens it with that customer
attached. There is no second billing screen.

The phone field drives everything:
- **Blank** → walk-in. The sale completes normally. *Nothing is ever withheld for not giving a number.*
- **Unknown number** → a short form opens in place. The customer record is created **as part of
  completing the sale**.
- **Known number** → their details load and can be corrected right there.

### Why a sale stores both `customer_id` and `customer_phone`

Because the Manager can change a customer's phone number.

- `customer_id` is the **permanent link**. Change the phone and their history still follows them.
- `customer_phone` is a **snapshot of what was printed on that bill**. Reprint an old receipt and it
  shows the number they were actually handed.

Phone alone cannot do both jobs. Store only the phone and editing it orphans every past sale.

### QR feedback with no login

Three codes, one public page:

| Code | Goes on | Opens |
|---|---|---|
| Shelf | the shelf label | that product, pre-selected |
| Shop | the counter | a product picker |
| Bill | the receipt | the items they just bought, pre-filled |

The page is a **public React route with no authentication**. A shopper holding a phone has no login
and never will; asking them to make one would end the interaction. Because it is an unauthenticated
write it is **rate-limited per IP**, otherwise the bad-review alert could be spammed. A rating of 2 or
below notifies the Manager immediately.

### Roles and JWT

Sign in returns a **signed token** carrying only a user id and role. Every protected request sends it
back; the server verifies the signature and **re-reads the user from the database**.

The old build stored `{role: "Owner"}` as plain text in the browser and believed it — typing one line
into the console granted Owner. Here, editing the stored token breaks the signature and the request is
refused with 401.

**The three roles:** Owner sees everything but bills nothing. Manager runs products, suppliers,
approvals, staff — and bills. Staff work the floor and the till. Accounts are created down a chain:
Owner → Manager → Staff. **Nobody self-registers**, which is why the seed creates the first Owner.

---

## 5. Why each decision was made

These are the questions reviewers actually ask.

**Why three roles and not five?** Helper and Cashier were merged into Staff. In a small shop the same
person rings up a sale and then counts the chiller. Splitting them normally guards against someone
pocketing a sale and "correcting" the count later — but **every stock movement and every bill already
records who did it**, so accountability is per-person without a second role. Where the control is
really wanted it sits in the workflow instead: a count differing by more than **5% or 3 units,
whichever is larger**, raises an approval request instead of applying silently.

**Why do customers have no accounts?** Because they would never use them. A customer is a record keyed
by phone, created at the till. There is no password field on the collection and there never will be.

**Why 10 collections and not 8?** *(11 since Phase 3 added `tasks`.)* An earlier draft tried to force everything into 8, which meant
`stocklogs` carrying both stock movements *and* the whole purchase-order lifecycle, with most fields
empty most of the time — and the staff issues screen had nowhere to live at all. Each document should
have one shape. The count was never the goal.

**Why store money as whole paise instead of rupees?** Because `0.1 + 0.2` is not `0.3` in floating
point. Adding up line items, then adding up 9,834 bills, accumulates error until the totals stop
reconciling by a few paise. Integers cannot drift. Rupees are converted at the edge, so the screens
still show ₹.

**Why is nothing ever deleted?** MongoDB does **not enforce foreign keys** — an id stored on a
document is just a field, and nothing stops it pointing at something that was removed. Old bills and
stock logs reference products and users forever, so those are deactivated, never deleted. This is the
single biggest practical difference from the SQL schema in last year's coursework.

**Why use a real dataset instead of making the sales up?** The previous build wrote down six product
pairs it wanted the system to "discover", generated demo baskets to match, and then discovered them.
That is not analysis. SIA seeds from **9,835 real grocery transactions** from the `arules` Groceries
dataset. The basket structure is real; prices, dates and customers are generated around it. So when
the Phase 2 model finds that flour and sugar go together, that is a real pattern in real shopping.

---

## 6. The demo script

### Before you start (5 minutes)

```bash
# 1. MongoDB is a Windows service and should already be running. Check:
mongosh --eval "db.runCommand({ping:1})"

# 2. Fresh, reproducible data
cd server
npm run seed

# 3. Prove the data is sound - run this in front of them, it takes 2 seconds
npm run verify          # 20/20 checks

# 4. Start the two servers, in two terminals
cd server && npm run dev      # API      → http://localhost:5000
cd client && npm run dev      # Screens  → http://localhost:5173
```

**Logins** (the seed prints these too):

| Role | Email | Password |
|---|---|---|
| Owner | `owner@sia.local` | `Owner@123` |
| Manager | `manager@sia.local` | `Manager@123` |
| Staff | `staff1@sia.local` | `Staff@123` |

The login screen has one-click buttons for all three — you never need to type these.

### The run, in order

**1 · Sign in as Owner.** Say: *"Three roles. The Owner sees everything but cannot bill — the account
that reviews the takings should not be able to create them."*
Point at the dashboard: 90 days of real sales, revenue chart, best sellers, aisle breakdown.
**Show the sidebar has no Billing link.** That is the role system working, not a missing feature.

**2 · Sign out, sign in as Staff.** Billing has appeared. Say: *"The menu is generated from the same
config that generates the routes, so a screen cannot be in the menu without existing."*

**3 · The headline — auto-restock.** Go to **Billing**. Search for **Tata Tea Premium 500g** (stock 6,
threshold 5). Add one. Leave the phone blank. Complete the sale.

> An amber banner appears: **"A restock request was raised automatically."**

Say: *"Nobody pressed anything. That sale took stock to 5, which is the reorder level, and the server
raised the request on its way out. The Manager has already been notified."*

**4 · Prove it came from the server, not the screen.** In a terminal:

```bash
mongosh sia --quiet --eval "db.restockrequests.find({status:'pending'}).sort({createdAt:-1}).limit(1).pretty()"
```

Point at **`raised_by: null`** and **`trigger: 'auto'`**. Say: *"No user raised this. The null is the
proof."*

**5 · Sell it again.** Same product, one more. **No second request appears.** Say: *"One open request
per product — and that is enforced by a unique index in the database, not just by an if-statement, so
two tills at the same moment still cannot duplicate it."*

**6 · Customer at the till.** Start a new sale, add anything, type a phone number that does not exist.
A small form opens inline. Type a name, complete the sale. Say: *"The customer record was created by
the sale. No separate 'add customer' step, and no leaving this screen."*
Bill the same number again — it recognises them, shows visit 2, and you can correct the name inline.

**7 · The receipt QR.** On the receipt screen, point at the QR. Say: *"This reaches the customer while
they still have an opinion, and it already knows what they bought."*

**8 · Feedback with no login.** Open `/feedback` in a **private browser window** — or scan the shop QR
with a phone on the same WiFi. Say: *"No login screen, no redirect, no account prompt."* Submit a
2-star rating.

**9 · Sign in as Manager.** The bell shows unread alerts — the restock request *and* the 2-star review.
Go to **Restock requests**: around 47 are waiting for a decision. Approve one, then mark another as received
and watch the stock rise. Say: *"Approve, then receive. Stock goes up and the request closes."*

**10 · Customer record.** Open any customer. Show details, history, then the product search at the
bottom. Say: *"The Manager can browse stock right here and go straight to billing with the customer
already attached."* Change their phone number and show the purchase history is still intact.

**11 · Close on the ledger.** Open **Stock ledger**. Say: *"Every movement, with before, after, and who
was responsible. It is append-only — a correction is a new row, never an edit. That is how the system
stays auditable without needing a separate role to police it."*

### If something breaks

| Problem | Do this |
|---|---|
| Screens show "Cannot reach the server" | The API is not running. `cd server && npm run dev` |
| Login fails | Data was never seeded. `cd server && npm run seed` |
| Nothing at all works | `mongosh --eval "db.runCommand({ping:1})"` — start the MongoDB service |
| Demo data got messy mid-run | `npm run seed` — 8 seconds, always identical |
| QR will not scan from a phone | The phone must be on the same WiFi. Otherwise open the URL on the laptop — it proves the same thing |

**Nothing needs the internet.** Every dependency is bundled; fonts and icons are local files.

---

## 7. Likely questions, with honest answers

**"Is this real data or did you make it up?"**
The baskets are real — 9,835 transactions from the Groceries dataset that ships with the R `arules`
package, real point-of-sale data from a grocery outlet. What items get bought together is genuinely
theirs. Prices, dates, customers and stock levels are generated, because the dataset has none. I
mapped its 169 items onto Indian supermarket products so the shop reads sensibly; the mapping is
one-to-one and semantic, so the co-occurrence is untouched.

**"Why is it spread over 90 days when the source is one month?"**
I deliberately re-dated it. At 90 days it is about 109 sales a day, which is plausible for a small
shop; the original month implies 328 a day. It is re-dating and I would not claim otherwise.

**"What happens if two people bill the last item at the same time?"**
The stock update is a single atomic operation with a condition that refuses to go negative, so the
second one fails with a clear message rather than overselling. The same reasoning covers restock
requests, which is why the uniqueness is an index and not just a check.

**"Does the sale use a transaction?"**
No, and that is a real limitation. MongoDB only supports multi-document transactions on a replica set,
and this runs as a standalone service. The mitigation is that stock is checked for every line *before*
anything is written, so a partial sale is very unlikely rather than routine. Converting to a
single-node replica set would fix it properly.

**"Where is the machine learning?"**
Not built yet — that is Phase 2, and I would rather show you something that works than something that
half-does. The groundwork is deliberate though: because the seeded sales are real baskets, the
association-rule model drops in against the same `sales` collection with **no re-seed and no schema
change**. One thing I have already measured: the good rules in this data sit at 0.3–0.6% support, so
the textbook `min_support` of 0.01 returns nothing at all. It needs to be about 0.003.

**"What is not finished?"**
*(Updated after Phase 3.)* The ML service, forecast, issues screen, tasks, discussion board and
notification centre are all built now. What is still missing is listed honestly in `docs/PLAN.md`
section 9: database-level `$jsonSchema` validators, multi-document transactions, and push (rather
than polled) notifications. Nothing appears in the menu that does not have a working screen behind
it; that was deliberate, because the previous version had a menu full of links that led nowhere.

**"How do I know the stock numbers are not just made up?"**
Run `npm run verify`. It reads every product's ledger and checks that the last recorded "stock after"
equals what the product currently holds, that every row chains into the next, that every bill adds up,
and that no customer document has a password. 20 checks, and they run against the live database in
front of you.

---

## 8. Five-line cheat sheet

1. **Auto-restock lives inside `adjustStock()`** — every path that moves stock goes through it, so it
   fires at runtime, not at seed time.
2. **Duplicates are stopped by a unique index**, not just an if-statement, because a check can be raced.
3. **Sales store `customer_id` *and* the phone as printed** — so editing a number never loses history.
4. **Money is stored in paise**; floats drift, integers do not.
5. **Nothing is deleted**, because MongoDB does not enforce foreign keys and old bills reference these
   records forever.
