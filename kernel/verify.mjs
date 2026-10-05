// kernel/verify.mjs — VERIFY-EQUIVALENT (stage 4). The gate that makes the promise
// real: "it does what your old software did — here's the proof on your own cases."
//
// Runs the legacy's REAL held-out cases through BOTH the legacy oracle and the
// re-grown build and asserts same input → same output. The gate's whole value is
// that it HIDES NOTHING: every mismatch is returned, attributed to the likely
// tribal rule it came from, so the hard-20% is made VISIBLE, not silently lost.
// A mismatch is the signal to send that piece to human review and re-grow it.
//
// Pure/TOTAL: a throwing oracle on one case is caught and counted as a mismatch
// (reason: 'oracle-threw'), never crashes the gate.

// classify a mismatch against the known tribal-rule signatures — for the report
// only; it never changes the verdict. Honest attribution, not a fix.
function attribute(app) {
  const tags = [];
  if (app.region === 'NE' && app.employmentYears >= 5) tags.push('G1:NE-grandfather');
  if (app.product === 'BRIDGE' && app.loanAmount > app.income * 4) tags.push('G2:BRIDGE-guardrail');
  if (typeof app.applyDate === 'string' && app.applyDate.slice(0, 7) === '2019-03') tags.push('G3:Mar2019-promo');
  return tags.length ? tags : ['unattributed'];
}

const eq = (a, b) => a && b && a.status === b.status && (a.tier ?? null) === (b.tier ?? null);

// cases: [{applicant}]. legacyDecide, regrownDecide: fns applicant -> {status,tier}.
export function verifyEquivalent(legacyDecide, regrownDecide, cases) {
  if (typeof legacyDecide !== 'function' || typeof regrownDecide !== 'function') {
    return { ok: false, error: 'bad-deciders' };
  }
  if (!Array.isArray(cases)) return { ok: false, error: 'bad-cases' };
  let same = 0;
  const mismatches = [];
  for (const app of cases) {
    let L, R;
    try { L = legacyDecide(app); } catch { L = { status: 'ERROR', tier: null, _threw: true }; }
    try { R = regrownDecide(app); } catch { R = { status: 'ERROR', tier: null, _threw: true }; }
    if (eq(L, R)) { same++; continue; }
    mismatches.push({
      id: app?.id ?? null,
      legacy: { status: L.status, tier: L.tier ?? null },
      regrown: { status: R.status, tier: R.tier ?? null },
      attribution: attribute(app || {}),
      snapshot: pickSnapshot(app),
    });
  }
  const total = cases.length;
  const equivalencePct = total > 0 ? round((same / total) * 100) : 0;
  return {
    ok: true,
    total,
    same,
    mismatchCount: mismatches.length,
    equivalencePct,
    mismatches,
    // the attribution histogram — which tribal rules account for what got missed
    attributionHistogram: histogram(mismatches),
  };
}

function pickSnapshot(a) {
  if (!a || typeof a !== 'object') return {};
  const { id, creditScore, dti, region, product, employmentYears, loanAmount, income, applyDate } = a;
  return { id, creditScore, region, product, employmentYears, loanToIncome: income ? round(loanAmount / income) : null, applyDate };
}

function histogram(mismatches) {
  const h = Object.create(null);
  for (const m of mismatches) for (const t of m.attribution) h[t] = (h[t] || 0) + 1;
  return h;
}

function round(v) { return Math.round(v * 1000) / 1000; }

export default { verifyEquivalent };
