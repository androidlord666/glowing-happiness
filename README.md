# Mobile Staking Toolkit

Solana Mobile dApp for consolidating stake accounts (up to 25 source stake accounts into 1 destination stake account), with a minimalist dark Solana-themed UI.

## Project layout

- `Staking with Solana Mobile/` → React Native Android/iOS app (main app)
- root files are legacy scaffold notes from earlier MVP pass

## Current shipped features

- Dark Solana-inspired mobile UI
- Wallet connect/disconnect/sign integration via Solana Mobile Wallet Adapter layer (with mock fallback safety)
- Send flow (build transfer tx + sign/send via wallet adapter interface)
- Receive flow (open wallet address in Solana explorer)
- Stake account discovery
- Select up to 99 source stake accounts
- Consolidation transaction builder:
  - delegate destination to validator vote account
  - merge selected source stake accounts into destination
- Default validator vote account set to:
  - `SKRuTecmFDZHjs2DxRTJNEK7m7hunKGTWJiaZ3tMVVA`

## Run app

```bash
cd StakeNBakeMobile
npm install
npm run android
```

## Build APK

See:
- `StakeNBakeMobile/BUILD_ANDROID.md`

Quick release command:

```bash
cd StakeNBakeMobile/android
./gradlew assembleRelease
```

Expected APK:
- `StakeNBakeMobile/android/app/build/outputs/apk/release/app-release.apk`

## Final production tasks remaining

1. Replace `MockWalletAdapter` in `StakeNBakeMobile/src/lib/mwa.ts` with full Solana Mobile Wallet Adapter implementation.
2. Configure Android signing keystore for release signing.
3. Validate stake merge constraints on-device against real stake account states.
4. Add dApp Store listing assets (icon/screenshots/copy/privacy text).
