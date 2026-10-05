// seal.mjs — SEAL-BEFORE-MEASURE, as two commits.
//
//   node seal.mjs --prereg    writes prereg.json: predictions + sha256 of every input.
//                             Commit 1 (CI green on it) proves the claims predate the
//                             result.
//   node seal.mjs --measure   reads prereg.json, re-checks the input hashes, runs the
//                             pipeline, writes measure.json. Commit 2.
//   node seal.mjs --verify    (CI, on the measure commit) re-derives the hashes AND the
//                             result from the sealed inputs and asserts they match both
//                             prereg and measure. Exit 1 on any drift.
//
// The measurement is a pure function of the hashed inputs, so the runner reproduces it
// exactly; git history shows prereg landed before measure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runPipeline } from './run.mjs';
import { runDefense } from './kernel/defense.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (p) => createHash('sha256').update(readFileSync(join(here, p))).digest('hex');

// every file that determines the measurement — the legacy system, the data, the
// confirmed rules, and the kernel algorithms.
const INPUT_FILES = [
  'legacy/engine.cjs', 'legacy/engine.browser.mjs', 'legacy/config.json', 'legacy/records.json', 'legacy/store.cjs', 'legacy/schema.sql',
  'confirmed-rules.json',
  'kernel/features.mjs', 'kernel/understand.mjs', 'kernel/regrow.mjs', 'kernel/verify.mjs', 'kernel/migrate.mjs', 'kernel/ingest.mjs', 'kernel/confirm.mjs', 'kernel/sentinel.mjs', 'kernel/defense.mjs', 'kernel/pipeline.mjs',
];

function inputHashes() {
  const h = {};
  for (const f of INPUT_FILES) h[f] = sha(f);
  return h;
}

// the predictions, registered BEFORE the measurement (prereg commit).
const PREDICTIONS = {
  equivalence_base_pct: { min: 85, max: 98, note: 'behaviour-induction reproduces the common rules; continuous-ratio boundary noise + rare tribal rules remain' },
  equivalence_after_human_ge_base: true,
  auto_carry_not_worse_than_base: true,
  every_mismatch_flagged: true,
  migrate_integrity_pass: true,
  sentinel_defense_pass: true,
  tribal_rules_cleared_after_human: true,
};

function measure() {
  const r = runPipeline();
  if (!r.ok) throw new Error('pipeline failed: ' + r.stage);
  const def = runDefense();
  const base = r.verify.base.equivalencePct;
  const auto = r.verify.auto.equivalencePct;
  const human = r.verify.human.equivalencePct;
  // after the human-confirmed loop, no mismatch should still be attributed to a tribal rule
  const residualTribal = Object.keys(r.verify.human.attributionHistogram).filter((k) => k.startsWith('G'));
  return {
    counts: r.ingest,
    equivalence: { base, auto, human, same: r.verify.same, total: r.verify.total },
    flagged_invariant: r.verify.same + r.verify.mismatchCount === r.verify.total,
    base_attribution: r.verify.base.attributionHistogram,
    human_residual_attribution: r.verify.human.attributionHistogram,
    tribal_cleared: residualTribal.length === 0,
    migrate: r.migrate,
    compression: r.regrow.compression,
    organs: r.regrow.organs,
    auto_rules: r.regrow.correctionRules.length,
    confirmed_rules: r.regrow.confirmedRules,
    defense: def,
  };
}

function predictionsMet(m) {
  const p = PREDICTIONS;
  return [
    m.equivalence.base >= p.equivalence_base_pct.min && m.equivalence.base <= p.equivalence_base_pct.max,
    m.equivalence.human >= m.equivalence.base,
    m.equivalence.auto >= m.equivalence.base,
    m.flagged_invariant === true,
    m.migrate.pass === true,
    m.defense.pass === true,
    m.tribal_cleared === true,
  ].every(Boolean);
}

const mode = process.argv[2];
const preregPath = join(here, 'prereg.json');
const measurePath = join(here, 'measure.json');

if (mode === '--prereg') {
  const prereg = { kind: 'prereg', note: 'predictions + input hashes, committed BEFORE the measurement', predictions: PREDICTIONS, inputs: inputHashes() };
  writeFileSync(preregPath, JSON.stringify(prereg, null, 2) + '\n');
  console.log('wrote prereg.json with', Object.keys(prereg.inputs).length, 'hashed inputs');
} else if (mode === '--measure') {
  if (!existsSync(preregPath)) throw new Error('no prereg.json — run --prereg and commit it first');
  const prereg = JSON.parse(readFileSync(preregPath, 'utf8'));
  const now = inputHashes();
  for (const f of INPUT_FILES) if (prereg.inputs[f] !== now[f]) throw new Error('INPUT CHANGED since prereg: ' + f);
  const results = measure();
  const out = { kind: 'measure', derivedFrom: now, results, predictionsMet: predictionsMet(results) };
  writeFileSync(measurePath, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote measure.json · base', results.equivalence.base + '% → human', results.equivalence.human + '% · predictionsMet', out.predictionsMet);
} else if (mode === '--verify') {
  // CI: re-derive everything from the sealed inputs and assert zero drift.
  const prereg = JSON.parse(readFileSync(preregPath, 'utf8'));
  const committed = JSON.parse(readFileSync(measurePath, 'utf8'));
  const now = inputHashes();
  let fail = 0;
  for (const f of INPUT_FILES) {
    if (prereg.inputs[f] !== now[f]) { console.error('✗ input drift vs prereg:', f); fail++; }
  }
  const fresh = measure();
  if (JSON.stringify(fresh) !== JSON.stringify(committed.results)) {
    console.error('✗ re-derived results differ from committed measure.json');
    fail++;
  }
  if (!predictionsMet(fresh)) { console.error('✗ predictions NOT met on re-derivation'); fail++; }
  if (fail) { console.error(`SEAL VERIFY FAILED (${fail})`); process.exit(1); }
  console.log('✓ seal verified: hashes + results re-derived identically from sealed inputs; predictions met.');
} else {
  console.error('usage: node seal.mjs --prereg | --measure | --verify');
  process.exit(2);
}
