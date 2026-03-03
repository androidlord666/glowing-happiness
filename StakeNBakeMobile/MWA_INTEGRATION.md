# Solana Mobile Wallet Adapter Integration (next step)

Current app uses `MockWalletAdapter` (`src/lib/mwa.ts`) so the rest of the app flow can be developed and tested.

To complete production MWA integration:

1. Install Solana Mobile wallet adapter packages per latest Solana Mobile docs:
   - https://docs.solanamobile.com/get-started/react-native/installation
2. Replace `MockWalletAdapter` methods with:
   - authorize/connect
   - reauthorize (if needed)
   - sign and send transactions
   - deauthorize/disconnect
3. Ensure Android intent-filter/deeplink config matches wallet adapter requirements.
4. Test on Solana Mobile device with a supported wallet app.

## Interface target

Implement this interface in `src/lib/mwa.ts`:

```ts
export type WalletAdapter = {
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  signAndSendTransactions(txs: Transaction[]): Promise<string[]>;
};
```

The rest of the app (`App.tsx`) is already wired to this interface.
