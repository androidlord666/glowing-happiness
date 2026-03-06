import { Connection, PublicKey } from '@solana/web3.js';

let snsMod: any;

const SNS_FALLBACK_RPC_URLS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
  'https://solana.publicnode.com',
];

const SNS_HTTP_RESOLVERS = [
  'https://sns-sdk-proxy.bonfida.workers.dev/resolve/',
];

async function loadSns() {
  if (snsMod) return snsMod;
  try {
    snsMod = require('@bonfida/spl-name-service');
    return snsMod;
  } catch {
    return null;
  }
}

async function resolveViaHttpProxy(name: string): Promise<string> {
  let lastErr: any;
  for (const base of SNS_HTTP_RESOLVERS) {
    try {
      const res = await fetch(`${base}${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data: any = await res.json();
      const candidate = data?.result ?? data?.address ?? data?.owner;
      if (!candidate) throw new Error('empty_result');
      return new PublicKey(candidate).toBase58();
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('http_resolve_failed');
}

export async function resolveRecipientAddress(input: string, connection: Connection): Promise<string> {
  const v = input.trim();
  if (!v) throw new Error('Recipient required');

  if (!v.toLowerCase().endsWith('.sol')) {
    return new PublicKey(v).toBase58();
  }

  const mod = await loadSns();
  if (!mod) throw new Error('SNS resolver not installed. Use wallet pubkey or install @bonfida/spl-name-service');

  const { resolve, getDomainKeySync, NameRegistryState } = mod;

  try {
    const clients = [
      connection,
      ...SNS_FALLBACK_RPC_URLS.map((u) => new Connection(u, 'confirmed')),
    ];

    // Preferred SNS SDK path (handles v2 resolver behavior better than raw registry owner reads).
    let lastErr: any;
    if (typeof resolve === 'function') {
      for (const client of clients) {
        try {
          const out = await resolve(client, v);
          const out58 = out?.toBase58 ? out.toBase58() : String(out);
          return new PublicKey(out58).toBase58();
        } catch (err: any) {
          lastErr = err;
        }
      }
    }

    // Fallback: SNS HTTP resolver proxy.
    try {
      const resolved = await resolveViaHttpProxy(v);
      return new PublicKey(resolved).toBase58();
    } catch (err: any) {
      lastErr = err;
    }

    // Fallback: direct registry owner lookup.
    const domain = v.slice(0, -4); // strip `.sol`
    let pubkey: PublicKey;
    try {
      ({ pubkey } = getDomainKeySync(domain));
    } catch {
      ({ pubkey } = getDomainKeySync(v));
    }

    for (const client of clients) {
      try {
        const registry = await NameRegistryState.retrieve(client, pubkey);
        if (!registry?.registry?.owner) throw new Error('unregistered');
        return new PublicKey(registry.registry.owner).toBase58();
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message ?? '').toLowerCase();
        if (msg.includes('unregistered') || msg.includes('not found') || msg.includes('does not exist')) {
          throw err;
        }
      }
    }

    throw lastErr ?? new Error('SNS resolution failed across all resolvers');
  } catch (e: any) {
    const msg = String(e?.message ?? '').toLowerCase();
    if (msg.includes('429') || msg.includes('too many requests')) {
      throw new Error('SNS is temporarily rate-limited. Please wait a few moments and try again 🙏😎');
    }
    if (msg.includes('unregistered') || msg.includes('not found') || msg.includes('does not exist')) {
      throw new Error(`SNS name not found: ${v}`);
    }
    throw new Error(`SNS resolution failed for ${v}. Check network and try again.`);
  }
}
