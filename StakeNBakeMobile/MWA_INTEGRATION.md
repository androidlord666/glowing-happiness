# Solana Mobile Wallet Adapter Integration

`StakeNBakeMobile/src/lib/mwa.ts` now contains a real Solana Mobile Wallet Adapter implementation (`SolanaMobileWalletAdapter`) and runtime fallback to `MockWalletAdapter` when MWA packages are unavailable.

## What is implemented

- `connect()`
  - Uses MWA `transact(...)`
  - Calls `wallet.authorize(...)`
  - Extracts first account and normalizes to base58 address
- `signAndSendTransactions()`
  - Serializes transactions
  - Calls `wallet.signAndSendTransactions(...)`
  - Returns signatures as strings
- `disconnect()`
  - Calls `wallet.deauthorize(...)` when auth token exists

## Required packages

In `package.json`:

- `@solana-mobile/mobile-wallet-adapter-protocol`
- `@solana-mobile/mobile-wallet-adapter-protocol-web3js`
- `buffer`

Install:

```bash
cd StakeNBakeMobile
npm install
```

## Device validation checklist

1. Install on Solana Mobile device
2. Tap Connect and confirm wallet authorize prompt appears
3. Verify wallet pubkey populates in app
4. Test Send transaction signing
5. Test Consolidate transaction signing
6. Confirm explorer links resolve expected signatures

## Notes

- The app defaults to `devnet`.
- If wallet adapter package resolution fails at runtime, app falls back to mock adapter (dev safety).
- For production release, ensure MWA path is active on device and remove fallback if desired.
