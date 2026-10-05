// legacy/engine.browser.mjs — a FAITHFUL ES-module mirror of legacy/engine.cjs, for
// the live page (browsers cannot require CommonJS). It is a line-for-line port of the
// legacy decision logic; a test (decide parity) asserts it stays identical to the CJS
// original on every record, so the live page runs the true legacy behavior.
export function makeLegacy(CONFIG) {
  return function decide(a) {
    const c = CONFIG;
    if (a.age < c.minAge) return { status: 'DECLINE', tier: null };
    if (a.income < c.minIncome) return { status: 'DECLINE', tier: null };
    if (a.creditScore < c.hardDeclineScore) return { status: 'DECLINE', tier: null };
    if (a.priorDefaults >= c.maxPriorDefaults) return { status: 'DECLINE', tier: null };
    const dti = a.debt / a.income;
    const lti = a.loanAmount / a.income;
    if (dti >= c.dtiDecline) return { status: 'DECLINE', tier: null };
    if (lti >= c.ltiDecline) return { status: 'DECLINE', tier: null };
    let tier;
    if (a.creditScore >= c.band.A) tier = 'A';
    else if (a.creditScore >= c.band.B) tier = 'B';
    else if (a.creditScore >= c.band.C) tier = 'C';
    else tier = 'D';
    let status;
    if (dti < c.dtiApprove && lti < c.ltiApprove) status = 'APPROVE';
    else status = 'REFER';
    if (a.employmentYears < c.minEmploymentForApprove && status === 'APPROVE') status = 'REFER';
    if (a.region === 'NE' && a.employmentYears >= c.neGrandfatherYears && status === 'REFER') status = 'APPROVE';
    if (a.product === 'BRIDGE' && a.loanAmount > a.income * c.bridgeLtiGuardrail && status === 'APPROVE') status = 'REFER';
    if (typeof a.applyDate === 'string' && a.applyDate.slice(0, 7) === c.promoMonth && status === 'APPROVE') {
      if (tier === 'B') tier = 'A';
      else if (tier === 'C') tier = 'B';
    }
    return { status, tier };
  };
}
