import { Connection, PublicKey } from '@solana/web3.js';

export const RPC_URL = 'https://api.devnet.solana.com';
export const connection = new Connection(RPC_URL, 'confirmed');

export type StakeAccountInfo = {
  pubkey: string;
  lamports: number;
};

function isOwnedBy(wallet: string, parsed: any): boolean {
  const staker = parsed?.info?.meta?.authorized?.staker;
  const withdrawer = parsed?.info?.meta?.authorized?.withdrawer;
  return staker === wallet || withdrawer === wallet;
}

export async function fetchStakeAccounts(owner: string): Promise<StakeAccountInfo[]> {
  const ownerKey = new PublicKey(owner).toBase58();
  const accounts = await connection.getParsedProgramAccounts(
    new PublicKey('Stake11111111111111111111111111111111111111')
  );

  return accounts
    .filter((a: any) => !!a.account?.data?.parsed?.info?.meta?.authorized)
    .filter((a: any) => isOwnedBy(ownerKey, a.account?.data?.parsed))
    .map((a) => ({ pubkey: a.pubkey.toBase58(), lamports: a.account.lamports }));
}
