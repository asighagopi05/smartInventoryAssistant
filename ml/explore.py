from pymongo import MongoClient
import pandas as pd
from mlxtend.preprocessing import TransactionEncoder
from mlxtend.frequent_patterns import apriori
from mlxtend.frequent_patterns import apriori, association_rules


# Connect to the same database Express uses
client = MongoClient("mongodb://127.0.0.1:27017")
db = client["sia"]

# Mongoose stores the Sale model in a collection called "sales"
sales = db["sales"]

print("Number of sales:", sales.count_documents({}))

# Look at one sale to see its shape
one = sales.find_one()
print("One sale's items:")
for item in one["items"]:
    print("  ", item["name"], "x", item["qty"])
# ---- Step 2.2: build the baskets ----
baskets = []
for sale in sales.find():
    names = [item["name"] for item in sale["items"]]
    baskets.append(names)

print()
print("Number of baskets:", len(baskets))
print("First 3 baskets:")
for b in baskets[:3]:
    print("  ", b)
# ---- Step 2.3: baskets -> True/False table ----
te = TransactionEncoder()
table = te.fit(baskets).transform(baskets)
df = pd.DataFrame(table, columns=te.columns_)

print()
print("Table shape (rows, columns):", df.shape)
print(df.iloc[:3, :5])
# ---- Step 2.4: frequent itemsets ----
frequent = apriori(df, min_support=0.003, use_colnames=True)

print()
print("Frequent itemsets found:", len(frequent))
print(frequent.sort_values("support", ascending=False).head(10))
# ---- Step 2.5: association rules ----
rules = association_rules(frequent, num_itemsets=len(baskets), metric="lift", min_threshold=1.0)

# Keep only simple pairs: 1 product -> 1 product
rules = rules[(rules["antecedents"].apply(len) == 1) & (rules["consequents"].apply(len) == 1)]

# Keep only rules that are reasonably likely
rules = rules[rules["confidence"] >= 0.2]

rules = rules.sort_values("lift", ascending=False)

print()
print("Pair rules found:", len(rules))
for _, r in rules.head(10).iterrows():
    x = list(r["antecedents"])[0]
    y = list(r["consequents"])[0]
    print(f"  {x}  ->  {y}")
    print(f"      confidence {r['confidence']:.0%}, lift {r['lift']:.1f}x, in {round(r['support'] * len(baskets))} bills")
