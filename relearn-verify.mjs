// relearn-verify.mjs — on GitHub's runner, drive the WHOLE "bring your own decision log" product on the
// frozen sample exactly as a user would: ingest generically, grow a replacement, prove equivalence on the
// held-out slice, WRITE the downloadable owned model, IMPORT it back, run predict(), and check every number
// against the sealed relearn.predictions.json. The sample is sha-pinned in CI; nothing here is typed.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareLog, grow, equivalence, replacementModule, buildMigrationReceipt, verifyMigrationReceipt } from './kernel/relearn.mjs';

export async function derive() {
  const text = readFileSync(new URL('./samples/decisions.csv', import.meta.url), 'utf8');
  const prep = prepareLog(text);
  const g = grow(prep);
  const holdout = prep.entries.filter((e) => e.slice === 'holdout');
  const eq = equivalence(g.tree, holdout);
  const negatives = prep.decisions;
  const receipt = buildMigrationReceipt({
    systemName: 'LoanDesk 2011', decisionName: prep.decisionName, rows: prep.nrows, decisions: prep.decisions,
    featureCount: prep.featureNames.length, holdoutN: eq.total, equivalenceRate: eq.rate,
    mismatchCount: eq.mismatches.length, invariantHolds: eq.invariant, flaggedLeaves: g.flagged, at: '2026-10-06T00:00:00Z',
  });
  // write the owned replacement the user downloads, import it back, run it — the real product path
  const file = join(tmpdir(), 'disco-ci-replacement.mjs');
  writeFileSync(file, replacementModule({ tree: g.tree, schema: prep.schema, decisionName: prep.decisionName, systemName: 'LoanDesk 2011', equivalenceRate: eq.rate, receipt }));
  const mod = await import(pathToFileURL(file).href);
  // a known APPROVE-shaped applicant and a known DECLINE-shaped one
  const approveRow = { age: 45, income: 80000, debt: 8000, loanAmount: 120000, employmentYears: 10, creditScore: 800, priorDefaults: 0, dti: 0.1, lti: 1.5, region: 'LON', product: 'STD', applyMonth: '2019-08' };
  const declineRow = { age: 20, income: 9000, debt: 5000, loanAmount: 80000, employmentYears: 0, creditScore: 480, priorDefaults: 3, dti: 0.55, lti: 8.9, region: 'NW', product: 'STD', applyMonth: '2018-01' };
  return {
    rows: prep.nrows,
    features: prep.featureNames.length,
    decisionName: prep.decisionName,
    decisionCount: prep.decisions.length,
    holdoutN: eq.total,
    equivalenceRate: eq.rate,
    mismatches: eq.mismatches.length,
    invariantHolds: eq.invariant,
    flaggedLeaves: g.flagged,
    receiptVerifies: verifyMigrationReceipt(receipt),
    tamperRejected: verifyMigrationReceipt({ ...receipt, equivalenceRate: 0.99 }) === false,
    modelReceiptVerifies: verifyMigrationReceipt(mod.receipt),
    modelApprove: mod.predict(approveRow),
    modelDecline: mod.predict(declineRow),
  };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('relearn-verify.mjs')) {
  const preds = JSON.parse(readFileSync(new URL('./relearn.predictions.json', import.meta.url), 'utf8'));
  const m = await derive();
  let fail = 0;
  for (const [k, v] of Object.entries(preds.expected)) if (m[k] !== v) { console.error(`MISMATCH ${k}: expected ${v}, got ${m[k]}`); fail++; }
  const holds = (e) => { const { rows, features, decisionName, decisionCount, holdoutN, equivalenceRate, mismatches, invariantHolds, flaggedLeaves, receiptVerifies, tamperRejected, modelReceiptVerifies, modelApprove, modelDecline } = m; try { return !!eval(e); } catch { return false; } };
  for (const c of preds.claims) if (!holds(c.check)) { console.error(`CLAIM FAIL ${c.id}: ${c.check}`); fail++; }
  if (fail) { console.error(`\n${fail} mismatch(es).`); process.exit(1); }
  console.log('✓ drove the whole product on the frozen sample; all', preds.claims.length, 'claims hold.');
  console.log(JSON.stringify(m));
}
