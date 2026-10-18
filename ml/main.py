import math

from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np
import pandas as pd
from mlxtend.preprocessing import TransactionEncoder
from mlxtend.frequent_patterns import apriori, association_rules
from scipy.stats import fisher_exact
from sklearn.linear_model import LinearRegression

app = FastAPI()

# Popularity bands for the "slow mover + strong seller" story, as percentiles of
# how many bills each product appears in.
SLOW_PERCENTILE = 50    # bottom half of sellers
STRONG_PERCENTILE = 90  # top 10% of sellers

# A rule is kept only if the chance of seeing this many shared bills by
# coincidence is under 1% (Fisher's exact test). Measured on the seed data by
# mining the earlier 70% of bills and checking the later 30%: rules that pass
# held up 96.8% of the time, the 85 that failed only 74.1% of the time.
MAX_P_VALUE = 0.01


# What Express must send us
class CombosRequest(BaseModel):
    baskets: list[list[str]]
    min_support: float = 0.003
    min_confidence: float = 0.2


class Series(BaseModel):
    key: str              # the product id; we only hand it back
    values: list[float]   # units sold on each training day, same order as train_weekdays


class ForecastRequest(BaseModel):
    # Weekday of every training day and every day to predict: Monday = 0 ... Sunday = 6.
    # Sent explicitly because Express leaves out days the shop recorded no sales
    # at all - those are missing data, not zero demand - so the days are not
    # always consecutive.
    train_weekdays: list[int]
    forecast_weekdays: list[int]
    series: list[Series]


@app.get("/health")
def health():
    return {"ok": True, "service": "sia-ml"}


@app.post("/combos")
def combos(req: CombosRequest):
    baskets = req.baskets

    # Same steps as explore.py: table -> itemsets -> rules
    te = TransactionEncoder()
    df = pd.DataFrame(te.fit(baskets).transform(baskets), columns=te.columns_)

    frequent = apriori(df, min_support=req.min_support, use_colnames=True)
    if frequent.empty:
        return {"basket_count": len(baskets), "rules": []}

    rules = association_rules(frequent, num_itemsets=len(baskets), metric="lift", min_threshold=1.0)
    rules = rules[(rules["antecedents"].apply(len) == 1) & (rules["consequents"].apply(len) == 1)]
    rules = rules[rules["confidence"] >= req.min_confidence]

    # Step 2.3: rank non-obvious pairs higher. Raw lift alone puts pairs the
    # shop already knows on top, so the score boosts a rule when the "also
    # bought" product sells far more than the "if bought" one - that is the
    # rule worth acting on: place the slow seller next to the popular one.
    product_support = df.mean()  # share of bills each product appears in
    slow = np.percentile(product_support, SLOW_PERCENTILE)
    strong = np.percentile(product_support, STRONG_PERCENTILE)

    # Turn each row into plain JSON (frozensets can't be sent as JSON)
    n = len(baskets)
    result = []
    for _, r in rules.iterrows():
        x = list(r["antecedents"])[0]
        y = list(r["consequents"])[0]
        x_support = float(product_support[x])
        y_support = float(product_support[y])

        # Could this many shared bills be coincidence? 2x2 table of bills:
        # with/without x against with/without y.
        both = int((df[x] & df[y]).sum())
        with_x, with_y = int(df[x].sum()), int(df[y].sum())
        table = [[both, with_x - both], [with_y - both, n - with_x - with_y + both]]
        p_value = float(fisher_exact(table, alternative="greater")[1])
        if p_value >= MAX_P_VALUE:
            continue

        popularity_gap = min(y_support / x_support, 10)
        result.append({
            "if_bought": x,
            "also_bought": y,
            "support": round(float(r["support"]), 4),
            "confidence": round(float(r["confidence"]), 4),
            "lift": round(float(r["lift"]), 2),
            "bill_count": round(float(r["support"]) * len(baskets)),
            "if_support": round(x_support, 4),
            "also_support": round(y_support, 4),
            "p_value": p_value,
            "slow_strong": bool(x_support <= slow and y_support >= strong),
            "score": round(float(r["lift"]) * math.log2(1 + popularity_gap), 3),
        })

    result.sort(key=lambda rule: rule["score"], reverse=True)
    return {"basket_count": len(baskets), "rules": result}


def weekday_features(weekdays):
    """One column per weekday (Tuesday..Sunday; Monday is the baseline).

    Measured on the seed data: adding a time-trend column made every backtest
    week LESS accurate, because over 90 days this shop has no real trend - the
    trend term just fits noise. Weekday columns capture the weekend peaks.
    """
    weekdays = np.asarray(weekdays)
    return np.stack([(weekdays == d).astype(float) for d in range(1, 7)], axis=1)


@app.post("/forecast")
def forecast(req: ForecastRequest):
    X_train = weekday_features(req.train_weekdays)
    X_future = weekday_features(req.forecast_weekdays)
    horizon = len(req.forecast_weekdays)
    if not req.series:
        return {"model": "Product average x shop weekday shape (LinearRegression)", "horizon": horizon, "forecasts": []}

    # Learn the weekday shape ONCE, from the whole shop's daily sales, then
    # scale it to each product's own average. Fitting a separate model per
    # product gave each one a shape learned from ~13 days per weekday, which
    # is mostly noise for a product that sells a unit or two a day. Measured
    # over 8 backtest weeks, per-product day accuracy went from 53.2% to 54.9%.
    shop = np.sum([s.values for s in req.series], axis=0)
    shop_model = LinearRegression().fit(X_train, shop)
    shape_future = np.clip(shop_model.predict(X_future), 0, None) / max(shop.mean(), 1e-9)

    result = []
    for s in req.series:
        y = np.asarray(s.values, dtype=float)
        daily = y.mean() * shape_future

        # The simple rule a shopkeeper would use, so the screen can show
        # whether the model actually beats it.
        recent = y[-28:]
        naive = recent.sum() / len(recent) * horizon if len(recent) else 0.0

        result.append({
            "key": s.key,
            "daily": [round(float(v), 2) for v in daily],
            "predicted_units": round(float(daily.sum()), 1),
            "naive_units": round(float(naive), 1),
        })

    return {"model": "Product average x shop weekday shape (LinearRegression)", "horizon": horizon, "forecasts": result}
