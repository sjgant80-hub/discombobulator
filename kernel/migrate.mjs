// kernel/migrate.mjs — MIGRATE (stage 5). Schema-transform the legacy records into
// the sovereign build's structure and prove they came across intact. Output = the
// new build running on their real data, integrity-checked.
//
// Integrity gate (all must pass):
//   count        every legacy row produced exactly one sovereign record
//   required     no required field is null/NaN in any sovereign record
//   checksum     a deterministic checksum over the key fields matches end-to-end
//   roundtrip    the sovereign record maps BACK to the legacy key fields exactly
// Pure/TOTAL: a bad row is reported in `rejected`, never throws.

import { createHash } from 'node:crypto';

const REGION_NAMES = { NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west', MID: 'midlands', LON: 'london' };
const REQUIRED = ['applicantId', 'age', 'income', 'debt', 'loanAmount', 'employmentYears', 'creditScore', 'priorDefaults', 'region', 'product', 'appliedOn'];

// one legacy row -> one sovereign record (camelCase, normalized, derived ratios)
export function transform(row) {
  if (!row || typeof row !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const income = num(row.GROSS_INC);
  const rec = {
    applicantId: num(row.APPLICANT_ID),
    age: num(row.APP_AGE),
    income,
    debt: num(row.TOT_DEBT),
    loanAmount: num(row.LOAN_AMT),
    employmentYears: num(row.EMP_YRS),
    creditScore: num(row.CR_SCORE),
    priorDefaults: num(row.PRIOR_DEF),
    region: typeof row.REGION_CD === 'string' ? row.REGION_CD : null,
    regionName: REGION_NAMES[row.REGION_CD] || 'unknown',
    product: typeof row.PROD_CD === 'string' ? row.PROD_CD : null,
    appliedOn: typeof row.APPLY_DT === 'string' ? row.APPLY_DT : null,
    // derived, carried forward so the sovereign build needn't recompute at read time
    debtToIncome: income ? round(num(row.TOT_DEBT) / income) : null,
    loanToIncome: income ? round(num(row.LOAN_AMT) / income) : null,
  };
  return rec;
}

// map a sovereign record BACK to the legacy key fields (for the roundtrip check)
function toLegacyKey(rec) {
  return { APPLICANT_ID: rec.applicantId, APP_AGE: rec.age, GROSS_INC: rec.income, TOT_DEBT: rec.debt, LOAN_AMT: rec.loanAmount, EMP_YRS: rec.employmentYears, CR_SCORE: rec.creditScore, PRIOR_DEF: rec.priorDefaults, REGION_CD: rec.region, PROD_CD: rec.product, APPLY_DT: rec.appliedOn };
}

function keyChecksum(obj, fields) {
  const h = createHash('sha256');
  for (const f of fields) h.update(String(obj[f]) + '|');
  return h.digest('hex').slice(0, 12);
}

const LEGACY_KEY_FIELDS = ['APPLICANT_ID', 'APP_AGE', 'GROSS_INC', 'TOT_DEBT', 'LOAN_AMT', 'EMP_YRS', 'CR_SCORE', 'PRIOR_DEF', 'REGION_CD', 'PROD_CD', 'APPLY_DT'];

export function migrate(legacyRows) {
  if (!Array.isArray(legacyRows)) return { ok: false, error: 'bad-rows' };
  const records = [];
  const rejected = [];
  let roundtripFails = 0;
  let checksumFails = 0;

  for (const row of legacyRows) {
    const rec = transform(row);
    if (!rec) { rejected.push({ row, why: 'untransformable' }); continue; }
    // roundtrip
    const back = toLegacyKey(rec);
    const rt = LEGACY_KEY_FIELDS.every((f) => String(back[f]) === String(row[f]));
    if (!rt) roundtripFails++;
    // checksum end-to-end
    const srcSum = keyChecksum(row, LEGACY_KEY_FIELDS);
    const dstSum = keyChecksum(back, LEGACY_KEY_FIELDS);
    if (srcSum !== dstSum) checksumFails++;
    records.push(rec);
  }

  // every legacy row must have produced exactly one sovereign record (none dropped)
  const countMatch = records.length === legacyRows.length;
  // transform already guarantees each field is finite-or-null, so a null check on the
  // required fields is sufficient to catch a lost value.
  const nullFreeRequired = records.every((r) => REQUIRED.every((f) => r[f] !== null && r[f] !== undefined));
  const checksumMatch = checksumFails === 0;
  const roundtripOk = roundtripFails === 0;
  const integrity = { countMatch, nullFreeRequired, checksumMatch, roundtripOk };
  const pass = countMatch && nullFreeRequired && checksumMatch && roundtripOk;

  return {
    ok: true,
    migrated: records.length,
    source: legacyRows.length,
    rejected: rejected.length,
    integrity,
    pass,
    sample: records.slice(0, 2),
  };
}

function round(v) { return Math.round(v * 1000) / 1000; }

export default { migrate, transform };
