// relearn.test.mjs — behavior tests for the generic "bring your own decision log" kernel. Exercises every
// branch so the witness mutation gate catches a flipped operator, incl. the CART kill-recipes: a BALANCED
// split at exactly minLeaf, and predict AT a threshold / value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fingerprint, sliceOf, suggestDecision, prepareLog,
  labelCounts, gini, majority, bestSplit, fitTree, routeLeaf, predict,
  grow, equivalence, predictRow, replacementModule, buildMigrationReceipt, verifyMigrationReceipt,
} from './kernel/relearn.mjs';

// ---------------- fingerprint / sliceOf ----------------
test('fingerprint: pinned known value, differs on different input', () => {
  assert.equal(fingerprint('abc'), '1a47e90b');     // pins the fnv1a loop bound/body exactly
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
  assert.doesNotThrow(() => fingerprint(null));
});

test('sliceOf: deterministic, pinned buckets, only ever fit/validate/holdout', () => {
  assert.equal(sliceOf('0'), 'fit');
  assert.equal(sliceOf('2'), 'holdout');            // pins hash10 + the <3 holdout cut
  assert.equal(sliceOf('4'), 'validate');           // pins the validate sub-cut
  assert.equal(sliceOf('8'), 'fit');                // sits on the :t sub-cut boundary — kills < 3 → <= 3
  assert.equal(sliceOf('row-7'), sliceOf('row-7'));
  const seen = new Set(); for (let i = 0; i < 200; i++) seen.add(sliceOf(String(i)));
  assert.equal(seen.size, 3);
});

// ---------------- suggestDecision ----------------
test('suggestDecision: a name-hinted categorical wins; else the last categorical', () => {
  const cols = [{ name: 'colour', kind: 'categorical', distinct: 3 }, { name: 'decision', kind: 'categorical', distinct: 3 }];
  assert.equal(suggestDecision(cols), 'decision');
  const noHint = [{ name: 'a', kind: 'categorical', distinct: 2 }, { name: 'b', kind: 'categorical', distinct: 3 }];
  assert.equal(suggestDecision(noHint), 'b');
  assert.equal(suggestDecision(null), '');
  assert.equal(suggestDecision([{ name: 'x', kind: 'numeric', distinct: 9 }]), '');  // no categorical → '' (not cands[-1])
});

// ---------------- gini / labelCounts / majority ----------------
test('gini: pure=0, even two-class=0.5, empty=0', () => {
  assert.equal(gini({ A: 4 }, 4), 0);
  assert.equal(gini({ A: 2, B: 2 }, 4), 0.5);
  assert.equal(gini({}, 0), 0);
});

test('labelCounts + majority: counts labels; ties resolve to the first sorted key', () => {
  const rows = [{ y: 'B' }, { y: 'B' }, { y: 'A' }];
  assert.deepEqual(labelCounts(rows), { B: 2, A: 1 });
  assert.equal(majority({ A: 2, B: 3 }), 'B');
  assert.equal(majority({ A: 2, B: 2 }), 'A');   // tie → first sorted
});

// ---------------- bestSplit: balanced split at exactly minLeaf ----------------
test('bestSplit: finds a clean numeric split with exactly minLeaf rows each side', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ x: { a: 1 }, y: 'L' });   // 6 at a=1
  for (let i = 0; i < 6; i++) rows.push({ x: { a: 9 }, y: 'R' });   // 6 at a=9
  const sp = bestSplit(rows, { numeric: ['a'], categorical: [] }, { minLeaf: 6, thresholdCap: 40 });
  assert.ok(sp, 'a split exists');
  assert.equal(sp.kind, 'num');
  assert.equal(sp.L.length, 6);
  assert.equal(sp.R.length, 6);   // exactly minLeaf each side — kills minLeaf < → <=
});

test('bestSplit: a categorical one-vs-rest split separates the classes', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ x: { c: 'X' }, y: 'L' });
  for (let i = 0; i < 6; i++) rows.push({ x: { c: 'Y' }, y: 'R' });
  const sp = bestSplit(rows, { numeric: [], categorical: ['c'] }, { minLeaf: 6, thresholdCap: 40 });
  assert.ok(sp);
  assert.equal(sp.kind, 'cat');
  assert.ok(sp.L.every((r) => r.x.c === sp.value));   // the matched side holds === value (kills === → !==)
});

test('bestSplit: no split when a side would fall below minLeaf', () => {
  const rows = [{ x: { a: 1 }, y: 'L' }, { x: { a: 9 }, y: 'R' }];  // only 1 each side
  assert.equal(bestSplit(rows, { numeric: ['a'], categorical: [] }, { minLeaf: 6, thresholdCap: 40 }), null);
});

// ---------------- fitTree / routeLeaf / predict ----------------
test('routeLeaf/predict: numeric routing, AT the threshold goes left (<=)', () => {
  const tree = { leaf: false, kind: 'num', feature: 'a', threshold: 5, left: { leaf: true, id: 1, label: 'L' }, right: { leaf: true, id: 2, label: 'R' } };
  assert.equal(predict(tree, { a: 5 }), 'L');   // 5 <= 5 → left  (kills <= → <)
  assert.equal(predict(tree, { a: 5.0001 }), 'R');
  assert.equal(predict(tree, { a: 4 }), 'L');
});

test('routeLeaf/predict: categorical routing matches on === value', () => {
  const tree = { leaf: false, kind: 'cat', feature: 'c', value: 'X', left: { leaf: true, id: 1, label: 'L' }, right: { leaf: true, id: 2, label: 'R' } };
  assert.equal(predict(tree, { c: 'X' }), 'L');
  assert.equal(predict(tree, { c: 'Z' }), 'R');
});

test('fitTree: grows a tree that separates a clean 2-feature problem', () => {
  const entries = [];
  for (let i = 0; i < 20; i++) entries.push({ x: { a: 1, c: 'X' }, y: 'YES' });
  for (let i = 0; i < 20; i++) entries.push({ x: { a: 9, c: 'Y' }, y: 'NO' });
  const tree = fitTree(entries, { numeric: ['a'], categorical: ['c'] }, { minLeaf: 4, maxDepth: 6 });
  assert.ok(tree);
  assert.equal(predict(tree, { a: 1, c: 'X' }), 'YES');
  assert.equal(predict(tree, { a: 9, c: 'Y' }), 'NO');
});

test('fitTree: exactly 2*minLeaf rows still SPLIT (not collapsed to a leaf)', () => {
  const entries = [];
  for (let i = 0; i < 6; i++) entries.push({ x: { a: 1 }, y: 'L' });
  for (let i = 0; i < 6; i++) entries.push({ x: { a: 9 }, y: 'R' });   // 12 = 2*minLeaf
  const tree = fitTree(entries, { numeric: ['a'], categorical: [] }, { minLeaf: 6, maxDepth: 6 });
  assert.equal(tree.leaf, false);                       // rows.length < 2*minLeaf is FALSE at ==, so it splits
  assert.equal(predict(tree, { a: 1 }), 'L');
  assert.equal(predict(tree, { a: 9 }), 'R');
});

test('fitTree: maxDepth caps the tree — children at maxDepth are leaves', () => {
  const entries = [];
  // separable only in two steps: first by c, then by a
  for (let i = 0; i < 8; i++) entries.push({ x: { c: 'X', a: 1 }, y: 'A' });
  for (let i = 0; i < 8; i++) entries.push({ x: { c: 'X', a: 9 }, y: 'B' });
  for (let i = 0; i < 8; i++) entries.push({ x: { c: 'Y', a: 1 }, y: 'C' });
  for (let i = 0; i < 8; i++) entries.push({ x: { c: 'Y', a: 9 }, y: 'D' });
  const tree = fitTree(entries, { numeric: ['a'], categorical: ['c'] }, { minLeaf: 4, maxDepth: 1 });
  assert.equal(tree.leaf, false);               // depth 0 splits
  assert.equal(tree.left.leaf, true);           // depth 1 is forced to a leaf (depth >= maxDepth), kills >= → >
  assert.equal(tree.right.leaf, true);
});

test('fitTree: empty/garbage entries → null, never throws', () => {
  assert.equal(fitTree([], { numeric: [], categorical: [] }), null);
  assert.equal(fitTree(null, null), null);
});

// ---------------- equivalence: THE safety invariant ----------------
test('equivalence: same + mismatches === total, every mismatch surfaced', () => {
  const tree = { leaf: false, kind: 'cat', feature: 'c', value: 'X', left: { leaf: true, id: 1, label: 'YES' }, right: { leaf: true, id: 2, label: 'NO' } };
  const holdout = [
    { id: 1, x: { c: 'X' }, y: 'YES' },  // match
    { id: 2, x: { c: 'Y' }, y: 'NO' },   // match
    { id: 3, x: { c: 'X' }, y: 'NO' },   // mismatch: tree says YES
  ];
  const eq = equivalence(tree, holdout);
  assert.equal(eq.total, 3);
  assert.equal(eq.same, 2);
  assert.equal(eq.mismatches.length, 1);
  assert.equal(eq.mismatches[0].id, 3);
  assert.equal(eq.mismatches[0].legacy, 'NO');
  assert.equal(eq.mismatches[0].regrown, 'YES');
  assert.ok(eq.invariant);                 // same + mismatches == total
  assert.equal(eq.rate, Math.round((2 / 3) * 1000) / 1000);
});

test('equivalence: garbage holdout → zero totals, never throws', () => {
  const eq = equivalence({ leaf: true, label: 'A' }, null);
  assert.equal(eq.total, 0);
  assert.equal(eq.rate, 0);
  assert.ok(eq.invariant);
});

// ---------------- prepareLog (end-to-end ingest) ----------------
const LOG = [
  'id,score,region,decision',
  '1,800,LON,APPROVE',
  '2,400,NW,DECLINE',
  '3,650,LON,REFER',
  '4,820,LON,APPROVE',
  '5,300,NW,DECLINE',
  '6,610,SE,REFER',
].join('\n');

test('prepareLog: infers schema, picks the hinted decision, builds entries', () => {
  const p = prepareLog(LOG);
  assert.equal(p.ok, true);
  assert.equal(p.decisionName, 'decision');
  assert.deepEqual(p.decisions, ['APPROVE', 'DECLINE', 'REFER']);
  assert.ok(p.schema.numeric.includes('score'));
  assert.ok(p.schema.categorical.includes('region'));
  assert.ok(!p.schema.numeric.includes('region'));    // a categorical is NOT numeric (kills numeric-filter && → ||)
  assert.ok(!p.featureNames.includes('decision'));   // target never a feature
  assert.equal(p.entries.length, 6);
  for (const e of p.entries) { assert.ok(typeof e.y === 'string'); assert.ok(['fit', 'validate', 'holdout'].includes(e.slice)); }
});

test('prepareLog: opts.decisionColumn overrides the suggestion; an absent one falls back', () => {
  assert.equal(prepareLog(LOG, { decisionColumn: 'region' }).decisionName, 'region');
  assert.equal(prepareLog(LOG, { decisionColumn: 'nope' }).decisionName, 'decision');  // absent → fall back (kills some === → !==)
});

test('prepareLog: the decision at column 0 and short rows are handled (cellAt bounds)', () => {
  const p = prepareLog(['decision,score', 'APPROVE,800', 'DECLINE,300', 'REFER,600', 'APPROVE,810', 'DECLINE,310', 'REFER,620'].join('\n'));
  assert.equal(p.decisionName, 'decision');    // column 0 read correctly (kills i >= 0 → i > 0)
  assert.equal(p.entries.length, 6);
  // a row missing the trailing decision value is dropped, not read as "undefined"
  const q = prepareLog(['score,region,decision', '800,LON,APPROVE', '300,NW,DECLINE', '600,SE,REFER', '810,LON,APPROVE', '310,NW'].join('\n'));
  assert.equal(q.entries.length, 4);           // the 1 short row (no decision) is dropped (kills i < len → <=)
});

test('prepareLog: a high-cardinality numeric column is quantized to ≤16 distinct values', () => {
  const rows = ['score,decision'];
  for (let i = 0; i < 40; i++) rows.push(`${i * 3},${i % 2 ? 'A' : 'B'}`);   // 40 distinct scores
  const p = prepareLog(rows.join('\n'));
  const distinct = new Set(p.entries.map((e) => e.x.score));
  assert.ok(distinct.size <= 16, `quantized to ${distinct.size}, want ≤16`);   // kills the empty-filter flip (s !== '' → ===)
});

test('prepareLog: garbage → ok:false, never throws (incl. a null opts)', () => {
  for (const g of [null, undefined, 42, '', 'no,rows,here']) {
    assert.doesNotThrow(() => prepareLog(g));
    assert.equal(prepareLog(g).ok, false);
  }
  assert.doesNotThrow(() => prepareLog(LOG, null));              // null opts must not deref (kills opts && → ||)
  assert.equal(prepareLog(LOG, null).decisionName, 'decision');
});

// ---------------- grow + predictRow on a real-ish set ----------------
test('grow: fitN/validateN come from the right slices; cleanly separable → nothing flagged', () => {
  // fully separable by score: a perfect tree on validate → every leaf confident → 0 flagged
  const rows = ['score,region,decision'];
  for (let i = 0; i < 300; i++) rows.push(`${i},${i % 2 ? 'LON' : 'NW'},${i < 150 ? 'DECLINE' : 'APPROVE'}`);
  const p = prepareLog(rows.join('\n'));
  const g = grow(p);
  assert.equal(g.ok, true);
  assert.ok(g.tree);
  assert.equal(g.fitN, p.entries.filter((e) => e.slice === 'fit').length);        // kills slice === 'fit' → !==
  assert.equal(g.validateN, p.entries.filter((e) => e.slice === 'validate').length); // kills === 'validate' → !==
  assert.equal(g.flagged, 0);     // perfect separation → every leaf confident (kills leaf.label === e.y → !==)
});

test('predictRow: coerces a raw row and predicts via the tree', () => {
  const tree = { leaf: false, kind: 'num', feature: 'score', threshold: 500, left: { leaf: true, id: 1, label: 'DECLINE' }, right: { leaf: true, id: 2, label: 'OK' } };
  const schema = { numeric: ['score'], categorical: [] };
  assert.equal(predictRow(tree, schema, { score: '450' }), 'DECLINE');  // string coerced to number, 450<=500
  assert.equal(predictRow(tree, schema, { score: '900' }), 'OK');
  assert.doesNotThrow(() => predictRow(tree, schema, null));
});

// ---------------- the downloadable owned replacement REALLY runs ----------------
test('replacementModule: the emitted module imports and reproduces the tree', async () => {
  const tree = { leaf: false, kind: 'num', feature: 'score', threshold: 500, left: { leaf: true, id: 1, label: 'DECLINE' }, right: { leaf: false, kind: 'cat', feature: 'region', value: 'LON', left: { leaf: true, id: 2, label: 'APPROVE' }, right: { leaf: true, id: 3, label: 'REFER' } } };
  const schema = { numeric: ['score'], categorical: ['region'] };
  const receipt = buildMigrationReceipt({ systemName: 'Demo', decisionName: 'decision', rows: 100, decisions: ['APPROVE', 'DECLINE', 'REFER'], featureCount: 2, holdoutN: 30, equivalenceRate: 0.9, mismatchCount: 3, invariantHolds: true, flaggedLeaves: 1, at: '2026-10-06T00:00:00Z' });
  const src = replacementModule({ tree, schema, decisionName: 'decision', systemName: 'Demo', equivalenceRate: 0.9, receipt });
  const file = join(tmpdir(), 'disco-repl-test.mjs');
  writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.predict({ score: '300', region: 'NW' }), 'DECLINE');  // 300<=500
  assert.equal(mod.predict({ score: '500', region: 'NW' }), 'DECLINE');  // AT threshold → left (kills template <= → <)
  assert.equal(mod.predict({ score: '800', region: 'LON' }), 'APPROVE'); // 800>500, region LON
  assert.equal(mod.predict({ score: '800', region: 'SE' }), 'REFER');    // 800>500, region !=LON
  assert.equal(verifyMigrationReceipt(mod.receipt), true);
});

test('replacementModule: garbage spec → a string, never throws', () => {
  for (const g of [null, undefined, 42, {}]) { assert.doesNotThrow(() => replacementModule(g)); assert.equal(typeof replacementModule(g), 'string'); }
});

// ---------------- migration receipt ----------------
test('buildMigrationReceipt + verify: signs, verifies, tamper fails', () => {
  const r = buildMigrationReceipt({ systemName: 'S', decisionName: 'decision', rows: 1200, decisions: ['A', 'B'], featureCount: 12, holdoutN: 351, equivalenceRate: 0.949, mismatchCount: 18, invariantHolds: true, flaggedLeaves: 9, at: '2026-10-06' });
  assert.equal(typeof r.sig, 'string');
  assert.equal(r.invariantHolds, true);     // === true must store the boolean (kills === → !==)
  assert.equal(verifyMigrationReceipt(r), true);
  assert.equal(verifyMigrationReceipt({ ...r, equivalenceRate: 0.99 }), false);
  assert.equal(verifyMigrationReceipt({ ...r, mismatches: 0 }), false);
  for (const g of [null, 42, {}, { sig: 1 }]) assert.equal(verifyMigrationReceipt(g), false);
});

test('verifyMigrationReceipt: signature is independent of key order (survives download + reload)', () => {
  const r = buildMigrationReceipt({ systemName: 'S', decisionName: 'd', rows: 10, decisions: ['A', 'B'], featureCount: 3, holdoutN: 4, equivalenceRate: 0.9, mismatchCount: 1, invariantHolds: true, flaggedLeaves: 0, at: 't' });
  const reordered = {};
  for (const k of Object.keys(r).reverse()) reordered[k] = r[k];
  assert.equal(verifyMigrationReceipt(reordered), true);   // canonical sorts keys (kills stable's typeof === 'object' → !==)
});
