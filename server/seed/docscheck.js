/* eslint-disable no-console */
/**
 * Keeps the documents honest against the code (Phase 3 verification 3).
 *
 *   1. docs/diagrams/er.mmd is drawn by hand. Every entity's fields are
 *      compared with the Mongoose schema in server/models/, both ways: a field
 *      in the diagram that the model lacks, or a model field the diagram
 *      leaves out, fails. Types and FK markers are checked too, and every
 *      reference between collections must appear as a relationship line.
 *   2. docs/diagrams/architecture.mmd must name every real collection.
 *   3. docs/diagrams/schema.mmd and docs/SCHEMA.md are GENERATED from the
 *      models. The check regenerates them and fails if the committed copies
 *      are stale. `npm run docscheck -- --write` rewrites them.
 *
 * Needs no database: it reads the schemas, not the data.
 *
 * Run: npm run docscheck
 */

const fs = require('fs');
const path = require('path');
const models = require('../models');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const DIAGRAMS = path.join(DOCS, 'diagrams');
const WRITE = process.argv.includes('--write');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

// Diagram entity -> where its fields live in the code.
const ENTITY = {
  USER: ['User'], SUPPLIER: ['Supplier'], PRODUCT: ['Product'], STOCKLOG: ['StockLog'],
  RESTOCKREQUEST: ['RestockRequest'], SALE: ['Sale'], SALE_ITEM: ['Sale', 'items'],
  CUSTOMER: ['Customer'], NOTE: ['Note'], NOTIFICATION: ['Notification'], ISSUE: ['Issue'],
  TASK: ['Task'], COMBOCACHE: ['ComboCache'], COMBO_RULE: ['ComboCache', 'rules'],
  PREDICTION: ['Prediction'], COUNTER: ['Counter'],
};
const MODEL_ENTITY = Object.fromEntries(Object.entries(ENTITY).filter(([, v]) => v.length === 1).map(([k, [m]]) => [m, k]));
const SKIP = new Set(['__v', 'createdAt', 'updatedAt']);

/** The fields of a model (or of one of its embedded arrays), as the diagram should show them. */
function schemaFields([modelName, sub]) {
  const Model = models[modelName];
  let schema = Model.schema;
  if (sub) schema = schema.path(sub).schema;
  const fields = {};
  schema.eachPath((p, t) => {
    if (SKIP.has(p) || (sub && p === '_id')) return;
    if (!sub && t.schema) return; // an embedded array is its own entity
    let type = t.instance;
    let ref = t.options && t.options.ref;
    if (type === 'Array') {
      type = `${t.caster ? t.caster.instance : 'Mixed'}_array`;
      ref = t.caster && t.caster.options && t.caster.options.ref;
    }
    fields[p] = { type, ref: ref || null };
  });
  return fields;
}

function parseEr(text) {
  const entities = {};
  const rels = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    const open = /^([A-Z_]+)\s*\{$/.exec(line);
    if (open) { current = open[1]; entities[current] = {}; continue; }
    if (line === '}') { current = null; continue; }
    if (current) {
      const m = /^(\S+)\s+(\S+)(?:\s+(PK|FK|UK))?/.exec(line);
      if (m) entities[current][m[2]] = { type: m[1], key: m[3] || null };
      continue;
    }
    const rel = /^([A-Z_]+)\s+\S+\s+([A-Z_]+)\s*:/.exec(line);
    if (rel) rels.push([rel[1], rel[2]]);
  }
  return { entities, rels };
}

// ---------------------------------------------------------------------------
function checkEr() {
  console.log('\n-- ER diagram (docs/diagrams/er.mmd) against server/models/');
  const { entities, rels } = parseEr(fs.readFileSync(path.join(DIAGRAMS, 'er.mmd'), 'utf8'));
  const linked = (a, b) => rels.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  const missingEntities = Object.keys(ENTITY).filter((e) => !entities[e]);
  const unknownEntities = Object.keys(entities).filter((e) => !ENTITY[e]);
  check('Every collection and embedded array is an entity in the diagram',
    missingEntities.length + unknownEntities.length === 0,
    `${Object.keys(entities).length} entities`
      + (missingEntities.length ? `; missing ${missingEntities.join(', ')}` : '')
      + (unknownEntities.length ? `; not in the code: ${unknownEntities.join(', ')}` : ''));

  for (const [entity, where] of Object.entries(ENTITY)) {
    if (!entities[entity]) continue;
    const drawn = entities[entity];
    const real = schemaFields(where);
    const problems = [];
    for (const f of Object.keys(real)) if (!drawn[f]) problems.push(`missing ${f}`);
    for (const f of Object.keys(drawn)) if (!real[f]) problems.push(`${f} is not in the model`);
    for (const [f, r] of Object.entries(real)) {
      const d = drawn[f];
      if (!d) continue;
      if (d.type !== r.type) problems.push(`${f} drawn as ${d.type}, model has ${r.type}`);
      if (r.ref && d.key !== 'FK') problems.push(`${f} references ${r.ref} but is not marked FK`);
      if (!r.ref && d.key === 'FK') problems.push(`${f} is marked FK but references nothing`);
      if (r.ref && !linked(entity, MODEL_ENTITY[r.ref])) problems.push(`no relationship line ${entity} - ${MODEL_ENTITY[r.ref]} for ${f}`);
    }
    if (where.length === 2 && !linked(entity, ENTITY_PARENT(where[0]))) problems.push(`not linked to ${ENTITY_PARENT(where[0])}`);
    check(`${entity.padEnd(15)} matches ${where.join('.')}`, problems.length === 0,
      problems.length ? problems.join('; ') : `${Object.keys(real).length} fields`);
  }
}
const ENTITY_PARENT = (modelName) => MODEL_ENTITY[modelName];

function checkArchitecture() {
  console.log('\n-- Architecture diagram names the real collections');
  const text = fs.readFileSync(path.join(DIAGRAMS, 'architecture.mmd'), 'utf8');
  const names = Object.values(models).map((M) => M.collection.collectionName);
  const missing = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
  check('Every collection appears by its MongoDB name', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${names.length} collections`);
}

// ---------------------------------------------------------------------------
// Generated: schema.mmd (class diagram) and SCHEMA.md (tables)
// ---------------------------------------------------------------------------
function describe(t) {
  const o = t.options || {};
  const bits = [];
  if (o.required) bits.push('required');
  if (o.unique) bits.push('unique');
  if (o.select === false) bits.push('never returned by default');
  if (o.default !== undefined && typeof o.default !== 'function' && o.default !== null && !Array.isArray(o.default)) bits.push(`default ${JSON.stringify(o.default)}`);
  if (o.min !== undefined) bits.push(`min ${Array.isArray(o.min) ? o.min[0] : o.min}`);
  if (o.max !== undefined) bits.push(`max ${Array.isArray(o.max) ? o.max[0] : o.max}`);
  if (o.maxlength !== undefined) bits.push(`max length ${Array.isArray(o.maxlength) ? o.maxlength[0] : o.maxlength}`);
  if (o.get && o.get.name === 'toRupees') bits.push('money, stored in paise');
  return bits;
}

function typeOf(t) {
  if (t.instance === 'Array') {
    if (t.schema) return 'embedded array';
    const inner = t.caster ? t.caster.instance : 'Mixed';
    const ref = t.caster && t.caster.options && t.caster.options.ref;
    return `${inner}[]${ref ? ` → ${ref}` : ''}`;
  }
  return `${t.instance}${t.options && t.options.ref ? ` → ${t.options.ref}` : ''}`;
}

function eachField(schema, fn, prefix = '') {
  schema.eachPath((p, t) => {
    if (SKIP.has(p)) return;
    fn(prefix + p, t);
    if (t.schema) eachField(t.schema, fn, `${prefix}${p}[].`);
  });
}

const ORDER = ['User', 'Supplier', 'Product', 'StockLog', 'RestockRequest', 'Sale', 'Customer', 'Note',
  'Notification', 'Issue', 'Task', 'ComboCache', 'Prediction', 'Counter'];

function generateSchemaMd() {
  const out = [
    '# SIA database schema',
    '',
    '> **Generated from `server/models/` by `npm run docscheck -- --write`. Do not edit by hand.**',
    '> `npm run docscheck` fails if this file no longer matches the code.',
    '',
    'MongoDB database `sia`. Every collection except `counters` and `predictions` also has',
    '`createdAt` and `updatedAt`, maintained by Mongoose. Money fields are integers in paise and are',
    'converted to rupees only at the API edge. The ER diagram is `docs/diagrams/er.svg`.',
    '',
  ];
  for (const name of ORDER) {
    const M = models[name];
    out.push(`## ${name} — \`${M.collection.collectionName}\``, '', '| Field | Type | Rules |', '|---|---|---|');
    eachField(M.schema, (p, t) => {
      if (p === '_id' && t.instance === 'ObjectId') return;
      const rules = describe(t);
      if (t.enumValues && t.enumValues.length) rules.push(`one of: ${t.enumValues.join(', ')}`);
      out.push(`| \`${p}\` | ${typeOf(t)} | ${rules.join('; ') || '—'} |`);
    });
    const idx = M.schema.indexes().map(([k, o]) => {
      const keys = Object.entries(k).map(([f, d]) => `${f} ${d === 1 ? '↑' : d === -1 ? '↓' : d}`).join(', ');
      const opts = [o.unique && 'unique', o.partialFilterExpression && `partial: ${JSON.stringify(o.partialFilterExpression)}`].filter(Boolean);
      return `\`${keys}\`${opts.length ? ` (${opts.join('; ')})` : ''}`;
    });
    out.push('', `**Indexes:** ${idx.length ? idx.join(' · ') : 'only `_id`'}`, '');
  }
  return out.join('\n');
}

function generateSchemaMmd() {
  const out = [
    '%% GENERATED from server/models/ by `npm run docscheck -- --write`. Do not edit by hand.',
    'classDiagram',
    '    direction LR',
  ];
  const links = [];
  for (const name of ORDER) {
    const M = models[name];
    out.push(`    class ${name} {`, `        <<${M.collection.collectionName}>>`);
    eachField(M.schema, (p, t) => {
      if (p === '_id' && t.instance === 'ObjectId') return;
      const flags = [t.options && t.options.required && 'required', t.options && t.options.unique && 'unique'].filter(Boolean);
      const type = typeOf(t).replace(/ → .*/, '').replace('[]', '_list').replace('embedded array', 'embedded');
      out.push(`        ${type} ${p.replace('[].', '_')}${flags.length ? ` (${flags.join(', ')})` : ''}`);
      const ref = (t.options && t.options.ref) || (t.caster && t.caster.options && t.caster.options.ref);
      if (ref && ref !== name) links.push(`    ${name} --> ${ref} : ${p.replace('[].', '_')}`);
    });
    out.push('    }');
  }
  return [...out, ...links, ''].join('\n');
}

function checkGenerated() {
  console.log('\n-- Generated documents are current');
  for (const [file, text] of [[path.join(DOCS, 'SCHEMA.md'), generateSchemaMd()], [path.join(DIAGRAMS, 'schema.mmd'), generateSchemaMmd()]]) {
    const rel = path.relative(path.join(DOCS, '..'), file).replace(/\\/g, '/');
    if (WRITE) {
      fs.writeFileSync(file, text);
      check(`${rel} written`, true);
    } else {
      const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
      check(`${rel} matches the models`, now === text, now === null ? 'missing: run npm run docscheck -- --write' : now === text ? '' : 'stale: run npm run docscheck -- --write');
    }
  }
}

console.log('\nChecking the documents against the code');
checkGenerated();
checkEr();
checkArchitecture();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed ? 1 : 0);
