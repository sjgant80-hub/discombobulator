// legacy/store.cjs — LoanDesk's data-access layer. Owns the legacy schema mapping.
// The discombobulator INGESTs through here: it reads legacy rows and (for the
// behavioral oracle) maps them into what the engine consumes. MIGRATE later turns
// these same rows into the SOVEREIGN build's schema.
const fs = require('node:fs');
const path = require('node:path');

// Map one legacy row (uppercase schema columns) → the object engine.decide expects.
function rowToApplicant(row) {
  return {
    id: row.APPLICANT_ID,
    age: row.APP_AGE,
    income: row.GROSS_INC,
    debt: row.TOT_DEBT,
    loanAmount: row.LOAN_AMT,
    employmentYears: row.EMP_YRS,
    creditScore: row.CR_SCORE,
    priorDefaults: row.PRIOR_DEF,
    region: row.REGION_CD,
    product: row.PROD_CD,
    applyDate: row.APPLY_DT,
  };
}

function loadRows(file) {
  const p = file || path.join(__dirname, 'records.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = { rowToApplicant, loadRows };
