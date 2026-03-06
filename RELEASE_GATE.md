# RELEASE_GATE.md — Production Release Gate (stakeNbake)

This app is live. Treat every upload as production-critical.

## Non-Negotiable Gate (must all pass)

1. CI release workflow is **green** on latest commit.
2. APK contains `assets/index.android.bundle` (enforced in CI).
3. Physical-device install + cold launch succeeds.
4. Full smoke sequence passes end-to-end.
5. No crash/red-screen/stuck state during at least 10 minutes active use.

If any item fails: **do not upload**.

---

## Mandatory Smoke Sequence (every release)

### App lifecycle
- Cold start app
- Connect wallet
- Kill app, reopen, reconnect behavior is healthy

### Stake flow
- Refresh stake accounts
- Create + Stake (small amount)
- Unstake selected account
- Consolidate flow:
  - select destination
  - select source accounts
  - confirm modal appears
  - submit succeeds
  - post-confirm refresh reflects state

### Send / Receive flow
- Send to normal address (small amount)
- Send to `.sol` name (small amount)
- `Max` button sets sane amount (fee buffer preserved)
- Copy receive address
- Show/hide QR

### Explorer / Diagnostics
- Open latest tx link
- Open recent tx history links
- Settings: copy debug report works

### Stability checks
- No UI freeze
- No unexpected busy lock
- No repeated duplicate submission
- Pending tx status recovers after reopen

---

## Upload Rules

- Upload only from latest green run artifact.
- Confirm `versionCode` is higher than store’s current live version.
- Keep upload notes tied to commit hash/run number.

---

## Security / Key Ops

- Keep keystore and credentials backed up (`KEYSTORE_BACKUP.md`).
- Rotate PAT/bot tokens after release operations done.
- Never store long-lived high-scope PAT in chat/history.

---

## Quick Go / No-Go

- **GO** only if all gate checks pass.
- **NO-GO** if any smoke item is uncertain.
