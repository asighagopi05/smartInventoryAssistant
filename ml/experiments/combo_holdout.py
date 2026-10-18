"""Mine rules on the earlier 70% of bills, check whether they hold on the later 30%."""
import numpy as np, pandas as pd
from pymongo import MongoClient
from mlxtend.preprocessing import TransactionEncoder
from mlxtend.frequent_patterns import apriori, association_rules
from scipy.stats import fisher_exact

db = MongoClient("mongodb://127.0.0.1:27017")["sia"]
baskets = [[i["name"] for i in s["items"]] for s in db.sales.find({}, {"items.name": 1}).sort("createdAt", 1)]
cut = int(len(baskets) * 0.7)
te = TransactionEncoder().fit(baskets)
df = pd.DataFrame(te.transform(baskets), columns=te.columns_)
train, test = df.iloc[:cut], df.iloc[cut:]

freq = apriori(train, min_support=0.003, use_colnames=True)
R = association_rules(freq, num_itemsets=len(train), metric="lift", min_threshold=1.0)
R = R[(R.antecedents.apply(len) == 1) & (R.consequents.apply(len) == 1) & (R.confidence >= 0.2)].copy()
R["x"] = R.antecedents.apply(lambda s: next(iter(s))); R["y"] = R.consequents.apply(lambda s: next(iter(s)))

def stats(frame, x, y):
    a = frame[x].values; b = frame[y].values; n = len(frame)
    both = (a & b).sum(); nx, ny = a.sum(), b.sum()
    return both, nx, ny, n
rows = []
for _, r in R.iterrows():
    both, nx, ny, n = stats(train, r.x, r.y)
    p = fisher_exact([[both, nx - both], [ny - both, n - nx - ny + both]], alternative="greater")[1]
    tb, tx, ty, tn = stats(test, r.x, r.y)
    t_conf = tb / tx if tx else np.nan
    t_lift = (tb * tn) / (tx * ty) if tx and ty else np.nan
    rows.append(dict(lift=r.lift, conf=r.confidence, bills=both, p=p,
                     holds=(t_lift > 1) and tb >= 1, t_conf=t_conf, conf_err=abs(t_conf - r.confidence)))
T = pd.DataFrame(rows)
m = len(T)
print(f"train bills {cut}, test bills {len(baskets)-cut}, rules mined {m}")
def show(name, mask):
    s = T[mask]
    print(f"  {name:44s} rules {len(s):4d}  hold up in later bills {s.holds.mean()*100:5.1f}%  "
          f"confidence error {s.conf_err.mean()*100:4.1f} pts")
show("current (lift > 1, conf >= 0.2)", T.lift > 0)
show("lift >= 1.2", T.lift >= 1.2)
show("lift >= 1.5", T.lift >= 1.5)
show("lift >= 2", T.lift >= 2)
show("bills >= 30 (in train)", T.bills >= 30)
show("Fisher p < 0.05", T.p < 0.05)
show("Fisher p < 0.05 / rules (Bonferroni)", T.p < 0.05 / m)
show("Fisher p < 0.01", T.p < 0.01)
show("REJECTED by p < 0.01", T.p >= 0.01)
show("REJECTED by lift >= 1.2", T.lift < 1.2)
