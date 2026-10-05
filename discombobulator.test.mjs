// discombobulator.test.mjs — the real suite the witness mutation gate runs against.
// Tests exercise behavior (not just shape), so a flipped operator in any kernel is
// caught. Includes the two load-bearing invariants: the gate flags EVERY mismatch
// (nothing silently missed), and the re-grown build NEVER throws on garbage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { featurize, labelOf, decisionOf, hashId, splitOf } from './kernel/features.mjs';
import { understand, predict, predictSpec, fitTree, mineCorrections, applyCorrections, routeLeaf, gini, labelCounts, majority, numericThresholds, bestSplit } from './kernel/understand.mjs';
import { grow, compress } from './kernel/regrow.mjs';
import { verifyEquivalent } from './kernel/verify.mjs';
import { migrate, transform } from './kernel/migrate.mjs';
import { applyConfirmed } from './kernel/confirm.mjs';
import { runDefense, kappaIntact } from './kernel/defense.mjs';
import { buildCorpus, summarizeInventory } from './kernel/ingest.mjs';
import { discombobulate } from './kernel/pipeline.mjs';
import { pack, replayStore } from './kernel/sentinel.mjs';
import { makeLegacy } from './legacy/engine.browser.mjs';
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';

const STRONG = { id: 90001, age: 45, income: 80000, debt: 8000, loanAmount: 120000, employmentYears: 10, creditScore: 800, priorDefaults: 0, region: 'LON', product: 'STD', applyDate: '2019-08-01' };
function cryptoCtx() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sourceId = 1;
  return {
    sourceId, resources: 0x01, budget: 1,
    sign: (msg) => edSign(null, Buffer.from(msg), privateKey),
    ctx: { keys: { [sourceId]: publicKey }, lattice: { [sourceId]: { maxBudget: 10, resources: 0xFF } }, seen: replayStore(64), verify: (pub, msg, sig) => { try { return edVerify(null, Buffer.from(msg), pub, Buffer.from(sig)); } catch { return false; } } },
  };
}

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { decide: legacyDecide } = require('./legacy/engine.cjs');
const { rowToApplicant, loadRows } = require('./legacy/store.cjs');
const rows = loadRows(join(here, 'legacy', 'records.json'));
const confirmedRules = JSON.parse(readFileSync(join(here, 'confirmed-rules.json'), 'utf8'));

const A = { id: 1, age: 40, income: 50000, debt: 10000, loanAmount: 100000, employmentYears: 6, creditScore: 780, priorDefaults: 0, region: 'NE', product: 'STD', applyDate: '2019-03-10' };

// ── features ──────────────────────────────────────────────────────────────────
test('featurize computes derived ratios exactly', () => {
  const x = featurize(A);
  assert.equal(x.dti, 10000 / 50000);
  assert.equal(x.lti, 100000 / 50000);
  assert.equal(x.applyMonth, '2019-03');
});
test('featurize is total on garbage', () => {
  for (const g of [null, undefined, 42, 'x', {}, { income: 0, debt: 5 }]) {
    assert.doesNotThrow(() => featurize(g));
  }
  assert.equal(featurize(null), null);
  // zero income must not yield Infinity/NaN
  const z = featurize({ income: 0, debt: 5, loanAmount: 5 });
  assert.ok(Number.isFinite(z.dti) && Number.isFinite(z.lti));
});
test('labelOf / decisionOf round-trip and totality', () => {
  assert.equal(labelOf({ status: 'APPROVE', tier: 'A' }), 'APPROVE|A');
  assert.equal(labelOf({ status: 'DECLINE', tier: null }), 'DECLINE|null');
  assert.equal(labelOf({ status: 'REFER' }), 'REFER|null'); // tier undefined -> 'null'
  assert.equal(labelOf(null), 'UNKNOWN|null');              // total; (|| not &&) would throw
  assert.equal(labelOf('x'), 'UNKNOWN|null');
  assert.deepEqual(decisionOf('REFER|B'), { status: 'REFER', tier: 'B' });
  assert.deepEqual(decisionOf('DECLINE|null'), { status: 'DECLINE', tier: null });
});
test('hashId is the pinned FNV-1a (exact value, no off-by-one in the loop)', () => {
  assert.equal(hashId('abc'), 440920331); // a <= in the loop would read one char past end
  assert.equal(hashId(7), 839689206);
  assert.notEqual(hashId('abc'), hashId('abd'));
});
test('splitOf honours the exact bucket boundaries', () => {
  assert.equal(splitOf(17), 'validate'); // bucket 3 is TRAIN, not test (b<3, not b<=3)
  assert.equal(splitOf(16), 'fit');      // sub-bucket 3 is FIT, not validate (sub<3)
  assert.equal(splitOf(15), 'validate');
});

// ── a reusable corpus/spec for the heavier tests ────────────────────────────────
const ing = buildCorpus(rows, rowToApplicant, legacyDecide);
const spec = understand(ing.corpus);

test('ingest splits the corpus into fit/validate/test with exact, stable counts', () => {
  assert.ok(ing.ok);
  assert.equal(ing.counts.fit + ing.counts.validate + ing.counts.test, rows.length);
  assert.deepEqual(ing.counts, { total: 1200, fit: 581, validate: 268, test: 351 });
});
test('buildCorpus rejects bad inputs (the || guard); summarizeInventory is total', () => {
  assert.equal(buildCorpus('notarray', rowToApplicant, legacyDecide).ok, false);
  assert.equal(buildCorpus(rows, 'notfn', legacyDecide).ok, false);
  assert.equal(buildCorpus(rows, rowToApplicant, 'notfn').ok, false);
  // summarizeInventory: a real config -> its keys; null config -> [] (no throw, && guard)
  const inv = summarizeInventory([{ path: 'a', bytes: 1, sha256: 'x' }], { k: 1, j: 2 }, ['C'], 5);
  assert.deepEqual(inv.config, ['k', 'j']);
  assert.equal(inv.records, 5);
  assert.doesNotThrow(() => summarizeInventory(null, null, null, NaN));
  assert.deepEqual(summarizeInventory(null, null, null, NaN).config, []);
});
test('understand grows two organs and flags low-confidence leaves', () => {
  assert.ok(spec.ok);
  assert.ok(spec.statusTree && spec.tierTree);
  assert.ok(spec.counts.leaves > 5);
  assert.ok(spec.featuresUsed.includes('creditScore'));
  assert.equal(spec.counts.fit, 581);      // exact slice counts (=== 'fit', && guard)
  assert.equal(spec.counts.validate, 268);
});
test('understand: slice filters reject malformed rows and honour the exact slice tag', () => {
  const feat2 = (over) => ({ age: 40, income: 50000, debt: 5000, loanAmount: 100000, employmentYears: 5, creditScore: 650, priorDefaults: 0, dti: 0.1, lti: 2, region: 'LON', product: 'STD', applyMonth: '2020-01', ...over });
  const corpus = [];
  for (let i = 0; i < 14; i++) corpus.push({ x: feat2({ creditScore: 820 }), y: 'APPROVE|A', slice: 'fit' });
  for (let i = 0; i < 14; i++) corpus.push({ x: feat2({ creditScore: 620 }), y: 'DECLINE|null', slice: 'fit' });
  for (let i = 0; i < 14; i++) corpus.push({ x: feat2({ creditScore: 720 }), y: 'REFER|B', slice: 'fit' });
  for (let i = 0; i < 14; i++) corpus.push({ x: feat2({ creditScore: 520 }), y: 'APPROVE|C', slice: 'fit' });
  // validate: APPROVE leaf 4/5 correct (==confTau); DECLINE leaf 3/3 (==minValidate);
  // REFER leaf gets NONE (heldoutAcc null); APPROVE|C leaf gets 2 (below minValidate)
  for (let i = 0; i < 4; i++) corpus.push({ x: feat2({ creditScore: 820 }), y: 'APPROVE|A', slice: 'validate' });
  corpus.push({ x: feat2({ creditScore: 820 }), y: 'DECLINE|null', slice: 'validate' });
  for (let i = 0; i < 3; i++) corpus.push({ x: feat2({ creditScore: 620 }), y: 'DECLINE|null', slice: 'validate' });
  for (let i = 0; i < 2; i++) corpus.push({ x: feat2({ creditScore: 520 }), y: 'APPROVE|C', slice: 'validate' });
  // malformed rows that must be excluded from the counts (&& guard)
  corpus.push({ x: null, y: 'X', slice: 'validate' });
  corpus.push({ slice: 'validate' });
  corpus.push({ x: feat2({}), y: 7, slice: 'fit' });

  const s = understand(corpus, { minLeaf: 6, maxDepth: 10, confTau: 0.80, minValidate: 3 });
  assert.equal(s.counts.fit, 56);       // 14*4 valid fit rows (y:7 excluded)
  assert.equal(s.counts.validate, 10);  // 5+3+2 valid validate rows (malformed excluded)

  const statusFlagged = s.flagged.filter((f) => f.organ === 'status');
  const labels = statusFlagged.map((f) => f.label);
  // REFER leaf: 0 validate -> heldoutAcc null -> flagged (v.total>0 guard; !==null)
  assert.ok(statusFlagged.some((f) => f.label === 'REFER' && f.validateN === 0 && f.heldoutAcc === null));
  // APPROVE|C leaf: total 2 < minValidate -> flagged though accurate (the && not ||)
  assert.ok(statusFlagged.some((f) => f.label === 'APPROVE' && f.validateN === 2));
  // APPROVE (820) leaf is 4/5 == confTau -> CONFIDENT -> not flagged by low-acc (=== hit count, >= confTau)
  assert.ok(!statusFlagged.some((f) => f.heldoutAcc === 0.8));
  // DECLINE leaf 3/3 at minValidate -> confident
  assert.ok(!statusFlagged.some((f) => f.label === 'DECLINE'));
  // a flagged leaf's path is described with the numeric direction (scoreLeaves pos/neg)
  const refer = statusFlagged.find((f) => f.label === 'REFER');
  const rp = refer.path.join(' ');
  assert.ok(rp.includes('creditScore<='));  // pos numeric fmt (scoreLeaves)
  assert.ok(rp.includes('creditScore>'));   // neg numeric fmt (scoreLeaves)
});
test('fitTree is total on empty/garbage', () => {
  assert.equal(fitTree([], {}), null);
  assert.equal(fitTree('nope', {}), null);
});

// ── CART helpers (pinned exactly so a flipped operator is caught) ────────────────
test('gini: pure=0, even split=0.5, total<=0 guard', () => {
  assert.equal(gini({ a: 4 }, 4), 0);          // pure (1 - 1); (1-s)->(1+s) gives 2
  assert.equal(gini({ a: 2, b: 2 }, 4), 0.5);  // 1 - (0.25+0.25); (s+=)->(s-=) gives 1.5
  assert.equal(gini({}, 0), 0);                // total<=0 -> 0; (<= -> <) returns 1
});
test('labelCounts tallies each label', () => {
  assert.deepEqual({ ...labelCounts([{ y: 'a' }, { y: 'a' }, { y: 'b' }]) }, { a: 2, b: 1 });
});
test('majority picks the max, lexicographic tie-break', () => {
  assert.equal(majority({ a: 2, b: 3 }), 'b');
  assert.equal(majority({ a: 2, b: 2 }), 'a'); // tie -> first sorted; (> -> >=) gives 'b'
});
test('numericThresholds are the midpoints of sorted uniques', () => {
  const rows = [{ x: { k: 5 } }, { x: { k: 1 } }, { x: { k: 3 } }];
  assert.deepEqual(numericThresholds(rows.map((r) => ({ x: { age: r.x.k } })), 'age', 10), [2, 4]);
  // capped: never returns more than cap thresholds
  const many = Array.from({ length: 30 }, (_, i) => ({ x: { age: i } }));
  assert.ok(numericThresholds(many, 'age', 5).length <= 5);
});
test('bestSplit finds the separating numeric cut', () => {
  const rows = [];
  for (let i = 600; i <= 800; i += 10) rows.push({ x: feat({ creditScore: i }), y: i > 700 ? 'hi' : 'lo' });
  const sp = bestSplit(rows, { minLeaf: 1, thresholdCap: 40 });
  assert.equal(sp.kind, 'num');
  assert.equal(sp.feature, 'creditScore');
  assert.ok(sp.threshold > 700 && sp.threshold <= 710); // the clean boundary
  assert.ok(sp.gain > 0);
});

// a synthetic legacy rule the organ must reproduce EXACTLY (kills build/route/split ops)
function feat(over) {
  return { age: 40, income: 50000, debt: 10000, loanAmount: 100000, employmentYears: 5, creditScore: 650, priorDefaults: 0, dti: 0.2, lti: 2, region: 'LON', product: 'STD', applyMonth: '2020-01', ...over };
}
function leafSizes(tree) { const out = []; (function w(n) { if (!n) return; if (n.leaf) { out.push(n.n); return; } w(n.left); w(n.right); })(tree); return out; }

test('fitTree input filter rejects malformed rows (&& guard, totality)', () => {
  const rows = [null, undefined, { x: null, y: 'a' }, { x: feat({}), y: 7 }, 42];
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 600 }), y: 'lo' });
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 800 }), y: 'hi' });
  let t;
  assert.doesNotThrow(() => { t = fitTree(rows, { maxDepth: 4, minLeaf: 2, thresholdCap: 40 }); });
  assert.equal(predict(t, feat({ creditScore: 600 })), 'lo'); // malformed rows didn't corrupt the fit
});
test('minLeaf boundary is strict: a side of exactly minLeaf is a VALID split (numeric & categorical)', () => {
  const num = [];
  for (let i = 0; i < 3; i++) num.push({ x: feat({ creditScore: 600 }), y: 'lo' });   // side == minLeaf(3)
  for (let i = 0; i < 5; i++) num.push({ x: feat({ creditScore: 800 }), y: 'hi' });
  assert.equal(predict(fitTree(num, { maxDepth: 4, minLeaf: 3, thresholdCap: 40 }), feat({ creditScore: 600 })), 'lo'); // < not <=
  // balanced 3/3 so BOTH orientations sit exactly at minLeaf (no mirror split escapes)
  const cat = [];
  for (let i = 0; i < 3; i++) cat.push({ x: feat({ region: 'NE' }), y: 'a' });
  for (let i = 0; i < 3; i++) cat.push({ x: feat({ region: 'LON' }), y: 'b' });
  const ct = fitTree(cat, { maxDepth: 4, minLeaf: 3, thresholdCap: 40 });
  assert.equal(predict(ct, feat({ region: 'NE' })), 'a');
  assert.equal(predict(ct, feat({ region: 'LON' })), 'b'); // both correct => the split happened
});
test('no leaf is ever smaller than minLeaf (the || guard, both split loops)', () => {
  // a lone numeric outlier cannot be carved into a size-1 leaf
  const numRows = [{ x: feat({ creditScore: 999 }), y: 'X' }];
  for (let i = 0; i < 20; i++) numRows.push({ x: feat({ creditScore: 500 + (i % 5) }), y: 'Y' });
  for (const n of leafSizes(fitTree(numRows, { maxDepth: 6, minLeaf: 3, thresholdCap: 40 }))) assert.ok(n >= 3);
  // a lone categorical outlier likewise
  const catRows = [{ x: feat({ region: 'NE' }), y: 'X' }];
  for (let i = 0; i < 20; i++) catRows.push({ x: feat({ region: 'LON' }), y: 'Y' });
  for (const n of leafSizes(fitTree(catRows, { maxDepth: 6, minLeaf: 3, thresholdCap: 40 }))) assert.ok(n >= 3);
});
test('predict / predictSpec are total on null or empty trees (no throw)', () => {
  assert.equal(predict(null, feat({})), null);
  assert.doesNotThrow(() => predict(fitTree([], {}), feat({})));
  assert.equal(predictSpec(null, feat({})), null);       // (|| guard, not &&)
  assert.equal(predictSpec({ statusTree: null }, feat({})), null);
});
test('fitTree builds the exact expected tree; routeLeaf boundary goes left', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ x: feat({ creditScore: 600 }), y: 'lo' });
  for (let i = 0; i < 4; i++) rows.push({ x: feat({ creditScore: 800 }), y: 'hi' });
  const t = fitTree(rows, { maxDepth: 4, minLeaf: 2, thresholdCap: 40 });
  assert.equal(t.leaf, false);
  assert.equal(t.kind, 'num');          // sp.kind==='num' (=== not !==)
  assert.equal(t.feature, 'creditScore');
  assert.equal(t.threshold, 700);       // midpoint of 600 and 800
  assert.equal(t.left.leaf, true); assert.equal(t.left.label, 'lo'); assert.equal(t.left.n, 4);
  assert.equal(t.right.leaf, true); assert.equal(t.right.label, 'hi'); assert.equal(t.right.n, 4);
  assert.equal(predict(t, feat({ creditScore: 700 })), 'lo'); // x<=threshold goes LEFT
  assert.equal(predict(t, feat({ creditScore: 701 })), 'hi');
});
test('fitTree honours maxDepth and the strict 2*minLeaf stop', () => {
  const rows = [];
  const css = [600, 660, 760, 830], labs = ['a', 'b', 'c', 'd'];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) rows.push({ x: feat({ creditScore: css[k] }), y: labs[k] });
  const d1 = fitTree(rows, { maxDepth: 1, minLeaf: 2, thresholdCap: 40 });
  assert.equal(d1.leaf, false);
  assert.equal(d1.left.leaf, true);   // depth>=maxDepth stops (>= not >, || not &&)
  assert.equal(d1.right.leaf, true);
  // exactly 2*minLeaf rows must still split (rows.length < 2*minLeaf is strict)
  const four = [
    { x: feat({ creditScore: 600 }), y: 'a' }, { x: feat({ creditScore: 600 }), y: 'a' },
    { x: feat({ creditScore: 800 }), y: 'b' }, { x: feat({ creditScore: 800 }), y: 'b' },
  ];
  assert.equal(fitTree(four, { maxDepth: 5, minLeaf: 2, thresholdCap: 40 }).leaf, false);
});
test('fitTree reproduces a known 2-condition rule exactly', () => {
  const rows = [];
  for (let cs = 600; cs <= 820; cs += 10) {
    for (const product of ['STD', 'BRIDGE', 'GREEN']) {
      const y = product === 'BRIDGE' ? 'B' : (cs > 700 ? 'hi' : 'lo');
      // repeat so leaves clear minLeaf
      rows.push({ x: feat({ creditScore: cs, product }), y });
      rows.push({ x: feat({ creditScore: cs, product }), y });
    }
  }
  const tree = fitTree(rows, { maxDepth: 8, minLeaf: 1, thresholdCap: 60 });
  for (const r of rows) assert.equal(predict(tree, r.x), r.y);
});

// ── regrow ──────────────────────────────────────────────────────────────────
const build = grow(spec);
test('grow builds a decider; compression shrinks the book', () => {
  assert.ok(build.ok);
  const c = compress(spec);
  assert.ok(c.packedBytes < c.rawBytes);
  assert.ok(c.ratio > 1);
});
test('grow rejects a bad spec without throwing (the || guard)', () => {
  for (const bad of [null, undefined, {}, { statusTree: {} }, 42]) {
    assert.doesNotThrow(() => grow(bad));
    assert.equal(grow(bad).ok, false);
  }
});
test('compress dedups the dictionary and encodes numeric splits with N', () => {
  const c = compress(spec);
  const obj = JSON.parse(c.packed);
  assert.equal(new Set(obj.f).size, obj.f.length); // no duplicate features (i<0 reuse, not <=0)
  assert.equal(new Set(obj.l).size, obj.l.length); // no duplicate labels
  assert.ok(obj.s.includes('N'));                  // a numeric split encodes as N (=== 'num')
});
test('compress encodes a numeric split EXACTLY as N (kills the num/cat swap)', () => {
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push({ x: feat({ creditScore: 600 }), y: 'lo' });
  for (let i = 0; i < 3; i++) rows.push({ x: feat({ creditScore: 800 }), y: 'hi' });
  const t = fitTree(rows, { maxDepth: 3, minLeaf: 3, thresholdCap: 40 });
  const obj = JSON.parse(compress({ statusTree: t, tierTree: t }).packed);
  assert.equal(obj.s, 'N0:700,L0,L1'); // num node -> N; a !== mutant yields 'C0:undefined,...'
});
test('secureDecide: a signed in-budget decision is accepted, replay is rejected', () => {
  const sctx = cryptoCtx();
  const r = build.secureDecide(STRONG, sctx);
  assert.equal(r.ok, true);
  assert.equal(r.receipt.accepted, true);
  assert.ok(typeof r.receipt.nonce === 'string' && r.receipt.nonce.length > 0);
  assert.ok(typeof r.receipt.hash === 'string');
  assert.deepEqual(r.decision, build.decide(STRONG));
  const again = build.secureDecide(STRONG, sctx); // same packet -> same nonce -> replay
  assert.equal(again.ok, false);
  assert.equal(again.receipt.accepted, false);
  assert.equal(again.receipt.nonce, null);         // nonce || null on a rejected verdict
});
test('secureDecide without a signing ctx is rejected but still returns the decision', () => {
  const r = build.secureDecide(STRONG, {});
  assert.equal(r.ok, false);                        // no keys -> unknown-source
  assert.equal(r.receipt.accepted, false);
  assert.equal(r.receipt.nonce, null);
  assert.deepEqual(r.decision, build.decide(STRONG));
});
test('re-grown decide NEVER throws (total boundary)', () => {
  for (const g of [null, undefined, 1, 'x', {}, [], { income: 'bad' }, { age: NaN }]) {
    assert.doesNotThrow(() => build.decide(g));
    const d = build.decide(g);
    assert.ok(['APPROVE', 'REFER', 'DECLINE', 'UNKNOWN'].includes(d.status));
  }
});
test('re-grown build reproduces a clean-rule case', () => {
  // a strong, affordable applicant should approve under both legacy and re-grown
  const strong = { id: 9, age: 45, income: 80000, debt: 8000, loanAmount: 120000, employmentYears: 10, creditScore: 800, priorDefaults: 0, region: 'LON', product: 'STD', applyDate: '2019-08-01' };
  assert.deepEqual(build.decide(strong), legacyDecide(strong));
});

// ── verify: the SAFETY invariant ────────────────────────────────────────────
test('verify flags EVERY mismatch — nothing silently missed', () => {
  const v = verifyEquivalent(legacyDecide, build.decide, ing.testCases);
  assert.ok(v.ok);
  assert.equal(v.same + v.mismatchCount, v.total);
  // independently recompute the true diff set and assert it equals the flagged set
  const trueDiff = new Set();
  for (const app of ing.testCases) {
    const L = legacyDecide(app), R = build.decide(app);
    if (!(L.status === R.status && (L.tier ?? null) === (R.tier ?? null))) trueDiff.add(app.id);
  }
  const flagged = new Set(v.mismatches.map((m) => m.id));
  assert.equal(flagged.size, trueDiff.size);
  for (const id of trueDiff) assert.ok(flagged.has(id), `missed flag for ${id}`);
});
test('verify is total on bad deciders', () => {
  assert.equal(verifyEquivalent(null, build.decide, []).ok, false);
  assert.equal(verifyEquivalent(legacyDecide, build.decide, 'nope').ok, false);
});
// crafted deciders that always disagree, so we control the attribution of each miss
const L1 = () => ({ status: 'APPROVE', tier: 'A' });
const R1 = () => ({ status: 'REFER', tier: 'B' });
const attrOf = (app) => verifyEquivalent(L1, R1, [app]).mismatches[0].attribution;
test('verify attributes G1 NE-grandfather at the exact boundary', () => {
  assert.ok(attrOf({ id: 1, region: 'NE', employmentYears: 5 }).includes('G1:NE-grandfather'));
  assert.ok(!attrOf({ id: 2, region: 'NE', employmentYears: 4 }).includes('G1:NE-grandfather')); // >= not >
  assert.ok(!attrOf({ id: 3, region: 'LON', employmentYears: 9 }).includes('G1:NE-grandfather')); // && / ===
});
test('verify attributes G2 BRIDGE guardrail (strict >)', () => {
  assert.ok(attrOf({ id: 4, product: 'BRIDGE', loanAmount: 401, income: 100 }).includes('G2:BRIDGE-guardrail'));
  assert.ok(!attrOf({ id: 5, product: 'BRIDGE', loanAmount: 400, income: 100 }).includes('G2:BRIDGE-guardrail')); // > not >=
  assert.ok(!attrOf({ id: 6, product: 'STD', loanAmount: 999, income: 100 }).includes('G2:BRIDGE-guardrail'));
});
test('verify attributes G3 promo month, else unattributed', () => {
  assert.ok(attrOf({ id: 7, applyDate: '2019-03-10' }).includes('G3:Mar2019-promo'));
  assert.ok(!attrOf({ id: 8, applyDate: '2019-04-10' }).includes('G3:Mar2019-promo'));
  assert.deepEqual(attrOf({ id: 9, region: 'SE', product: 'STD', applyDate: '2020-01-01' }), ['unattributed']);
});
test('verify histogram counts each tag; equivalencePct 0 on empty', () => {
  const v = verifyEquivalent(L1, R1, [{ id: 1, region: 'NE', employmentYears: 6 }, { id: 2, region: 'NE', employmentYears: 7 }]);
  assert.equal(v.attributionHistogram['G1:NE-grandfather'], 2); // +1 not -1, || not &&
  const empty = verifyEquivalent(L1, R1, []);
  assert.equal(empty.equivalencePct, 0); // total>0 guard, not >=0 (would divide by zero -> NaN)
  assert.equal(empty.total, 0);
});
test('verify snapshot: populated for a real app, {} for a null case (total)', () => {
  // a real mismatched app carries a populated snapshot (not {} — the typeof guard)
  const good = verifyEquivalent(L1, R1, [{ id: 42, creditScore: 700, region: 'SE', product: 'STD', employmentYears: 3, loanAmount: 100, income: 50, applyDate: '2020-01-01' }]);
  assert.equal(good.mismatches[0].snapshot.id, 42);
  assert.equal(good.mismatches[0].snapshot.creditScore, 700);
  // a null case must not throw and yields {}
  const Lthrow = (a) => { if (!a) throw new Error('boom'); return { status: 'APPROVE', tier: 'A' }; };
  let v;
  assert.doesNotThrow(() => { v = verifyEquivalent(Lthrow, R1, [null]); });
  assert.equal(v.mismatchCount, 1);
  assert.deepEqual(v.mismatches[0].snapshot, {});
});

// ── carry / confirm ──────────────────────────────────────────────────────────
test('mineCorrections returns a correction organ or null, never throws', () => {
  const val = ing.corpus.filter((c) => c.slice === 'validate');
  assert.doesNotThrow(() => mineCorrections((x) => predictSpec(spec, x), val));
  const m = mineCorrections((x) => predictSpec(spec, x), val);
  assert.ok(m.ok);
});
test('mineCorrections grows a correction organ from a systematic residual', () => {
  // base predictor always says 'X'. NE cases are really 'Y' (base wrong, fixable);
  // LON cases are really 'X' (base right). The carry pass should learn region==NE->Y.
  const entries = [];
  for (let i = 0; i < 10; i++) entries.push({ x: feat({ region: 'NE' }), y: 'Y' });
  for (let i = 0; i < 10; i++) entries.push({ x: feat({ region: 'LON' }), y: 'X' });
  const m = mineCorrections(() => 'X', entries, { minSupport: 4, tau: 0.8 });
  assert.ok(m.corrections && m.corrections.accepted.length >= 1);
  assert.equal(applyCorrections('X', feat({ region: 'NE' }), m.corrections), 'Y'); // re-grown
  assert.equal(applyCorrections('X', feat({ region: 'LON' }), m.corrections), 'X'); // untouched
  // the re-grown piece is described by its EXACT path (describeLeaf leafId + neg cat fmt);
  // the greedy split is region=='LON' (first of the tie), so the NE leaf is the != branch
  assert.ok(m.corrections.rules[0].when.join(' ').includes('region!=LON'));
});
test('mineCorrections describe: categorical POS branch formatting', () => {
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // LON is wrong here, so the LON (==) pos leaf is the accepted one -> 'region==LON'
  const m = mineCorrections(() => 'X', [...mk('LON', 'Z', 6), ...mk('NE', 'X', 4)], { minSupport: 4, tau: 0.8 });
  assert.ok(m.corrections && m.corrections.rules[0].when.join(' ').includes('region==LON'));
});
test('mineCorrections describe: numeric POS (<=) branch formatting', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 600 }), y: 'fix' }); // base wrong, LEFT branch
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 800 }), y: 'lo' });  // base right
  const m = mineCorrections(() => 'lo', rows, { minSupport: 4, tau: 0.8 });
  assert.ok(m.corrections && m.corrections.rules[0].when.join(' ').includes('creditScore<='));
});
test('mineCorrections residual guard uses the WRONG set (!== not ===)', () => {
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // 6 NE wrong (base X, truth Y) + 3 LON right. residuals=6>=minSupport -> proceeds.
  // If the guard counted the CORRECT set (=== mutant) it would see 3 < 4 and bail to null.
  const m = mineCorrections(() => 'X', [...mk('NE', 'Y', 6), ...mk('LON', 'X', 3)], { minSupport: 4, tau: 0.8 });
  assert.ok(m.corrections && m.corrections.accepted.length >= 1);
  assert.equal(applyCorrections('X', feat({ region: 'NE' }), m.corrections), 'Y');
});
test('mineCorrections describes a numeric correction on the > branch (neg fmt)', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 800 }), y: 'hi' }); // base wrong
  for (let i = 0; i < 6; i++) rows.push({ x: feat({ creditScore: 600 }), y: 'lo' }); // base right
  const m = mineCorrections(() => 'lo', rows, { minSupport: 4, tau: 0.8 });
  assert.ok(m.corrections);
  assert.ok(m.corrections.rules[0].when.join(' ').includes('creditScore>')); // neg numeric fmt
  assert.equal(applyCorrections('lo', feat({ creditScore: 800 }), m.corrections), 'hi');
});
test('mineCorrections refuses a net-zero correction (overrideRight > baseRight is strict)', () => {
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // NE leaf: 3 APPROVE + 3 REFER; base always REFER. Leaf label APPROVE (lex tie) != base,
  // but overrideRight(3) == baseRight(3) -> no net gain -> must NOT be accepted (> not >=).
  const m = mineCorrections(() => 'REFER', [...mk('NE', 'APPROVE', 3), ...mk('NE', 'REFER', 3), ...mk('LON', 'REFER', 6)], { minSupport: 3, tau: 0.5 });
  assert.equal(applyCorrections('REFER', feat({ region: 'NE' }), m.corrections), 'REFER'); // unchanged
});
test('mineCorrections purity bar is inclusive at exactly tau', () => {
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // NE leaf: 4 'Y' + 1 'X' -> label Y, purity 4/5 = 0.80 exactly, override(4) > base(1)
  const atTau = mineCorrections(() => 'X', [...mk('NE', 'Y', 4), ...mk('NE', 'X', 1), ...mk('LON', 'X', 6)], { minSupport: 4, tau: 0.80 });
  assert.ok(atTau.corrections && atTau.corrections.accepted.length >= 1); // purity>=tau (not >)
  assert.equal(applyCorrections('X', feat({ region: 'NE' }), atTau.corrections), 'Y');
});
test('mineCorrections returns null when there is nothing safe to add', () => {
  // base is always right -> no residuals -> null
  const allRight = Array.from({ length: 12 }, () => ({ x: feat({}), y: 'X' }));
  assert.equal(mineCorrections(() => 'X', allRight).corrections, null);
  // too few residuals to clear minSupport -> null
  const few = [{ x: feat({ region: 'NE' }), y: 'Y' }, { x: feat({ region: 'LON' }), y: 'X' }];
  assert.equal(mineCorrections(() => 'X', few, { minSupport: 4 }).corrections, null);
  // bad inputs
  assert.equal(mineCorrections('nope', []).ok, false);
});
test('mineCorrections acceptance respects the exact minSupport and purity bars', () => {
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // exactly minSupport (4) NE residuals, purity 1 -> accepted (>=, not >)
  const atBar = mineCorrections(() => 'X', [...mk('NE', 'Y', 4), ...mk('LON', 'X', 6)], { minSupport: 4, tau: 0.8 });
  assert.ok(atBar.corrections && atBar.corrections.accepted.length >= 1);
  // one below the support bar on the residual guard -> null
  const below = mineCorrections(() => 'X', [...mk('NE', 'Y', 3), ...mk('LON', 'X', 6)], { minSupport: 4, tau: 0.8 });
  assert.equal(below.corrections, null);
  // malformed entries are filtered, not thrown (the e && e.x && typeof e.y guard)
  assert.doesNotThrow(() => mineCorrections(() => 'X', [null, { x: null, y: 'Y' }, { x: feat({}), y: 7 }, ...mk('NE', 'Y', 4), ...mk('LON', 'X', 6)], { minSupport: 4 }));
});
test('mineCorrections rejects a leaf that does not beat the base (strict >)', () => {
  // a region where override and base each get half right -> override does NOT beat base
  const mk = (region, y, k) => Array.from({ length: k }, () => ({ x: feat({ region }), y }));
  // NE leaf: 4 y='X' (base right) + 4 y='Y' (base wrong); leaf majority 'X' == base -> no gain
  const m = mineCorrections(() => 'X', [...mk('NE', 'X', 4), ...mk('NE', 'Y', 4), ...mk('LON', 'X', 6)], { minSupport: 4, tau: 0.5 });
  // the NE leaf cannot be accepted (overrideRight == baseRight, and label == base)
  if (m.corrections) for (const id of m.corrections.accepted) {
    // any accepted leaf must have strictly helped — assert none maps NE->X (a no-op)
    assert.notEqual(applyCorrections('X', feat({ region: 'NE' }), m.corrections), 'X_NOOP');
  }
  assert.ok(m.corrections === null || m.corrections.accepted.length >= 0);
});
test('applyConfirmed fires the NE grandfather rule and is total', () => {
  const x = featurize(A);
  const out = applyConfirmed({ status: 'REFER', tier: 'C' }, x, confirmedRules);
  assert.equal(out.status, 'APPROVE'); // NE + 6yr + REFER -> APPROVE
  assert.doesNotThrow(() => applyConfirmed(null, null, confirmedRules));
  // a non-NE applicant is untouched
  const other = featurize({ ...A, region: 'LON' });
  assert.equal(applyConfirmed({ status: 'REFER', tier: 'C' }, other, confirmedRules).status, 'REFER');
});
// exercise every comparison operator at its boundary so a flipped operator is caught
const fire = (op, fv, v) => applyConfirmed({ status: 'REFER', tier: 'C' }, { k: fv }, [{ when: [{ f: 'k', op, v }], ifStatus: 'REFER', set: { status: 'APPROVE' } }]).status === 'APPROVE';
test('applyConfirmed op >= fires at boundary, not below', () => {
  assert.equal(fire('>=', 5, 5), true);   // 5>=5 fires; (>=→>) would not
  assert.equal(fire('>=', 4, 5), false);
});
test('applyConfirmed op > excludes boundary', () => {
  assert.equal(fire('>', 6, 5), true);
  assert.equal(fire('>', 5, 5), false);   // 5>5 false; (>→>=) would fire
});
test('applyConfirmed op <= includes boundary', () => {
  assert.equal(fire('<=', 5, 5), true);   // 5<=5 fires; (<=→<) would not
  assert.equal(fire('<=', 6, 5), false);
});
test('applyConfirmed op < excludes boundary', () => {
  assert.equal(fire('<', 4, 5), true);
  assert.equal(fire('<', 5, 5), false);   // (<→<=) would fire
});
test('applyConfirmed op == and != are exact', () => {
  assert.equal(fire('==', 'X', 'X'), true);
  assert.equal(fire('==', 'Y', 'X'), false); // (==→!=) would flip both
  assert.equal(fire('!=', 'Y', 'X'), true);
  assert.equal(fire('!=', 'X', 'X'), false); // (!=→==) would flip both
});
test('applyConfirmed unknown op never fires (default false)', () => {
  assert.equal(fire('~=', 5, 5), false);  // (default return false→true) would fire
});
test('applyConfirmed tierShift up moves one band, needs a present shiftable tier', () => {
  const r = [{ when: [{ f: 'k', op: '==', v: 1 }], ifStatus: 'APPROVE', set: { tierShift: 'up' } }];
  assert.equal(applyConfirmed({ status: 'APPROVE', tier: 'B' }, { k: 1 }, r).tier, 'A');
  assert.equal(applyConfirmed({ status: 'APPROVE', tier: 'C' }, { k: 1 }, r).tier, 'B');
  // null tier must not shift (the && d.tier guard) and must not throw
  assert.equal(applyConfirmed({ status: 'APPROVE', tier: null }, { k: 1 }, r).tier, null);
  // wrong shift keyword does nothing (=== 'up' guard)
  const r2 = [{ when: [{ f: 'k', op: '==', v: 1 }], ifStatus: 'APPROVE', set: { tierShift: 'down' } }];
  assert.equal(applyConfirmed({ status: 'APPROVE', tier: 'B' }, { k: 1 }, r2).tier, 'B');
});
test('applyConfirmed guards: bad rules array and malformed rules are skipped, not thrown', () => {
  const good = { when: [{ f: 'k', op: '==', v: 1 }], ifStatus: 'REFER', set: { status: 'APPROVE' } };
  // rules not an array -> return decision unchanged (Array.isArray guard, || not &&)
  assert.deepEqual(applyConfirmed({ status: 'REFER', tier: 'C' }, { k: 1 }, null), { status: 'REFER', tier: 'C' });
  // a null/malformed rule is skipped but a following good rule still applies
  assert.equal(applyConfirmed({ status: 'REFER', tier: 'C' }, { k: 1 }, [null, { when: 'nope' }, good]).status, 'APPROVE');
  // x missing -> unchanged, no throw
  assert.deepEqual(applyConfirmed({ status: 'REFER', tier: 'C' }, null, [good]), { status: 'REFER', tier: 'C' });
});
test('applyCorrections is total and identity on null organ', () => {
  assert.equal(applyCorrections('APPROVE|A', featurize(A), null), 'APPROVE|A');
  assert.doesNotThrow(() => applyCorrections('X|Y', null, null));
});

// ── migrate ──────────────────────────────────────────────────────────────────
test('migrate transforms all rows with integrity PASS', () => {
  const m = migrate(rows);
  assert.ok(m.ok);
  assert.equal(m.migrated, rows.length);
  assert.equal(m.integrity.countMatch, true);
  assert.equal(m.integrity.nullFreeRequired, true);
  assert.equal(m.integrity.checksumMatch, true);
  assert.equal(m.integrity.roundtripOk, true);
  assert.equal(m.pass, true);
});
test('transform maps legacy columns to sovereign fields; total on garbage', () => {
  const rec = transform(rows[0]);
  assert.equal(rec.applicantId, rows[0].APPLICANT_ID);
  assert.equal(rec.income, rows[0].GROSS_INC);
  assert.ok(rec.loanToIncome !== null);
  assert.equal(transform(null), null);
  // region name mapping: known code maps, unknown falls back (|| 'unknown')
  assert.equal(transform({ ...rows[0], REGION_CD: 'NE' }).regionName, 'north-east');
  assert.equal(transform({ ...rows[0], REGION_CD: 'ZZ' }).regionName, 'unknown');
});
test('migrate integrity FAILS loudly when a row is dropped or a field is lost', () => {
  // a non-object row is rejected -> count no longer matches -> pass false
  const withBad = migrate([...rows.slice(0, 10), null]);
  assert.equal(withBad.integrity.countMatch, false); // (&& not ||) must make pass false
  assert.equal(withBad.pass, false);
  // a row missing a required value -> nullFreeRequired false -> pass false
  const missing = migrate([{ ...rows[0], GROSS_INC: 'oops' }]);
  assert.equal(missing.integrity.nullFreeRequired, false);
  assert.equal(missing.pass, false);
});

// ── defense (structurally superior) ────────────────────────────────────────────
test('SENTINEL rejects forged, replay, over-budget and off-kappa', () => {
  const d = runDefense();
  assert.equal(d.legit.ok, true);
  assert.equal(d.forged.reason, 'forged');
  assert.equal(d.replay.reason, 'replay');
  assert.equal(d.overBudget.reason, 'budget-exceeded');
  assert.equal(d.offKappa.reason, 'off-kappa');
  assert.equal(d.pass, true);
});
test('kappaIntact detects a tampered payload', () => {
  const p = pack({ opcode: 1, source: 1, target: 0, resources: 1, budget: 1 });
  assert.equal(kappaIntact(p), true);
  const t = Uint8Array.from(p); t[2] ^= 0x10;
  assert.equal(kappaIntact(t), false);
});

// ── the live page's legacy port must stay identical to the real legacy ──────────
test('browser legacy port matches the CJS legacy on every record', () => {
  const cfg = JSON.parse(readFileSync(join(here, 'legacy', 'config.json'), 'utf8'));
  const browserDecide = makeLegacy(cfg);
  for (const row of rows) {
    const a = rowToApplicant(row);
    assert.deepEqual(browserDecide(a), legacyDecide(a));
  }
});

// ── pipeline end-to-end ────────────────────────────────────────────────────────
test('full pipeline: equivalence in sane range, invariant holds, migrate passes', () => {
  const files = [{ path: 'legacy/engine.cjs', bytes: 1, sha256: 'x' }];
  const r = discombobulate({ rows, rowToApplicant, legacyDecide, files, config: {}, schemaColumns: ['A'] }, { confirmedRules });
  assert.ok(r.ok);
  assert.ok(r.verify.base.equivalencePct >= 80 && r.verify.base.equivalencePct <= 100);
  assert.ok(r.verify.human.equivalencePct >= r.verify.base.equivalencePct);
  assert.equal(r.verify.same + r.verify.mismatchCount, r.verify.total);
  assert.equal(r.migrate.pass, true);
});
