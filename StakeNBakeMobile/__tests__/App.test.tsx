/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@solana/web3.js', () => {
  const bytesToHex = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  class PublicKey {
    value: string;
    constructor(value: string | Uint8Array) {
      this.value = typeof value === 'string' ? value : bytesToHex(value);
    }
    equals(other: any) {
      return other?.value === this.value;
    }
    toBase58() {
      return this.value;
    }
    static async createWithSeed() {
      return new PublicKey('seeded-public-key');
    }
  }
  class Transaction {
    instructions: any[] = [];
    feePayer: any;
    recentBlockhash?: string;
    lastValidBlockHeight?: number;
    constructor(init?: any) {
      this.feePayer = init?.feePayer;
      this.recentBlockhash = init?.blockhash;
      this.lastValidBlockHeight = init?.lastValidBlockHeight;
    }
    add(ix: any) {
      this.instructions.push(ix);
      return this;
    }
  }
  class VersionedTransaction {}
  class Authorized {
    constructor(_staker: any, _withdrawer: any) {}
  }
  class Lockup {
    constructor(_unixTimestamp: number, _epoch: number, _custodian: any) {}
  }
  const programId = new PublicKey('stake-program');
  const StakeProgram = {
    programId,
    delegate: jest.fn((args: any) => ({ programId, kind: 'delegate', args })),
    merge: jest.fn((args: any) => ({ programId, kind: 'merge', args })),
    createAccountWithSeed: jest.fn((args: any) => ({ programId, kind: 'create', args })),
    deactivate: jest.fn((args: any) => ({ programId, kind: 'deactivate', args })),
    withdraw: jest.fn((args: any) => ({ programId, kind: 'withdraw', args })),
  };
  return {
    PublicKey,
    Transaction,
    VersionedTransaction,
    Authorized,
    Lockup,
    StakeProgram,
    LAMPORTS_PER_SOL: 1_000_000_000,
  };
});

jest.mock('@solana/spl-token', () => ({
  createAssociatedTokenAccountInstruction: jest.fn(),
  createTransferCheckedInstruction: jest.fn(),
  getAssociatedTokenAddressSync: jest.fn(() => 'mock-ata'),
}));

jest.mock('../src/lib/solana', () => ({
  createConnection: jest.fn().mockReturnValue({}),
  fetchStakeAccounts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/lib/stake', () => ({
  buildConsolidationTransactions: jest.fn(),
  buildCreateAndDelegateStakeTx: jest.fn(),
  buildDeactivateStakeTx: jest.fn(),
  buildWithdrawStakeTx: jest.fn(),
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
