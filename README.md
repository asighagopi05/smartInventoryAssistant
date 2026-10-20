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
# 1. Install, and create server/.env  (then put a random string after JWT_SECRET= in it)
cd server && npm install
cd ../client && npm install
cd .. && copy server\.env.example server\.env

# 2. Load the data  (~10 seconds, prints the demo logins when it finishes)
cd ../server && npm run seed

# 3. Check the data is sound  (15 checks against the live database)
npm run verify

# 4. Set up the ML service  (needs internet once; see ml/README.md)
cd ../ml && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt

# 5. Run everything from the project folder  (API :5000, screens :5173, ML :8000)
cd .. && npm run dev

# 6. See every ML feature checked and explained  (with step 5 running)
npm run ml-demo
```

The ML service is optional at runtime: the Combos, Forecast and Performance screens read saved
results, so they still work if Python is not running. Only their **Run** buttons need it.

### Demo logins

| Role | Email | Password | Can do |
|---|---|---|---|
| Owner | `owner@sia.local` | `Owner@123` | Sees everything. Cannot bill. |
| Manager | `manager@sia.local` | `Manager@123` | Products, suppliers, approvals, staff — and bills. |
| Staff | `staff1@sia.local` | `Staff@123` | The floor and the till. |

The login screen has one-click buttons for all three.

### Running it for the shop (deployment)

**Setting it up on a new PC?** Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), step by step.

The database stays on this PC, so the app is deployed here and used over the shop's Wi-Fi. No cloud
and no internet are involved. With MongoDB running and the steps above done once:

```bash
npm start
```

This builds the screens, then starts the API (which serves those screens) and the ML service. Everything
is on **one port, 5000**. It prints two addresses:

```
On this PC:          http://localhost:5000
On the shop network: http://192.168.1.7:5000
```

Any phone, tablet or till on the same Wi-Fi opens the second one, and the QR codes point at it
automatically. Stop with **Ctrl+C**.

- **Windows Firewall:** the first time, Windows asks whether Node.js may accept connections. Allow
  it for the network type the Wi-Fi is set to (Private or Public), or other devices cannot connect.
- **The address changes** if the router gives this PC a new IP. Reserve it in the router, or set
  `SIA_PUBLIC_URL` before `npm start` to choose the address the QR codes use.
- **Different port:** set `PORT` before `npm start`, for example `$env:PORT=8080; npm start`.

### Scanning the QR codes from a phone in development

With `npm start` this is automatic. With `npm run dev`, the codes encode whatever `PUBLIC_BASE_URL`
is set to in `server/.env`. A phone cannot open `localhost`, so set it to this machine's network
address:

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
  models/      the 11 collections, plus supporting ones: counter, saved combos, predictions
  routes/      REST endpoints, all role-guarded
  services/    stockService.js — the one place stock ever moves
               forecastService.js — sales series, forecasts, and checking them against real sales
  seed/        seed.js, verify.js, apitest.js, mldemo.js, phase3test.js, migrate-phase3.js,
               docscheck.js, and the source data
ml/        FastAPI + mlxtend + scikit-learn: combos (Apriori) and the sales forecast
client/    React + Vite
  src/pages/       one file per screen
  src/config/      navigation.jsx — sidebar AND router come from here
  src/styles/      design tokens and application styles
docs/      PLAN.md (project document), SCHEMA.md (generated), diagrams/ (ER, schema, architecture,
           system flow), STUDY-GUIDE.md, REVIEW-SCRIPT.md, ML-BUILD-LOG.md
```

### Scripts

| Command | What it does |
|---|---|
| `npm run seed` | Drops and rebuilds the database. Deterministic — identical every run, except that the dates move forward in whole weeks so the history always ends in the past. |
| `npm run verify` | 20 checks on the data: ledger reconciliation, no duplicate open requests, no customer passwords, every bill adds up, adjustments reach the ledger, issue/task/discussion records are consistent. |
| `npm run apitest` | 36 checks against a running API, walking the plan's verification list. |
| `npm run ml-demo` | 13 checks of the Phase 2 ML features against a running API, explaining each in plain English. Also works with Python stopped, checking the saved results. |
| `npm run phase3test` | 69 checks of Phase 3 against a running API: stock adjustments, issues, tasks, discussion, notification centre. Removes the records it creates. |
| `npm run docscheck` | Checks the ER diagram field by field against the models, and that the generated `docs/SCHEMA.md` is current (`-- --write` regenerates it). |
| `npm run migrate` | Upgrades a database created before Phase 3. Safe to run twice. |
| `npm run dev` | Starts with auto-reload. |
| `npm start` | Deployment: builds the screens and serves everything on port 5000 to the shop network. |
| `npm run build` | Builds the screens only, into `client/dist`. |

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

## Status

All three phases are built. Phase 2 (the ML) is described in
[`docs/ML-BUILD-LOG.md`](docs/ML-BUILD-LOG.md). Phase 3 added stock-count approvals, issues, tasks,
discussion, the notification centre and the diagrams. What is still missing is listed in
[`docs/PLAN.md`](docs/PLAN.md) section 9.

Nothing appears in the menu that does not have a working screen behind it. That is deliberate: the
sidebar and the router are generated from the same config, so a dead link is not possible.
