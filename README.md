# Smart Inventory Assistant

A centralised inventory system for a small supermarket. Stock, suppliers and reorder levels live in
one place; **restock requests raise themselves the moment stock crosses a threshold**; sales are
recorded at the till against an optional phone number; and customers leave feedback by scanning a QR
code with no account and no password.

Mini Project III — **Asigha K G** (9517202404017) and **Nirupa K V** (9517202404096).

> **Where to start:** [`docs/STUDY-GUIDE.md`](docs/STUDY-GUIDE.md) explains how everything works and
> contains the demo script. [`docs/PLAN.md`](docs/PLAN.md) is the design document.

---

## Running it

Everything runs locally and **needs no internet connection** — all dependencies are bundled, and
fonts and icons are local files.

**Prerequisites:** Node.js 18+ and MongoDB running locally (it installs as a Windows service and
starts on boot).

```bash
# 1. Install
cd server && npm install
cd ../client && npm install

# 2. Load the data  (~10 seconds, prints the demo logins when it finishes)
cd ../server && npm run seed

# 3. Check the data is sound  (15 checks against the live database)
npm run verify

# 4. Run it, in two terminals
cd server && npm run dev     # API      http://localhost:5000
cd client && npm run dev     # Screens  http://localhost:5173
```

### Demo logins

| Role | Email | Password | Can do |
|---|---|---|---|
| Owner | `owner@sia.local` | `Owner@123` | Sees everything. Cannot bill. |
| Manager | `manager@sia.local` | `Manager@123` | Products, suppliers, approvals, staff — and bills. |
| Staff | `staff1@sia.local` | `Staff@123` | The floor and the till. |

The login screen has one-click buttons for all three.

### Scanning the QR codes from a phone

The codes encode whatever `PUBLIC_BASE_URL` is set to in `server/.env`. A phone cannot open
`localhost`, so set it to this machine's network address:

```
PUBLIC_BASE_URL=http://192.168.1.7:5173
```

Vite prints the right address as **Network:** when it starts. The phone only needs to be on the same
WiFi or hotspot — **no internet required**. Without a phone, open the feedback URL in a browser tab;
it demonstrates the same thing.

---

## What is here

```
server/    Express + Mongoose API
  models/      the 10 collections, plus an internal counter
  routes/      REST endpoints, all role-guarded
  services/    stockService.js — the one place stock ever moves
  seed/        seed.js, verify.js, apitest.js, and the source data
client/    React + Vite
  src/pages/       one file per screen
  src/config/      navigation.jsx — sidebar AND router come from here
  src/styles/      design tokens and application styles
docs/      PLAN.md (design) and STUDY-GUIDE.md (how it works + demo script)
```

### Scripts

| Command | What it does |
|---|---|
| `npm run seed` | Drops and rebuilds the database. Deterministic — identical every run, except that the dates move forward in whole weeks so the history always ends in the past. |
| `npm run verify` | 15 checks on the data: ledger reconciliation, no duplicate open requests, no customer passwords, every bill adds up. |
| `npm run apitest` | 36 checks against a running API, walking the plan's verification list. |
| `npm run dev` | Starts with auto-reload. |

---

## Three things worth knowing

**Restocking fires at runtime, not when data is loaded.** The threshold check lives inside
`adjustStock()` in `server/services/stockService.js`, and every path that moves stock goes through
that one function. Sell a product past its reorder level and the request appears by itself, with
`raised_by: null` because no person raised it.

**A product can only have one open order.** That is a *partial unique index* on `restockrequests`
covering both `pending` and `approved` — not just an `if` in the code, which two concurrent sales
could race past. It covers `approved` too, because a product sits below its threshold for the whole
lead time and would otherwise re-order on every sale.

**The seeded sales are real.** 9,835 genuine grocery transactions from the `arules` Groceries dataset,
re-dated across 90 days and mapped onto Indian supermarket products. Which items get bought together
is real shopping behaviour, not something invented to make a demo work. Prices, dates, customers and
stock levels are generated, because the source has none.

---

## Not built yet

The machine-learning service (association rules over the same sales), the sales forecast, the staff
issues screen and the discussion board. The `issues` collection already exists and is populated —
only its screen is outstanding.

Nothing appears in the menu that does not have a working screen behind it. That is deliberate: the
sidebar and the router are generated from the same config, so a dead link is not possible.
