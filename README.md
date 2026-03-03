# stakeNbake

Solana Mobile dApp focused on consolidating stake accounts (up to 25 source stake accounts into 1 destination stake account) with a minimalist dark Solana-themed UI.

## MVP features
- Solana dark minimalist mobile UI
- Wallet connect/disconnect integration surface (mock adapter currently wired)
- Send flow (build transfer tx + sign/send via wallet adapter)
- Receive flow (opens explorer address link)
- Stake account discovery + selection (up to 25)
- Consolidation tx builder (delegate destination + merge selected source stake accounts)
- Validator vote account preset for Solana Mobile staking validator
- Status pipeline + tx explorer links

## Tech
- React Native (TypeScript)
- Solana Mobile Wallet Adapter + `@solana/web3.js`

## Quick start
```bash
npm install
npm run start
```

## Notes
This repo currently targets devnet first. Mainnet-beta can be enabled by changing RPC + cluster config.

## Remaining for production
- Replace `MockWalletAdapter` in `src/lib/mwa.ts` with full Solana Mobile Wallet Adapter authorization + sign/send implementation.
- Add full React Native Android project scaffold (if starting from scratch) and configure release signing.
- Run on physical Solana Mobile device and verify stake merge constraints against real account states.
- Prepare dApp Store listing assets and policy text.
