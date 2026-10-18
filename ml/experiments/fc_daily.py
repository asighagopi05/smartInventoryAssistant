import numpy as np
exec(open("fc_experiment.py").read().split("n_weeks =")[0])  # reuse loading + methods

def daily_current(Y, tr, fut):
    X, Xf = feats([wd(d) for d in tr]), feats([wd(d) for d in fut])
    return np.array([np.clip(LinearRegression().fit(X, y).predict(Xf), 0, None) for y in Y])
def daily_flat(Y, tr, fut): return np.repeat(Y[:, -28:].mean(1, keepdims=True), H, 1)
def daily_pooled(Y, tr, fut):
    f = shop_profile(Y, tr); return Y.mean(1, keepdims=True) * np.array([f[wd(d)] for d in fut])[None, :]
def daily_shrunk(Y, tr, fut, k=20):  # product's own weekday shape, pulled toward the shop's
    w = np.array([wd(d) for d in tr]); f = shop_profile(Y, tr); lvl = Y.mean(1)
    out = []
    for i, y in enumerate(Y):
        own = np.array([y[w == j].sum() for j in range(7)]); n = np.array([(w == j).sum() for j in range(7)])
        prof = (own + k * lvl[i] * f) / (n * lvl[i] + k * lvl[i]) * lvl[i] if lvl[i] > 0 else np.zeros(7)
        out.append([prof[wd(d)] for d in fut])
    return np.array(out)

weeks = complete_weeks(8)
full = {p: np.mean([units[p].get(d, 0) for d in days]) * H for p in products}
DM = {"current LR per product": daily_current, "flat 28-day avg": daily_flat,
      "pooled: product avg x shop weekday shape": daily_pooled, "shrunk weekday shape (k=20)": daily_shrunk}
wk = {"oracle (true long-run avg)": []}; dy = {m: [] for m in DM}
for cut in weeks:
    tr = [d for d in days if d < cut]; fut = list(range(cut, cut + H))
    Y = np.array([[units[p].get(d, 0) for d in tr] for p in products])
    A = np.array([[units[p].get(d, 0) for d in fut] for p in products])
    wk["oracle (true long-run avg)"].append((np.abs(np.array([full[p] for p in products]) - A.sum(1)).sum(), A.sum()))
    for m, fn in DM.items():
        P = fn(Y, tr, fut)
        dy[m].append((np.abs(P - A).sum(), A.sum(), np.abs(P.sum(0) - A.sum(0)).sum()))
acc = lambda r, i=0: 1 - sum(x[i] for x in r) / sum(x[1] for x in r)
print("WEEKLY total per product, 8 weeks:  oracle ceiling", f"{acc(wk['oracle (true long-run avg)'])*100:.1f}%")
print("\nDAILY accuracy, 8 weeks       per product/day   whole shop/day")
for m, r in dy.items(): print(f"  {m:42s} {acc(r)*100:5.1f}%          {acc(r,2)*100:5.1f}%")
