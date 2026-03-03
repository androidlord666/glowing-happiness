# stakeNbake

Solana Mobile dApp focused on consolidating stake accounts (up to 25 source stake accounts into 1 destination stake account) with a minimalist dark Solana-themed UI.

## MVP features
- Mobile Wallet Adapter connect / disconnect
- Wallet actions: send / receive stubs
- Stake account discovery + selection (up to 25)
- Build and sign consolidation transactions
- Status + explorer links

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
