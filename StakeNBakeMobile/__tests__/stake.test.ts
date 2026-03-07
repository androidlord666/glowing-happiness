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
    Connection: class {},
    PublicKey,
    Transaction,
    Authorized,
    Lockup,
    StakeProgram,
    LAMPORTS_PER_SOL: 1_000_000_000,
  };
});

import { PublicKey, StakeProgram } from '@solana/web3.js';
import { assertConsolidationLimits, buildConsolidationTransactions } from '../src/lib/stake';

describe('stake consolidation tx builder', () => {
  const owner = new PublicKey(new Uint8Array(32).fill(1));
  const destination = new PublicKey(new Uint8Array(32).fill(2));
  const validatorVote = new PublicKey(new Uint8Array(32).fill(3));
  const sourceA = new PublicKey(new Uint8Array(32).fill(4));
  const sourceB = new PublicKey(new Uint8Array(32).fill(5));

  const connection = {
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: '7f7Tj8hYzUQ5i8xWn9o8uY3qL5Nw8P2bqU9eYp1r2s3',
      lastValidBlockHeight: 123,
    }),
  } as any;

  test('enforces source account limits', () => {
    expect(() => assertConsolidationLimits(0)).toThrow('Select at least one source stake account');
    expect(() => assertConsolidationLimits(100)).toThrow('Maximum 99 source accounts per consolidation');
    expect(() => assertConsolidationLimits(1)).not.toThrow();
    expect(() => assertConsolidationLimits(99)).not.toThrow();
  });

  test('includes delegate tx by default', async () => {
    const txs = await buildConsolidationTransactions({
      connection,
      owner,
      plan: {
        destination,
        sources: [sourceA, sourceB],
        validatorVote,
      },
    });

    expect(txs).toHaveLength(3);
    const firstIx = txs[0].instructions[0];
    expect(firstIx.programId.equals(StakeProgram.programId)).toBe(true);
  });

  test('can skip delegate tx when destination already delegated', async () => {
    const txs = await buildConsolidationTransactions({
      connection,
      owner,
      plan: {
        destination,
        sources: [sourceA, sourceB],
        validatorVote,
        includeDelegateTx: false,
      },
    });

    expect(txs).toHaveLength(2);
    txs.forEach((tx) => {
      expect(tx.instructions[0].programId.equals(StakeProgram.programId)).toBe(true);
    });
  });

  test('supports consolidation batch ramp from 1 to 99 sources', async () => {
    for (let sourceCount = 1; sourceCount <= 99; sourceCount++) {
      const sources = Array.from({ length: sourceCount }, (_, i) => {
        return new PublicKey(new Uint8Array(32).fill((i % 250) + 6));
      });

      const withDelegate = await buildConsolidationTransactions({
        connection,
        owner,
        plan: {
          destination,
          sources,
          validatorVote,
          includeDelegateTx: true,
        },
      });
      expect(withDelegate).toHaveLength(sourceCount + 1);

      const withoutDelegate = await buildConsolidationTransactions({
        connection,
        owner,
        plan: {
          destination,
          sources,
          validatorVote,
          includeDelegateTx: false,
        },
      });
      expect(withoutDelegate).toHaveLength(sourceCount);
    }
  });
});
