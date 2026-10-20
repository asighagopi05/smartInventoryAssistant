/* eslint-disable no-console */
/**
 * Walks the Phase 2 verification list from docs/PLAN.md, printing what each
 * ML feature does in plain English as it checks it.
 *
 * Needs the API running (npm run dev). The ML service should be running too;
 * if it is not, the script checks that the saved results still work instead.
 *
 * It writes only what the "Run analysis" and "Run forecast" buttons write
 * (the saved combos and forecasts). It does not bill, approve or change stock.
 *
 * Run: npm run ml-demo
 */

require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const ML_URL = process.env.ML_URL || 'http://localhost:8000';
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};
const say = (text = '') => console.log(`        ${text}`);
const heading = (text) => console.log(`\n-- ${text} ${'-'.repeat(Math.max(0, 66 - text.length))}`);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

const login = async (email, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.token;
};

async function mlIsUp() {
  try {
    const r = await fetch(`${ML_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Count bills straight from MongoDB, without the ML service, to check a lift by hand. */
async function handLift(x, y) {
  const sales = mongoose.connection.db.collection('sales');
  const count = (names) => sales.countDocuments({ $and: names.map((n) => ({ 'items.name': n })) });
  const [all, withX, withY, both] = await Promise.all([
    sales.countDocuments(), count([x]), count([y]), count([x, y]),
  ]);
  return { all, withX, withY, both, lift: (both * all) / (withX * withY) };
}

async function main() {
  console.log('\nSmart Inventory Assistant - Phase 2 ML demo\n');

  const health = await call('/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.log('  The API is not running. Start everything with `npm run dev` from the project folder, then run this again.\n');
    process.exit(1);
  }
  const managerT = await login('manager@sia.local', 'Manager@123');
  const staffT = await login('staff1@sia.local', 'Staff@123');
  await mongoose.connect(process.env.MONGODB_URI);

  // -- 2.1 the ML service ------------------------------------------------------
  heading('2.1  The Python ML service');
  const mlUp = await mlIsUp();
  if (mlUp) check('FastAPI answers on port 8000', true, ML_URL);
  else console.log('  NOTE  FastAPI is not running, so this run checks the SAVED results only');
  say('Express sends it the bills; it does the maths and sends results back.');
  say('It never touches the database itself.');

  // -- 2.2 / 2.3 combos ---------------------------------------------------------
  heading('2.2  Combos: products bought together (Apriori)');
  let combos;
  if (mlUp) {
    const r = await call('/combos/generate', { method: 'POST', token: managerT });
    combos = r.body?.combos;
    check('Run analysis finds combos', r.status === 200 && combos?.rules.length > 0,
      `${combos?.rules.length} combos from ${combos?.basket_count} bills`);
  } else {
    combos = (await call('/combos', { token: managerT })).body?.combos;
  }

  const saved = await call('/combos', { token: managerT });
  check('Combos are saved, so the screen works with Python switched off',
    saved.status === 200 && saved.body.combos?.rules.length > 0,
    saved.body.combos ? `${saved.body.combos.rules.length} saved` : 'nothing saved yet - run with the ML service up first');

  if (combos?.rules.length) {
    const rules = combos.rules;
    check('Every combo has support, confidence, lift and a bill count',
      rules.every((r) => [r.support, r.confidence, r.lift, r.bill_count].every((v) => typeof v === 'number')));

    const flour = rules.find((r) => r.if_bought.includes('Atta') && r.also_bought.includes('Sugar'));
    check('Flour + sugar is found', Boolean(flour),
      flour ? `${flour.if_bought} -> ${flour.also_bought}` : 'not in the list');
    if (flour) {
      say(`"${pct(flour.confidence)} of bills with atta also have sugar, ${flour.lift.toFixed(1)}x more often`);
      say(` than chance, across ${flour.bill_count} bills."`);

      // Bills billed since the analysis ran shift the count slightly, so allow 1%
      const hand = await handLift(flour.if_bought, flour.also_bought);
      check('Its lift matches a count done by hand in MongoDB',
        Math.abs(hand.lift - flour.lift) <= flour.lift * 0.01, `hand ${hand.lift.toFixed(2)} vs model ${flour.lift.toFixed(2)}`);
      say(`${hand.all} bills; ${hand.withX} have atta, ${hand.withY} have sugar, ${hand.both} have both.`);
      say(`lift = ${hand.both} x ${hand.all} / (${hand.withX} x ${hand.withY}) = ${hand.lift.toFixed(2)}`);
      if (hand.all !== combos.basket_count) {
        say(`(${hand.all - combos.basket_count} bill(s) added since the analysis ran; press Run analysis to include them)`);
      }
    }

    heading('2.3  Ranking combos worth acting on');
    const stories = rules.filter((r) => r.slow_strong);
    check('Slow mover + strong seller combos are tagged', stories.length > 0, `${stories.length} of ${rules.length}`);
    say('Top 3 by opportunity score (lift, boosted when the partner sells far more):');
    rules.slice(0, 3).forEach((r, i) => say(`${i + 1}. ${r.if_bought} -> ${r.also_bought}  (lift ${r.lift.toFixed(1)}x${r.slow_strong ? ', slow + strong' : ''})`));
    if (stories[0]) {
      say(`Example story: ${stories[0].if_bought} sells slowly, but ${pct(stories[0].confidence)} of the`);
      say(`people who buy it also buy ${stories[0].also_bought}. Shelve them together.`);
    }
  }

  // -- 2.4 product performance --------------------------------------------------
  heading('2.4  Product performance (sales + QR ratings)');
  const perf = await call('/insights/performance', { token: managerT });
  check('Products are grouped by sales and rating', perf.status === 200 && perf.body.products.length > 0,
    perf.body && Object.entries(perf.body.counts).map(([g, n]) => `${perf.body.groups[g].label} ${n}`).join(', '));
  const pair = perf.body?.products.find((p) => p.group === 'pair' && p.partner);
  const delist = perf.body?.products.find((p) => p.group === 'delist');
  if (pair) say(`Pairing problem: ${pair.name} rates ${pair.rating_avg} stars but sold only ${pair.units}. Place it next to ${pair.partner.name}.`);
  if (delist) say(`Delisting candidate: ${delist.name} sold ${delist.units} and rates ${delist.rating_avg} stars.`);

  // -- 2.5 forecast ---------------------------------------------------------------
  heading('2.5  Sales forecast (LinearRegression)');
  if (mlUp) {
    const g = await call('/forecast/generate', { method: 'POST', token: managerT });
    check('Run forecast predicts every product', g.status === 200 && g.body.live > 0,
      `${g.body?.live} products, ${g.body?.backtests} backtest weeks`);
  }
  const fc = await call('/forecast', { token: managerT });
  const weeks = fc.body?.backtest.weeks || [];
  check('Backdated predictions show predicted and actual sales with an accuracy',
    weeks.length > 0 && weeks.every((w) => w.actual_units > 0 && w.model_accuracy != null),
    `${weeks.length} past weeks`);
  say('Each past week was hidden, predicted from the weeks before it, then compared:');
  weeks.forEach((w) => say(`week of ${w.window_start.slice(0, 10)}: sold ${w.actual_units}, model said ${w.predicted_units} (${pct(w.model_accuracy)}), 4-week average said ${w.naive_units} (${pct(w.naive_accuracy)})`));
  if (weeks.length) {
    const { model_accuracy: m, naive_accuracy: n } = fc.body.backtest;
    check('The model is at least as accurate as the 4-week average', m >= n, `model ${pct(m)} vs 4-week average ${pct(n)}`);
  }
  const risk = (fc.body?.products || []).filter((p) => p.runs_out);
  say(`${risk.length} products will run out in the next 7 days; the first three:`);
  risk.slice(0, 3).forEach((p) => say(`${p.product.name}: ${p.product.stock} in stock, about ${Math.round(p.predicted_units)} expected to sell${p.restock_status ? ` (restock ${p.restock_status})` : ' (no restock requested)'}`));

  // -- 2.6 bill QR ----------------------------------------------------------------
  heading('2.6  Feedback QR on the bill');
  const latest = await mongoose.connection.db.collection('sales').findOne({}, { sort: { createdAt: -1 } });
  const qr = await call(`/feedback/qr?type=bill&id=${latest._id}`, { token: staffT });
  check('Staff at the till get the bill QR', qr.status === 200 && qr.body.target.includes(`sale=${latest._id}`), qr.body?.target);
  const ctx = await call(`/feedback/public/context?sale=${latest._id}`);
  const names = (ctx.body?.sale_items || []).map((i) => i.name);
  check('Scanning it pre-fills what was bought, with no login', ctx.status === 200 && names.length === latest.items.length,
    names.join(', '));

  // ------------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  }
  console.log('');
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n[ml-demo] ERROR:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
