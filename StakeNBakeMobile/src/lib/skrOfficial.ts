import { Buffer } from 'buffer';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { toJSON } from 'seroval';

const SERVER_FN_BASE = 'https://stake.solanamobile.com/_serverFn/';

const HASH_CREATE_STAKE_TX = 'dc813ba819d17751b8eed9bf1bec60ead4815ba05542ea87351f533b88062f28';
const HASH_CREATE_UNSTAKE_TX = '3245bb4ea443c37eadd38a73c78bf55c0bf612f654ee0e7a25a460ab7ff00164';
const HASH_CREATE_WITHDRAW_TX = 'bd247fc68624cb504883b3e55c2e3e9dfbf344a46d2193f695c042e085c28fa4';
const HASH_CREATE_CANCEL_UNSTAKE_TX = '7b794004104c25a8e08a7487a95db0c8e2ee484185f01c087c1a8d6abce5b480';

type DecodedServerFnEnvelope = {
  result?: {
    ok?: boolean;
    error?: string;
    transaction?: string;
    fee?: string;
    cluster?: string;
  };
  error?: unknown;
  context?: unknown;
};

function decodeSerovalNode(node: any): any {
  if (node == null || typeof node !== 'object') return node;
  if (typeof node.t !== 'number') return node;

  switch (node.t) {
    case 1:
      return node.s;
    case 2:
      // TanStack server-fn/seroval boolean encoding used by stake.solanamobile.com.
      if (node.s === 2) return true;
      if (node.s === 1) return false;
      return null;
    case 3:
      return Number(node.s);
    case 6:
      return null;
    case 9:
      return Array.isArray(node.a) ? node.a.map(decodeSerovalNode) : [];
    case 10: {
      const keys = Array.isArray(node.p?.k) ? node.p.k : [];
      const values = Array.isArray(node.p?.v) ? node.p.v : [];
      const out: Record<string, any> = {};
      for (let i = 0; i < keys.length; i += 1) {
        out[String(keys[i])] = decodeSerovalNode(values[i]);
      }
      return out;
    }
    case 11: {
      const keys = Array.isArray(node.p?.k) ? node.p.k : [];
      const values = Array.isArray(node.p?.v) ? node.p.v : [];
      const out: Record<string, any> = {};
      for (let i = 0; i < keys.length; i += 1) {
        out[String(decodeSerovalNode(keys[i]))] = decodeSerovalNode(values[i]);
      }
      return out;
    }
    default:
      return node;
  }
}

async function callServerFn(hash: string, data: Record<string, any>): Promise<DecodedServerFnEnvelope> {
  const body = JSON.stringify(toJSON({ data }));
  const response = await fetch(`${SERVER_FN_BASE}${hash}`, {
    method: 'POST',
    headers: {
      'x-tsr-serverFn': 'true',
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Official SKR API request failed (${response.status})`);
  }

  const raw = await response.json();
  return decodeSerovalNode(raw) as DecodedServerFnEnvelope;
}

function ensureTx(result: DecodedServerFnEnvelope): { transaction: string; fee?: string; cluster?: string } {
  const payload = result?.result;
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Official SKR API returned not-ok response.');
  }
  if (!payload.transaction) {
    throw new Error('Official SKR API did not return a transaction payload.');
  }
  return {
    transaction: payload.transaction,
    fee: payload.fee,
    cluster: payload.cluster,
  };
}

export async function buildOfficialStakeTx(params: {
  naturalTokenAmount: string;
  payer: string;
  user: string;
}): Promise<{ transaction: string; fee?: string; cluster?: string }> {
  return ensureTx(await callServerFn(HASH_CREATE_STAKE_TX, params));
}

export async function buildOfficialUnstakeTx(params: {
  naturalTokenAmount: string;
  user: string;
}): Promise<{ transaction: string; fee?: string; cluster?: string }> {
  return ensureTx(await callServerFn(HASH_CREATE_UNSTAKE_TX, params));
}

export async function buildOfficialWithdrawTx(params: {
  payer: string;
  user: string;
}): Promise<{ transaction: string; fee?: string; cluster?: string }> {
  return ensureTx(await callServerFn(HASH_CREATE_WITHDRAW_TX, params));
}

export async function buildOfficialCancelUnstakeTx(params: {
  user: string;
  guardian: string;
}): Promise<{ transaction: string; fee?: string; cluster?: string }> {
  return ensureTx(await callServerFn(HASH_CREATE_CANCEL_UNSTAKE_TX, params));
}

export function decodeOfficialUnsignedTx(base64Tx: string): Transaction | VersionedTransaction {
  const bytes = Uint8Array.from(Buffer.from(base64Tx, 'base64'));
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(Buffer.from(bytes));
  }
}
