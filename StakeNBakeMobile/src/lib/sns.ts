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

  if (!v.toLowerCase().endsWith('.sol')) {
    return new PublicKey(v).toBase58();
  }

  const mod = await loadSns();
  if (!mod) throw new Error('SNS resolver not installed. Use wallet pubkey or install @bonfida/spl-name-service');

  const { getDomainKeySync, NameRegistryState } = mod;

  try {
    const { pubkey } = getDomainKeySync(v);
    const registry = await NameRegistryState.retrieve(connection, pubkey);

    if (!registry?.registry?.owner) throw new Error('unregistered');
    return new PublicKey(registry.registry.owner).toBase58();
  } catch (e: any) {
    const msg = String(e?.message ?? '').toLowerCase();
    if (msg.includes('unregistered') || msg.includes('not found') || msg.includes('does not exist')) {
      throw new Error(`SNS name not found: ${v}`);
    }
    throw new Error(`SNS resolution failed for ${v}. Check network and try again.`);
  }
}
