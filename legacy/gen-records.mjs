// legacy/gen-records.mjs — deterministic generator for the legacy applicant store.
//
// Produces records.json in the LEGACY schema. Fully seeded (no Math.random), so the
// dataset is reproducible and its sha256 can be sealed. The distribution is realistic
// and, crucially, the gnarly combinations (NE + long tenure, large BRIDGE, Mar-2019)
// are genuinely RARE — the dataset is NOT rigged to make them easy. Run:
//   node legacy/gen-records.mjs            (writes legacy/records.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// mulberry32 — a tiny deterministic PRNG. Same seed → same dataset on every machine.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 1200;
const SEED = 20260105;
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// region weights: NE kept to ~8% so the grandfather rule is rare
const REGIONS = ['NW', 'NW', 'SE', 'SE', 'SW', 'MID', 'MID', 'LON', 'LON', 'LON', 'LON', 'NE'];
// product weights: BRIDGE kept to ~7%
const PRODUCTS = ['STD', 'STD', 'STD', 'STD', 'STD', 'STD', 'GREEN', 'GREEN', 'REMO', 'REMO', 'REMO', 'BRIDGE'];
// apply dates across 2018-2020 with a sliver in the Mar-2019 promo window
const MONTHS = [
  '2018-06', '2018-09', '2018-11', '2019-01', '2019-02', '2019-03',
  '2019-05', '2019-08', '2019-11', '2020-01', '2020-04', '2020-07',
];

const rows = [];
for (let i = 1; i <= N; i++) {
  const age = between(19, 68);
  // income log-ish spread 12k..180k
  const income = Math.round((12000 + Math.floor(rnd() * rnd() * 168000)) / 100) * 100;
  const dtiTarget = rnd() * 0.7;                       // 0..0.70
  const debt = Math.round(income * dtiTarget);
  const ltiTarget = 0.5 + rnd() * 6.0;                 // 0.5..6.5
  const loanAmount = Math.round(income * ltiTarget);
  const employmentYears = between(0, 25);
  const creditScore = between(520, 840);
  const priorDefaults = rnd() < 0.82 ? 0 : between(1, 3);
  const region = pick(REGIONS);
  const product = pick(PRODUCTS);
  const applyDate = `${pick(MONTHS)}-${String(between(1, 28)).padStart(2, '0')}`;

  rows.push({
    APPLICANT_ID: i,
    APP_AGE: age,
    GROSS_INC: income,
    TOT_DEBT: debt,
    LOAN_AMT: loanAmount,
    EMP_YRS: employmentYears,
    CR_SCORE: creditScore,
    PRIOR_DEF: priorDefaults,
    REGION_CD: region,
    PROD_CD: product,
    APPLY_DT: applyDate,
  });
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'records.json');
writeFileSync(out, JSON.stringify(rows, null, 0) + '\n');
console.log(`wrote ${rows.length} legacy rows → ${out}`);
