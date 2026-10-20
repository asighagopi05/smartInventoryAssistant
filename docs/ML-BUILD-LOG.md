# ML build log — Phase 2

Every command run while building the ML part, in order: **why** it was run, **what it printed**,
and **what was decided** from it. Outputs are real and copied from the terminal, trimmed where long.

Built 10–11 Oct 2026. To see it all working yourself, run `npm run dev` and then `npm run ml-demo`
(see [Re-running everything](#re-running-everything) at the end).

| Part | Plan step | Status |
|---|---|---|
| A. Setup | – | ✅ |
| B. Learning Apriori in a script | – | ✅ |
| C. FastAPI service + Express link | 2.1 | ✅ |
| D. Saved combos + Combos screen | 2.1, 2.2 | ✅ |
| E. Choosing the forecast model | 2.5 | ✅ |
| F. Choosing the combo ranking | 2.3 | ✅ |
| G. Building the rest | 2.3–2.6 | ✅ |
| H. Testing | all | ✅ 13/13 |
| I. A bug the tests caught | 2.5 | ✅ fixed |
| J. Improving accuracy | 2.2, 2.5 | ✅ |
| K. Correcting the accuracy claims | 2.2, 2.5 | ✅ |

---

## A. Setup

**Why:** Python packages go in a *virtual environment* (`venv`), a private copy of Python just for
this project, so they don't mix with anything else on the laptop. Like `node_modules`, it is not
committed to git.

```powershell
cd C:\Users\WELCOME\Documents\smart-inventory-assistant\ml
python -m venv venv
.\venv\Scripts\python.exe -m pip install fastapi uvicorn mlxtend scikit-learn pandas pymongo
.\venv\Scripts\python.exe -c "import fastapi, uvicorn, mlxtend, sklearn, pandas, pymongo; print('all packages OK')"
.\venv\Scripts\python.exe -m pip freeze | Out-File -Encoding ascii requirements.txt
```
```
all packages OK
```

**Two problems hit on the way, worth remembering:**
- The setup was first run twice, which made `ml\ml\venv`. The fix was to delete both copies and make one.
- In PowerShell, `pip freeze > requirements.txt` saves the file as UTF-16, which pip cannot read
  back. `Out-File -Encoding ascii` fixes it.

---

## B. Learning Apriori in a script — `ml/explore.py`

**Why:** to see each step of the algorithm print its result before putting it in a server.
`explore.py` reads MongoDB directly; it is a practice file and is never used by the app.

```powershell
python explore.py
```

| Step | What it does | Output |
|---|---|---|
| 2.1 | Connect and count | `Number of sales: 9834` |
| 2.2 | One basket (list of product names) per bill | `Number of baskets: 9834` |
| 2.3 | True/False table, one column per product | `Table shape (rows, columns): (9834, 169)` |
| 2.4 | Apriori, `min_support=0.003` | `Frequent itemsets found: 2225`; top is milk, in 25.6% of bills |
| 2.5 | Rules, pairs only, `confidence >= 0.3` | `Pair rules found: 148` |
| 2.5 | Same, `confidence >= 0.2` | `Pair rules found: 360` |

**Decision: confidence 0.2, not 0.3.** At 0.3, *Atta → Sugar* is missing, even though it is the
second-strongest link in the shop:

```
Aashirvaad Whole Wheat Atta 5kg  ->  Madhur Pure Sugar 1kg
    confidence 29%, lift 8.5x, in 49 bills
```

Its confidence is 28.7%, just under the cutoff. The lesson: lift shows a link is *real*;
confidence only shows how *common* it is.

---

## C. FastAPI service and the Express link (plan 2.1)

**Why:** so the app, not just a terminal, can ask for combos. Express reads the bills and sends
them to Python; Python does the maths and sends rules back.

```
React (5173)  →  Express (5000)  →  FastAPI (8000)
                       ↓
                    MongoDB
```

```powershell
uvicorn main:app --reload --port 8000
```
Opening `http://localhost:8000/health` showed `{"ok":true,"service":"sia-ml"}`. Calling
`POST /combos` from `/docs` with 5 test baskets returned 4 rules, including Atta → Sugar,
confidence 1.0, lift 1.67.

Then through Express (`server/routes/combos.js`), logged in as the Manager:
```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Body '{"email":"manager@sia.local","password":"Manager@123"}'
$result = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/combos/generate -Headers @{ Authorization = "Bearer $($login.token)" }
```
```
Baskets: 9834   Rules: 360
if_bought                       also_bought                        confidence  lift bill_count
Maggi 2-Minute Noodles 8 pack   Licious Chicken Mince 450g             0.3797 11.42         30
Aashirvaad Whole Wheat Atta 5kg Madhur Pure Sugar 1kg                  0.2865  8.46         49
```
These are the same 360 rules as `explore.py`, now coming through the whole chain.

---

## D. Saved combos and the Combos screen (plan 2.1, 2.2)

**Why:** if Python is not running on demo day, the screen must still work. Each run is saved in a
`combocaches` collection, and the screen reads from there.

Test: generate, **stop Python**, then read again:
```
GENERATE: bills 9834, combos 360, by Priya Menon
--- Python stopped ---
SAVED: combos 360; top = Maggi 2-Minute Noodles 8 pack -> Licious Chicken Mince 450g
GENERATE without Python: {"error":"The ML service is not running. Start it with: uvicorn main:app --port 8000"}
```

`dev.js` was also changed so that `npm run dev` starts Python as well, instead of needing 3 terminals.

---

## E. Choosing the forecast model (plan 2.5)

**Why:** the plan names `LinearRegression`, but a model is only worth having if it beats the
simple rule a shopkeeper would use: *"next week will be like the average of the last 4 weeks."*
So both were tested first.

**How it was tested (backtesting):** hide one of the last 3 weeks, train only on the weeks before
it, predict the hidden week, then compare with what really sold. Accuracy is
`1 − total miss ÷ total sold`.

Experiment 1, the plain model (trend + day of week) against the 4-week average:
```
week -3: actual 4185  LR accuracy 76.4%  naive accuracy 79.0%
week -2: actual 4890  LR accuracy 79.7%  naive accuracy 81.2%
week -1: actual 4515  LR accuracy 82.1%  naive accuracy 82.3%
```
**The model lost every week.** Shorter training windows and Ridge regression were tried next, and
both were worse:
```
LR window 56d ['77.0%', '77.6%', '79.0%']
LR window 28d ['72.4%', '68.5%', '74.4%']
Ridge window 56d ['77.6%', '76.6%', '79.0%']
```
Experiment 3: drop the trend, and look at the weekly totals:
```
LR day-of-week only, 90d ['78.2%', '82.5%', '83.7%']
weekly shop units: [4028, 5253, 4476, 4492, 4365, 5423, 4035, 4638, 4627, 4095, 4256, 5137]
```
**Decision: LinearRegression on day of week only.** The weekly totals go up and down with no
direction, so this shop has **no trend** over 90 days and the trend column was only fitting noise.
Without it, the model beats the 4-week average in 2 of 3 weeks (81.6% vs 80.9% overall).

> **For the review:** the gain is small, and that is an honest result. On steady sales a simple
> average is already good. The model's real advantage is that it knows **weekends sell more**, so
> it gets each *day* right, not just the week's total.

---

## F. Choosing the combo ranking (plan 2.3)

**Why:** the plan wants the screen to tell the *"slow mover + strong seller"* story: a product
that sells little but is often bought with a best seller. Shelve them together and the slow one
gets seen.

```
single-item support percentiles 25/50/75/90: [0.0039, 0.0104, 0.031, 0.0718]
rules: 360  slow->strong stories: 22
```
Example story found:
```
India Gate Basmati Rice 5kg -> Fresh Potatoes 1kg   lift 3.79  confidence 41%
  (rice is in 0.76% of bills - bottom half; potatoes in 10.9% - top 10%)
```
**Decision:**
- Tag a rule *slow + strong* when the first product is in the bottom half of sellers and the second
  is in the top 10%.
- Rank by `score = lift × log2(1 + popularity gap)`, where the gap is how many times more popular
  the second product is (capped at 10). Basmati → Potatoes moved up from #7 to #4.
- The screen offers *Best opportunities* (score) and *Highest lift* sorts, plus a *slow + strong only* filter.

---

## G. Building the rest

| Plan | What was built | Files |
|---|---|---|
| 2.3 | Score + slow/strong tag on every combo; sort and filter buttons | `ml/main.py`, `models/ComboCache.js`, `pages/Combos.jsx` |
| 2.4 | Product performance: sales over 30 days + QR ratings → 5 groups, scatter chart, and a combo partner for each *pairing problem* | `routes/insights.js`, `pages/Performance.jsx` |
| 2.5 | `POST /forecast` in Python; forecasts saved as `predictions`; backtests; days of cover; product chart | `ml/main.py`, `models/Prediction.js`, `services/forecastService.js`, `routes/forecast.js`, `pages/Forecast.jsx` |
| 2.5 | Restock approval records the forecast for that product | `routes/restock.js` |
| 2.5 | Hourly check that fills in actual sales once a forecast's week is over | `server/index.js` (a timer, not `node-cron`: one fixed interval needs no new package) |
| 2.6 | Bill QR fixed for Staff (see below); charts on all three screens | `routes/feedback.js` |
| – | `npm run ml-demo` | `server/seed/mldemo.js` |

**A bug found while reading the code (2.6):** the receipt asks for a bill QR, but the QR route only
allowed the Manager and the Owner. **Staff do most of the billing**, so their receipts silently had
no QR. Now Staff may generate bill QRs, and only bill QRs.

**The product performance groups:**

| | Sells well (≥ median) | Sells little |
|---|---|---|
| **Rated ≥ 3.5★** | Star | Pairing problem: customers like it but few find it |
| **Rated < 3.5★** | Fix quality | Delisting candidate |

Products with fewer than 3 ratings are *not enough ratings*, so one angry customer can't decide the verdict.

---

## H. Testing

**Backend, every new endpoint:**
```
=== 2.3 combos ranking ===   combos: 360; slow+strong: 22
=== 2.5 forecast ===         {"live":169,"backtests":3,...}
                             products: 169; runs out this week: 52
                             overall backtest accuracy: model 81.6%  naive 80.9%
=== 2.4 performance ===      {"star":41,"fix":18,"pair":42,"delist":18,"unrated":50}
=== 2.6 bill QR as Staff === staff bill QR -> http://10.66.254.137:5173/feedback?sale=6ac7...
                             staff shop QR: {"error":"Staff can only generate the QR printed on a bill"}
                             public page pre-fills: Amul Gold Full Cream Milk 1L, Britannia Pav Buns 6 pcs, ...
```

**Restock approval records a forecast.** One real pending request was approved, checked, then put
back exactly as it was:
```
approved: Nestle Milkmaid Condensed Milk 400g -> approved
forecast recorded: 10.9 units, kind approval, until 2026-10-18T12:51:11.747Z
matches live forecast: true
undone: status pending | notification removed 1 | approval forecasts left 0
```

**The hourly check fills in actual sales.** A temporary prediction for a past week was evaluated,
then deleted:
```
evaluated 1 | actual 266 (backtest says 266) | accuracy 0.998 (backtest 0.998)
temp prediction removed
```

**Nothing old broke:**
```
npm run verify    15/15 checks passed
npm run apitest   36/36 checks passed
client build      ✓ built; oxlint: no warnings in the new pages
```

---

## I. A bug the tests caught

After `npm run apitest` had run (it bills 5 test sales **today**), `npm run ml-demo` failed:

```
FAIL  Backdated predictions show predicted and actual sales with an accuracy
PASS  The model is at least as accurate as a simple average  -> model 0.0% vs average 0.0%
```

**Cause:** the seeded bills end on **1 Oct**. The test sales on **11 Oct** made the history look
like 10 days in which *the whole shop sold nothing*. The code treated those days as real zeros, so
two of the three backtest weeks fell inside the gap, where actual sales were 0 and accuracy 0%. The
live forecast was also being trained on 10 fake zero days.

**Fix:** a day on which the *whole shop* recorded no sales is **missing data, not zero demand**. A
supermarket always sells something, so an empty day means the system wasn't in use. Now:
- training uses trading days only,
- backtests use only weeks in which all 7 days have data,
- Python is sent each day's weekday explicitly, because the days are no longer always consecutive,
- the product chart leaves a gap on missing days instead of drawing zero.

Also fixed in the demo: with Python stopped it printed `FAIL FastAPI answers`, but that is the
expected situation for that test, so it is now a `NOTE`. And its hand check of the lift now
allows for bills added after the analysis ran.

**After the fix:**
```
npm run ml-demo  (Python running)   13/13 checks passed
npm run ml-demo  (Python stopped)   10/10 checks passed
```

The final demo output, Python running:
```
-- 2.2  Combos: products bought together (Apriori) -------------------
  PASS  Run analysis finds combos  -> 360 combos from 9839 bills
  PASS  Combos are saved, so the screen works with Python switched off  -> 360 saved
  PASS  Every combo has support, confidence, lift and a bill count
  PASS  Flour + sugar is found  -> Aashirvaad Whole Wheat Atta 5kg -> Madhur Pure Sugar 1kg
        "28.6% of bills with atta also have sugar, 8.5x more often
         than chance, across 49 bills."
  PASS  Its lift matches a count done by hand in MongoDB  -> hand 8.47 vs model 8.47
        9839 bills; 171 have atta, 333 have sugar, 49 have both.
        lift = 49 x 9839 / (171 x 333) = 8.47

-- 2.5  Sales forecast (LinearRegression) ----------------------------
  PASS  Backdated predictions show predicted and actual sales with an accuracy  -> 3 past weeks
        week of 2026-09-10: sold 4185, model said 4550 (78.2%), simple average said 4386 (79.1%)
        week of 2026-09-17: sold 4890, model said 4518 (82.5%), simple average said 4401 (81.2%)
        week of 2026-09-24: sold 4515, model said 4548 (83.7%), simple average said 4439 (82.3%)
  PASS  The model is at least as accurate as a simple average  -> model 81.6% vs average 80.9%
```

---

## J. Improving accuracy (15 Oct 2026)

**Why:** to check how much better each model could get, and keep only changes that measurably help.
The scripts are in `ml/experiments/`; run them from that folder with the venv's Python.

### Combos: are they real, or chance?

**How it was tested:** mine rules on the **earlier 70%** of bills only, then check each rule on the
**later 30%**, which it never saw. A rule *holds up* if the pair still appears together more often than
chance (lift > 1) in the later bills.

```
python combo_holdout.py
train bills 6887, test bills 2952, rules mined 400
  current (lift > 1, conf >= 0.2)        rules  400  hold up in later bills  92.0%
  lift >= 1.2                            rules  354  hold up in later bills  96.0%
  Fisher p < 0.01                        rules  315  hold up in later bills  96.8%
  Fisher p < 0.05 / rules (Bonferroni)   rules  228  hold up in later bills  99.1%
  REJECTED by p < 0.01                   rules   85  hold up in later bills  74.1%
```

**Decision: keep a rule only if Fisher's exact test gives p < 0.01**, meaning less than a 1-in-100
chance that this many shared bills is coincidence. 1 in 12 of the old rules did not hold up; with the
test, about 1 in 30 don't. Bonferroni was more reliable still, but dropped 172 rules, most of them good.
Every combo card now shows its chance figure.

After the change, through the app: **296 combos instead of 360**. The weakest kept now has lift 1.16
(was 1.02). Atta → Sugar is kept with p = 1.5 × 10⁻³², so it is as far from chance as a rule can be.

### Forecast: how good can it get?

The app's check uses 3 hidden weeks. Every method was re-run on **8** to see real differences.

```
python fc_experiment.py 8
method                       OVERALL  last3
blend LR + naive 50/50        80.3%   81.6%
current: LR per product       80.3%   81.6%
naive: all history avg        80.2%   81.6%
pooled weekday, last 56d      80.1%   81.5%
naive: last 28 days avg       79.8%   80.9%

python fc_daily.py
WEEKLY total per product, 8 weeks:  oracle ceiling 82.0%
DAILY accuracy                       per product/day   whole shop/day
  current LR per product                  53.2%           86.1%
  flat 28-day avg                         50.5%           77.6%
  pooled: product avg x shop weekday      54.9%           86.1%
```

**What this showed:**
- **For a week's total, every sensible method scores about 80%.** A 7-day week contains each weekday
  exactly once, so the weekday pattern cannot change a weekly total. The old model was, in effect, an
  average over all history, and it tied with exactly that.
- **An "oracle" scores 82.0% over these 8 weeks.** It is told each product's true long-run average,
  which no real model could know. The rest is randomness: which baskets fall in which week. So the
  model (80.3% over the same 8 weeks) was 1.7 points below it. *(Corrected 20 Oct: this is a
  yardstick, not a proven ceiling for every possible model. On the app's own 3 weeks the oracle
  scores 83.1%, not 82.0%; see section K.)*
- **Daily accuracy could improve.** Fitting a weekday shape per product meant learning it from about
  13 days per weekday, mostly noise for a product that sells a unit a day.

**Decision:** LinearRegression now learns the weekday shape **once, from the whole shop's sales**,
and each product's forecast is its own average × that shape. Day accuracy per product goes from
53.2% to **54.9%**; week totals are unchanged at 81.6% (last 3 weeks), still ahead of the 4-week
average at 80.9%. *(Note, 20 Oct: a full week contains each weekday once, so the weekly forecast is
now exactly the product's all-history average; LinearRegression only shapes the days. See section K.)*

> **For the review:** the honest answer to "can it be more accurate?" is that the weekly forecast is
> 1.5 points below an oracle that knows each product's true average (81.6% against 83.1% on the same
> 3 weeks). Real shop data would have things this seed lacks, such as festivals, price changes and a
> real trend, and those are what a better model could use. *(Corrected 20 Oct; the earlier wording,
> "within 2 points of the mathematical best", overstated it.)*

**After the change:** `npm run ml-demo` 13/13, client build ✓.

---

## K. Correcting the accuracy claims (20 Oct 2026)

**Why:** asked "what is the accuracy now?", the first answer overstated several things. Each was
re-measured on the reseeded database (9,834 bills) and is corrected here and in `docs/PLAN.md`.

```
backtest, 3 hidden weeks x 169 products (from the predictions collection)
week of 24 Sep   model 78.2%   4-week average 79.1%   <- the model LOST this week
week of 1 Oct    model 82.5%   4-week average 81.2%
week of 8 Oct    model 83.7%   4-week average 82.3%
overall          model 81.6%   4-week average 80.9%
product-weeks where the model was closer: 261, the 4-week average: 226, tie: 20
sign test on those 487: p = 0.12

same 3 weeks, fc_experiment.py / fc_daily.py
naive: all history avg (weekly)        81.6%
oracle: true long-run avg (weekly)     83.1%
daily, per product:   pooled model 55.5%   flat 28-day avg 51.3%
daily, whole shop:    pooled model 89.1%   flat 28-day avg 78.5%

combo_holdout.py, rerun
rules kept by Fisher p < 0.01   317   hold up in later bills 96.8%   confidence error 5.0 pts
rules rejected by it             86   hold up in later bills 72.1%
```

**Corrections:**
1. **The weekly forecast is the product's all-history average.** A week holds each weekday once, so
   the learned weekday shape sums out. The plain all-history average scores the same 81.6%.
   LinearRegression earns its place on the **daily** split (55.5% vs 51.3% per product per day).
2. **The edge over the 4-week average (0.7 points) is not statistically significant** (p = 0.12),
   and the 4-week average won one of the three weeks.
3. **The "ceiling" was compared on the wrong window.** 82.0% was over 8 weeks; over the app's 3
   weeks the oracle scores 83.1%. It is also a yardstick, not a proof that no model could do better.
4. **The combo figure is for the method, not for the app's 296 combos.** It is measured on rules
   mined from the first 70% of bills (317 of them) and checked on the last 30%. "Holds up" is a low
   bar: the pair still appears together more often than chance (lift above 1) in those bills.
   Predicted confidence was off by 5 points on average. The bills' dates are generated by the seed,
   so this shows the rules generalise to unseen bills, not that they stay true across seasons.
5. The screen and `npm run ml-demo` said "simple average" for what is the **4-week** average. Both
   now say "4-week average".

---

## Known limits

- **The forecast's gain over the 4-week average is small** (0.7 points overall) and not
  statistically significant (p = 0.12); it lost one of the three test weeks. For weekly totals it
  is exactly the all-history average. It is reported on the screen next to the baseline rather
  than hidden. Section K has the numbers.
- **52 products show as running out this week.** That reflects the seeded stock levels; most
  already have a restock request open, and the screen shows which don't.
- **Some combos are based on about 30 bills.** Each one now passes a 1-in-100 coincidence test, and
  about 1 in 30 still may not hold up on new bills.
- **Combos use product names**, which are frozen on each bill. Renaming a product would split its
  history in two.
- **A live forecast is only checked if the shop is used during its week.** If nothing is billed, it
  is checked against zero sales.

---

## Re-running everything

```powershell
cd C:\Users\WELCOME\Documents\smart-inventory-assistant
npm run dev          # terminal 1: API, screens and Python together
npm run ml-demo      # terminal 2: every ML check, explained
```
Then open `http://localhost:5173`, log in as the Manager, and look under **Insights**:
**Combos**, **Forecast** and **Performance**. Press **Run analysis** and **Run forecast** to refresh them.
