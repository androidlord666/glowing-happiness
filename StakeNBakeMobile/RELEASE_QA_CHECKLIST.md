# Release QA Checklist (Mainnet)

Use this checklist on release day before store upload.

1. Environment
- Confirm build came from the latest successful `Android Release APK` workflow run on `main`.
- Confirm artifact is `app-release-apk` and signature is valid with the release keystore.

2. Wallet + Session
- Launch app and connect wallet.
- Disconnect and reconnect once to verify session recovery.
- Verify wallet box shows SOL and SKR balances.

3. Staking Flow
- Create a stake account with a valid SOL amount.
- Unstake (deactivate) that account.
- Confirm UI shows correct state transitions.

4. Withdraw Flow
- Select an `Inactive` stake account.
- Withdraw succeeds and wallet SOL balance updates.
- Attempt withdraw on non-inactive account and verify clear rejection message.

5. Consolidation Flow
- Select destination and multiple sources.
- Run `Dry Run` and confirm report copies with eligibility + simulation info.
- Run `Consolidate` in `Batch` mode and verify tx lifecycle entries.
- Run `Consolidate` in `Sequential` mode for a small set.
- Attempt immediate duplicate consolidate and verify idempotency block.

6. Swap Flow
- Get quote and execute swap `SOL -> SKR`.
- Get quote and execute swap `SKR -> SOL`.
- Verify balances and status updates.

7. Send / Receive
- Send SOL to a valid address.
- Resolve and send to `.sol` name.
- Open receive QR, copy address, open explorer link.

8. Logging + Support
- Copy debug report.
- Copy TX lifecycle report.
- Export logs using `Export Logs (Share)`.
- Copy support bundle and issue template.

9. UI + Stability
- Pull-to-refresh updates account state.
- Background app then resume, verify no stale/broken state.
- Toggle theme, explorer, and settings without crash.

10. Final Gate
- Confirm no blocker severity issues.
- Confirm changelog artifact exists in workflow run.
- Approve APK for store upload.
