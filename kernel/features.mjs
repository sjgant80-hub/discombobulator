// kernel/features.mjs — the shared, sovereign feature basis.
//
// One deterministic view of an applicant that every stage agrees on: the raw
// fields, the two derived affordability ratios, and the apply-month signal. Also
// the deterministic hash that fixes the train/validate/test split so the seal can
// prove nothing moved between stages. Pure and TOTAL: hostile input returns a safe
// default, never throws (witness fuzz boundary).

export const NUMERIC = ['age', 'income', 'debt', 'loanAmount', 'employmentYears', 'creditScore', 'priorDefaults', 'dti', 'lti'];
export const CATEGORICAL = ['region', 'product', 'applyMonth'];
export const FEATURES = [...NUMERIC, ...CATEGORICAL];

const n = (v) => (Number.isFinite(v) ? v : 0);
const s = (v) => (typeof v === 'string' ? v : '');

// featurize — the shaped measures the organ reads. Total.
export function featurize(a) {
  if (a === null || typeof a !== 'object') return null;
  const income = n(a.income);
  const safeInc = income > 0 ? income : 1; // guard divide; a 0-income applicant is a hard decline anyway
  return {
    age: n(a.age),
    income,
    debt: n(a.debt),
    loanAmount: n(a.loanAmount),
    employmentYears: n(a.employmentYears),
    creditScore: n(a.creditScore),
    priorDefaults: n(a.priorDefaults),
    dti: n(a.debt) / safeInc,
    lti: n(a.loanAmount) / safeInc,
    region: s(a.region),
    product: s(a.product),
    applyMonth: s(a.applyDate).slice(0, 7),
  };
}

// the combined decision label the organ predicts. Total.
export function labelOf(decision) {
  if (decision === null || typeof decision !== 'object') return 'UNKNOWN|null';
  const st = typeof decision.status === 'string' ? decision.status : 'UNKNOWN';
  const ti = decision.tier === null || decision.tier === undefined ? 'null' : String(decision.tier);
  return `${st}|${ti}`;
}

export function decisionOf(label) {
  const str = typeof label === 'string' ? label : 'UNKNOWN|null';
  const [status, tier] = str.split('|');
  return { status: status || 'UNKNOWN', tier: tier === 'null' ? null : (tier || null) };
}

// FNV-1a 32-bit over the id — deterministic, stable across machines. Total.
export function hashId(id) {
  let h = 0x811c9dc5 >>> 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// The split: TEST is the held-out the equivalence gate measures on (never seen by
// induction). TRAIN is split into FIT (tree grown here) and VALIDATE (the
// understand prove-gate measures leaf confidence here). Deterministic by id.
export function splitOf(id) {
  const b = hashId(id) % 10;          // 0..9
  if (b < 3) return 'test';           // ~30% held-out for equivalence
  const sub = hashId(`${id}:fit`) % 10;
  return sub < 3 ? 'validate' : 'fit'; // ~30% of train validates, ~70% fits
}
