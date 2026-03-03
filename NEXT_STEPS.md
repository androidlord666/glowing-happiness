# stakeNbake — Proactive Execution Plan

## Immediate next milestones (in order)

1. **Real Solana Mobile MWA integration**
   - Replace `MockWalletAdapter` in `StakeNBakeMobile/src/lib/mwa.ts`
   - Implement authorize / sign+send / deauthorize
   - Validate connect + transaction signing on device

2. **Consolidation reliability pass**
   - Preflight checks for merge compatibility
   - Better error messages for incompatible stake states
   - Progress states per transaction

3. **Release readiness**
   - Android signing config
   - Release APK build + install test on device
   - App icon/splash polish

4. **Store submission pack**
   - Description copy
   - Screenshots
   - Privacy/security notes

## Execution policy

- Ship in small commits to `main`.
- Keep devnet default until final verification.
- Do not switch to mainnet until user says `mainnet-go`.

## Current defaults

- Cluster: `devnet`
- Validator vote account: `SKRuTecmFDZHjs2DxRTJNEK7m7hunKGTWJiaZ3tMVVA`
