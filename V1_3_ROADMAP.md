# stakeNbake v1.3 Roadmap (Post-Launch Hardening)

## Goal
Improve reliability and supportability without changing core user flow.

## P0 (Do first)

- [ ] **RPC resilience**
  - Add primary + fallback RPC endpoints in config.
  - Add bounded retry/backoff wrapper for key reads.
  - On 429/timeout, use cached last-known stake-account snapshot for UI continuity.
  - **Acceptance:** refresh works under transient RPC failures without blanking UI.

- [ ] **Consolidation safety checks**
  - Validate destination/source compatibility before tx build.
  - Block consolidate action when selected sources are invalid.
  - Show clear reason in status text.
  - **Acceptance:** no invalid consolidation tx attempts from UI state drift.

- [ ] **Transaction state UX**
  - Standardize statuses: building → submitted → confirming → confirmed/failed.
  - Consolidation status shows progress (`n/total`).
  - **Acceptance:** users can always tell current tx phase.

## P1 (High value)

- [ ] **Support diagnostics**
  - Add “Copy debug report” action (non-sensitive): app version, cluster, last action, last signature, timestamps, error text.
  - **Acceptance:** support issues can be triaged from one paste.

- [ ] **Performance polish**
  - Keep source account list derived via memoized selector.
  - Debounce expensive refresh triggers.
  - **Acceptance:** fewer redundant RPC reads; smoother UI updates.

- [ ] **Idempotency guards**
  - Prevent accidental duplicate sends/consolidations while tx in flight.
  - **Acceptance:** repeated taps don’t create duplicate submits.

## P2 (Release ops)

- [ ] **Release checklist doc**
  - Preflight: secrets present, keystore alias/passwords verified, version bump, run green, artifact hash check.
  - **Acceptance:** one deterministic release path.

- [ ] **Versioning automation (optional)**
  - Add CI/manual input to set `versionCode` and `versionName` per release run.
  - **Acceptance:** no manual gradle edit for each store upload.

## Suggested Execution Order
1. RPC resilience
2. Consolidation safety
3. Tx UX states
4. Diagnostics export
5. Release automation
