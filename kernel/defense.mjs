// kernel/defense.mjs — prove the re-grown build is STRUCTURALLY SUPERIOR, not just
// equivalent. The legacy engine accepts any call that reaches it. The sovereign
// build routes every decision as a signed, κ-witnessed SENTINEL packet (Thomas
// Frumkin's primorial-fold codec, via sentinel.mjs) and REJECTS what the legacy
// could not even see: a forged call, a replayed call, a tampered (off-κ) packet,
// and a call over its capability budget. This module runs those adversarial checks
// with real Ed25519 and returns the verdicts. Node crypto (load-bearing proof).

import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { pack, foldWitness, check, unpack, replayStore, WIRE, OPCODES } from './sentinel.mjs';

function buildWire(sourceId, cmd, signFn) {
  const payload = pack({ opcode: OPCODES.READ, source: sourceId, target: 0, resources: cmd.resources, budget: cmd.budget });
  const raw = new Uint8Array(WIRE);
  raw[0] = sourceId;
  raw.set(payload, 1);
  const msg = raw.subarray(0, 7);
  if (signFn) raw.set(signFn(msg).subarray(0, 64), 7);
  return raw;
}

// Run the full adversarial battery. Returns the verdict for each attack: the build
// is structurally superior iff the legit call is accepted and ALL four attacks are
// rejected for the right reason.
export function runDefense() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sourceId = 1;
  const signFn = (msg) => edSign(null, Buffer.from(msg), privateKey);
  const verifyFn = (pub, msg, sig) => { try { return edVerify(null, Buffer.from(msg), pub, Buffer.from(sig)); } catch { return false; } };
  const ctx = {
    keys: { [sourceId]: publicKey },
    lattice: { [sourceId]: { maxBudget: 10, resources: 0xFF } },
    seen: replayStore(256),
    verify: verifyFn,
  };

  // 1 · a legitimate, signed, in-budget decision is ACCEPTED
  const good = buildWire(sourceId, { resources: 0x01, budget: 1 }, signFn);
  const legit = check(good, ctx);

  // 2 · FORGED — flip a payload byte after signing: signature no longer matches
  const forgedRaw = buildWire(sourceId, { resources: 0x01, budget: 1 }, signFn);
  forgedRaw[2] ^= 0x20;                  // tamper the resources byte
  const forged = check(forgedRaw, ctx);

  // 3 · REPLAY — resend the exact legit packet: its signature nonce is already seen
  const replay = check(good, ctx);

  // 4 · BUDGET — a signed packet asking beyond its capability budget is DENIED
  const bigRaw = buildWire(sourceId, { resources: 0x01, budget: 9999 }, signFn);
  const overBudget = check(bigRaw, ctx);

  // 5 · OFF-κ — the pure primorial-fold tamper check (browser-safe, no crypto):
  //     corrupt the κ-witness byte and the 6-byte payload no longer folds to it
  const payload = pack({ opcode: OPCODES.READ, source: sourceId, target: 0, resources: 0x01, budget: 1 });
  const corrupt = Uint8Array.from(payload);
  corrupt[5] ^= 0x01;                    // break the κ-witness
  const offKappa = unpack(corrupt);

  return {
    legit: { ok: legit.ok, reason: legit.reason },
    forged: { rejected: !forged.ok, reason: forged.reason },
    replay: { rejected: !replay.ok, reason: replay.reason },
    overBudget: { rejected: !overBudget.ok, reason: overBudget.reason },
    offKappa: { rejected: !offKappa.ok, reason: offKappa.reason },
    pass:
      legit.ok === true &&
      forged.ok !== true && forged.reason === 'forged' &&
      replay.ok !== true && replay.reason === 'replay' &&
      overBudget.ok !== true && overBudget.reason === 'budget-exceeded' &&
      offKappa.ok !== true && offKappa.reason === 'off-kappa',
  };
}

// browser-safe κ-witness check for the live page (pure, sync, no crypto). Returns
// true when the 6-byte payload folds to its witness byte (i.e. untampered).
export function kappaIntact(payload) {
  if (!(payload instanceof Uint8Array) || payload.length < 6) return false;
  return payload[5] === foldWitness(payload);
}

export default { runDefense, kappaIntact };
