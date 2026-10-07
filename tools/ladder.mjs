// tools/ladder.mjs — THE LADDER, woven into the Discombobulator. "Improves after purchase" (RSI), made real:
// after a legacy system is re-grown into a verified decision library, that library CLIMBS TIERS — it deepens
// over rungs, each rung warm-started from the last champion and kept only if it holds-or-beats it on held-out
// (MONOTONE — never regresses). No retraining; the library compounds. This is the konomi-slm growth engine,
// applied to the Discombobulator's OWN decision log (samples/decisions.csv), on its own ground.
//
// The ribosome (grow → grade-on-held-out, the scorecard genome) is vendored verbatim under vendor/konomi-ladder
// (gated CLEAN in sjgant80-hub/konomi-slm). The climb driver below reuses it; pure, total, deterministic.
// Powered by the Konomi architecture, created by Thomas Frumkin.
import {
  stemGenome, randomGenome, mutateGenome, crossGenome, rng, draw, coin,
  splitRows, assess, fit, scoreRow, auc, round6,
} from '../vendor/konomi-ladder/seedlib.mjs';
import { sha256Hex } from '../vendor/konomi-ladder/sha256.mjs';

export const NUMERIC = ['age', 'income', 'debt', 'loanAmount', 'employmentYears', 'creditScore', 'priorDefaults', 'dti', 'lti'];
export const CLASSES = ['DECLINE', 'APPROVE', 'REFER'];
export const DEEPEN = { population: 44, elites: 6, generations: 44 };
const NUM = /^-?\d+(\.\d+)?(e-?\d+)?$/i;
const seedFor = (s) => { let h = 7; for (const c of String(s)) h = (h * 131 + c.charCodeAt(0)) >>> 0; return (h % 90000) + 1; };

// build a binary one-vs-rest dataset for `target` from the decision log, over the numeric features (stratified 30% held)
export function loadDecisionDomain(csvText, target, { share = 0.3, seed = 101 } = {}) {
  if (typeof csvText !== 'string') return { ok: false, error: 'need the CSV text' };
  const lines = csvText.split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 3) return { ok: false, error: 'no rows' };
  const head = lines[0].split(',');
  const di = head.indexOf('decision');
  const need = NUMERIC.filter((f) => head.includes(f));
  if (di < 0 || need.length < 2) return { ok: false, error: 'missing decision or numeric columns' };
  const feats = NUMERIC.filter((f) => head.includes(f));
  const idx = Object.fromEntries(head.map((h, k) => [h, k]));
  const n = lines.length - 1;
  const cols = {}; for (const f of feats) cols[f] = new Float64Array(n);
  const y = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const cells = lines[i + 1].split(',');
    for (const f of feats) { const v = cells[idx[f]]; cols[f][i] = NUM.test(v) ? Number(v) : 0; }
    y[i] = cells[di] === target ? 1 : 0;
  }
  const ds = { ok: true, name: target.toLowerCase(), features: feats, n, cols, y };
  const sp = splitRows(ds, Array.from({ length: n }, (_, i) => i), share, seed);
  ds.heldRows = sp.held; ds.trainRows = sp.rest;
  return ds;
}

// a warm-started GA (the konomi-slm growth engine's deepen): population seeded from `stems` + mutations + randoms
export function deepen(dataset, trainRows, seed, cfg, stems) {
  const inner = splitRows(dataset, trainRows, 1 / 3, seed);
  const r = rng(seed * 7919 + 1);
  let born = 0;
  const live = (g) => ({ g, n: born++, fitness: assess(dataset, inner, g) });
  const better = (a, b) => a.fitness > b.fitness || (a.fitness === b.fitness && a.n < b.n);
  const warm = []; for (const s of (stems && stems.length ? stems : [stemGenome()])) { warm.push(s, mutateGenome(s, r), mutateGenome(s, r)); }
  let pop = [...warm, ...Array.from({ length: Math.max(0, cfg.population - warm.length) }, () => randomGenome(r))].map(live);
  const best = () => pop.reduce((a, b) => (better(b, a) ? b : a));
  for (let gen = 1; gen < cfg.generations; gen++) {
    const battle = () => { const a = pop[draw(r, pop.length)], b = pop[draw(r, pop.length)]; return better(b, a) ? b : a; };
    const next = [...pop].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, cfg.elites);
    while (next.length < cfg.population) { const child = crossGenome(battle().g, battle().g, r); next.push(live(coin(r) ? mutateGenome(child, r) : child)); }
    pop = next;
  }
  return best().g;
}

export function heldAuc(ds, genome) {
  const card = fit(ds, ds.trainRows, genome);
  const s = ds.heldRows.map((i) => scoreRow(card, ds, i));
  return round6(auc(s, ds.heldRows.map((i) => ds.y[i])));
}

// CLIMB one decision domain across `rungs` tiers; each rung warm-started from the last champion, monotone-kept.
export function climb(ds, { rungs = 3, cfg = DEEPEN } = {}) {
  let g = deepen(ds, ds.trainRows, seedFor(ds.name), cfg, [stemGenome()]);
  let a = heldAuc(ds, g);
  const tiers = [{ tier: 1, heldAuc: a }];
  for (let t = 2; t <= rungs; t++) {
    const g2 = deepen(ds, ds.trainRows, seedFor(ds.name) + t, cfg, [g]);
    const a2 = heldAuc(ds, g2);
    if (a2 >= a) { g = g2; a = a2; }                 // MONOTONE: keep the deepened champion only if it does not regress
    tiers.push({ tier: t, heldAuc: a });
  }
  return { domain: ds.name, held: ds.heldRows.length, base: round6(ds.heldRows.reduce((s, i) => s + ds.y[i], 0) / ds.heldRows.length), tiers, monotone: tiers.every((x, i) => i === 0 || x.heldAuc >= tiers[i - 1].heldAuc - 1e-9) };
}

export function climbAll(csvText, opts = {}) {
  const domains = CLASSES.map((c) => climb(loadDecisionDomain(csvText, c, opts), opts)).filter((d) => d.tiers);
  const first = round6(domains.reduce((s, d) => s + d.tiers[0].heldAuc, 0) / domains.length);
  const last = round6(domains.reduce((s, d) => s + d.tiers[d.tiers.length - 1].heldAuc, 0) / domains.length);
  const core = { model: 'discombobulator/ladder', domains, meanTier1: first, meanTierTop: last, monotone: domains.every((d) => d.monotone) };
  return { ...core, receiptHash: sha256Hex(JSON.stringify(core)) };
}
