# Smart Inventory Assistant — Project Plan (rev. 24 Sep 2026)

## Context

SIA is a centralized inventory system for a **small supermarket**. This is a from-scratch build in a
new directory. The previous attempt (`Documents\SmartInventoryAssistant`) is a frontend-only
localStorage demo with no server, no database and no version control; **nothing is carried over from
it** — not code, not CSS, not diagrams, not the old `docs/PLAN.md`, not the SRS or the decks. It stays
on disk untouched and is not consulted as a spec.

**Hard constraint: a demo first thing on 25 Sep 2026, with only tonight to build.** Phase 1 is
therefore scoped to exactly what has to be on screen: a real database behind working screens. The ML
model is deliberately deferred to Phase 2 — no Python tonight, and no third process to keep alive in
front of an audience.

**The ML is deferred, not designed out.** Because the Phase 1 seed loads real grocery *baskets*, the
association-rule model drops into Phase 2 against the same `Sale` documents with **no data migration
and no re-seed**. That is why the dataset choice still matters tonight.

## Project statement

> A centralized inventory system for a small supermarket. Stock, suppliers and thresholds live in one
> place; restock requests raise themselves the moment stock crosses a threshold; sales are recorded at
> the till against an optional phone number; customers leave feedback by scanning a QR with no account;
> and an association-rule model pairs slow-moving products with strong sellers, explains each pairing
> in support/confidence/lift, then checks its own prediction against what actually sold.

---

# THE SYSTEM

## Roles

| Role | Does |
|---|---|
| **Owner** | Creates the Manager. Sees everything — stock, sales, analytics, feedback, combos. Runs nothing, bills nothing. |
| **Manager** | Products, thresholds, suppliers. Approves restock and adjustment requests, marks stock received. Hires Staff. Maintains customer records. Decides on combo suggestions. **Bills too.** |
| **Staff** | The floor and the till — records sales, enters customer details while billing, counts stock, restocks, flags issues, posts in Discussion. |
| **Customer** | **Not a role.** A phone-keyed record. No login, no password. |

Helper and Cashier are merged into **Staff**: in a small shop the same person rings up a sale and then
counts the chiller. Accounts are created down a chain — Owner → Manager → Staff. **Nobody
self-registers, so the seed creates the first Owner.** An owner who works the counter gets a separate
Staff account.

**Billing is done by Staff and Manager, never the Owner** — the account that reviews the takings
should not be able to create them.

**Shrinkage control without a fourth role.** Splitting till from stock normally guards against someone
pocketing a sale and "correcting" the count later. Two roles are not needed for that: every `StockLog`
and `Sale` records its author, so accountability is per-person. The control lives in the workflow
instead — a stock correction differing from system stock **by more than 5% or 3 units, whichever is
larger**, raises an adjustment request for the Manager rather than applying silently. Same pattern as
the restock request, so it is nearly free.

## The database — MongoDB, **10 domain collections + 1 internal, decided**

**Connection.** Local MongoDB 8.3.7 already running as a Windows service. Database name **`sia`**,
`MONGODB_URI=mongodb://127.0.0.1:27017/sia` in `.env`. Mongoose with `strict: true` and `timestamps`
on every schema, one file per collection in `server/models/`. The seed drops and rebuilds `sia`.

**Embed or reference — the rule used throughout.** `Sale.items[]` is **embedded**, because a bill is
always read as one unit, is never queried across, and its contents must freeze at the moment of sale.
**Everything else is referenced** by `ObjectId`, because products, customers and users change
independently and get queried on their own. Three deliberate denormalizations, each earning its keep:
`Sale.items[].name/sku` and `Sale.customer_phone` (a reprint must show what the customer was actually
handed, even after a rename or a number change), and `Product.rating_avg/rating_count` (so the product
list sorts by rating without aggregating `Note` on every page load).

**Why 10 and not 8.** An earlier draft forced everything into 8, which meant `StockLog.entry_type`
carrying stock movements *and* the whole purchase-order lifecycle (qty, status, approved_by,
received_at, supplier) in one collection where most fields were null most of the time — and the staff
issues screen had nowhere to live at all. `RestockRequest` and `Issue` get their own collections so
each document has exactly one shape. **The count was never the design goal.**

---

### 1. `User` — staff accounts only
```
name          String   required
email         String   required, unique, lowercase
password_hash String   required          // bcrypt, cost 10
role          String   required  enum: Owner | Manager | Staff
phone         String
active        Boolean  default true      // deactivate, never delete — logs reference users
created_by    ObjectId → User            // null only for the seeded bootstrap Owner
last_login    Date
```
**Indexes:** `email` unique · `role`

### 2. `Supplier`
```
name            String  required
contact_person  String
phone           String
email           String
address         String
active          Boolean default true
```
**Indexes:** `name`

### 3. `Product`
```
sku           String   required, unique
name          String   required
category      String   required
unit          String   enum: pc | kg | litre | pack
price         Number   required          // selling price
cost          Number                     // purchase cost
stock         Number   required, default 0
threshold     Number   required          // reorder level
reorder_qty   Number   required          // how much a raised request asks for
supplier_id   ObjectId → Supplier  required
active        Boolean  default true
rating_avg    Number   default 0         // denormalized from Note
rating_count  Number   default 0
```
**Indexes:** `sku` unique · `category` · `supplier_id` · `stock` (low-stock queries)

### 4. `StockLog` — movements only, append-only
```
product_id          ObjectId → Product  required
entry_type          String   required  enum: sale | received | count | damage | return | adjustment
quantity_change     Number   required          // signed: -3, +50
stock_before        Number   required
stock_after         Number   required          // before/after make the ledger auditable
reason              String
source              String   enum: billing | manual | restock | seed
user_id             ObjectId → User  required  // accountability is per-person
sale_id             ObjectId → Sale
restock_request_id  ObjectId → RestockRequest
```
**Indexes:** `{product_id, createdAt}` · `user_id` · `entry_type`

Never updated or deleted — a correction is a new row. This is what makes shrinkage traceable without
a fourth role.

### 5. `RestockRequest`
```
product_id            ObjectId → Product   required
supplier_id           ObjectId → Supplier  required
qty                   Number   required
status                String   default 'pending'  enum: pending | approved | rejected | received
trigger               String   default 'auto'     enum: auto | manual
stock_at_request      Number                      // what the shelf held when it fired
threshold_at_request  Number                      // and what the threshold was then
raised_by             ObjectId → User             // null when the server raised it automatically
approved_by           ObjectId → User
approved_at           Date
received_at           Date
received_qty          Number
note                  String
```
**Indexes:** `{product_id, status}` · `status` · **partial unique on `product_id` where
`status: 'pending'`**

That partial unique index is the important one: it makes **"one pending request per product" a
database constraint**, not just an `if` in the service. The application guard can be bypassed by a
second concurrent sale; the index cannot.

### 6. `Sale`
```
bill_no         String   required, unique     // SIA-20260924-0001
items: [ {
  product_id    ObjectId → Product  required
  name          String   required            // snapshot
  sku           String   required            // snapshot
  qty           Number   required
  unit_price    Number   required            // snapshot — price changes never rewrite old bills
  line_total    Number   required
} ]
subtotal        Number   required
discount        Number   default 0
tax             Number   default 0
total           Number   required
payment_method  String   default 'cash'  enum: cash | card | upi
customer_id     ObjectId → Customer          // null = walk-in
customer_phone  String                       // snapshot as printed on that bill
billed_by       ObjectId → User  required    // Staff or Manager, never Owner
```
**Indexes:** `bill_no` unique · `createdAt` · `customer_id` · `billed_by`

`customer_id` **and** `customer_phone` together are the whole point: the id survives a phone change so
history holds, the snapshot preserves what was printed.

### 7. `Customer` — no account, no login
```
phone        String   required, unique      // the key
name         String
address      String
email        String
first_seen   Date
last_seen    Date
visits       Number   default 0
total_spent  Number   default 0
created_by   ObjectId → User                // whoever billed them first
```
**Indexes:** `phone` unique

**There is no `password` field and there never will be.** Customers do not log in.

### 8. `Note` — customer feedback and internal discussion
```
type           String   required  enum: feedback | discussion
body           String
author_id      ObjectId → User               // null ⇒ customer feedback
rating         Number   min 1, max 5         // feedback only
product_id     ObjectId → Product
sale_id        ObjectId → Sale               // bill-QR feedback
contact_phone  String                        // optional, given by the customer
customer_id    ObjectId → Customer           // resolved from contact_phone at write time
source         String   enum: product_qr | shop_qr | bill_qr | staff
parent_id      ObjectId → Note               // discussion threading
```
**Indexes:** `{type, createdAt}` · `product_id` · `rating`

These two share a collection because they are the same shape — a body, an author, a timestamp, a
thread — differing only in whether the author is a user. That is a real commonality, unlike the
purchase-order fields that were being forced into `StockLog`.

### 9. `Notification` — always written by a trigger, never seeded
```
type         String   enum: low_stock | restock_request | restock_approved | stock_received |
                            adjustment_request | bad_review | issue_raised
title        String   required
body         String
for_role     String   enum: Owner | Manager | Staff     // role-targeted
for_user_id  ObjectId → User                            // or user-targeted
ref_type     String                                     // 'RestockRequest', 'Note', 'Issue'
ref_id       ObjectId                                   // the document that caused it
link         String                                     // screen to open
read_by      [ObjectId → User]
```
**Indexes:** `{for_role, createdAt}` · `read_by`

### 10. `Issue` — staff-flagged floor problems
```
title        String   required
description  String
product_id   ObjectId → Product                  // optional
category     String   enum: damage | expiry | shelf | pricing | equipment | other
severity     String   enum: low | medium | high
status       String   default 'open'  enum: open | acknowledged | resolved
raised_by    ObjectId → User  required
resolved_by  ObjectId → User
resolved_at  Date
```
**Indexes:** `status` · `raised_by`

---

**Relationship map.**
`Supplier` 1—N `Product` · `Product` 1—N `StockLog` / `RestockRequest` / `Note` / `Issue` ·
`Customer` 1—N `Sale` · `User` 1—N `Sale` (billed_by) / `StockLog` (user_id) / `Issue` (raised_by) ·
`Sale` 1—N embedded `items[]`, and 1—N `Note` via the bill QR.

**Schemas 1–10 are all created in Phase 1 step 1.2**, including `Issue` — the collection exists and is
indexed tonight even though its screen is Phase 3, so no migration is needed later.

---

## Database quality — what makes it well-built, not merely present

A correct field list is not a good database. These are the things that separate the two, all of them
in scope for step 1.2.

**Validation lives in the schema, in two layers.** Mongoose validators (`required`, `min`/`max`,
`enum`, `match` for phone and email) catch bad writes from our own code with useful messages. Beneath
that, each collection is created with a MongoDB **`$jsonSchema` validator**, so a bad document cannot
be inserted even from `mongosh` or Compass. Application-only validation is the thing that makes a
database drift from its own rules.

**Money is stored as integer paise, never floating point.** `price`, `cost`, `unit_price`,
`line_total`, `subtotal`, `discount`, `tax`, `total`, `total_spent`. Doubles accumulate error across
`items[]` and again across a 90-day sales aggregation, and the totals stop reconciling by a few paise
— the classic bug, and an awkward one to be asked about at a review. Conversion happens at the API
edge, so screens still deal in rupees. **Decided — no floating-point money anywhere in the schema.**
Mongoose getters/setters do the rupee↔paise conversion, and aggregation pipelines work in paise and
convert once at the end.

**`password_hash` is `select: false`.** It is never returned by a query unless explicitly asked for,
so it cannot leak through a careless `res.json(user)`. Belt and braces with a `toJSON` transform that
strips it.

**`bill_no` is generated atomically** from a tiny internal `counters` collection via
`findOneAndUpdate({_id:'bill'}, {$inc:{seq:1}}, {upsert:true, returnDocument:'after'})`. Deriving it
from a count or a timestamp gives two tills the same bill number under concurrent sales. This is a
supporting collection, not a domain entity — **10 domain collections plus `counters`.**

**A text index on `products.name` + `category`.** The Manager's customer screen searches stock inline,
and the till needs type-ahead. Without it that search is a collection scan behind a regex on every
keystroke.

**Derived values are maintained by hooks, not by callers.** A `pre('validate')` hook computes
`line_total` and the `Sale` totals from `items[]`, so a bill can never be saved with numbers that do
not add up. A hook on feedback writes recomputes `products.rating_avg`/`rating_count`. Leaving this to
whoever calls the API is how denormalized fields go stale.

**Virtuals for what is derivable:** `product.is_low_stock` (`stock <= threshold`) and
`product.stock_value`. Never stored — a stored flag is one more thing that can disagree with reality.

**Nothing is hard-deleted.** `users`, `products` and `suppliers` carry `active` flags and a Mongoose
query helper (`.activeOnly()`), because `stocklogs` and old `sales` reference them forever. Mongo does
not enforce foreign keys — an `ObjectId` is just a field holding an id, and nothing stops it pointing
at a document someone removed. **Soft deletion is what keeps those references valid**, and it is the
single most important consequence of this being MongoDB rather than the SQL schema the earlier
coursework used.

**The seed is deterministic.** A fixed RNG seed means every run produces the same database, so a demo
is reproducible and a bug is reproducible with it. It uses `insertMany` in batches — 9,835 sales via
individual `save()` calls is slow enough to notice.

**The connection is production-shaped:** pool size set, retry on initial connect (the Mongo service
can still be starting), listeners on `error` and `disconnected`, and a `SIGINT` handler that closes
cleanly so `nodemon` restarts do not leak connections.

**The model is designed for the queries it will actually serve** — low-stock list, sales by day, top
products, a customer's history, product performance joining sales with ratings, and Phase 2's basket
extraction. Each is a single indexed query or one `$lookup`; none requires a scan.

## Auto-restock — the headline behaviour

One `adjustStock()` service. **Every path that moves stock goes through it, and the threshold check
lives inside it**, so it fires at runtime. The old build ran `generateOrders()` once during seeding
over products already below threshold, and `adjustStock()` wrote a stock log but never re-checked —
the headline feature existed only in the demo data.

**Guard: skip if a pending `RestockRequest` already exists for that product.** Without it, every later
sale of a below-threshold product raises another request and the screen drowns in notifications.

The receive half is built too: approve → mark received → stock rises → request closes. The old build
has no such path at all.

## Billing — one component, two entry points

The till and the customer record share the **same billing component**. From the till it opens empty
with an optional phone field; from a customer's record it opens with that customer attached. Not two
screens.

The phone field drives it:
- **Blank** → walk-in, sale completes normally. **Nothing is ever gated on giving a number.**
- **New number** → a short inline form opens in place (name, address if wanted on the bill). The
  `Customer` is created as part of completing the sale — no separate "add customer" step, no leaving
  the screen.
- **Known number** → their details load and can be **corrected inline** right there. `lastSeen`
  updates, `visits` increments, the sale attaches.

**Customer details are captured at billing, by whoever is billing** — Staff at the till, not the
Manager alone. Most customers are created at the till.

**The Manager's customer screen is for maintenance afterwards**, in this order down the page: their
details with an edit control on each; visit history; then **a product search** — browse stock right
there and, when the customer decides to buy, *Proceed to billing* with them already attached. That
flow is what makes the screen worth having rather than a read-only profile page.

## QR — how customers reach the system

Three codes, one public route, all generated server-side by the Manager and printable:

| QR | Lives on | Opens | Effect |
|---|---|---|---|
| **Product** | shelf label | `/feedback/:productId` | that product pre-selected |
| **Shop** | counter / door | `/feedback` | product picker, then rating |
| **Bill** | printed receipt | `/feedback?sale=:saleId` | the items they just bought, pre-filled |

The bill QR is the strongest: it reaches the customer when they have an opinion, and already knows
what they bought and which phone was on the sale — so feedback links to their history **without asking
them for anything**.

Public React route. **No auth, no redirect to login, no account prompt.** Submitting writes a `Note`
with `type:'feedback'`, `author_id:null`, the product, the rating and an optional `contact_phone`; a
phone matching a stored customer links it to their purchase history. A rating ≤2 fires a bad-review
notification to the Manager. **Per-IP rate limit**, because it is an unauthenticated write and the
bad-review notification is otherwise trivially spammable.

**Ratings are an ML input, not a side feature.** Product performance is sales *and* ratings together:
a product selling poorly and rating poorly is a delisting candidate; one selling poorly but rating
well is a visibility or pairing problem — exactly what the combo engine should target.

**Deliberately out of scope:** a public QR catalogue where customers browse live stock and reserve
items. Separate module, its own problems (holding stock, no-shows).

## The seed — real grocery baskets

**Source: `groceries.csv`** — 9,835 transactions, 169 distinct items, 78% of baskets hold 2+ items,
average 4.4. To be committed to `server/seed/data/groceries.csv`.

**Provenance — recorded because it belongs in the report.** This is the **Groceries** dataset from the
R **`arules`** package (Hahsler, Grün & Hornik): real point-of-sale transactions from a European
grocery outlet, one month of trading, items aggregated by the publishers to 169 categories.
**Downloaded 24 Sep 2026** from `raw.githubusercontent.com/stedy/Machine-Learning-with-R-datasets`,
a third-party mirror of the datasets used in *Machine Learning with R* — **cite `arules`, not that
URL**. 500,843 bytes, sha256 `ff1be892fd6b9b57d1a7bc50de067798963dda607619645988b21789bf23ae3b`.
No header row; ragged lines of 1–32 items. **It is real data, not generated.**

**Two honest caveats.**
1. *The original spans 30 days, not 90.* The seed deliberately re-dates the baskets across 90 days,
   which gives ~109 sales/day — more plausible for a small shop than the original ~328/day. It is
   re-dating, and should be described as such rather than implied to be 90 days of source data.
2. *The 169 "items" are aggregated categories from a European shop, not Indian retail SKUs.* Some
   read fine (*whole milk, butter, sugar, detergent*); around 25 are category buckets that look wrong
   next to a price (`other vegetables`, `kitchen utensil`, `sound storage medium`); and a handful are
   distinctly European (`zwieback`, `liver loaf`, `pip fruit`, `prosecco`).

### The catalogue is mapped to Indian supermarket products

**All 169 items are mapped one-to-one to Indian retail products**, named the way a listing would name
them — brand, product, pack size:

| Dataset item | Product | Category | ₹ |
|---|---|---|---|
| whole milk | Amul Gold Full Cream Milk 1L | Dairy | 68 |
| flour | Aashirvaad Whole Wheat Atta 5kg | Staples | 285 |
| rolls/buns | Britannia Pav Buns 6 pcs | Bakery | 35 |
| root vegetables | Fresh Potatoes 1kg | Produce | 32 |
| other vegetables | Fresh Mixed Vegetables 1kg | Produce | 60 |
| soda | Thums Up 750ml | Beverages | 45 |
| detergent | Surf Excel Easy Wash 1kg | Household | 135 |
| zwieback | Britannia Rusk 300g | Bakery | 45 |
| sound storage medium | SanDisk Pen Drive 32GB | Electronics | 399 |

**The mapping is semantic, never arbitrary** — a milk item maps to a milk product, a bakery item to a
bakery product. That is what keeps the associations meaningful: *flour + sugar* becomes *Aashirvaad
Atta + Madhur Sugar*, which is still exactly the co-occurrence the real data recorded. An arbitrary
mapping would turn Phase 2's combo cards into confident nonsense — the precise failure that got the
UCI giftware dataset rejected.

The mapping lives in **`server/seed/data/catalogue.json`** (dataset item → name, category, price,
unit), committed and editable, so refining it later is a data edit and never a re-seed of the schema.
`category` and the price bands fall straight out of it rather than being guessed by a keyword rule.

**One point to note:** ~10 items are alcohol (`bottled beer`, `whisky`, `rum`, `white wine`). Kept as
a licensed section, because *bottled beer + liquor* is one of the strongest associations in the data
and dropping it would weaken the Phase 2 demo. Easy to remove later if the shop shouldn't stock it.

The dataset carries no quantities (an item is either in a basket or not), no prices, no dates and no
customers. All four are generated; see the per-collection breakdown below.

**Chosen on measurement, not assumption.** It yields genuine, explainable supermarket co-occurrence —
*flour + sugar*, *ham + processed cheese*, *bottled beer + liquor*, *coffee + condensed milk*. Of
1,348 pairs seen 25+ times: 15 at lift ≥3, 82 at lift 2–3, 323 at 1.5–2, and **476 below 1.2**. That
last number is the proof there is real signal to find rather than noise.

The UCI Online Retail dataset in `Downloads` was profiled first and **rejected**: a UK giftware
wholesaler, so the shop would not be a supermarket, and its strongest pairs are colour variants of one
product (*green teacup → pink teacup*, lift 10) which make useless suggestions. Kept as a fallback.

**This is how the old build's worst flaw gets fixed.** It hardcoded six `AFFINITIES` pairs, planted
baskets to match, then "discovered" them, and its forecasts were six hand-typed numbers. Here the
co-occurrence is real purchasing and nothing is planted.

**What the dataset gives and what it does not.** `groceries.csv` contains *only item names grouped
into baskets* — no prices, no dates, no quantities, no customers, no stock. So the **basket structure
is taken and never touched**, and everything else is generated around it. That division is the whole
integrity claim: the part the ML will later learn from is real, and the part that is invented is the
part no conclusion rests on.

### What goes into each collection

**`products` — 169 rows, one per dataset item.**
- `name`, `category`, `price` and `unit` come from `catalogue.json` — the Indian product mapping
  above (*Amul Gold Full Cream Milk 1L*, *Aashirvaad Whole Wheat Atta 5kg*).
- `sku` generated sequentially, `SIA-0001`…`SIA-0169`.
- `cost` set 20–30% below `price`, so margin is real and the analytics have something to compute.
- Categories span ~11 aisles: dairy, bakery, produce, meat, frozen, beverages, alcohol, snacks,
  staples, household, personal care.
- `threshold`, `reorder_qty` and opening `stock` are **derived from that product's real sales
  velocity** over the 90 days, not random: threshold ≈ 7 days of average sales, reorder_qty ≈ 21 days.
  A product selling 40/week gets a threshold near 40; one selling 2/week gets 2. Random thresholds are
  what make a seeded inventory look obviously fake.

**`suppliers` — 8–10 rows**, each owning one or two categories, so every product has a real supplier
and the restock flow has somewhere to send the request.

**`users` — 4 rows.** The bootstrap Owner (created by nobody), a Manager created by the Owner, two
Staff created by the Manager — so the creation chain is real in the data, not just a rule in the code.
**The seed prints these logins at the end of its run**, so they are to hand at demo time.

**`customers` — ~400 rows.** Generated names, Indian-format phone numbers, some with addresses and
some without. Visit counts follow a **long tail** — a few regulars with 20+ visits, most with one or
two — because a uniform distribution makes the customer screen look synthetic. `visits`, `last_seen`
and `total_spent` are computed from the sales actually attached, never assigned independently.

**`sales` — 9,835 rows.** One per dataset basket, spread across the **last 90 days ending today**,
weighted by day of week (weekend peaks) and by hour so Phase 2's forecast has genuine seasonality.
Quantities per line are small retail numbers (1–3). **~40% carry a `customer_id`**; the rest are
walk-ins, so both billing paths exist in seeded data before anyone touches the till.

**`stocklogs` — ~43,000 rows**, one per sale line plus every restock receipt. See the replay below.

**`restockrequests` — ~100–200 rows**, produced *by the replay*, not written by hand: a mix of
`received` (historical, closed) and a few `pending` ones so the Manager's approvals queue has content
on opening.

**`notes` — ~600 rows.** Feedback with 1–5 ratings across a subset of products, skewed positive with a
deliberate handful of poor ones so the bad-review path has examples; plus a few `discussion` posts.
Product `rating_avg`/`rating_count` are recomputed from these, never assigned.

**`notifications` — a handful of historical rows only.** These are trigger-written by design; seeding
a pile of them would repeat exactly the old build's mistake of hardcoding *"4 products are below
threshold"*.

**`issues` — ~6 rows**, a few open and a few resolved, so the Phase 3 screen has data waiting.

### The seed replays 90 days chronologically — it does not fabricate stock

This is the part that makes the data trustworthy. A naive seed inserts sales as history and then sets
`stock` to some plausible number, which leaves the ledger disagreeing with the shelf from the first
minute. Instead the seed **walks the 90 days in order**: opening stock, then each day's sales
decrementing it through the same threshold rule the live service uses, raising a restock request when
a product crosses, and receiving it a realistic 2–4 days later.

Three things fall out of that for free:
- `stock_before`/`stock_after` on every `stocklog` row are **genuinely consecutive**, so the ledger
  reconciles to current stock exactly. That is checkable in `mongosh`, and it is the kind of thing a
  reviewer does check.
- Historical restock requests exist because the threshold rule actually fired, with real
  `stock_at_request` values — not because someone wrote a fixture.
- Stock never goes negative, and current stock is a believable end state rather than a guess.

**The threshold rule is one pure function** — `shouldRestock(product, newStock)` — called by both the
live `adjustStock()` service and the seed replay. The seed replays in memory and bulk-inserts
(9,835 sales and ~43,000 logs via individual `save()` calls would be slow), but it cannot drift from
runtime behaviour, because there is only one copy of the rule. **This is the structural fix for the
old build's worst bug**, where seed-time restocking and runtime restocking were separate code and only
the seed-time one existed.

Opening stock is then tuned so that, at the end of the replay, **a handful of products sit one sale
above their threshold** — so the live auto-restock demo fires on the first sale rather than the
twentieth.

**The seed is deterministic** (fixed RNG seed): the same database every run, so the demo is
reproducible and so is any bug in it.

## Tech stack

| Layer | Technology | Phase |
|---|---|---|
| Frontend | React 18 + Vite, React Router, Bootstrap 5 / React-Bootstrap | 1 |
| Backend | Node.js, Express, REST, JWT, bcrypt | 1 |
| Database | MongoDB + Mongoose | 1 |
| QR | `qrcode` (Node, server-side) | 1 |
| ML service | Python, FastAPI, pandas, mlxtend, scikit-learn | 2 |
| Charts | Recharts | 2 |
| Scheduler | `node-cron` | 2 |
| Tools | Git, Postman, VS Code, draw.io | — |

```
React SPA (Vite) ──HTTP/JSON+JWT──> Express REST API ──Mongoose──> MongoDB
      │                                    │
      │ /feedback/:productId               └──HTTP──> FastAPI  (Phase 2)
      │ (public, no auth)                             Apriori · LinearRegression
      └─ reached by QR
```

**Express owns the database; FastAPI never connects to Mongo.** Express sends baskets in the request
body and stores the returned rules. One DB owner, no Python Mongo driver, and :8000 holds no
credentials.

## Repo structure

**New directory: `C:\Users\WELCOME\Documents\smart-inventory-assistant`.** `git init` before the first
line of code — the old project has no version control and two people are working on this one.

```
smart-inventory-assistant/
  server/   Express + Mongoose. models/ routes/ controllers/ services/ middleware/ seed/
  client/   React + Vite. src/{components,pages,hooks,api,styles}
  ml/       FastAPI. main.py, apriori.py, forecast.py, requirements.txt   (Phase 2)
  docs/     PLAN.md, diagrams/
  .gitignore  README.md
```

## Verified environment (24 Sep 2026)

| Tool | Status |
|---|---|
| Node / npm | v24.16.0 / 11.17.0 |
| MongoDB | 8.3.7, **running as a Windows service** — no manual `mongod` |
| mongosh | 2.9.2 |
| Python | 3.14.6; mlxtend 0.25.0 + scikit-learn 1.9.1 confirmed installable — not needed until Phase 2 |

**Consequence:** Mongo is standalone, so there are **no multi-document transactions**. The sale path
(write `Sale` → decrement stock → maybe raise a restock request) is non-atomic. Accepted; a
single-node replica set is the fix if it ever matters.

---

# PHASE 1 — DATABASE + SCREENS (tonight, demo-ready)

Each step is a clean stop point, so if the night runs out the project stops somewhere coherent.

**1.1 Scaffold.** New directory, `git init`, `.gitignore`, `.env`, Express + Mongoose connection.

**1.2 The database.** All 10 schemas in `server/models/`, one file each, plus the `counters` helper —
with every item from **Database quality** above: two-layer validation, integer-paise money,
`select:false` on the password hash, atomic `bill_no`, the product text index, the partial unique index
on pending restock requests, derived-value hooks, virtuals, soft-delete query helpers, and a
production-shaped connection. This is the step the whole demo rests on; it gets done properly rather
than quickly.

**1.3 Auth.** bcrypt, JWT with expiry, role middleware checked **server-side on every route**. The old
session was `{id,name,email,role}` in plain localStorage trusted by `requireRole()` — setting
`localStorage.sia3_session = {role:'Owner'}` granted Owner, and passwords were compared with `===`.

**1.4 Seed.** Per the rules above. → *Stop point: a real populated database, verifiable in Compass.*

**1.5 REST routes.** Products, suppliers, stock, sales, customers, feedback — all role-guarded.

**1.6 Stock service + auto-restock**, including the dedupe guard and the receive half.

**1.7 React shell.** Vite, fresh stylesheet, `<Layout>` with role-driven sidebar, **router generated
from the same role config the sidebar reads**, API client with JWT handling, Login. The old `roles.js`
listed ten destinations with no files behind them. → *Stop point: log in as each role, see the right
nav.*

**1.8 Products + Stock screens** over real seeded data.

**1.9 Billing + customer screens** — the shared component, both entry points, inline customer capture.

**1.10 Public QR feedback** — the public route, plus server-side product and shop QR generation.

**1.11 `docs/STUDY-GUIDE.md` — written for you, to study from and to present from.** Not developer
documentation and not a copy of this plan. Plain language, in this order:

1. **What SIA is** in five sentences, and the problem it replaces.
2. **How the three tiers fit together** — what React does, what Express does, what MongoDB does, and
   what actually happens between them when you click "complete sale". One request traced end to end.
3. **Every collection in one line each** — what it stores and why it exists.
4. **How each feature works, mechanically**, so you can answer "but how?": auto-restock (where the
   check lives, why inside the service and not at seed time, how duplicates are prevented), billing
   and inline customer capture, QR feedback without login, roles and JWT.
5. **Why each decision was made** — 3 roles not 5, no customer passwords, phone-keyed customers with
   an id on the sale, 10 collections not 8, integer paise, soft deletes, a real dataset instead of
   planted pairs. These are the questions a reviewer actually asks.
6. **The demo script** — a numbered click-by-click run: what to open, in what order, what to say at
   each step, and the exact `mongosh` command to prove the restock request was written **by the
   server**. Includes the login details the seed prints, and a "if something breaks, do this" note.
7. **Likely questions with answers**, including the honest ones: why no transactions, why the data is
   re-dated across 90 days, what is real in the dataset and what is generated, and what is not built
   yet (the ML, Phases 2 and 3).

Written as the build finishes so it describes what actually exists, not what was planned.

**Notifications are written by their triggers**, never hardcoded. The old seed hardcoded *"4 products
are below threshold"* and contained exactly one runtime notification write in the whole build.

**Nothing dead in the sidebar.** Combos, forecast, issues and discussion get no nav entry until they
have screens behind them — shipping dead links into a demo is precisely the old build's mistake.

### Phase 1 verification

1. `npm run seed` populates all 10 collections; counts check out in `mongosh`/Compass; demo logins
   print.
2. Express :5000 and Vite :5173 start clean.
3. **Auto-restock, end to end — the most important test.** Staff sells a product past its threshold →
   a `RestockRequest` with `status:'pending'` exists in `mongosh`, created **by the server**, and the
   Manager's bell shows it. Sell again → **no second request**.
4. **Receive stock:** approve → mark received → stock rises → request closes.
5. **Walk-in:** a sale with the phone blank must succeed. Sell twice to one phone → one Customer,
   `visits: 2`.
6. **Customer created at the till:** bill an unknown phone as Staff → inline form → complete → one
   Customer exists, created by the sale. Bill again, correct the name inline → **updated, not
   duplicated**.
7. **Phone edit:** Manager changes a phone → **past sales still appear in that customer's history**,
   and the next bill prints the new number.
8. **QR feedback:** public route in a private window → **no redirect to login**. No phone → anonymous
   `Note`. Known phone → links to that Customer. 2 stars → Manager notification fires.
9. **Auth:** tampered JWT → 401. Manager-only route with a Staff token → 403. Sale as Owner → 403.
10. **No `password` field on any Customer document.**
11. Every sidebar link opens a real screen.

---

# PHASE 2 — THE ML SERVICE

**2.1 FastAPI service.** `ml/` with its own `requirements.txt` and venv. Express POSTs baskets built
from real `Sale` documents; the service returns rules. **Express caches the last rule set in Mongo**,
so the combo screen still renders if Python is not running — a live-demo safeguard.

**2.2 Apriori combos.** `mlxtend`, cards showing **support, confidence, lift and basket count**, each
phrased as its own explanation: *"29% of baskets with flour also contain sugar — 8.5× more often than
chance, across 49 baskets."* Apriori is explainable by construction; the output *is* the explanation.

> **Recorded finding: `min_support` must be ≈0.003.** Measured support for the good rules is
> 0.33%–0.65%, so the textbook 0.01 returns an empty set on this data and the screen comes up blank
> with no error.

**2.3 Combo ranking that favours non-obvious pairs**, so the screen tells the "slow mover + strong
seller" story rather than showing whatever has the highest raw lift. Without this the top cards are
dominated by pairs the shop already knows.

**2.4 Product performance** — sales combined with QR ratings, to separate delisting candidates from
pairing problems.

**2.5 Forecast + the prediction loop.** `LinearRegression` for sales prediction. On approval, store
`{predicted_units, horizon, generated_at}`; after the horizon, write `actual_units` and accuracy.
Needs `node-cron`, and **the seed must backdate some predictions** or there is nothing to show inside
a review window.

**2.6 Bill QR** — `/feedback?sale=:saleId` with the purchased items pre-filled, and Recharts on the
analytics screens.

### Phase 2 verification

1. `uvicorn main:app` :8000 starts clean; Express reaches it.
2. `POST /api/combos/generate` → every card shows support, confidence, lift and basket count.
   **Hand-check one lift against a `mongosh` aggregation.** Confirm *flour + sugar* appears.
3. Stop the Python service → the combo screen still renders from cache.
4. Complete a sale, scan the receipt QR → the bought items are pre-filled.
5. A backdated prediction shows both `predicted_units` and `actual_units` with an accuracy figure.

---

# PHASE 3 — FLOOR, TEAM AND DOCUMENTS

**3.1 Issues / flagging screen** for Staff — the entity the old build never had, and which tasks are
not a substitute for.

**3.2 Staff tasks** and **Discussion** (`Note.type: 'discussion'`).

**3.3 Adjustment-request workflow on screen** — the >5%-or-3-units tolerance surfacing in the
Manager's approvals queue alongside restock requests.

**3.4 Notification centre** — full history rather than just the bell.

**3.5 Documents.** ER, schema, system flow and architecture diagrams drawn fresh against this
10-collection model, three roles and the three-tier architecture. **Nothing reused from the old
`docs/`** — that set specifies SQL types (`VARCHAR`, `INT`, `ENUM`, `DECIMAL`, `FK →`) inherited from
earlier Supermarket coursework and its PNG exports are stale renders of an older 3-role, 6-table
model. Rewrite `docs/PLAN.md` as the project document.

### Phase 3 verification

1. Staff raises an issue → the Manager sees it; resolving it closes it.
2. An out-of-tolerance stock correction raises an adjustment request instead of applying silently.
3. Every diagram matches the shipped schema — collection names and field names checked against
   `server/models/`.

---

## Known risks

- **One night is tight even for Phase 1.** 1.1–1.10 is the priority order; stopping after 1.8 still
  demos as a real system with a real database behind it.
- **Standalone Mongo has no transactions** — the sale path is non-atomic.
- **`min_support`** silently blanks the Phase 2 combo screen if left at the default.
- **Three processes** once Phase 2 lands; the rule cache is the mitigation.
