// kernel/confirm.mjs — HUMAN-ON-THE-20%. The gate flags the cases the automated
// organ could not reproduce AND attributes each to a candidate tribal rule. A human
// reviews that short, pinpointed list and authorizes a correction. These confirmed
// rules are HUMAN KNOWLEDGE — not auto-discovered — applied on top of the grown
// build. Declarative and serializable so the same rules run in Node and in the
// browser live page. Pure/TOTAL.
//
// This is the spec's design exactly: "where re-growth doesn't match, you KNOW what
// didn't come across — flag it, human-review, re-grow that piece." The product value
// is that the gate turns blind reverse-engineering into a minutes-long confirm step.

function cmp(op, a, b) {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>=': return a >= b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '<': return a < b;
    default: return false;
  }
}

const TIER_UP = { D: 'C', C: 'B', B: 'A', A: 'A' };

// apply confirmed rules in order to a base decision under feature view x. Pure/total.
export function applyConfirmed(decision, x, rules) {
  if (!decision || !x || !Array.isArray(rules)) return decision;
  let d = { status: decision.status, tier: decision.tier ?? null };
  for (const r of rules) {
    if (!r || !Array.isArray(r.when)) continue;
    const condOk = r.when.every((c) => c && cmp(c.op, x[c.f], c.v));
    if (!condOk) continue;
    if (r.ifStatus && d.status !== r.ifStatus) continue;
    if (Array.isArray(r.ifTierIn) && !r.ifTierIn.includes(d.tier)) continue;
    const set = r.set || {};
    if (set.status) d.status = set.status;
    if (Object.prototype.hasOwnProperty.call(set, 'tier')) d.tier = set.tier;
    if (set.tierShift === 'up' && d.tier && TIER_UP[d.tier]) d.tier = TIER_UP[d.tier];
  }
  return d;
}

export default { applyConfirmed };
