import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

export async function buildTransferTx(params: {
  connection: Connection;
  from: PublicKey;
  to: PublicKey;
  lamports: number;
}): Promise<Transaction> {
  const { connection, from, to, lamports } = params;
  const recent = await connection.getLatestBlockhash('confirmed');

  return new Transaction({
    feePayer: from,
    blockhash: recent.blockhash,
    lastValidBlockHeight: recent.lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports,
    })
  );
}
