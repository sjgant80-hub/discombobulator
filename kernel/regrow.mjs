// kernel/regrow.mjs — RE-GROW (stage 3). Grow a FallWorld-native sovereign build
// from the functional-spec the Pattern Organ extracted. NOT a transpile of the
// legacy code — a fresh organ that computes the same FUNCTION, but structurally
// superior: sovereign (its own pure kernel), SENTINEL-defended (decisions flow as
// signed, κ-witnessed packets — Thomas Frumkin's primorial-fold codec, via
// sentinel.mjs), Konomi-compressed (the pattern book packs to a compact dictionary
// form), and proof-chain-transparent (every decision carries a receipt).
//
// grow-not-install: only the features the organ actually used become grown organs;
// the build differentiates to the extracted function, it does not install a
// fixed template. Reuses the grow-from-seed doctrine of fall-spore (sjgant80-hub).
//
// Pure/TOTAL where it matters: decide() never throws on garbage.

import { featurize, decisionOf } from './features.mjs';
import { predictSpec, applyCorrections } from './understand.mjs';
import { applyConfirmed } from './confirm.mjs';
import { pack, unpack, foldWitness, check, replayStore, WIRE, OPCODES } from './sentinel.mjs';
import { createHash } from 'node:crypto';

// ── Konomi-style compaction of the pattern book ──────────────────────────────
// A small shared dictionary (feature names, labels) + a compact pre-order encoding
// of BOTH grown organs. Measured honestly against the raw JSON — no inflated ratio.
function encodeTree(tree, feats, labels) {
  const fidx = (f) => { let i = feats.indexOf(f); if (i < 0) { i = feats.length; feats.push(f); } return i; };
  const lidx = (l) => { let i = labels.indexOf(l); if (i < 0) { i = labels.length; labels.push(l); } return i; };
  const parts = [];
  (function enc(n) {
    if (!n) { parts.push('_'); return; }
    if (n.leaf) { parts.push(`L${lidx(n.label)}`); return; }
    if (n.kind === 'num') parts.push(`N${fidx(n.feature)}:${round(n.threshold)}`);
    else parts.push(`C${fidx(n.feature)}:${n.value}`);
    enc(n.left); enc(n.right);
  })(tree);
  return parts.join(',');
}

export function compress(spec) {
  const feats = [];
  const labels = [];
  const s = encodeTree(spec.statusTree, feats, labels);
  const t = encodeTree(spec.tierTree, feats, labels);
  const packed = JSON.stringify({ f: feats, l: labels, s, t });
  const raw = JSON.stringify({ statusTree: spec.statusTree, tierTree: spec.tierTree });
  return { packed, rawBytes: raw.length, packedBytes: packed.length, ratio: round(raw.length / packed.length) };
}

function round(v) { return Math.round(v * 1000) / 1000; }

// ── the grown sovereign build ────────────────────────────────────────────────
export function grow(spec, options) {
  // !spec catches null/undefined/primitives-without-trees cheaply; the two tree checks
  // reject anything missing an organ. (A non-object primitive has no .statusTree, so a
  // separate typeof check would be redundant.)
  if (!spec || !spec.statusTree || !spec.tierTree) {
    return { ok: false, error: 'bad-spec' };
  }
  const organs = Array.isArray(spec.featuresUsed) ? [...spec.featuresUsed] : [];
  const corrections = (spec.corrections && spec.corrections.tree) ? spec.corrections : null;
  const correctionRules = corrections ? corrections.rules : [];
  const confirmedRules = Array.isArray(spec.confirmedRules) ? spec.confirmedRules : [];
  const comp = compress(spec);

  // the pure decision function — the heart of the sovereign build. Base tree, then
  // the gate-driven auto-carry correction organ, then any human-confirmed tribal
  // rules (the human-on-the-20%). TOTAL — never throws on garbage.
  function decide(applicant) {
    const x = featurize(applicant);
    if (!x) return { status: 'DECLINE', tier: null }; // safe default on garbage
    const base = predictSpec(spec, x);
    const corrected = applyCorrections(base, x, corrections);
    const decision = decisionOf(corrected);
    return applyConfirmed(decision, x, confirmedRules);
  }

  // a stable hash of the decision for the proof chain
  function decisionHash(applicant, decision) {
    return createHash('sha256')
      .update(JSON.stringify({ id: applicant?.id ?? null, d: decision }))
      .digest('hex').slice(0, 16);
  }

  // SENTINEL-defended governed decision. Builds a signed, κ-witnessed command
  // packet for the decision event and runs it through the sentinel gate. Only a
  // packet that verifies (sig ok BEFORE parse, κ ok, within budget, not a replay)
  // is accepted; the receipt proves it. A tampered or replayed packet is rejected.
  function secureDecide(applicant, sctx) {
    const decision = decide(applicant);
    const sourceId = sctx?.sourceId ?? 1;
    const payload = pack({ opcode: OPCODES.READ, source: sourceId, target: 0, resources: sctx?.resources ?? 0x01, budget: sctx?.budget ?? 1 });
    if (!payload) return { ok: false, reason: 'pack-failed' };
    const raw = new Uint8Array(WIRE);
    raw[0] = sourceId;
    raw.set(payload, 1);
    const msg = raw.subarray(0, 7);
    if (sctx && typeof sctx.sign === 'function') {
      const sig = sctx.sign(msg);               // Ed25519 signature over sourceId+payload
      raw.set(sig.subarray(0, 64), 7);
    }
    const verdict = check(raw, sctx?.ctx || {});
    const hash = decisionHash(applicant, decision);
    return {
      ok: verdict.ok,
      reason: verdict.reason,
      decision,
      receipt: {
        accepted: verdict.ok === true,
        verdict: verdict.reason,
        nonce: verdict.nonce || null,
        hash,
        organs,
      },
    };
  }

  return {
    ok: true,
    decide,
    secureDecide,
    organs,                 // grow-not-install: the organs that actually grew
    corrections,            // the gate-driven correction organ (carry element), or null
    correctionRules,        // human-readable summary of the auto re-grown pieces
    confirmedRules,         // the human-confirmed tribal rules applied (human-on-20%)
    compression: comp,
    kappaWitness: foldWitness, // exported so the live page can show tamper-detection
    describe() {
      return { organs, leaves: spec.counts?.leaves ?? null, compression: comp };
    },
  };
}

export default { grow, compress };
