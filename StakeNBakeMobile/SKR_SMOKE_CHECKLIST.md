# SKR Smoke Checklist

Use this after each SKR-related change before release.

## Preconditions

- Wallet connected on mainnet.
- Wallet has enough SKR for test.
- App build is from latest CI run.

## Steps

1. Open app, tap upper-right Seeker icon.
2. In `SKR Staking` card, enter a small amount (for example `1`).
3. Tap `Stake SKR` then `Confirm Stake` and sign in wallet.
4. Verify success status appears and wallet SKR balance decreases.
5. Tap `Unstake SKR` then `Confirm Unstake` and sign in wallet.
6. Verify success status appears and wallet SKR balance increases.

## Wrong-authority validation

1. Connect with a wallet that is not staking authority for the configured staking source account.
2. Tap `Unstake SKR` and confirm/sign.
3. Verify notice shows clear message:
   - `Unstake requires staking authority wallet ...`
4. Verify `Raw detail:` line is visible in notice modal.

## Pass criteria

- Stake success path works.
- Unstake success path works for correct authority.
- Wrong-authority path fails with clear message and raw detail.
- Balance updates are visible after each successful transaction.
