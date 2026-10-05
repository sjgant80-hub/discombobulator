# The Discombobulator

### ▶ LIVE: https://sjgant80-hub.github.io/discombobulator/

Feed it a legacy system. It works out what the software **does** (not how it's coded), re-grows a sovereign build that does the same job, **proves equivalence on the system's own held-out cases**, and migrates the data across. The live page runs the whole pipeline in your browser on the real gated kernels, with a re-run button.

> Not a copier — a **re-grower**. A byte-identical copy reproduces the old flaws (soft, un-sovereign, black-box). The discombobulator extracts the *function* as verified patterns, grows a FallWorld-native organ that reproduces it, **proves** it's equivalent, and migrates the data in. Functionally equivalent, structurally superior, owned by you.

---

## The five gated stages

| # | Stage | What it does |
|---|-------|--------------|
| 1 | **Ingest** | Inventory the code, config, schema & data; sample the legacy as a black-box oracle (input→output pairs). It never transpiles the legacy source. |
| 2 | **Understand** | Induce the decision *function* as patterns — two grown organs (a status organ and a tier organ). Every leaf is **proved on a held-out VALIDATE slice**; a low-confidence leaf is flagged as a candidate MISunderstanding, never silently kept. The hard, valuable part. |
| 3 | **Re-grow** | Grow a sovereign build from the spec: **SENTINEL-defended** (signed, κ-witnessed packets), Konomi-compressed pattern book, proof-chain transparent, grow-not-install (only the organs the function needs). |
| 4 | **Verify-equivalent** | Run the legacy's **real held-out cases** through BOTH old and new; assert same input → same output; surface **every** mismatch and attribute it to a candidate tribal rule. The gate is the safety. |
| 5 | **Migrate** | Schema-transform the records into the sovereign build's structure; count / null / checksum / roundtrip integrity checks. |

---

## Proven on: "LoanDesk 2011"

A synthetic but faithful legacy system — an undocumented **1,200-record credit-decision engine** (`legacy/engine.cjs`) with ~80% clean threshold rules and ~20% gnarly, undocumented **tribal rules**: a regional grandfather clause, a product guardrail, and a date-bound promo. It is treated as a black box.

### Sealed results (re-derived by CI from the hashed inputs)

- **Equivalence on 351 held-out cases:** `94.6%` automated (base organ) → `96.0%` after the gate-driven **auto-carry** → `97.7%` after a human confirms the 3 tribal rules the gate pinpointed.
- **Mismatches flagged, never hidden:** the flagged set is provably **equal** to the set of all cases where old and new differ (`same + mismatches == total`). After the guided loop the residual is continuous-ratio **boundary approximation** — every case surfaced.
- **Structurally superior:** the re-grown build rejects a **forged**, **replayed**, **over-budget**, or **off-κ** (tampered) decision packet — the legacy engine accepts any call that reaches it.
- **Migrate integrity:** `PASS` — 1,200/1,200 records across, count + null + checksum + roundtrip all green.

> **Honest v1.** This is a *guided pipeline*, not a one-click vending machine. The common rules extract automatically; the gnarly, undocumented ones are flagged for a human to confirm in a moment. Some things don't translate at all (deep platform deps, hardware-bound logic) and would be *bridged*, not re-grown — flagged up front. Automation deepens as the pattern library grows.

---

## Run it

```bash
node run.mjs            # run the whole pipeline, print the report
npm test                # behaviour + totality + the two load-bearing invariants
npm run gate            # witness mutation gate on every kernel (must be CLEAN)
node seal.mjs --verify  # re-derive the sealed measurement from the hashed inputs
node build-page.mjs     # regenerate the kernel-backed index.html
```

## Seal-before-measure (two commits)

`prereg.json` (predictions + sha256 of every input) is committed **first**; `measure.json` (the result) lands in a **separate** commit, and CI re-derives the measurement on the runner from the same hashed inputs. Git history proves the seal predated the measurement.

## Credits

Built on the **Konomi** architecture and **LIGHT**, created by **Thomas Frumkin** — the SENTINEL defense uses his primorial-fold codec (the κ-witness). The UNDERSTAND stage reuses **pattern-organs** (the Pattern Organ & held-out prove-gate) and the RE-GROW stage follows **fall-spore** (grow-from-seed), both `sjgant80-hub`. Equivalence is enforced by the **witness** mutation gate. "LoanDesk 2011" is a synthetic proof target with no real data.
