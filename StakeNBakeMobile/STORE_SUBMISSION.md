# Solana Mobile dApp Store Submission Pack

## App
- **Name:** Solana Mobile Staking
- **Category:** Finance / Staking
- **Primary function:** Stake, unstake, consolidate stake accounts, and send SOL with Solana Mobile Wallet Adapter integration.

## Core Value Proposition
Solana Mobile Staking is a mobile-first staking utility for Solana Mobile users, focused on:
- Mainnet staking flow for Solana Mobile validator
- Stake account consolidation (wallet-authority scoped)
- Clean send/receive UX with SNS name support
- Smooth branded Solana Mobile experience

## Features (store-facing)
- Connect wallet via Solana Mobile Wallet Adapter
- Stake SOL to validator
- Unstake (deactivate) stake accounts
- Consolidate stake accounts (destination + source selection)
- Send SOL (supports `.sol` resolution)
- Receive SOL (copy address + QR)
- Network switch (mainnet-beta/devnet)
- Explorer selection (OrbMarkets, Solscan, Solana Explorer)
- Theme switch (dark/light)

## Privacy / Data Handling
- No custodial key management in app
- Transactions are authorized and signed by connected wallet
- No plaintext seed phrase collection or storage
- No off-chain personal profile requirement to use core staking/send flows

## Required Submission Assets
- App icon (1024x1024 recommended source)
- Screenshots (phone portrait)
  - Splash + connect
  - Staking dashboard
  - Consolidation flow
  - Send + receive screens
  - Settings screen
- Privacy Policy URL
- Support URL / contact

## Pre-Submit Checklist
- [ ] Latest android-release artifact installed on Solana Mobile device
- [ ] Mainnet: connect + stake + unstake pass
- [ ] Mainnet: consolidation pass (2+ stake accounts)
- [ ] Mainnet: send + receive pass
- [ ] Settings pass (network/theme/explorer)
- [ ] Branding pass final (logos/wording)
- [ ] Crash-free open/close and reconnect behavior

## Notes
- Current app naming and UI branding target: **Solana Mobile Staking**
- Consolidation requires at least 2 stake accounts (1 destination + 1+ source)
