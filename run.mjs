// run.mjs — the DISCOMBOBULATOR CLI. Wires the real legacy system (CommonJS) into
// the pure pipeline and prints the full report. `node run.mjs [--json]`.
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discombobulate } from './kernel/pipeline.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const { decide } = require('./legacy/engine.cjs');
const { rowToApplicant, loadRows } = require('./legacy/store.cjs');

function fileMeta(rel) {
  const p = join(here, rel);
  const buf = readFileSync(p);
  return { path: rel, bytes: statSync(p).size, sha256: createHash('sha256').update(buf).digest('hex') };
}

export function runPipeline() {
  const rows = loadRows(join(here, 'legacy', 'records.json'));
  const config = JSON.parse(readFileSync(join(here, 'legacy', 'config.json'), 'utf8'));
  const schemaColumns = ['APPLICANT_ID', 'APP_AGE', 'GROSS_INC', 'TOT_DEBT', 'LOAN_AMT', 'EMP_YRS', 'CR_SCORE', 'PRIOR_DEF', 'REGION_CD', 'PROD_CD', 'APPLY_DT'];
  const files = [fileMeta('legacy/engine.cjs'), fileMeta('legacy/config.json'), fileMeta('legacy/store.cjs'), fileMeta('legacy/records.json'), fileMeta('legacy/schema.sql')];
  const confirmedRules = JSON.parse(readFileSync(join(here, 'confirmed-rules.json'), 'utf8'));
  return discombobulate({ rows, rowToApplicant, legacyDecide: decide, files, config, schemaColumns }, { confirmedRules });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runPipeline();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, (k, v) => (k === '_build' || k === '_spec' ? undefined : v), 2)); process.exit(r.ok ? 0 : 1); }
  if (!r.ok) { console.error('pipeline FAILED at', r.stage, r.error); process.exit(1); }
  console.log('╔══ DISCOMBOBULATOR ════════════════════════════════════════════');
  console.log('║ 1 INGEST     ', JSON.stringify(r.ingest), '| files', r.inventory.software.length, '| schema cols', r.inventory.schema.length);
  console.log('║ 2 UNDERSTAND ', `leaves ${r.understand.leaves}, flagged ${r.understand.flagged} (possible MISunderstandings)`);
  console.log('║              ', 'features grown:', r.understand.featuresUsed.join(', '));
  console.log('║ 3 RE-GROW    ', `organs ${r.regrow.organs.length}, book ${r.regrow.compression.rawBytes}B → ${r.regrow.compression.packedBytes}B (${r.regrow.compression.ratio}x)`);
  console.log('║ 4 VERIFY     ', `base ${r.verify.base.equivalencePct}% → +auto-carry ${r.verify.auto.equivalencePct}% → +human-confirmed ${r.verify.human.equivalencePct}% (${r.verify.same}/${r.verify.total})`);
  console.log('║              ', `${r.verify.base.mismatchCount} misses at base, ALL flagged+attributed · base attribution:`, JSON.stringify(r.verify.base.attributionHistogram));
  console.log('║              ', `after human-confirmed loop: ${r.verify.mismatchCount} residual (attribution:`, JSON.stringify(r.verify.attributionHistogram) + ')');
  for (const c of r.regrow.correctionRules) console.log('║   auto-grew: ', `→${c.to} (n${c.support}, purity ${c.purity}, +${c.gain}) when ${c.when.join(' & ')}`);
  console.log('║   confirmed: ', r.regrow.confirmedRules.join(', ') || '(none)');
  console.log('║ 5 MIGRATE    ', `${r.migrate.migrated}/${r.migrate.source} records, integrity ${r.migrate.pass ? 'PASS' : 'FAIL'}`, JSON.stringify(r.migrate.integrity));
  console.log('╚═══════════════════════════════════════════════════════════════');
}
