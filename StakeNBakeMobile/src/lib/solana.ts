import { Connection, PublicKey } from '@solana/web3.js';

export const RPC_URL = 'https://api.devnet.solana.com';
export const connection = new Connection(RPC_URL, 'confirmed');

export type StakeAccountInfo = {
  pubkey: string;
  lamports: number;
};

export async function fetchStakeAccounts(owner: string): Promise<StakeAccountInfo[]> {
  const ownerKey = new PublicKey(owner);
  const accounts = await connection.getParsedProgramAccounts(
    new PublicKey('Stake11111111111111111111111111111111111111'),
    {
      filters: [{ memcmp: { offset: 44, bytes: ownerKey.toBase58() } }]
    }
  );

  return accounts.map((a) => ({ pubkey: a.pubkey.toBase58(), lamports: a.account.lamports }));
}
