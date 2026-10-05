// kernel/understand.mjs — THE PATTERN ORGAN (stage 2, the hard/valuable part).
//
// Reverse-engineers the MEANING of the legacy system, not its code. It never reads
// the legacy source. It observes input→output pairs (the behavioral oracle from
// INGEST) and induces a decision function as a book of patterns: a deterministic
// CART tree over the shared feature basis.
//
// Lineage — pattern-organs (sjgant80-hub, built on Thomas Frumkin's Konomi
// architecture): three of its stem elements are switched on here —
//   prove  a pattern (leaf) is only trusted if it holds on a VALIDATE slice it was
//          not fitted on; a leaf that fails is flagged as a MISunderstanding, not
//          silently kept. THIS IS THE UNDERSTAND GATE.
//   carry  the tree keeps splitting the cases earlier splits left mixed (residual).
//   own    region/product enter as first-class categorical splits, so a segment can
//          own its own sub-rule.
//
// Pure and deterministic: same corpus → same tree on every machine. TOTAL: the
// checked entry points return {ok:false,error} on garbage; they never throw.

import { NUMERIC, CATEGORICAL } from './features.mjs';

const GINI_MIN_GAIN = 1e-9;

export function gini(counts, total) {
  if (total <= 0) return 0;
  let s = 0;
  for (const k in counts) { const p = counts[k] / total; s += p * p; }
  return 1 - s;
}

export function labelCounts(rows) {
  const c = Object.create(null);
  for (const r of rows) c[r.y] = (c[r.y] || 0) + 1;
  return c;
}

export function majority(counts) {
  let best = null, n = -1;
  // deterministic tie-break: lexicographically smallest label wins
  for (const k of Object.keys(counts).sort()) { if (counts[k] > n) { n = counts[k]; best = k; } }
  return best;
}

// candidate numeric thresholds: midpoints between sorted unique values, capped.
export function numericThresholds(rows, f, cap) {
  const vals = [...new Set(rows.map((r) => r.x[f]))].sort((a, b) => a - b);
  const mids = [];
  for (let i = 1; i < vals.length; i++) mids.push((vals[i - 1] + vals[i]) / 2);
  if (mids.length <= cap) return mids;
  // evenly subsample to cap, deterministically
  const out = [];
  for (let i = 0; i < cap; i++) out.push(mids[Math.floor((i * mids.length) / cap)]);
  return [...new Set(out)];
}

export function bestSplit(rows, opts) {
  const parentGini = gini(labelCounts(rows), rows.length);
  let best = null;
  // numeric splits
  for (const f of NUMERIC) {
    for (const t of numericThresholds(rows, f, opts.thresholdCap)) {
      const L = [], R = [];
      for (const r of rows) (r.x[f] <= t ? L : R).push(r);
      if (L.length < opts.minLeaf || R.length < opts.minLeaf) continue;
      const g = (L.length * gini(labelCounts(L), L.length) + R.length * gini(labelCounts(R), R.length)) / rows.length;
      const gain = parentGini - g;
      if (gain > GINI_MIN_GAIN && (!best || gain > best.gain)) best = { kind: 'num', feature: f, threshold: t, gain, L, R };
    }
  }
  // categorical one-vs-rest splits
  for (const f of CATEGORICAL) {
    const vals = [...new Set(rows.map((r) => r.x[f]))].sort();
    for (const v of vals) {
      const L = [], R = [];
      for (const r of rows) (r.x[f] === v ? L : R).push(r);
      if (L.length < opts.minLeaf || R.length < opts.minLeaf) continue;
      const g = (L.length * gini(labelCounts(L), L.length) + R.length * gini(labelCounts(R), R.length)) / rows.length;
      const gain = parentGini - g;
      if (gain > GINI_MIN_GAIN && (!best || gain > best.gain)) best = { kind: 'cat', feature: f, value: v, gain, L, R };
    }
  }
  return best;
}

let LEAF_SEQ = 0;
// grow a raw CART over [{x,y}] entries. Exported so the carry/correction pass can
// grow a SECOND organ on the flagged residuals. Deterministic.
export function fitTree(entries, options) {
  const opts = {
    maxDepth: options?.maxDepth ?? 9,
    minLeaf: options?.minLeaf ?? 8,
    thresholdCap: options?.thresholdCap ?? 40,
  };
  const rows = (Array.isArray(entries) ? entries : []).filter((r) => r && r.x && typeof r.y === 'string');
  if (rows.length === 0) return null;
  LEAF_SEQ = 0;
  return build(rows, 0, opts);
}

function build(rows, depth, opts) {
  const counts = labelCounts(rows);
  const label = majority(counts);
  const pure = Object.keys(counts).length <= 1;
  if (pure || depth >= opts.maxDepth || rows.length < 2 * opts.minLeaf) {
    return { leaf: true, id: LEAF_SEQ++, label, n: rows.length, counts };
  }
  const sp = bestSplit(rows, opts);
  if (!sp) return { leaf: true, id: LEAF_SEQ++, label, n: rows.length, counts };
  const node = sp.kind === 'num'
    ? { leaf: false, kind: 'num', feature: sp.feature, threshold: sp.threshold }
    : { leaf: false, kind: 'cat', feature: sp.feature, value: sp.value };
  node.left = build(sp.L, depth + 1, opts);
  node.right = build(sp.R, depth + 1, opts);
  return node;
}

// walk a built tree to the leaf for one featurized row x
export function routeLeaf(tree, x) {
  let node = tree;
  let guard = 0;
  while (node && !node.leaf && guard++ < 10000) {
    if (node.kind === 'num') node = (x[node.feature] <= node.threshold) ? node.left : node.right;
    else node = (x[node.feature] === node.value) ? node.left : node.right;
  }
  return node && node.leaf ? node : null;
}

export function predict(tree, x) {
  const leaf = routeLeaf(tree, x);
  return leaf ? leaf.label : null;
}

// predict the COMBINED status|tier label from the two grown organs. Total.
export function predictSpec(spec, x) {
  if (!spec || !spec.statusTree || !spec.tierTree) return null;
  const s = predict(spec.statusTree, x);
  const t = predict(spec.tierTree, x);
  return `${s ?? 'UNKNOWN'}|${t ?? 'null'}`;
}

// score every leaf of one tree on the validate slice, flag low-confidence leaves.
function scoreLeaves(tree, validate, projector, opts) {
  const perLeaf = new Map();
  for (const r of validate) {
    const leaf = routeLeaf(tree, r.x);
    if (!leaf) continue;
    const y = projector(r.y);
    const e = perLeaf.get(leaf.id) || { hit: 0, total: 0 };
    e.total++; if (leaf.label === y) e.hit++;
    perLeaf.set(leaf.id, e);
  }
  const leaves = [], flagged = [];
  (function collect(node, path) {
    if (!node) return;
    if (node.leaf) {
      const v = perLeaf.get(node.id) || { hit: 0, total: 0 };
      const heldoutAcc = v.total > 0 ? v.hit / v.total : null;
      const confident = v.total >= opts.minValidate && heldoutAcc !== null && heldoutAcc >= opts.confTau;
      const rec = { id: node.id, label: node.label, fitN: node.n, validateN: v.total, heldoutAcc, confident, path };
      leaves.push(rec);
      if (!confident) flagged.push(rec);
      return;
    }
    const pos = node.kind === 'num' ? `${node.feature}<=${round(node.threshold)}` : `${node.feature}==${node.value}`;
    const neg = node.kind === 'num' ? `${node.feature}>${round(node.threshold)}` : `${node.feature}!=${node.value}`;
    collect(node.left, [...path, pos]);
    collect(node.right, [...path, neg]);
  })(tree, []);
  return { leaves, flagged };
}

function usedFeatures(tree) {
  const used = new Set();
  (function walk(nd) { if (!nd || nd.leaf) return; used.add(nd.feature); walk(nd.left); walk(nd.right); })(tree);
  return used;
}

// THE PROVE-GATE. corpus = [{id, x, y, slice}] where slice ∈ {fit, validate} and y
// is the combined "status|tier" label. Grows TWO differentiated organs — a STATUS
// organ and a TIER organ (grow-not-install: the function decomposes into the organs
// that reproduce it) — and scores each leaf on the VALIDATE slice; a leaf below the
// confidence bar is flagged as a candidate MISunderstanding, not silently kept.
export function understand(corpus, options) {
  if (!Array.isArray(corpus) || corpus.length === 0) return { ok: false, error: 'empty-corpus' };
  // Defaults selected on the VALIDATE slice (never the equivalence TEST set):
  // two organs at depth 10 / minLeaf 6 / thresholdCap 40 maximized validate combined
  // accuracy (~0.95). Fixed here so the seal pins them by hashing this file.
  const opts = {
    maxDepth: options?.maxDepth ?? 10,
    minLeaf: options?.minLeaf ?? 6,
    thresholdCap: options?.thresholdCap ?? 40,
    confTau: options?.confTau ?? 0.80,
    minValidate: options?.minValidate ?? 3,
  };
  const fit = corpus.filter((r) => r && r.slice === 'fit' && r.x && typeof r.y === 'string');
  const validate = corpus.filter((r) => r && r.slice === 'validate' && r.x && typeof r.y === 'string');
  if (fit.length === 0) return { ok: false, error: 'no-fit-rows' };

  const statusOf = (y) => String(y).split('|')[0];
  const tierOf = (y) => String(y).split('|')[1];

  const statusTree = fitTree(fit.map((e) => ({ x: e.x, y: statusOf(e.y) })), opts);
  const tierTree = fitTree(fit.map((e) => ({ x: e.x, y: tierOf(e.y) })), opts);

  const sScore = scoreLeaves(statusTree, validate, statusOf, opts);
  const tScore = scoreLeaves(tierTree, validate, tierOf, opts);

  const featuresUsed = [...new Set([...usedFeatures(statusTree), ...usedFeatures(tierTree)])].sort();
  const leaves = sScore.leaves.length + tScore.leaves.length;
  const flagged = [
    ...sScore.flagged.map((f) => ({ organ: 'status', ...f })),
    ...tScore.flagged.map((f) => ({ organ: 'tier', ...f })),
  ];

  return {
    ok: true,
    statusTree,
    tierTree,
    leaves: { status: sScore.leaves, tier: tScore.leaves },
    flagged,
    featuresUsed,
    counts: { fit: fit.length, validate: validate.length, leaves, flagged: flagged.length },
    options: opts,
  };
}

function round(v) { return Math.round(v * 1000) / 1000; }

// summarize a correction leaf's path into a human-readable rule (for the report)
function describeLeaf(tree, leafId) {
  let out = null;
  (function walk(node, path) {
    if (!node || out) return;
    if (node.leaf) { if (node.id === leafId) out = { label: node.label, path }; return; }
    const pos = node.kind === 'num' ? `${node.feature}<=${round(node.threshold)}` : `${node.feature}==${node.value}`;
    const neg = node.kind === 'num' ? `${node.feature}>${round(node.threshold)}` : `${node.feature}!=${node.value}`;
    walk(node.left, [...path, pos]); walk(node.right, [...path, neg]);
  })(tree, []);
  return out;
}

// ── carry / residual mining: RE-GROW-THE-MISSED-PIECE, driven by the gate ──────
// The verify gate flags the cases the first-pass organ got wrong. Instead of hand-
// writing the legacy logic back in, the organ GROWS A SECOND ORGAN on exactly those
// flagged cases — a correction tree over the full feature basis — on the VALIDATE
// slice only (never the equivalence TEST set). pattern-organs' `carry` element: find
// the next pattern among the cases the earlier ones left unexplained.
//
// Safety: a correction leaf is accepted ONLY where, on the FULL validate set routing
// to it, overriding to the leaf's label beats the base organ (net more cases right)
// and clears ≥ tau of them with ≥ minSupport. So it can only HELP on validate; it
// closes the rare multi-condition TRIBAL misses and leaves continuous-ratio boundary
// noise alone, honestly. Returns a {tree, accepted[], rules[]} correction organ.
export function mineCorrections(predictFn, validateEntries, options) {
  if (typeof predictFn !== 'function' || !Array.isArray(validateEntries)) return { ok: false, error: 'bad-inputs' };
  const tau = options?.tau ?? 0.80;
  const minSupport = options?.minSupport ?? 4;
  const entries = validateEntries.filter((e) => e && e.x && typeof e.y === 'string');

  // cheap guard: if the base organ is already near-perfect on validate, there is
  // nothing to carry.
  const residuals = entries.filter((e) => predictFn(e.x) !== e.y);
  if (residuals.length < minSupport) return { ok: true, corrections: null };

  // Grow the correction organ over the WHOLE validate slice (held out from the fit
  // organ) predicting the legacy label, so it can form the discriminating split the
  // residuals alone cannot (they are homogeneous — the misses). The acceptance gate
  // below then keeps ONLY the leaves that provably beat the base on validate.
  const cTree = fitTree(entries.map((e) => ({ x: e.x, y: e.y })), { maxDepth: options?.maxDepth ?? 6, minLeaf: options?.minLeaf ?? 3, thresholdCap: options?.thresholdCap ?? 40 });
  if (!cTree) return { ok: true, corrections: null };

  // for every FULL validate entry, where does it route in the correction tree, and
  // is the base right/wrong there?
  const perLeaf = new Map();
  for (const e of entries) {
    const leaf = routeLeaf(cTree, e.x);
    if (!leaf) continue;
    const m = perLeaf.get(leaf.id) || { leaf, total: 0, baseRight: 0, overrideRight: 0, hitLabel: 0 };
    m.total++;
    if (predictFn(e.x) === e.y) m.baseRight++;
    if (leaf.label === e.y) { m.overrideRight++; m.hitLabel++; }
    perLeaf.set(leaf.id, m);
  }

  const accepted = [];
  const rules = [];
  for (const m of perLeaf.values()) {
    const purity = m.total > 0 ? m.hitLabel / m.total : 0;
    if (m.overrideRight > m.baseRight && m.total >= minSupport && purity >= tau) {
      accepted.push(m.leaf.id);
      const d = describeLeaf(cTree, m.leaf.id);
      rules.push({ to: m.leaf.label, support: m.total, purity: round(purity), gain: m.overrideRight - m.baseRight, when: d ? d.path : [] });
    }
  }
  rules.sort((a, b) => (b.gain - a.gain) || (b.support - a.support));
  if (accepted.length === 0) return { ok: true, corrections: null };
  return { ok: true, corrections: { tree: cTree, accepted, rules } };
}

// apply the correction organ to a base label under feature view x. Pure/total.
export function applyCorrections(baseLabel, x, corrections) {
  if (!corrections || !corrections.tree || !Array.isArray(corrections.accepted) || !x) return baseLabel;
  const leaf = routeLeaf(corrections.tree, x);
  if (leaf && corrections.accepted.includes(leaf.id)) return leaf.label;
  return baseLabel;
}

export default { understand, predict, routeLeaf, mineCorrections, applyCorrections };
