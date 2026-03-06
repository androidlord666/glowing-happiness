import { Connection, PublicKey } from '@solana/web3.js';
import { ClusterName, RPC_FALLBACK_URLS, RPC_URLS } from '../config';

const STAKE_PROGRAM_ID = new PublicKey('Stake11111111111111111111111111111111111111');
const AUTH_STAKER_OFFSET = 12;
const AUTH_WITHDRAWER_OFFSET = 44;

export type StakeAccountInfo = {
  pubkey: string;
  lamports: number;
  stakeState?: string;
};

export function createConnection(cluster: ClusterName): Connection {
  return new Connection(RPC_URLS[cluster], 'confirmed');
}

export async function fetchStakeAccounts(
  connection: Connection,
  owner: string,
  cluster?: ClusterName
): Promise<StakeAccountInfo[]> {
  const ownerKey = new PublicKey(owner).toBase58();
  const primaryEndpoint = (connection as any).rpcEndpoint as string | undefined;
  const fallbacks = cluster ? RPC_FALLBACK_URLS[cluster] ?? [] : [];
  const endpoints = [primaryEndpoint, ...fallbacks].filter(Boolean) as string[];

  let lastError: any;
  for (const endpoint of endpoints.length ? endpoints : [RPC_URLS['mainnet-beta']]) {
    try {
      const conn = endpoint === primaryEndpoint ? connection : new Connection(endpoint, 'confirmed');
      const [asStaker, asWithdrawer] = await Promise.all([
        conn.getProgramAccounts(STAKE_PROGRAM_ID, {
          filters: [{ memcmp: { offset: AUTH_STAKER_OFFSET, bytes: ownerKey } }],
        }),
        conn.getProgramAccounts(STAKE_PROGRAM_ID, {
          filters: [{ memcmp: { offset: AUTH_WITHDRAWER_OFFSET, bytes: ownerKey } }],
        }),
      ]);

      const byPubkey = new Map<string, StakeAccountInfo>();
      for (const a of [...asStaker, ...asWithdrawer]) {
        byPubkey.set(a.pubkey.toBase58(), {
          pubkey: a.pubkey.toBase58(),
          lamports: a.account.lamports,
        });
      }

      return [...byPubkey.values()];
    } catch (e: any) {
      lastError = e;
    }
  }

  throw lastError ?? new Error('Failed to fetch stake accounts from all RPC endpoints');
}
