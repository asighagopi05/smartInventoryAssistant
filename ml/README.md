# ML service

FastAPI on port 8000. Express sends it data built from `Sale` documents and saves what comes back
in MongoDB; the service never touches the database itself. Every screen reads the saved results,
so only the **Run** buttons need Python to be running.

## Setup (needs internet once)

```powershell
cd ml
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Run

`npm run dev` from the project root starts it together with the API and the client. On its own:

```powershell
venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

`http://localhost:8000/docs` lets you call each endpoint by hand. `npm run ml-demo` from the
project root checks every ML feature end to end and explains each one as it goes.

## Endpoints

| Endpoint | Model | Used by |
|---|---|---|
| `GET /health` | – | `npm run ml-demo`, `dev.js` |
| `POST /combos` | Apriori (`mlxtend`) + Fisher's exact test (`scipy`) | Combos screen |
| `POST /forecast` | Product average × shop weekday shape (`scikit-learn` LinearRegression) | Forecast screen |

## Files

| File | What it is |
|---|---|
| `main.py` | The service |
| `explore.py` | Step-by-step practice script: reads MongoDB directly and prints the combos |

## Why these settings (all measured on the seed data)

**Combos**
- `min_support = 0.003`: good rules sit at 0.33%–0.65% support, so the textbook 0.01 returns nothing.
- `min_confidence = 0.2`: Atta → Sugar has lift 8.5× but confidence 28.7%; a 0.3 cutoff hides it.
- Ranking: `score = lift × log2(1 + popularity gap)`, the gap being how many times more bills the
  "also bought" product appears in (capped at 10). Raw lift alone ranks pairs the shop already knows
  first; this lifts rules where a slow seller is tied to a popular one, which are the ones worth
  acting on. Those with a bottom-half seller and a top-10% seller are tagged *slow mover + strong seller*.

**Forecast**, scored on the last 3 complete weeks, each hidden from the model and predicted from the
weeks before it:

| Model | Week −3 | Week −2 | Week −1 |
|---|---|---|---|
| Average of the last 4 weeks (baseline) | 79.0% | 81.2% | 82.3% |
| LinearRegression, trend + day of week | 76.4% | 79.7% | 82.1% |
| **LinearRegression, day of week only** (used) | 78.2% | **82.5%** | **83.7%** |

The trend term made every week worse: over 90 days this shop has no real trend, so it only fits
noise. Accuracy is `1 − |predicted − actual| / actual`, summed over all products.

Days on which the **whole shop** recorded no sales are treated as missing data, not zero demand,
and are left out of training and backtests.
