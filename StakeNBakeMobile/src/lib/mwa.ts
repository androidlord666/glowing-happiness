import { PublicKey, Transaction } from '@solana/web3.js';

export type WalletSession = {
  address: string;
};

export type WalletAdapter = {
  connect(): Promise<WalletSession>;
  disconnect(): Promise<void>;
  signAndSendTransactions(txs: Transaction[]): Promise<string[]>;
};

/**
 * Placeholder adapter for local/dev scaffolding.
 * Replace this with Solana Mobile Wallet Adapter authorization flow.
 */
export class MockWalletAdapter implements WalletAdapter {
  private address: string | null = null;

  async connect(): Promise<WalletSession> {
    this.address = '11111111111111111111111111111111';
    return { address: this.address };
  }

  async disconnect(): Promise<void> {
    this.address = null;
  }

  async signAndSendTransactions(_txs: Transaction[]): Promise<string[]> {
    if (!this.address) throw new Error('Wallet not connected');
    return ['mock-signature'];
  }
}

export function asPublicKey(address: string): PublicKey {
  return new PublicKey(address);
}
