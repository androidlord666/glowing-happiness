# stakeNbake

Solana Mobile dApp focused on consolidating stake accounts (up to 25 source stake accounts into 1 destination stake account) with a minimalist dark Solana-themed UI.

## MVP features
- Mobile Wallet Adapter integration surface (mock adapter wired, MWA drop-in point prepared)
- Wallet actions: connect / disconnect + send / receive placeholders
- Stake account discovery + selection (up to 25)
- Consolidation tx builder (delegate destination + merge sources)
- Dark Solana-style UI with explicit destination + validator vote controls
- Status pipeline for signing/submission feedback

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
