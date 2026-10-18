"""Compare forecast methods with the same backtest the app uses, over more weeks."""
import sys
from collections import defaultdict
import numpy as np
from pymongo import MongoClient
from sklearn.linear_model import LinearRegression

DAY_MS = 86400000
IST_MS = 330 * 60000
H = 7
db = MongoClient("mongodb://127.0.0.1:27017")["sia"]

units = defaultdict(lambda: defaultdict(float))
trading = set()
for s in db.sales.find({}, {"items.product_id": 1, "items.qty": 1, "createdAt": 1}):
    d = int((s["createdAt"].timestamp() * 1000 + IST_MS) // DAY_MS)
    trading.add(d)
    for it in s["items"]:
        units[str(it["product_id"])][d] += it["qty"]
products = [str(p["_id"]) for p in db.products.find({"active": True}, {"_id": 1})]
days = sorted(trading)
wd = lambda d: (d + 3) % 7  # 1 Jan 1970 was a Thursday -> Monday = 0

def complete_weeks(count):
    t = set(days); weeks = []; end = days[-1] + 1
    while len(weeks) < count:
        start = end - H
        if sum(1 for d in days if d < start) < 28: break
        if all(x in t for x in range(start, end)): weeks.insert(0, start); end = start
        else: end -= 1
    return weeks

def feats(w):
    w = np.asarray(w); return np.stack([(w == k).astype(float) for k in range(1, 7)], 1)

# ---- methods: each returns predicted 7-day total per product ----
def m_current(Y, tr, fut):   # per-product LR on weekday dummies (what the app does)
    X, Xf = feats([wd(d) for d in tr]), feats([wd(d) for d in fut])
    return np.array([np.clip(LinearRegression().fit(X, y).predict(Xf), 0, None).sum() for y in Y])

def m_naive(Y, tr, fut, n=28):
    return Y[:, -n:].mean(1) * H

def shop_profile(Y, tr):
    tot = Y.sum(0); w = np.array([wd(d) for d in tr])
    f = np.array([tot[w == k].mean() for k in range(7)]); return f / tot.mean()

def m_pooled(Y, tr, fut, n=None):  # product level x shop-wide weekday shape
    lvl = (Y if n is None else Y[:, -n:]).mean(1)
    f = shop_profile(Y, tr); return lvl * sum(f[wd(d)] for d in fut)

def m_blend(Y, tr, fut, a=0.5):
    return a * m_current(Y, tr, fut) + (1 - a) * m_naive(Y, tr, fut)

METHODS = {
    "current: LR per product": m_current,
    "naive: last 28 days avg": m_naive,
    "naive: all history avg": lambda Y, t, f: Y.mean(1) * H,
    "pooled weekday, last 28d": lambda Y, t, f: m_pooled(Y, t, f, 28),
    "pooled weekday, last 56d": lambda Y, t, f: m_pooled(Y, t, f, 56),
    "pooled weekday, all days": lambda Y, t, f: m_pooled(Y, t, f, None),
    "blend LR + naive 50/50": m_blend,
}

n_weeks = int(sys.argv[1]) if len(sys.argv) > 1 else 8
weeks = complete_weeks(n_weeks)
print(f"trading days {len(days)}, backtest weeks {len(weeks)}")
res = {m: [] for m in METHODS}
for cut in weeks:
    tr = [d for d in days if d < cut]; fut = list(range(cut, cut + H))
    Y = np.array([[units[p].get(d, 0) for d in tr] for p in products])
    actual = np.array([sum(units[p].get(d, 0) for d in fut) for p in products])
    for m, fn in METHODS.items():
        pred = fn(Y, tr, fut)
        res[m].append((np.abs(pred - actual).sum(), actual.sum()))
print(f"{'method':28s} " + " ".join(f"wk{i+1:<5d}" for i in range(len(weeks))) + "  OVERALL  last3")
for m, r in sorted(res.items(), key=lambda kv: -1 + sum(a for a, _ in kv[1]) / sum(b for _, b in kv[1])):
    per = [1 - a / b for a, b in r]
    tot = 1 - sum(a for a, _ in r) / sum(b for _, b in r)
    l3 = 1 - sum(a for a, _ in r[-3:]) / sum(b for _, b in r[-3:])
    print(f"{m:28s} " + " ".join(f"{x*100:5.1f}%" for x in per) + f"  {tot*100:5.1f}%  {l3*100:5.1f}%")
