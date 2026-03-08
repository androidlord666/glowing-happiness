import { Connection, PublicKey } from '@solana/web3.js';
import { ClusterName, RPC_FALLBACK_URLS, RPC_URLS } from '../config';

const STAKE_PROGRAM_ID = new PublicKey('Stake11111111111111111111111111111111111111');
const AUTH_STAKER_OFFSET = 12;
const AUTH_WITHDRAWER_OFFSET = 44;
const U64_MAX_EPOCH_STR = '18446744073709551615';

export type StakeAccountInfo = {
  pubkey: string;
  lamports: number;
  stakeState?: string;
  delegationVote?: string;
  activationEpoch?: string;
  deactivationEpoch?: string;
  stakeType?: string;
  canStake?: boolean;
  canWithdraw?: boolean;
};

export function createConnection(cluster: ClusterName): Connection {
  return new Connection(RPC_URLS[cluster], 'confirmed');
}

function isDeactivationStarted(epoch?: string): boolean {
  return !!epoch && epoch !== U64_MAX_EPOCH_STR;
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

  const merged = new Map<string, StakeAccountInfo>();
  const candidateEndpoints = endpoints.length ? endpoints : [RPC_URLS['mainnet-beta']];
  const endpointResults = await Promise.allSettled(
    candidateEndpoints.map(async (endpoint) => {
      const conn = endpoint === primaryEndpoint ? connection : new Connection(endpoint, 'confirmed');
      const [asStaker, asWithdrawer] = await Promise.all([
        conn.getParsedProgramAccounts(STAKE_PROGRAM_ID, {
          commitment: 'confirmed',
          filters: [{ memcmp: { offset: AUTH_STAKER_OFFSET, bytes: ownerKey } }],
        }),
        conn.getParsedProgramAccounts(STAKE_PROGRAM_ID, {
          commitment: 'confirmed',
          filters: [{ memcmp: { offset: AUTH_WITHDRAWER_OFFSET, bytes: ownerKey } }],
        }),
      ]);
      return { asStaker, asWithdrawer };
    })
  );

  let lastError: any;
  let sawSuccessfulQuery = false;
  for (const result of endpointResults) {
    if (result.status !== 'fulfilled') {
      lastError = result.reason;
      continue;
    }
    sawSuccessfulQuery = true;
    const { asStaker, asWithdrawer } = result.value;
    for (const a of asStaker) {
      const key = a.pubkey.toBase58();
      const parsed = (a.account.data as any)?.parsed;
      const stakeType = typeof parsed?.type === 'string' ? parsed.type : undefined;
      const delegation = parsed?.info?.stake?.delegation;
      const incoming: StakeAccountInfo = {
        pubkey: key,
        lamports: a.account.lamports,
        delegationVote: delegation?.voter,
        activationEpoch:
          delegation?.activationEpoch !== undefined ? String(delegation.activationEpoch) : undefined,
        deactivationEpoch:
          delegation?.deactivationEpoch !== undefined ? String(delegation.deactivationEpoch) : undefined,
        stakeType,
        canStake: true,
        canWithdraw: false,
      };
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, incoming);
        continue;
      }

      // Keep the freshest known delegation lifecycle flags across endpoints.
      const keepExistingLifecycle =
        isDeactivationStarted(existing.deactivationEpoch) && !isDeactivationStarted(incoming.deactivationEpoch);

      merged.set(key, {
        ...existing,
        // Prefer existing lifecycle fields if they indicate a started cooldown and incoming looks stale.
        activationEpoch: keepExistingLifecycle ? existing.activationEpoch : (incoming.activationEpoch ?? existing.activationEpoch),
        deactivationEpoch: keepExistingLifecycle ? existing.deactivationEpoch : (incoming.deactivationEpoch ?? existing.deactivationEpoch),
        stakeType: keepExistingLifecycle ? existing.stakeType : (incoming.stakeType ?? existing.stakeType),
        delegationVote: keepExistingLifecycle ? existing.delegationVote : (incoming.delegationVote ?? existing.delegationVote),
        // Union capabilities from staker/withdrawer views.
        canStake: (existing.canStake ?? false) || (incoming.canStake ?? false),
        canWithdraw: (existing.canWithdraw ?? false) || (incoming.canWithdraw ?? false),
        // Lamports should reflect latest read if available.
        lamports: incoming.lamports || existing.lamports,
      });
    }

    for (const a of asWithdrawer) {
      const parsed = (a.account.data as any)?.parsed;
      const stakeType = typeof parsed?.type === 'string' ? parsed.type : undefined;
      const delegation = parsed?.info?.stake?.delegation;
      const key = a.pubkey.toBase58();
      const existing = merged.get(key);
      const incoming: StakeAccountInfo = {
        pubkey: key,
        lamports: a.account.lamports,
        delegationVote: delegation?.voter,
        activationEpoch:
          delegation?.activationEpoch !== undefined ? String(delegation.activationEpoch) : undefined,
        deactivationEpoch:
          delegation?.deactivationEpoch !== undefined ? String(delegation.deactivationEpoch) : undefined,
        stakeType,
        canStake: false,
        canWithdraw: true,
      };

      if (!existing) {
        merged.set(key, incoming);
        continue;
      }

      const keepExistingLifecycle =
        isDeactivationStarted(existing.deactivationEpoch) && !isDeactivationStarted(incoming.deactivationEpoch);

      merged.set(key, {
        ...existing,
        activationEpoch: keepExistingLifecycle ? existing.activationEpoch : (incoming.activationEpoch ?? existing.activationEpoch),
        deactivationEpoch: keepExistingLifecycle ? existing.deactivationEpoch : (incoming.deactivationEpoch ?? existing.deactivationEpoch),
        stakeType: keepExistingLifecycle ? existing.stakeType : (incoming.stakeType ?? existing.stakeType),
        delegationVote: keepExistingLifecycle ? existing.delegationVote : (incoming.delegationVote ?? existing.delegationVote),
        canStake: (existing.canStake ?? false) || (incoming.canStake ?? false),
        canWithdraw: (existing.canWithdraw ?? false) || (incoming.canWithdraw ?? false),
        lamports: incoming.lamports || existing.lamports,
      });
    }
  }

  if (merged.size > 0) {
    return [...merged.values()];
  }

  if (sawSuccessfulQuery) {
    return [];
  }

  throw lastError ?? new Error('Failed to fetch stake accounts from all RPC endpoints');
}
