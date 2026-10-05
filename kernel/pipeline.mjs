// kernel/pipeline.mjs — the DISCOMBOBULATOR. Orchestrates the five gated stages
// end-to-end on one legacy system and returns a full, honest report.
//
//   INGEST → UNDERSTAND → RE-GROW → VERIFY-EQUIVALENT → MIGRATE
//
// Each stage is a real organ (ingest/understand/regrow/verify/migrate). This file
// only wires them. It takes the legacy setup as data (rows, rowToApplicant,
// legacyDecide, inventory) so the same pipeline runs in Node (seal/tests) and, with
// an inlined legacy decider, in the browser (the live page). Pure w.r.t. its inputs.

import { buildCorpus, summarizeInventory } from './ingest.mjs';
import { understand, predictSpec, mineCorrections } from './understand.mjs';
import { grow } from './regrow.mjs';
import { verifyEquivalent } from './verify.mjs';
import { migrate } from './migrate.mjs';

export function discombobulate(input, options) {
  const { rows, rowToApplicant, legacyDecide, files, config, schemaColumns } = input || {};

  // 1 · INGEST
  const inv = summarizeInventory(files, config, schemaColumns, Array.isArray(rows) ? rows.length : 0);
  const ing = buildCorpus(rows, rowToApplicant, legacyDecide);
  if (!ing.ok) return { ok: false, stage: 'ingest', error: ing.error };

  // 2 · UNDERSTAND (gated: low-confidence leaves flagged as MISunderstandings)
  const spec = understand(ing.corpus, options?.understand);
  if (!spec.ok) return { ok: false, stage: 'understand', error: spec.error };

  // 3 · RE-GROW — first pass: sovereign build from the base tree
  const base = grow(spec, options?.regrow);
  if (!base.ok) return { ok: false, stage: 'regrow', error: base.error };

  // 4a · VERIFY-EQUIVALENT (first pass) — old vs new on real held-out cases
  const verBefore = verifyEquivalent(legacyDecide, base.decide, ing.testCases);
  if (!verBefore.ok) return { ok: false, stage: 'verify', error: verBefore.error };

  // GUIDED LOOP, tier 1 (AUTOMATED carry) — the gate flags misses on the VALIDATE
  // slice; the organ grows a correction organ from them. Validate only: the TEST
  // equivalence set is never touched. Safe-by-construction: a correction leaf is
  // accepted only where it beats the base on validate.
  const validateEntries = ing.corpus.filter((c) => c.slice === 'validate');
  const mined = mineCorrections((x) => predictSpec(spec, x), validateEntries, options?.corrections);
  const corrections = mined.ok ? mined.corrections : null;
  const autoBuild = grow({ ...spec, corrections }, options?.regrow);
  const verAuto = verifyEquivalent(legacyDecide, autoBuild.decide, ing.testCases);
  if (!verAuto.ok) return { ok: false, stage: 'verify', error: verAuto.error };

  // GUIDED LOOP, tier 2 (HUMAN-CONFIRMED) — the gate ATTRIBUTES each remaining miss
  // to a candidate tribal rule; a human reviews that short list and authorizes the
  // confirmed rules (human knowledge, NOT auto-discovered). Re-grow that piece.
  const confirmedRules = Array.isArray(options?.confirmedRules) ? options.confirmedRules : [];
  const build = grow({ ...spec, corrections, confirmedRules }, options?.regrow);
  const ver = verifyEquivalent(legacyDecide, build.decide, ing.testCases);
  if (!ver.ok) return { ok: false, stage: 'verify', error: ver.error };

  // 5 · MIGRATE (schema-transform + integrity)
  const mig = migrate(rows);
  if (!mig.ok) return { ok: false, stage: 'migrate', error: mig.error };

  return {
    ok: true,
    inventory: inv,
    ingest: ing.counts,
    understand: {
      leaves: spec.counts.leaves,
      flagged: spec.counts.flagged,
      featuresUsed: spec.featuresUsed,
      flaggedPatterns: spec.flagged.map((f) => ({ organ: f.organ, label: f.label, heldoutAcc: f.heldoutAcc, validateN: f.validateN, path: f.path })),
    },
    regrow: { organs: build.organs, compression: build.compression, correctionRules: build.correctionRules, confirmedRules: build.confirmedRules.map((r) => r.id) },
    verify: {
      total: ver.total,
      same: ver.same,
      equivalencePct: ver.equivalencePct,
      mismatchCount: ver.mismatchCount,
      attributionHistogram: ver.attributionHistogram,
      mismatches: ver.mismatches,
      // the honest three-tier story:
      //   base       automated organ, first pass
      //   auto       + automated carry (safe corrections mined from flagged misses)
      //   human      + human-confirmed tribal rules (human-on-the-20%)
      base: { equivalencePct: verBefore.equivalencePct, same: verBefore.same, mismatchCount: verBefore.mismatchCount, attributionHistogram: verBefore.attributionHistogram },
      auto: { equivalencePct: verAuto.equivalencePct, same: verAuto.same, mismatchCount: verAuto.mismatchCount, attributionHistogram: verAuto.attributionHistogram },
      human: { equivalencePct: ver.equivalencePct, same: ver.same, mismatchCount: ver.mismatchCount, attributionHistogram: ver.attributionHistogram },
    },
    migrate: { migrated: mig.migrated, source: mig.source, integrity: mig.integrity, pass: mig.pass },
    _build: build,     // handed back for the re-grow-the-missed-piece demo
    _spec: spec,
  };
}

export default { discombobulate };
