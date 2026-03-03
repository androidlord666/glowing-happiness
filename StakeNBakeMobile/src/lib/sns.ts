import { Connection, PublicKey } from '@solana/web3.js';

let snsMod: any;

async function loadSns() {
  if (snsMod) return snsMod;
  try {
    snsMod = require('@bonfida/spl-name-service');
    return snsMod;
  } catch {
    return null;
  }
}

export async function resolveRecipientAddress(input: string, connection: Connection): Promise<string> {
  const v = input.trim();
  if (!v) throw new Error('Recipient required');

  if (!v.endsWith('.sol')) {
    return new PublicKey(v).toBase58();
  }

  const mod = await loadSns();
  if (!mod) throw new Error('SNS resolver not installed. Use wallet pubkey or install @bonfida/spl-name-service');

  const { getDomainKeySync, NameRegistryState } = mod;
  const { pubkey } = getDomainKeySync(v);
  const registry = await NameRegistryState.retrieve(connection, pubkey);

  if (!registry?.registry?.owner) throw new Error(`Unable to resolve ${v}`);
  return new PublicKey(registry.registry.owner).toBase58();
}
