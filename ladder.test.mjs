// ladder.test.mjs — the ladder woven into the Discombobulator: climbing its own decision log must be monotone
// (never regress a decision pattern), deterministic, and find real signal. Small config so the suite stays fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDecisionDomain, climb, climbAll, NUMERIC } from './tools/ladder.mjs';

const csv = fs.readFileSync(fileURLToPath(new URL('./samples/decisions.csv', import.meta.url)), 'utf8');
const CFG = { population: 12, elites: 3, generations: 10 };

test('loadDecisionDomain: builds a binary one-vs-rest domain over the numeric features', () => {
  const ds = loadDecisionDomain(csv, 'DECLINE');
  assert.equal(ds.ok, true);
  assert.deepEqual(ds.features, NUMERIC);
  assert.ok(ds.y.every((v) => v === 0 || v === 1));
  assert.ok(ds.trainRows.length > 0 && ds.heldRows.length > 0);
  assert.equal(new Set([...ds.trainRows, ...ds.heldRows]).size, ds.n, 'train and held partition every row');
  assert.equal(loadDecisionDomain('', 'DECLINE').ok, false);
});

test('climb: monotone (no tier regresses) and finds real signal on DECLINE', () => {
  const r = climb(loadDecisionDomain(csv, 'DECLINE'), { rungs: 3, cfg: CFG });
  assert.equal(r.monotone, true);
  for (let i = 1; i < r.tiers.length; i++) assert.ok(r.tiers[i].heldAuc >= r.tiers[i - 1].heldAuc - 1e-9);
  assert.ok(r.tiers[0].heldAuc > 0.55, 'tier 1 already beats chance — the decision log carries signal');
});

test('climb is deterministic — same log, same tiers', () => {
  const a = climb(loadDecisionDomain(csv, 'APPROVE'), { rungs: 2, cfg: CFG });
  const b = climb(loadDecisionDomain(csv, 'APPROVE'), { rungs: 2, cfg: CFG });
  assert.deepEqual(a.tiers, b.tiers);
});

test('climbAll: every decision class climbs monotonically, with a content-hashed receipt', () => {
  const r = climbAll(csv, { cfg: CFG, rungs: 2 });
  assert.equal(r.monotone, true);
  assert.ok(r.meanTierTop >= r.meanTier1 - 1e-9, 'the library as a whole does not regress');
  assert.match(r.receiptHash, /^[0-9a-f]{64}$/);
});
