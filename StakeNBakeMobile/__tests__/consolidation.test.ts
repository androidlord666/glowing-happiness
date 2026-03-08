import {
  buildConsolidationSessionKey,
  describeMergeCompatibility,
  summarizePreflightRows,
} from '../src/lib/consolidation';

describe('consolidation guardrails', () => {
  test('allows delegated accounts with matching vote', () => {
    const verdict = describeMergeCompatibility(
      { stakeState: 'active', stakeType: 'delegated', delegationVote: 'vote-1' } as any,
      { stakeState: 'active', stakeType: 'delegated', delegationVote: 'vote-1' } as any
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('eligible');
  });

  test('blocks deactivating account merges', () => {
    const verdict = describeMergeCompatibility(
      { stakeState: 'active', stakeType: 'delegated', delegationVote: 'vote-1' } as any,
      { stakeState: 'deactivating', stakeType: 'delegated', delegationVote: 'vote-1' } as any
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('deactivating');
  });

  test('blocks vote mismatch', () => {
    const verdict = describeMergeCompatibility(
      { stakeState: 'active', stakeType: 'delegated', delegationVote: 'vote-1' } as any,
      { stakeState: 'active', stakeType: 'delegated', delegationVote: 'vote-2' } as any
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('validator vote mismatch');
  });

  test('builds deterministic idempotency key', () => {
    const keyA = buildConsolidationSessionKey('dest', ['b', 'a', 'c'], 'batch');
    const keyB = buildConsolidationSessionKey('dest', ['c', 'b', 'a'], 'batch');
    const keyC = buildConsolidationSessionKey('dest', ['a', 'b', 'c'], 'sequential');
    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  test('summarizes exclusions by reason', () => {
    const summary = summarizePreflightRows([
      { ok: true, reason: 'eligible' },
      { ok: false, reason: 'validator vote mismatch' },
      { ok: false, reason: 'validator vote mismatch' },
      { ok: false, reason: 'state syncing; refresh first' },
    ]);
    expect(summary).toContain('2 validator vote mismatch');
    expect(summary).toContain('1 state syncing; refresh first');
  });
});
