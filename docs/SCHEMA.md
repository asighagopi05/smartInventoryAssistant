# SIA database schema

> **Generated from `server/models/` by `npm run docscheck -- --write`. Do not edit by hand.**
> `npm run docscheck` fails if this file no longer matches the code.

MongoDB database `sia`. Every collection except `counters` and `predictions` also has
`createdAt` and `updatedAt`, maintained by Mongoose. Money fields are integers in paise and are
converted to rupees only at the API edge. The ER diagram is `docs/diagrams/er.svg`.

## User — `users`

| Field | Type | Rules |
|---|---|---|
| `name` | String | required; max length 80 |
| `email` | String | required; unique |
| `password_hash` | String | required; never returned by default |
| `role` | String | required; one of: Owner, Manager, Staff |
| `phone` | String | — |
| `active` | Boolean | default true |
| `created_by` | ObjectId → User | — |
| `last_login` | Date | — |

**Indexes:** `email ↑` (unique) · `role ↑`

## Supplier — `suppliers`

| Field | Type | Rules |
|---|---|---|
| `name` | String | required; max length 120 |
| `contact_person` | String | max length 80 |
| `phone` | String | — |
| `email` | String | — |
| `address` | String | max length 300 |
| `categories` | String[] | — |
| `active` | Boolean | default true |

**Indexes:** `name ↑`

## Product — `products`

| Field | Type | Rules |
|---|---|---|
| `sku` | String | required; unique |
| `name` | String | required; max length 140 |
| `category` | String | required; one of: Dairy, Bakery, Produce, Meat, Frozen, Beverages, Alcohol, Snacks, Staples, Household, Personal Care, Electronics |
| `unit` | String | default "pc"; one of: pc, kg, litre, pack |
| `price` | Number | required; min 0; money, stored in paise |
| `cost` | Number | default 0; min 0; money, stored in paise |
| `stock` | Number | required; default 0; min 0 |
| `threshold` | Number | required; min 0 |
| `reorder_qty` | Number | required; min 1 |
| `supplier_id` | ObjectId → Supplier | required |
| `active` | Boolean | default true |
| `rating_avg` | Number | default 0; min 0; max 5 |
| `rating_count` | Number | default 0; min 0 |

**Indexes:** `sku ↑` (unique) · `category ↑` · `supplier_id ↑` · `stock ↑` · `name text, category text`

## StockLog — `stocklogs`

| Field | Type | Rules |
|---|---|---|
| `product_id` | ObjectId → Product | required |
| `entry_type` | String | required; one of: sale, received, count, damage, return, adjustment |
| `quantity_change` | Number | required |
| `stock_before` | Number | required; min 0 |
| `stock_after` | Number | required; min 0 |
| `reason` | String | max length 300 |
| `source` | String | default "manual"; one of: billing, manual, restock, seed |
| `user_id` | ObjectId → User | required |
| `sale_id` | ObjectId → Sale | — |
| `restock_request_id` | ObjectId → RestockRequest | — |

**Indexes:** `product_id ↑, createdAt ↓` · `user_id ↑` · `entry_type ↑`

## RestockRequest — `restockrequests`

| Field | Type | Rules |
|---|---|---|
| `product_id` | ObjectId → Product | required |
| `supplier_id` | ObjectId → Supplier | required |
| `qty` | Number | required; min 1 |
| `kind` | String | default "restock"; one of: restock, adjustment |
| `counted_stock` | Number | min 0 |
| `difference` | Number | — |
| `status` | String | default "pending"; one of: pending, approved, rejected, received, applied |
| `trigger` | String | default "auto"; one of: auto, manual |
| `stock_at_request` | Number | min 0 |
| `threshold_at_request` | Number | min 0 |
| `raised_by` | ObjectId → User | — |
| `approved_by` | ObjectId → User | — |
| `approved_at` | Date | — |
| `received_at` | Date | — |
| `received_qty` | Number | min 0 |
| `note` | String | max length 400 |

**Indexes:** `product_id ↑, status ↑` · `status ↑, createdAt ↓` · `kind ↑, status ↑, createdAt ↓` · `product_id ↑, kind ↑` (unique; partial: {"status":{"$in":["pending","approved"]}})

## Sale — `sales`

| Field | Type | Rules |
|---|---|---|
| `bill_no` | String | required; unique |
| `items` | embedded array | — |
| `items[].product_id` | ObjectId → Product | required |
| `items[].name` | String | required |
| `items[].sku` | String | required |
| `items[].qty` | Number | required; min 1 |
| `items[].unit_price` | Number | required; min 0; money, stored in paise |
| `items[].line_total` | Number | required; min 0; money, stored in paise |
| `subtotal` | Number | required; min 0; money, stored in paise |
| `discount` | Number | default 0; min 0; money, stored in paise |
| `tax` | Number | default 0; min 0; money, stored in paise |
| `total` | Number | required; min 0; money, stored in paise |
| `payment_method` | String | default "cash"; one of: cash, card, upi |
| `customer_id` | ObjectId → Customer | — |
| `customer_phone` | String | — |
| `billed_by` | ObjectId → User | required |

**Indexes:** `bill_no ↑` (unique) · `createdAt ↓` · `customer_id ↑, createdAt ↓` · `billed_by ↑`

## Customer — `customers`

| Field | Type | Rules |
|---|---|---|
| `phone` | String | required; unique |
| `name` | String | max length 80 |
| `address` | String | max length 300 |
| `email` | String | — |
| `first_seen` | Date | — |
| `last_seen` | Date | — |
| `visits` | Number | default 0; min 0 |
| `total_spent` | Number | default 0; min 0; money, stored in paise |
| `created_by` | ObjectId → User | — |

**Indexes:** `phone ↑` (unique)

## Note — `notes`

| Field | Type | Rules |
|---|---|---|
| `type` | String | required; one of: feedback, discussion |
| `body` | String | max length 1000 |
| `author_id` | ObjectId → User | — |
| `rating` | Number | min 1; max 5 |
| `product_id` | ObjectId → Product | — |
| `sale_id` | ObjectId → Sale | — |
| `contact_phone` | String | — |
| `customer_id` | ObjectId → Customer | — |
| `source` | String | default "staff"; one of: product_qr, shop_qr, bill_qr, staff |
| `parent_id` | ObjectId → Note | — |

**Indexes:** `type ↑, createdAt ↓` · `product_id ↑` · `rating ↑`

## Notification — `notifications`

| Field | Type | Rules |
|---|---|---|
| `type` | String | required; one of: low_stock, restock_request, restock_approved, stock_received, adjustment_request, adjustment_decided, bad_review, issue_raised, issue_updated, task_assigned, task_done, discussion_reply |
| `title` | String | required; max length 160 |
| `body` | String | max length 500 |
| `for_role` | String | one of: Owner, Manager, Staff |
| `for_user_id` | ObjectId → User | — |
| `ref_type` | String | — |
| `ref_id` | ObjectId | — |
| `link` | String | — |
| `read_by` | ObjectId[] → User | — |

**Indexes:** `for_role ↑, createdAt ↓` · `read_by ↑`

## Issue — `issues`

| Field | Type | Rules |
|---|---|---|
| `title` | String | required; max length 160 |
| `description` | String | max length 1000 |
| `product_id` | ObjectId → Product | — |
| `category` | String | default "other"; one of: damage, expiry, shelf, pricing, equipment, other |
| `severity` | String | default "medium"; one of: low, medium, high |
| `status` | String | default "open"; one of: open, acknowledged, resolved |
| `raised_by` | ObjectId → User | required |
| `acknowledged_by` | ObjectId → User | — |
| `acknowledged_at` | Date | — |
| `resolved_by` | ObjectId → User | — |
| `resolved_at` | Date | — |
| `resolution_note` | String | max length 500 |

**Indexes:** `status ↑, createdAt ↓` · `raised_by ↑`

## Task — `tasks`

| Field | Type | Rules |
|---|---|---|
| `title` | String | required; max length 160 |
| `description` | String | max length 1000 |
| `assigned_to` | ObjectId → User | required |
| `created_by` | ObjectId → User | required |
| `product_id` | ObjectId → Product | — |
| `issue_id` | ObjectId → Issue | — |
| `due_date` | Date | — |
| `status` | String | default "open"; one of: open, done, cancelled |
| `done_at` | Date | — |
| `done_note` | String | max length 500 |

**Indexes:** `assigned_to ↑, status ↑, due_date ↑` · `status ↑, createdAt ↓`

## ComboCache — `combocaches`

| Field | Type | Rules |
|---|---|---|
| `_id` | String | required |
| `basket_count` | Number | required |
| `min_support` | Number | required |
| `min_confidence` | Number | required |
| `rules` | embedded array | — |
| `rules[].if_bought` | String | required |
| `rules[].also_bought` | String | required |
| `rules[].support` | Number | required |
| `rules[].confidence` | Number | required |
| `rules[].lift` | Number | required |
| `rules[].bill_count` | Number | required |
| `rules[].if_support` | Number | required |
| `rules[].also_support` | Number | required |
| `rules[].p_value` | Number | — |
| `rules[].slow_strong` | Boolean | default false |
| `rules[].score` | Number | required |
| `generated_at` | Date | required |
| `generated_by` | ObjectId → User | required |

**Indexes:** only `_id`

## Prediction — `predictions`

| Field | Type | Rules |
|---|---|---|
| `product_id` | ObjectId → Product | required |
| `kind` | String | required; one of: live, approval, backtest |
| `window_start` | Date | required |
| `window_end` | Date | required |
| `horizon_days` | Number | required; min 1 |
| `predicted_units` | Number | required; min 0 |
| `naive_units` | Number | required; min 0 |
| `daily` | Number[] | — |
| `generated_at` | Date | required |
| `restock_request_id` | ObjectId → RestockRequest | — |
| `actual_units` | Number | — |
| `accuracy` | Number | min 0; max 1 |
| `evaluated_at` | Date | — |

**Indexes:** `kind ↑, product_id ↑, window_start ↓` · `actual_units ↑, window_end ↑`

## Counter — `counters`

| Field | Type | Rules |
|---|---|---|
| `_id` | String | required |
| `seq` | Number | required; default 0 |

**Indexes:** only `_id`
