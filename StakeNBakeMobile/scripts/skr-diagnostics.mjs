#!/usr/bin/env node
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

const BASE58_RE = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const DEFAULTS = {
  programId: 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ',
  guardian: 'SKRGdBwzb1AtFW2chhBnZpGFnFLj6Mi7HM7iwjXALvw',
  mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
  stakeVault: '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8',
  cooldownSeconds: 172800,
};

function parseArgs(argv) {
  const out = {
    wallet: '',
    rpc: process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'),
    limit: 40,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if ((a === '--wallet' || a === '-w') && v) {
      out.wallet = v;
      i += 1;
      continue;
    }
    if ((a === '--rpc' || a === '-r') && v) {
      out.rpc = v;
      i += 1;
      continue;
    }
    if ((a === '--limit' || a === '-l') && v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.limit = Math.min(200, Math.floor(n));
      i += 1;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log('SKR staking diagnostics (official Solana Mobile config + chain checks)');
  console.log('');
  console.log('Usage:');
  console.log('  npm run skr:diag -- --wallet <PUBKEY> [--rpc <URL>] [--limit <N>]');
  console.log('');
  console.log('Options:');
  console.log('  --wallet, -w  Wallet pubkey to analyze for SKR stake/unstake activity');
  console.log('  --rpc, -r     RPC endpoint (default: mainnet-beta)');
  console.log('  --limit, -l   Max wallet signatures to inspect (default: 40, max: 200)');
}

function extractString(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}":"(${BASE58_RE})"`);
  const m = body.match(re);
  return m?.[1] ?? '';
}

function extractNumber(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}":(\\d+)`);
  const m = body.match(re);
  return m ? Number(m[1]) : Number.NaN;
}

async function fetchOfficialConfig() {
  const res = await fetch('https://stake.solanamobile.com', {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch official stake site config (HTTP ${res.status})`);
  }
  const body = await res.text();
  const config = {
    programId: extractString(body, 'programId') || DEFAULTS.programId,
    guardian: extractString(body, 'guardian') || DEFAULTS.guardian,
    mint: extractString(body, 'mint') || DEFAULTS.mint,
    stakeVault: extractString(body, 'stakeVault') || DEFAULTS.stakeVault,
    cooldownSeconds: Number.isFinite(extractNumber(body, 'cooldownSeconds'))
      ? extractNumber(body, 'cooldownSeconds')
      : DEFAULTS.cooldownSeconds,
  };
  return config;
}

function parseTokenRawAmount(accountInfo) {
  const amount = accountInfo?.value?.data?.parsed?.info?.tokenAmount?.amount;
  return typeof amount === 'string' ? amount : '0';
}

function formatToken(raw, decimals) {
  const v = BigInt(raw || '0');
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole.toString()}.${frac.slice(0, 6)}` : whole.toString();
}

async function findWalletActivity(connection, wallet, programId, limit) {
  const signatures = await connection.getSignaturesForAddress(wallet, { limit }, 'confirmed');
  const signatureList = signatures.map((s) => s.signature);
  if (!signatureList.length) return [];
  const txs = new Array(signatureList.length).fill(null);
  const chunkSize = 10;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < signatureList.length; i += chunkSize) {
    const chunk = signatureList.slice(i, i + chunkSize);
    let parsed = null;
    let attempt = 0;
    let delayMs = 250;
    while (!parsed && attempt < 5) {
      try {
        parsed = await connection.getParsedTransactions(chunk, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
      } catch (e) {
        const msg = String(e?.message || e || '');
        if (!msg.includes('429')) throw e;
        await wait(delayMs);
        delayMs *= 2;
        attempt += 1;
      }
    }
    if (!parsed) {
      continue;
    }
    for (let j = 0; j < parsed.length; j += 1) {
      txs[i + j] = parsed[j];
    }
    await wait(120);
  }
  const events = [];

  for (let i = 0; i < signatures.length; i += 1) {
    const sigInfo = signatures[i];
    const tx = txs[i];
    if (!tx?.meta || !tx?.transaction) continue;
    const keys = tx.transaction.message.accountKeys || [];
    const programTouched = keys.some((k) => {
      const key = k?.pubkey ? k.pubkey : k;
      return key && new PublicKey(key).equals(programId);
    });
    if (!programTouched) continue;

    const logs = tx.meta.logMessages || [];
    let kind = '';
    for (const line of logs) {
      if (line.includes('Instruction: Stake')) {
        kind = 'Stake';
        break;
      }
      if (line.includes('Instruction: Unstake')) {
        kind = 'Unstake';
        break;
      }
      if (line.includes('Instruction: Withdraw')) {
        kind = 'Withdraw';
        break;
      }
      if (line.includes('Instruction: CancelUnstake') || line.includes('Instruction: Cancel Unstake')) {
        kind = 'CancelUnstake';
        break;
      }
    }

    events.push({
      signature: sigInfo.signature,
      slot: sigInfo.slot,
      blockTime: tx.blockTime || null,
      kind: kind || 'ProgramInteraction',
      err: tx.meta.err,
    });
  }

  return events;
}

function summarizeCooldown(events, cooldownSeconds) {
  const successful = events.filter((e) => !e.err && e.blockTime);
  const unstake = successful.filter((e) => e.kind === 'Unstake').sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
  const withdraw = successful.filter((e) => e.kind === 'Withdraw').sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
  const cancel = successful.filter((e) => e.kind === 'CancelUnstake').sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

  const lastUnstake = unstake[0]?.blockTime || 0;
  const clearTs = Math.max(withdraw[0]?.blockTime || 0, cancel[0]?.blockTime || 0);
  if (!lastUnstake || clearTs >= lastUnstake) {
    return {
      hasPendingCooldown: false,
      unlockAt: 0,
      remainingSec: 0,
      note: 'No pending cooldown inferred from recent wallet history.',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const unlockAt = lastUnstake + cooldownSeconds;
  const remainingSec = Math.max(0, unlockAt - now);
  return {
    hasPendingCooldown: true,
    unlockAt,
    remainingSec,
    note: 'Cooldown inferred from latest successful unstake without newer withdraw/cancel.',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await fetchOfficialConfig();
  const connection = new Connection(args.rpc, 'confirmed');

  const programPk = new PublicKey(config.programId);
  const mintPk = new PublicKey(config.mint);
  const vaultPk = new PublicKey(config.stakeVault);

  const [programInfo, mintInfo, vaultInfo] = await Promise.all([
    connection.getAccountInfo(programPk, 'confirmed'),
    connection.getParsedAccountInfo(mintPk, 'confirmed'),
    connection.getParsedAccountInfo(vaultPk, 'confirmed'),
  ]);

  const decimals = Number(mintInfo?.value?.data?.parsed?.info?.decimals ?? 6);
  const vaultRaw = parseTokenRawAmount(vaultInfo);

  const report = {
    checkedAtIso: new Date().toISOString(),
    rpc: args.rpc,
    officialConfig: config,
    onchain: {
      programExists: !!programInfo,
      programExecutable: !!programInfo?.executable,
      programOwner: programInfo?.owner?.toBase58() || '',
      mintDecimals: decimals,
      stakeVaultMint: vaultInfo?.value?.data?.parsed?.info?.mint || '',
      stakeVaultOwner: vaultInfo?.value?.data?.parsed?.info?.owner || '',
      stakeVaultBalanceRaw: vaultRaw,
      stakeVaultBalanceUi: formatToken(vaultRaw, decimals),
    },
  };

  if (args.wallet) {
    const walletPk = new PublicKey(args.wallet);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPk,
      { mint: mintPk },
      'confirmed'
    );

    let walletRaw = 0n;
    for (const account of tokenAccounts.value) {
      const raw = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (typeof raw === 'string') walletRaw += BigInt(raw);
    }

    let events = [];
    let walletDiagError = '';
    try {
      events = await findWalletActivity(connection, walletPk, programPk, args.limit);
    } catch (e) {
      walletDiagError = String(e?.message || e || 'wallet activity check failed');
    }
    const cooldown = summarizeCooldown(events, config.cooldownSeconds);

    report.wallet = {
      address: walletPk.toBase58(),
      liquidSkrRaw: walletRaw.toString(),
      liquidSkrUi: formatToken(walletRaw.toString(), decimals),
      analyzedSignatures: args.limit,
      foundProgramEvents: events.length,
      recentEvents: events.slice(0, 12),
      cooldownInference: cooldown,
      notes: [
        'Exact staked amount is program-account-layout dependent and is not decoded here.',
        'Cooldown status is inferred from recent wallet transactions and may miss older events if limit is too small.',
        walletDiagError ? `Wallet activity check degraded due to RPC limits/error: ${walletDiagError}` : '',
      ],
    };
    report.wallet.notes = report.wallet.notes.filter(Boolean);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[skr:diag] failed:', err?.message || err);
  process.exit(1);
});
