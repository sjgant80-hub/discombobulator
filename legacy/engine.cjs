// ════════════════════════════════════════════════════════════════════════════
// LEGACY SYSTEM — "LoanDesk 2011" credit-decision engine  (the proof target)
//
// This is a deliberately realistic piece of UNDOCUMENTED legacy business-rules
// software: the kind of thing a migration client actually arrives with. It is
// CommonJS, it reads its thresholds from a config file nobody remembers writing,
// and it carries three TRIBAL-KNOWLEDGE quirks that live only in this code (no
// spec, no comment at the call site) — exactly the gnarly ~20% the spec warns of.
//
// The discombobulator treats this file as a BLACK BOX. It never transpiles this
// logic (that would clone the flaws into a wrapper). It observes input→output and
// re-grows the FUNCTION. This file exists only so there is a real legacy behavior
// to reproduce and a real oracle to measure equivalence against.
//
// OUTPUT (the decision): { status: 'APPROVE'|'REFER'|'DECLINE', tier: 'A'|'B'|'C'|'D'|null }
//   status = what the business does with the application
//   tier   = the pricing/risk band (null when declined)
// ════════════════════════════════════════════════════════════════════════════

const CONFIG = require('./config.json');

// LoanDesk's one public entry point. Given an applicant record, return the decision.
// (Legacy style: mutable locals, early returns, magic numbers pulled from config,
// and a couple of overrides bolted on over the years that nobody documented.)
function decide(a) {
  const c = CONFIG;

  // --- hard knockouts (the clean, well-known floor) --------------------------
  if (a.age < c.minAge) return { status: 'DECLINE', tier: null };
  if (a.income < c.minIncome) return { status: 'DECLINE', tier: null };
  if (a.creditScore < c.hardDeclineScore) return { status: 'DECLINE', tier: null };
  if (a.priorDefaults >= c.maxPriorDefaults) return { status: 'DECLINE', tier: null };

  // --- affordability (clean thresholds) --------------------------------------
  const dti = a.debt / a.income;                 // debt-to-income
  const lti = a.loanAmount / a.income;           // loan-to-income
  if (dti >= c.dtiDecline) return { status: 'DECLINE', tier: null };
  if (lti >= c.ltiDecline) return { status: 'DECLINE', tier: null };

  // --- base tier from the credit score bands (clean) -------------------------
  let tier;
  if (a.creditScore >= c.band.A) tier = 'A';
  else if (a.creditScore >= c.band.B) tier = 'B';
  else if (a.creditScore >= c.band.C) tier = 'C';
  else tier = 'D';

  // --- base status from affordability (clean) --------------------------------
  let status;
  if (dti < c.dtiApprove && lti < c.ltiApprove) status = 'APPROVE';
  else status = 'REFER';

  // REFER anyone thin on the job, regardless of score (clean-ish, well used)
  if (a.employmentYears < c.minEmploymentForApprove && status === 'APPROVE') {
    status = 'REFER';
  }

  // ════════════ TRIBAL KNOWLEDGE — the gnarly ~20% ════════════════════════════
  // These three rules are the reason a byte-identical copy would reproduce flaws
  // and a from-behavior re-grow may MISS them. They are rare, interacting, and
  // undocumented. The discombobulator's verify gate exists to CATCH exactly these.

  // (G1) THE NORTH-EAST GRANDFATHER. When LoanDesk absorbed a regional lender in
  //      2013, long-tenure NE customers were promised their old auto-approve. It
  //      was hard-coded here and never written down. Rare: region NE AND 5+ years.
  if (a.region === 'NE' && a.employmentYears >= c.neGrandfatherYears && status === 'REFER') {
    status = 'APPROVE';
  }

  // (G2) THE BRIDGE GUARDRAIL. After a bad year on bridging loans, someone forced
  //      every large BRIDGE application to a human, even perfect credit. Lives
  //      only here. Rare: product BRIDGE AND loan > 4x income.
  if (a.product === 'BRIDGE' && a.loanAmount > a.income * c.bridgeLtiGuardrail && status === 'APPROVE') {
    status = 'REFER';
  }

  // (G3) THE MARCH-2019 PROMO. A board-approved spring promo bumped one tier for
  //      that month only. Left in the code. Date-bound; learnable IF the month is
  //      seen as a feature — included deliberately to show the organ CAN pick up a
  //      calendar rule when given the signal.
  if (typeof a.applyDate === 'string' && a.applyDate.slice(0, 7) === c.promoMonth && status === 'APPROVE') {
    if (tier === 'B') tier = 'A';
    else if (tier === 'C') tier = 'B';
  }

  return { status, tier };
}

module.exports = { decide };
