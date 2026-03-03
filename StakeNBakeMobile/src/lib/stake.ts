import {
  Connection,
  PublicKey,
  StakeProgram,
  Transaction,
  Authorized,
  Lockup,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

export type ConsolidationPlan = {
  sources: PublicKey[];
  destination: PublicKey;
  validatorVote: PublicKey;
};

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

export function solToLamports(sol: string): number {
  const value = Number(sol);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid SOL amount');
  return Math.round(value * LAMPORTS_PER_SOL);
}

export function assertConsolidationLimits(sourceCount: number): void {
  if (sourceCount < 1) throw new Error('Select at least one source stake account');
  if (sourceCount > 25) throw new Error('Maximum 25 source accounts per consolidation');
}

export async function buildConsolidationTransactions(params: {
  connection: Connection;
  owner: PublicKey;
  plan: ConsolidationPlan;
}): Promise<Transaction[]> {
  const { connection, owner, plan } = params;
  assertConsolidationLimits(plan.sources.length);

  const recent = await connection.getLatestBlockhash('confirmed');
  const txs: Transaction[] = [];

  const delegateTx = new Transaction({
    feePayer: owner,
    blockhash: recent.blockhash,
    lastValidBlockHeight: recent.lastValidBlockHeight,
  }).add(
    StakeProgram.delegate({
      stakePubkey: plan.destination,
      authorizedPubkey: owner,
      votePubkey: plan.validatorVote,
    })
  );

  txs.push(delegateTx);

  for (const source of plan.sources) {
    const t = new Transaction({
      feePayer: owner,
      blockhash: recent.blockhash,
      lastValidBlockHeight: recent.lastValidBlockHeight,
    }).add(
      StakeProgram.merge({
        authorizedPubkey: owner,
        stakePubkey: plan.destination,
        sourceStakePubKey: source,
      })
    );
    txs.push(t);
  }

  return txs;
}

export async function buildCreateAndDelegateStakeTx(params: {
  connection: Connection;
  owner: PublicKey;
  validatorVote: PublicKey;
  solAmount: string;
  seed: string;
}): Promise<{ tx: Transaction; stakeAddress: string }> {
  const { connection, owner, validatorVote, solAmount, seed } = params;
  const lamports = solToLamports(solAmount);
  const stakePubkey = await PublicKey.createWithSeed(owner, seed, StakeProgram.programId);

  const recent = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction({
    feePayer: owner,
    blockhash: recent.blockhash,
    lastValidBlockHeight: recent.lastValidBlockHeight,
  })
    .add(
      StakeProgram.createAccountWithSeed({
        fromPubkey: owner,
        basePubkey: owner,
        seed,
        stakePubkey,
        lamports,
        authorized: new Authorized(owner, owner),
        lockup: new Lockup(0, 0, owner),
      })
    )
    .add(
      StakeProgram.delegate({
        stakePubkey,
        authorizedPubkey: owner,
        votePubkey: validatorVote,
      })
    );

  return { tx, stakeAddress: stakePubkey.toBase58() };
}
