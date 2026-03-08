import type { StakeAccountInfo } from './solana';

export type ConsolidationSendMode = 'sequential' | 'batch';

export type MergeCompatibilityVerdict = {
  ok: boolean;
  reason: string;
};

function normalizedStakeState(state?: string): string {
  if (!state || state === 'unknown' || state === 'loading') return 'syncing';
  if (state === 'initialized') return 'undelegated';
  return state;
}

function isDelegatedState(state?: string): boolean {
  const s = normalizedStakeState(state);
  return s === 'delegated' || s === 'activating' || s === 'active' || s === 'deactivating';
}

export function describeMergeCompatibility(
  destinationMeta?: Partial<StakeAccountInfo> | null,
  sourceMeta?: Partial<StakeAccountInfo> | null
): MergeCompatibilityVerdict {
  const destState = normalizedStakeState(destinationMeta?.stakeState);
  const sourceState = normalizedStakeState(sourceMeta?.stakeState);
  const destType = String(destinationMeta?.stakeType ?? '').toLowerCase();
  const sourceType = String(sourceMeta?.stakeType ?? '').toLowerCase();
  const destVote = String(destinationMeta?.delegationVote ?? '');
  const sourceVote = String(sourceMeta?.delegationVote ?? '');

  if (!destinationMeta) return { ok: false, reason: 'destination missing' };
  if (!sourceMeta) return { ok: false, reason: 'source missing' };
  if (destState === 'syncing' || sourceState === 'syncing') {
    return { ok: false, reason: 'state syncing; refresh first' };
  }

  const destDelegatedLike = destType === 'delegated' || destType === 'stake' || (!destType && isDelegatedState(destState));
  const sourceDelegatedLike = sourceType === 'delegated' || sourceType === 'stake' || (!sourceType && isDelegatedState(sourceState));
  if (!destDelegatedLike || !sourceDelegatedLike) {
    return { ok: false, reason: 'must both be delegated-like stake accounts' };
  }

  if (destState === 'inactive' || sourceState === 'inactive') {
    if (destState !== 'inactive' || sourceState !== 'inactive') {
      return { ok: false, reason: 'inactive can only merge with inactive' };
    }
  }

  if (destState === 'deactivating' || sourceState === 'deactivating') {
    return { ok: false, reason: 'deactivating is blocked until fully inactive' };
  }

  if (
    (destState === 'activating' && sourceState === 'deactivating') ||
    (destState === 'deactivating' && sourceState === 'activating')
  ) {
    return { ok: false, reason: 'activating/deactivating pair is unstable' };
  }

  if (!destVote || !sourceVote || destVote !== sourceVote) {
    return { ok: false, reason: 'validator vote mismatch' };
  }

  return { ok: true, reason: 'eligible' };
}

export function buildConsolidationSessionKey(
  destination: string,
  eligibleSourceKeys: string[],
  mode: ConsolidationSendMode
): string {
  const sorted = [...eligibleSourceKeys].sort();
  return `${destination}|${sorted.join(',')}|${mode}`;
}

export function summarizePreflightRows(rows: Array<{ ok: boolean; reason: string }>): string {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.ok) continue;
    counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reason}`);
  return parts.length ? parts.join(' · ') : 'No exclusions';
}
