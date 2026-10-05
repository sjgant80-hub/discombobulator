// kernel/ingest.mjs — INGEST (stage 1). Pull the full legacy setup into one
// inventory, and build the BEHAVIORAL ORACLE corpus the Pattern Organ learns from.
//
// The corpus is the honest core of "understand the function, not the code": it is
// input→output pairs observed by running the legacy as a black box. UNDERSTAND
// never sees legacy source — only this corpus. Pure/TOTAL.

import { featurize, labelOf, splitOf } from './features.mjs';

// Run the legacy oracle over every row and record (features, label, split). The
// TEST slice is withheld from training and used only by VERIFY.
export function buildCorpus(rows, rowToApplicant, legacyDecide) {
  if (!Array.isArray(rows) || typeof rowToApplicant !== 'function' || typeof legacyDecide !== 'function') {
    return { ok: false, error: 'bad-inputs' };
  }
  const corpus = [];
  const testCases = [];
  for (const row of rows) {
    let app, decision;
    try { app = rowToApplicant(row); decision = legacyDecide(app); } catch { continue; }
    const x = featurize(app);
    if (!x) continue;
    const slice = splitOf(app.id);
    const entry = { id: app.id, x, y: labelOf(decision), slice, applicant: app };
    if (slice === 'test') testCases.push(app);
    else corpus.push(entry);
  }
  return {
    ok: true,
    corpus,                        // fit + validate (training material)
    testCases,                     // held-out applicants for VERIFY (never trained on)
    counts: {
      total: rows.length,
      fit: corpus.filter((c) => c.slice === 'fit').length,
      validate: corpus.filter((c) => c.slice === 'validate').length,
      test: testCases.length,
    },
  };
}

// summarize the inventory from already-read setup data (files/config/schema). Pure.
export function summarizeInventory(files, configObj, schemaColumns, recordCount) {
  return {
    software: Array.isArray(files) ? files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })) : [],
    config: configObj && typeof configObj === 'object' ? Object.keys(configObj) : [],
    schema: Array.isArray(schemaColumns) ? schemaColumns : [],
    records: Number.isFinite(recordCount) ? recordCount : 0,
  };
}

export default { buildCorpus, summarizeInventory };
