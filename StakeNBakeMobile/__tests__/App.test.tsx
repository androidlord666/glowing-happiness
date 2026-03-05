/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@solana/web3.js', () => ({
  LAMPORTS_PER_SOL: 1_000_000_000,
}));

jest.mock('../src/lib/solana', () => ({
  createConnection: jest.fn().mockReturnValue({}),
  fetchStakeAccounts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/lib/stake', () => ({
  buildConsolidationTransactions: jest.fn(),
  buildCreateAndDelegateStakeTx: jest.fn(),
  buildDeactivateStakeTx: jest.fn(),
}));

jest.mock('../src/lib/mwa', () => ({
  asPublicKey: (v: string) => v,
  createWalletAdapter: () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    signAndSendTransactions: jest.fn(),
  }),
}));

jest.mock('../src/lib/walletActions', () => ({
  buildTransferTx: jest.fn(),
}));

jest.mock('../src/lib/sns', () => ({
  resolveRecipientAddress: jest.fn().mockResolvedValue('11111111111111111111111111111111'),
}));

import App from '../App';

test('renders correctly', async () => {
  jest.useFakeTimers();

  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    jest.runOnlyPendingTimers();
  });

  await ReactTestRenderer.act(async () => {
    tree!.unmount();
  });

  jest.useRealTimers();
});
