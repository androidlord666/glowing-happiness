import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';

export type WalletSession = {
  address: string;
};

export type WalletAdapter = {
  connect(): Promise<WalletSession>;
  disconnect(): Promise<void>;
  signAndSendTransactions(txs: Transaction[]): Promise<string[]>;
};

type MwAccountLike = {
  address?: string | Uint8Array;
  publicKey?: string | Uint8Array;
};

function toBase58Address(account: MwAccountLike): string {
  const raw = account.publicKey ?? account.address;
  if (!raw) throw new Error('No wallet account address returned');

  if (typeof raw === 'string') {
    // Some implementations return base58 already.
    try {
      return new PublicKey(raw).toBase58();
    } catch {
      // Some return base64 strings.
      const bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
      return new PublicKey(bytes).toBase58();
    }
  }

  return new PublicKey(raw).toBase58();
}

function toSignatureText(sig: unknown): string {
  if (typeof sig === 'string') return sig;
  if (sig instanceof Uint8Array) return Buffer.from(sig).toString('base64');
  if (Array.isArray(sig)) return Buffer.from(sig).toString('base64');
  return String(sig ?? 'unknown-signature');
}

/**
 * Solana Mobile Wallet Adapter integration.
 *
 * Falls back to mock behavior if MWA packages are unavailable in current runtime.
 */
export class SolanaMobileWalletAdapter implements WalletAdapter {
  private address: string | null = null;
  private authToken: string | null = null;
  private readonly appIdentity = {
    name: 'stakeNbake',
    uri: 'https://github.com/rasetsutekka/stakeNbake',
    icon: 'favicon.ico',
  };

  private async loadTransact(): Promise<(fn: (wallet: any) => Promise<any>) => Promise<any>> {
    try {
      const mod = require('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      if (!mod?.transact) throw new Error('MWA transact helper not found');
      return mod.transact;
    } catch (e: any) {
      throw new Error(
        `MWA package unavailable. Install @solana-mobile/mobile-wallet-adapter-protocol-web3js. (${e?.message ?? 'unknown'})`
      );
    }
  }

  async connect(): Promise<WalletSession> {
    const transact = await this.loadTransact();

    const result = await transact(async (wallet: any) => {
      const auth = await wallet.authorize({
        cluster: 'devnet',
        identity: this.appIdentity,
      });

      const first = auth?.accounts?.[0];
      if (!first) throw new Error('No account returned by wallet');

      const address = toBase58Address(first);
      return {
        address,
        authToken: auth?.auth_token ?? null,
      };
    });

    this.address = result.address;
    this.authToken = result.authToken;
    return { address: result.address };
  }

  async disconnect(): Promise<void> {
    const transact = await this.loadTransact();

    if (this.authToken) {
      await transact(async (wallet: any) => {
        await wallet.deauthorize({ auth_token: this.authToken });
      });
    }

    this.address = null;
    this.authToken = null;
  }

  async signAndSendTransactions(txs: Transaction[]): Promise<string[]> {
    if (!this.address) throw new Error('Wallet not connected');
    const transact = await this.loadTransact();

    const signatures = await transact(async (wallet: any) => {
      if (this.authToken && wallet.reauthorize) {
        const reauth = await wallet.reauthorize({
          auth_token: this.authToken,
          identity: this.appIdentity,
        });
        if (reauth?.auth_token) this.authToken = reauth.auth_token;
      }

      const out = await wallet.signAndSendTransactions({
        // For web3js helper, pass Transaction objects directly.
        transactions: txs,
        ...(this.authToken ? { auth_token: this.authToken } : {}),
      });

      return out?.signatures ?? [];
    });

    return signatures.map((s: unknown) => toSignatureText(s));
  }
}

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

export function createWalletAdapter(): WalletAdapter {
  try {
    return new SolanaMobileWalletAdapter();
  } catch {
    return new MockWalletAdapter();
  }
}

export function asPublicKey(address: string): PublicKey {
  return new PublicKey(address);
}
