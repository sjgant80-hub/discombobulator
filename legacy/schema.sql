-- LoanDesk 2011 — legacy applicant store (the "data schema" the discombobulator ingests).
-- Flat, denormalized, legacy naming. MIGRATE transforms this into the sovereign build's schema.
CREATE TABLE applicants (
  APPLICANT_ID   INTEGER PRIMARY KEY,   -- legacy surrogate key
  APP_AGE        INTEGER NOT NULL,      -- years
  GROSS_INC      INTEGER NOT NULL,      -- annual gross income, whole currency units
  TOT_DEBT       INTEGER NOT NULL,      -- outstanding debt, whole units
  LOAN_AMT       INTEGER NOT NULL,      -- requested amount, whole units
  EMP_YRS        INTEGER NOT NULL,      -- employment years at current employer
  CR_SCORE       INTEGER NOT NULL,      -- credit score 300-850
  PRIOR_DEF      INTEGER NOT NULL,      -- count of prior defaults
  REGION_CD      TEXT    NOT NULL,      -- NE | NW | SE | SW | MID | LON
  PROD_CD        TEXT    NOT NULL,      -- STD | BRIDGE | GREEN | REMO
  APPLY_DT       TEXT    NOT NULL       -- ISO date YYYY-MM-DD
);
