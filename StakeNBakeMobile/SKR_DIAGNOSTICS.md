# SKR Diagnostics

Use this script to validate official Solana Mobile SKR staking config against on-chain state.

## Command

```bash
npm run skr:diag -- --wallet <YOUR_WALLET_PUBKEY>
```

Optional flags:

- `--rpc <URL>`: override RPC endpoint.
- `--limit <N>`: max wallet signatures scanned for SKR stake-program activity.

Example with a dedicated RPC:

```bash
npm run skr:diag -- --wallet <YOUR_WALLET_PUBKEY> --rpc https://<your-rpc-endpoint> --limit 60
```

## What it checks

- Official config from `https://stake.solanamobile.com`:
  - program id
  - guardian
  - SKR mint
  - stake vault
  - cooldown seconds
- On-chain verification:
  - stake program account exists and is executable
  - stake vault mint/owner/balance
  - SKR mint decimals
- Wallet signals (best-effort):
  - liquid SKR balance
  - recent SKR program events (Stake / Unstake / Withdraw / CancelUnstake)
  - inferred cooldown status from recent transactions

## Notes

- `staked SKR` exact decoding is not included yet because it depends on SKR program account layout/IDL.
- If public RPC returns `429`, wallet event analysis may be partial; use a dedicated RPC for reliable results.
