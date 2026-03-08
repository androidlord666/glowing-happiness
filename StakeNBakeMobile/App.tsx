import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import {
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Animated,
  Easing,
  Image,
  FlatList,
  AppState,
  RefreshControl,
  Share,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { LAMPORTS_PER_SOL, StakeProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ActionButton } from './src/components/ActionButton';
import { createConnection, fetchStakeAccounts, StakeAccountInfo } from './src/lib/solana';
import {
  buildConsolidationTransactions,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
  buildWithdrawStakeTx,
} from './src/lib/stake';
import { asPublicKey, createWalletAdapter } from './src/lib/mwa';
import { colors } from './src/theme/colors';
import { APP_NAME, ClusterName, DEFAULT_CLUSTER, DEFAULT_EXPLORER, ExplorerName, VALIDATOR_VOTE_BY_CLUSTER } from './src/config';
import { addressUrl, txUrl } from './src/lib/explorer';
import { buildTransferTx } from './src/lib/walletActions';
import { resolveRecipientAddress } from './src/lib/sns';
import {
  buildConsolidationSessionKey,
  ConsolidationSendMode,
  describeMergeCompatibility,
  summarizePreflightRows,
} from './src/lib/consolidation';

const walletAdapter = createWalletAdapter();
const solanaMobileWhiteLogo = require('./src/assets/solana-mobile-white.png');
const solanaMobileBlackLogo = require('./src/assets/solana-mobile-black.png');

type Mode = 'stake' | 'send' | 'receive' | 'swap';
type Screen = 'splash' | 'landing' | 'app';
type ThemeMode = 'dark' | 'light';
type RpcHealth = 'healthy' | 'degraded';
type SourceFilter = 'all' | 'high' | 'low';
type TxLifecycleStage = 'prepared' | 'sign_requested' | 'submitted' | 'confirmed' | 'failed';
type ConsolidationBatchChunkSize = 2 | 3 | 4;

type TxLifecycleEvent = {
  at: string;
  stage: TxLifecycleStage;
  label: string;
  sig?: string;
  sessionKey?: string;
  note?: string;
};

const APP_VERSION_LABEL = 'v2.43 (code 54)';
const MAX_SOURCE_ACCOUNTS = 99;

// Feature flags (fast emergency toggles)
const FEATURE_FEE_ENABLED = true;
const FEATURE_WITHDRAW_ENABLED = true;

const PLATFORM_FEE_WALLET = 'FeYxe8Up4bCpXtF168avXtCUKk18gsAh4Z6zz1QAZNnr';
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const SKR_FALLBACK_DECIMALS = 6;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_API_KEY = 'dbb47dbc-a5f8-44f6-ae14-291942c1723d';
const PLATFORM_FEE_PER_SOURCE_SKR = 10;
const PLATFORM_FEE_CAP_SKR = 100;
// Solana Mobile Wallet Adapter payload limits vary by wallet/runtime.
// Keep batch requests small for high reliability; 99-source runs are still supported via chunking.
const DEFAULT_BATCH_TX_PER_REQUEST: ConsolidationBatchChunkSize = 3;
const CONSOLIDATION_IDEMPOTENCY_WINDOW_MS = 2 * 60 * 1000;
const TX_LIFECYCLE_STORAGE_KEY = '@stakeNbake:txLifecycleEvents:v1';

function shortAddr(v: string) {
  if (!v) return '';
  return `${v.slice(0, 6)}...${v.slice(-6)}`;
}

function classifyError(e: any): 'user' | 'rpc' | 'wallet' | 'chain' | 'unknown' {
  const raw = String(e?.message ?? e ?? '').toLowerCase();
  if (raw.includes('cancel') || raw.includes('declin') || raw.includes('rejected') || raw.includes('user denied') || raw.includes('user aborted')) {
    return 'user';
  }
  if (raw.includes('429') || raw.includes('too many requests') || raw.includes('timeout') || raw.includes('network')) {
    return 'rpc';
  }
  if (raw.includes('wallet') || raw.includes('auth') || raw.includes('sign')) {
    return 'wallet';
  }
  if (raw.includes('insufficient') || raw.includes('invalid') || raw.includes('inactive') || raw.includes('stake account')) {
    return 'chain';
  }
  return 'unknown';
}

function normalizeErrorMessage(e: any): string {
  const raw = String(e?.message ?? e ?? 'unknown error');
  const kind = classifyError(e);
  if (kind === 'user') return 'Transaction cancelled by user.';
  if (kind === 'rpc') return 'please wait, rpc 😎🙏';
  if (kind === 'wallet') return `Wallet issue: ${raw}`;
  if (kind === 'chain') return `Chain/state issue: ${raw}`;
  return raw;
}

function actionError(prefix: string, e: any): string {
  return `${prefix}: ${normalizeErrorMessage(e)}`;
}

function presentStakeState(state?: string): string {
  if (!state || state === 'unknown' || state === 'loading') return 'syncing';
  if (state === 'initialized') return 'undelegated';
  return state;
}

function displayStakeState(state?: string): string {
  const s = presentStakeState(state);
  if (s === 'undelegated') return 'Inactive (withdraw-ready)';
  if (s === 'active') return 'Active';
  if (s === 'activating') return 'Activating (can unstake)';
  if (s === 'deactivating') return 'Deactivating (wait epoch)';
  if (s === 'inactive') return 'Inactive (withdraw-ready)';
  if (s === 'delegated') return 'Delegated';
  if (s === 'syncing') return 'Syncing';
  return s;
}

function isInactiveState(state?: string): boolean {
  const s = presentStakeState(state);
  return s === 'inactive' || s === 'undelegated';
}

function isDelegatedState(state?: string): boolean {
  const s = presentStakeState(state);
  return s === 'delegated' || s === 'activating' || s === 'active' || s === 'deactivating';
}

function isWithdrawReadyState(state?: string): boolean {
  const s = presentStakeState(state);
  return s === 'undelegated' || s === 'inactive';
}

function hasWithdrawableLamports(lamports?: number): boolean {
  return Number(lamports ?? 0) > 0;
}

function isMergeStateCompatible(destinationMeta?: StakeParsedMeta | StakeAccountInfo | null, sourceMeta?: StakeParsedMeta | StakeAccountInfo | null): boolean {
  return describeMergeCompatibility(destinationMeta as any, sourceMeta as any).ok;
}

function formatRawAmount(raw: string | number, decimals: number, maxFrac = 6): string {
  const n = typeof raw === 'number' ? BigInt(Math.floor(raw)) : BigInt(raw || '0');
  const base = BigInt(10) ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  if (decimals <= 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, Math.max(0, maxFrac));
  return `${whole.toString()}.${fracStr}`.replace(/\.0+$/, '').replace(/\.$/, '');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function withRetries<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 450): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (attempt >= retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise<void>((resolve) => setTimeout(() => resolve(), delay));
    }
  }
  throw lastError;
}

type StakeParsedMeta = {
  delegationVote?: string;
  delegationState?: string;
  stakeType?: string;
};

const U64_MAX_EPOCH = BigInt('18446744073709551615');

function parseEpoch(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function deriveDelegationStateFromInfo(info: StakeAccountInfo, currentEpoch?: bigint): string | undefined {
  const baseType = String(info.stakeType ?? '').toLowerCase();
  if (!baseType) return undefined;
  if (baseType === 'initialized' || baseType === 'uninitialized') return 'undelegated';
  if (baseType !== 'delegated' && baseType !== 'stake') return baseType;

  if (currentEpoch === undefined) return 'delegated';

  const activationEpoch = parseEpoch(info.activationEpoch);
  const deactivationEpoch = parseEpoch(info.deactivationEpoch);
  if (activationEpoch === null || deactivationEpoch === null) return 'delegated';

  if (deactivationEpoch !== U64_MAX_EPOCH) {
    // If stake was deactivated in the same epoch it was activated, it can be
    // effectively inactive/withdrawable immediately.
    if (activationEpoch === deactivationEpoch) return 'inactive';
    // deactivationEpoch is when cooldown starts; it is reliably inactive after that epoch.
    if (currentEpoch > deactivationEpoch) return 'inactive';
    return 'deactivating';
  }
  if (currentEpoch <= activationEpoch) return 'activating';
  return 'active';
}

async function hydrateStakeStatesFromChain(
  connection: ReturnType<typeof createConnection>,
  accounts: StakeAccountInfo[]
): Promise<StakeAccountInfo[]> {
  if (!accounts.length) return accounts;
  const chunks = chunkArray(accounts, 8);
  const byPubkey = new Map<string, string>();

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (account) => {
        try {
          const activation = await connection.getStakeActivation(asPublicKey(account.pubkey), 'confirmed');
          if (activation?.state) {
            byPubkey.set(account.pubkey, activation.state);
          }
        } catch {
          // Keep parsed fallback if stake activation lookup fails.
        }
      })
    );
  }

  return accounts.map((account) => {
    const stakeType = String(account.stakeType ?? '').toLowerCase();
    if (stakeType === 'initialized' || stakeType === 'uninitialized') {
      return { ...account, stakeState: 'undelegated' };
    }
    const chainState = byPubkey.get(account.pubkey);
    return chainState ? { ...account, stakeState: chainState } : account;
  });
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [splashPhase, setSplashPhase] = useState<0 | 1>(0);
  const [wallet, setWallet] = useState<string>('');
  const [mode, setMode] = useState<Mode>('stake');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [cluster, _setCluster] = useState<ClusterName>(DEFAULT_CLUSTER);
  const [explorer, setExplorer] = useState<ExplorerName>(DEFAULT_EXPLORER);
  const [showSettings, setShowSettings] = useState(false);
  const [showExplorerOptions, setShowExplorerOptions] = useState(false);
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [destination, setDestination] = useState<string>('');
  const [createStakeSol, setCreateStakeSol] = useState('0.1');
  const [sendTo, setSendTo] = useState('');
  const [sendSol, setSendSol] = useState('0.01');
  const [swapAmount, setSwapAmount] = useState('0.1');
  const [swapDir, setSwapDir] = useState<'SOL_TO_SKR' | 'SKR_TO_SOL'>('SOL_TO_SKR');
  const [swapSlippageBps, setSwapSlippageBps] = useState(100);
  const [swapQuoteText, setSwapQuoteText] = useState('');
  const [swapQuote, setSwapQuote] = useState<any>(null);
  const [swapQuoteAtMs, setSwapQuoteAtMs] = useState<number>(0);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapRouteText, setSwapRouteText] = useState('');
  const [swapImpactPct, setSwapImpactPct] = useState<number>(0);
  const [swapMinReceivedText, setSwapMinReceivedText] = useState('');
  const [swapStale, setSwapStale] = useState(false);
  const [skrDecimals, setSkrDecimals] = useState(SKR_FALLBACK_DECIMALS);
  const [snsPreview, setSnsPreview] = useState('');
  const [snsPreviewBusy, setSnsPreviewBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [lastSignature, setLastSignature] = useState('');
  const [txHistory, setTxHistory] = useState<string[]>([]);
  const [pendingTxs, setPendingTxs] = useState<Array<{ sig: string; label: string }>>([]);
  const [txLifecycleEvents, setTxLifecycleEvents] = useState<TxLifecycleEvent[]>([]);
  const [walletSolBalance, setWalletSolBalance] = useState<string>('—');
  const [walletSkrBalance, setWalletSkrBalance] = useState<string>('—');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [rpcHealth, setRpcHealth] = useState<RpcHealth>('healthy');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [confirmConsolidate, setConfirmConsolidate] = useState(false);
  const [showFeePolicy, setShowFeePolicy] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const suppressNextStatusModalRef = useRef(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [isAppActive, setIsAppActive] = useState(true);
  const [consolidationSendMode, setConsolidationSendMode] = useState<ConsolidationSendMode>('batch');
  const [batchTxChunkSize, setBatchTxChunkSize] = useState<ConsolidationBatchChunkSize>(DEFAULT_BATCH_TX_PER_REQUEST);
  const modeFade = useState(new Animated.Value(1))[0];
  const landingFade = useState(new Animated.Value(0))[0];
  const pullShift = useRef(new Animated.Value(0)).current;
  const lastStakeAccountsRef = useRef<StakeAccountInfo[]>([]);
  const lastRefreshAtRef = useRef(0);
  const refreshInProgressRef = useRef(false);
  const refreshMetricsRef = useRef({ count: 0, totalMs: 0 });
  const consolidationInFlightRef = useRef(false);
  const consolidationIdempotencyRef = useRef<Record<string, number>>({});

  const palette = theme === 'dark'
    ? colors
    : {
      ...colors,
      bg: '#EFFFFB',
      panel: '#DDF7F1',
      text: '#072225',
      muted: '#3C7F80',
      border: '#8ADFD3',
    };

  const explorerLabel = explorer === 'orbmarkets' ? 'OrbMarkets.io' : explorer === 'solscan' ? 'Solscan.io' : 'Explorer.Solana.com';

  const connection = useMemo(() => createConnection(cluster), [cluster]);

  useEffect(() => {
    const t1 = setTimeout(() => setSplashPhase(1), 1500);
    const t2 = setTimeout(() => setScreen('landing'), 3200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    setStatus('');
    modeFade.setValue(0.92);
    Animated.timing(modeFade, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mode, modeFade]);

  useEffect(() => {
    if (screen !== 'landing') return;
    landingFade.setValue(0);
    Animated.timing(landingFade, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [screen, landingFade]);

  useEffect(() => {
    if (!isAppActive) return;
    const candidate = sendTo.trim();
    if (!candidate.toLowerCase().endsWith('.sol')) {
      setSnsPreview('');
      setSnsPreviewBusy(false);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setSnsPreviewBusy(true);
        const resolved = await resolveRecipientAddress(candidate, connection);
        if (!cancelled) setSnsPreview(resolved);
      } catch {
        if (!cancelled) setSnsPreview('');
      } finally {
        if (!cancelled) setSnsPreviewBusy(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sendTo, connection, isAppActive]);

  useEffect(() => {
    if (!destination) return;
    if (!selected[destination]) return;
    setSelected((prev) => ({ ...prev, [destination]: false }));
  }, [destination, selected]);

  useEffect(() => {
    setSwapQuote(null);
    setSwapQuoteAtMs(0);
    setSwapQuoteText('');
    setSwapRouteText('');
    setSwapMinReceivedText('');
    setSwapImpactPct(0);
    setSwapStale(false);
  }, [swapDir, swapAmount, swapSlippageBps]);

  useEffect(() => {
    if (mode !== 'swap' || !isAppActive || !swapQuoteAtMs) return;
    const tick = setInterval(() => {
      const age = Date.now() - swapQuoteAtMs;
      setSwapStale(age > 12000);
    }, 1000);
    return () => clearInterval(tick);
  }, [mode, isAppActive, swapQuoteAtMs]);



  useEffect(() => {
    const loadMintDecimals = async () => {
      try {
        const info = await connection.getParsedAccountInfo(asPublicKey(SKR_MINT), 'confirmed');
        const d = Number((info.value?.data as any)?.parsed?.info?.decimals ?? SKR_FALLBACK_DECIMALS);
        if (Number.isFinite(d)) setSkrDecimals(d);
        else setSkrDecimals(SKR_FALLBACK_DECIMALS);
      } catch {
        setSkrDecimals(SKR_FALLBACK_DECIMALS);
      }
    };
    loadMintDecimals();
  }, [connection]);

  useEffect(() => {
    if (!status) return;
    if (suppressNextStatusModalRef.current) {
      suppressNextStatusModalRef.current = false;
      return;
    }
    const s = status.toLowerCase();
    if (s.includes('error') || s.includes('failed') || s.includes('issue')) {
      setShowStatusModal(true);
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const loadLifecycleEvents = async () => {
      try {
        const raw = await AsyncStorage.getItem(TX_LIFECYCLE_STORAGE_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        setTxLifecycleEvents(
          parsed
            .filter((row: any) => row && typeof row.stage === 'string' && typeof row.label === 'string')
            .slice(0, 100)
        );
      } catch {
        // ignore persisted-state parse issues
      }
    };
    loadLifecycleEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(TX_LIFECYCLE_STORAGE_KEY, JSON.stringify(txLifecycleEvents)).catch(() => {
      // ignore storage failures
    });
  }, [txLifecycleEvents]);

  const delegatedAccounts = useMemo(
    () => stakeAccounts.filter((a) => isDelegatedState(a.stakeState)),
    [stakeAccounts]
  );
  const undelegatedAccounts = useMemo(
    () => stakeAccounts.filter((a) => !isDelegatedState(a.stakeState)),
    [stakeAccounts]
  );
  const destinationOrderedAccounts = useMemo(
    () => [...undelegatedAccounts, ...delegatedAccounts],
    [undelegatedAccounts, delegatedAccounts]
  );

  const sourceStakeAccounts = useMemo(() => {
    const raw = stakeAccounts.filter((a) => a.pubkey !== destination);
    const delegated = raw.filter((a) => isDelegatedState(a.stakeState));
    const undelegated = raw.filter((a) => !isDelegatedState(a.stakeState));
    return [...delegated, ...undelegated];
  }, [stakeAccounts, destination]);

  const filteredSourceStakeAccounts = useMemo(() => {
    const items = [...sourceStakeAccounts];
    if (sourceFilter === 'high') {
      items.sort((a, b) => b.lamports - a.lamports);
    } else if (sourceFilter === 'low') {
      items.sort((a, b) => a.lamports - b.lamports);
    }
    return items;
  }, [sourceStakeAccounts, sourceFilter]);

  const sourceSelectedKeys = useMemo(() => {
    const currentSources = new Set(sourceStakeAccounts.map((a) => a.pubkey));
    return Object.keys(selected).filter((k) => selected[k] && currentSources.has(k));
  }, [selected, sourceStakeAccounts]);

  const selectedCount = sourceSelectedKeys.length;
  const destinationAccountMeta = useMemo(
    () => stakeAccounts.find((a) => a.pubkey === destination) ?? null,
    [stakeAccounts, destination]
  );
  const selectedCompatibility = useMemo(() => {
    const sourceMap = new Map(sourceStakeAccounts.map((a) => [a.pubkey, a] as const));
    return sourceSelectedKeys.map((k) => {
      const src = sourceMap.get(k);
      const verdict = describeMergeCompatibility(destinationAccountMeta, src);
      return { pubkey: k, ok: verdict.ok, reason: verdict.reason };
    });
  }, [sourceSelectedKeys, sourceStakeAccounts, destinationAccountMeta]);
  const compatibleSelectedCount = useMemo(() => {
    return selectedCompatibility.filter((it) => it.ok).length;
  }, [selectedCompatibility]);
  const selectedIncompatibleCount = selectedCompatibility.length - compatibleSelectedCount;
  const preflightSummary = useMemo(() => {
    return summarizePreflightRows(selectedCompatibility);
  }, [selectedCompatibility]);
  const validatorVote = VALIDATOR_VOTE_BY_CLUSTER[cluster];
  const canConsolidate =
    !busy && !!destination && selectedCount > 0 && selectedCount <= MAX_SOURCE_ACCOUNTS && compatibleSelectedCount > 0;
  const destinationState = presentStakeState(stakeAccounts.find((a) => a.pubkey === destination)?.stakeState);
  const withdrawReadyAccounts = useMemo(
    () =>
      stakeAccounts.filter(
        (a) => isWithdrawReadyState(a.stakeState) && a.canWithdraw !== false && hasWithdrawableLamports(a.lamports)
      ),
    [stakeAccounts]
  );
  const withdrawTarget = useMemo(
    () =>
      destination && isWithdrawReadyState(destinationState) && hasWithdrawableLamports(stakeAccounts.find((a) => a.pubkey === destination)?.lamports)
        ? destination
        : withdrawReadyAccounts[0]?.pubkey ?? '',
    [destination, destinationState, withdrawReadyAccounts, stakeAccounts]
  );
  const canWithdraw = FEATURE_WITHDRAW_ENABLED && !busy && !!withdrawTarget;
  const consolidationFeeSkr = FEATURE_FEE_ENABLED
    ? Math.min(selectedCount * PLATFORM_FEE_PER_SOURCE_SKR, PLATFORM_FEE_CAP_SKR)
    : 0;
  const estimatedMergeTxCount = selectedCount + (destination && !isDelegatedState(destinationState) ? 1 : 0);
  const consolidationFeeSkrText = consolidationFeeSkr.toFixed(2);
  const pendingTxSet = useMemo(() => new Set(pendingTxs.map((p) => p.sig)), [pendingTxs]);

  const rememberTx = useCallback((sig: string) => {
    setLastSignature(sig);
    setTxHistory((prev) => [sig, ...prev.filter((s) => s !== sig)].slice(0, 5));
  }, []);

  const pushTxEvent = useCallback((event: Omit<TxLifecycleEvent, 'at'>) => {
    setTxLifecycleEvents((prev) => [{ ...event, at: new Date().toISOString() }, ...prev].slice(0, 100));
  }, []);

  const trackPendingTx = useCallback((sig: string, label: string) => {
    setPendingTxs((prev) => {
      if (prev.some((p) => p.sig === sig)) return prev;
      return [...prev, { sig, label }];
    });
  }, []);

  const refreshWalletBalances = useCallback(async (walletAddr?: string) => {
    const active = walletAddr ?? wallet;
    if (!active) return;
    try {
      const owner = asPublicKey(active);
      const mint = asPublicKey(SKR_MINT);
      const [lamports, parsedTokenAccounts] = await Promise.all([
        connection.getBalance(owner, 'confirmed'),
        connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed').catch(() => null),
      ]);

      let skrUiAmount = '0';
      if (parsedTokenAccounts?.value?.length) {
        const decimals = Number.isFinite(skrDecimals) ? skrDecimals : SKR_FALLBACK_DECIMALS;
        const totalRaw = parsedTokenAccounts.value.reduce((acc, row) => {
          const amount = (row.account.data as any)?.parsed?.info?.tokenAmount?.amount;
          try {
            return acc + BigInt(String(amount ?? '0'));
          } catch {
            return acc;
          }
        }, 0n);
        skrUiAmount = formatRawAmount(totalRaw.toString(), decimals, 6);
      } else {
        // Fallback: direct ATA lookup if parsed owner query is unavailable.
        const ownerAta = getAssociatedTokenAddressSync(mint, owner);
        const ataBal = await connection.getTokenAccountBalance(ownerAta, 'confirmed').catch(() => null);
        skrUiAmount = ataBal?.value?.uiAmountString ?? '0';
      }

      setWalletSolBalance((lamports / LAMPORTS_PER_SOL).toFixed(4));
      setWalletSkrBalance(skrUiAmount);
    } catch {
      // keep last-known balances to avoid flicker/disappearing values
    }
  }, [connection, wallet, skrDecimals]);

  const onPullRefresh = async () => {
    if (!wallet) return;
    Animated.timing(pullShift, { toValue: 10, duration: 120, useNativeDriver: true }).start();
    setPullRefreshing(true);

    // Make pull-to-refresh feel snappy; finish spinner early while sync continues.
    const fallback = setTimeout(() => setPullRefreshing(false), 1800);
    try {
      await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
    } finally {
      clearTimeout(fallback);
      setPullRefreshing(false);
      Animated.spring(pullShift, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 5 }).start();
    }
  };

  const onMainScroll = (e: any) => {
    if (pullRefreshing) return;
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    const shift = y < 0 ? Math.min(14, -y * 0.22) : 0;
    pullShift.setValue(shift);
  };

  const onMainScrollEnd = () => {
    if (pullRefreshing) return;
    Animated.spring(pullShift, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
  };

  const allFilteredSelected = useMemo(() => {
    if (!filteredSourceStakeAccounts.length) return false;
    const subset = filteredSourceStakeAccounts.slice(0, MAX_SOURCE_ACCOUNTS);
    const compatible = subset.filter((a) => isMergeStateCompatible(destinationAccountMeta, a));
    if (!compatible.length) return false;
    return compatible.every((a) => !!selected[a.pubkey]);
  }, [filteredSourceStakeAccounts, selected, destinationAccountMeta]);

  const selectAllValidSources = () => {
    const subset = filteredSourceStakeAccounts
      .slice(0, MAX_SOURCE_ACCOUNTS)
      .filter((a) => isMergeStateCompatible(destinationAccountMeta, a));
    if (allFilteredSelected) {
      const next = { ...selected };
      for (const a of subset) delete next[a.pubkey];
      setSelected(next);
      setStatus(`Deselected ${subset.length} source account(s).`);
      return;
    }

    const next = { ...selected };
    for (const a of subset) next[a.pubkey] = true;
    setSelected(next);
    setStatus(`Selected ${subset.length} source account(s).`);
  };

  useEffect(() => {
    // Keep selection aligned to current destination compatibility so cancel/reopen
    // never leaves stale incompatible picks that block later consolidations.
    setSelected((prev) => {
      let changed = false;
      const sourceMap = new Map(sourceStakeAccounts.map((a) => [a.pubkey, a] as const));
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!v) continue;
        const src = sourceMap.get(k);
        if (src && isMergeStateCompatible(destinationAccountMeta, src)) {
          next[k] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [destinationAccountMeta, sourceStakeAccounts]);

  useEffect(() => {
    if (!wallet) return;
    setStakeAccounts([]);
    setSelected({});
    setDestination('');
    loadStakeAccounts(wallet);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setIsAppActive(active);
      if (!active) {
        setShowSettings(false);
        setConfirmConsolidate(false);
        setShowFeePolicy(false);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // No auto-refresh on app switch; manual swipe-down refresh only.
  }, [isAppActive]);

  useEffect(() => {
    if (!isAppActive) return;
    if (!pendingTxs.length) return;
    const t = setInterval(async () => {
      try {
        const sigs = pendingTxs.map((p) => p.sig);
        const st = await connection.getSignatureStatuses(sigs);
        const done = new Set<string>();
        st.value.forEach((v, i) => {
          if (!v) return;
          if (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized') {
            const meta = pendingTxs[i];
            if (meta) {
              done.add(meta.sig);
              setStatus(`✅ ${meta.label} confirmed.`);
              rememberTx(meta.sig);
              pushTxEvent({ stage: 'confirmed', label: meta.label, sig: meta.sig });
            }
          }
        });
        if (done.size) {
          setPendingTxs((prev) => prev.filter((p) => !done.has(p.sig)));
          await refreshWalletBalances();
          setStatus('Transaction confirmed. Swipe down from top to sync stake-account state.');
        }
      } catch {
        // no-op
      }
    }, 3500);

    return () => clearInterval(t);
  }, [pendingTxs, connection, isAppActive, pushTxEvent, refreshWalletBalances, rememberTx]);

  const connectWallet = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const session = await walletAdapter.connect(cluster);
      setWallet(session.address);
      setScreen('app');
      setShowWhatsNew(true);
      setShowTips(true);
      setStatus('Wallet connected.');
      await loadStakeAccounts(session.address);
      await refreshWalletBalances(session.address);
    } catch (e: any) {
      setStatus(actionError('Connect error', e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectWallet = async () => {
    // Local disconnect only to avoid forcing wallet app/account picker on user-initiated disconnect.
    // Full deauthorize happens when wallet app/session requires it during next connect flow.
    setWallet('');
    setStakeAccounts([]);
    setSelected({});
    setDestination('');
    setLastSignature('');
    setPendingTxs([]);
    setWalletSolBalance('—');
    setWalletSkrBalance('—');
    setStatus('Disconnected');
    setScreen('landing');
  };

  const loadStakeAccounts = async (walletOverride?: string, opts?: { skipBalances?: boolean; skipBusy?: boolean }) => {
    try {
      const activeWallet = walletOverride ?? wallet;
      if (!activeWallet) throw new Error('Connect wallet first');
      if (refreshInProgressRef.current) {
        if (lastStakeAccountsRef.current.length) {
          setStakeAccounts(lastStakeAccountsRef.current);
        }
        return;
      }

      const now = Date.now();
      if (!walletOverride && now - lastRefreshAtRef.current < 3500) {
        setStatus('rpc request cooldown 🙏😎');
        if (lastStakeAccountsRef.current.length) {
          setStakeAccounts(lastStakeAccountsRef.current);
        }
        return;
      }

      lastRefreshAtRef.current = now;
      refreshInProgressRef.current = true;
      if (!opts?.skipBusy) setBusy(true);
      setStatus('Refreshing stake accounts...');
      const startedAt = Date.now();

      const items = await withRetries(
        () => fetchStakeAccounts(connection, activeWallet, cluster),
        2,
        500
      );

      const epochInfo = await connection.getEpochInfo('confirmed').catch(() => null);
      const currentEpoch = epochInfo?.epoch !== undefined ? BigInt(epochInfo.epoch) : undefined;
      const resolvedFromParsed = items.map((a) => ({
        ...a,
        stakeState: deriveDelegationStateFromInfo(a, currentEpoch) ?? 'unknown',
      }));
      const resolved = await hydrateStakeStatesFromChain(connection, resolvedFromParsed);

      lastStakeAccountsRef.current = resolved;
      setRpcHealth('healthy');
      setStakeAccounts(resolved);

      const elapsed = Date.now() - startedAt;
      refreshMetricsRef.current.count += 1;
      refreshMetricsRef.current.totalMs += elapsed;
      setSelected((prev) => {
        const valid = new Set(resolved.map((i) => i.pubkey));
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v && valid.has(k)) next[k] = true;
        }
        return next;
      });
      if (!resolved.length) {
        setDestination('');
      } else if (!destination || !resolved.some((i) => i.pubkey === destination)) {
        const firstDelegated = resolved.find((i) => isDelegatedState(i.stakeState));
        setDestination((firstDelegated ?? resolved[0]).pubkey);
      }
      setStatus(resolved.length ? `Loaded ${resolved.length} stake account(s)` : 'No stake accounts yet. Tap Create + Stake first.');
      if (!opts?.skipBalances) {
        await refreshWalletBalances(activeWallet);
      }
    } catch (e: any) {
      const raw = String(e?.message ?? e ?? '').toLowerCase();
      if (raw.includes('429') || raw.includes('too many requests')) {
        setRpcHealth('degraded');
        setStatus('rpc request cooldown 🙏😎');
        if (lastStakeAccountsRef.current.length) {
          setStakeAccounts(lastStakeAccountsRef.current);
        }
      } else {
        setRpcHealth('degraded');
        setStatus(actionError('Refresh failed', e));
      }
    } finally {
      refreshInProgressRef.current = false;
      if (!opts?.skipBusy) setBusy(false);
    }
  };

  const onCreateStake = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      const amount = Number(createStakeSol);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter valid SOL amount');
      const amountLamports = Math.round(amount * LAMPORTS_PER_SOL);
      const minStakeLamports = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
      if (amountLamports < minStakeLamports) {
        const minStakeSol = (minStakeLamports / LAMPORTS_PER_SOL).toFixed(6);
        throw new Error(`Minimum create stake amount is ${minStakeSol} SOL (rent-exempt minimum).`);
      }

      const balLamports = await connection.getBalance(asPublicKey(wallet));
      if (balLamports < amountLamports + 10_000) {
        throw new Error('Insufficient balance for staking amount');
      }

      setBusy(true);
      setStatus('Creating and delegating stake account...');

      const seed = `snb-${Date.now()}`;
      const { tx, stakeAddress } = await buildCreateAndDelegateStakeTx({
        connection,
        owner: asPublicKey(wallet),
        validatorVote: asPublicKey(validatorVote),
        solAmount: createStakeSol,
        seed,
      });

      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      const sig = sigs[0];
      if (!sig) throw new Error('wallet returned empty signature');
      rememberTx(sig);
      trackPendingTx(sig, 'Stake transaction');
      setStatus(`🛰️ Stake transaction submitted. Confirming...`);
      await connection.confirmTransaction(sig, 'confirmed');
      setDestination(stakeAddress);
      await refreshWalletBalances(wallet);
      await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
      setStatus(`✅ Delegated ${createStakeSol} SOL to validator ${shortAddr(validatorVote)}. Swipe down from top to sync new stake account state.`);
    } catch (e: any) {
      suppressNextStatusModalRef.current = true;
      if (classifyError(e) === 'user') {
        setStatus('Create stake not submitted by wallet. Please retry.');
      } else {
        setStatus(`Create stake not submitted: ${normalizeErrorMessage(e)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onUnstake = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select a stake account first');
      setBusy(true);
      setStatus('Submitting unstake (deactivate) transaction...');

      const tx = await buildDeactivateStakeTx({
        connection,
        owner: asPublicKey(wallet),
        stakeAccount: asPublicKey(destination),
      });
      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Unstake transaction');
        setStatus(`⏸️ Unstake submitted for ${shortAddr(destination)}. Confirming...`);
        await connection.confirmTransaction(sigs[0], 'confirmed');
        let nextHint = 'Waiting for deactivation/epoch processing before withdraw.';
        try {
          const [activation, epochInfo] = await Promise.all([
            connection.getStakeActivation(asPublicKey(destination), 'confirmed'),
            connection.getEpochInfo('confirmed'),
          ]);
          if (activation?.state) {
            nextHint = `State: ${activation.state} (epoch ${epochInfo.epoch}). Withdraw enables when inactive.`;
            // Apply immediate local state hint so UI doesn't appear stuck on stale activating.
            setStakeAccounts((prev) =>
              prev.map((a) => (a.pubkey === destination ? { ...a, stakeState: activation.state } : a))
            );
          }
        } catch {
          // keep default hint
        }
        await refreshWalletBalances(wallet);
        await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
        setStatus(`✅ Unstake confirmed for ${shortAddr(destination)}. ${nextHint} Swipe down from top to update list.`);
      }
    } catch (e: any) {
      setStatus(actionError('Unstake error', e));
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!withdrawTarget) throw new Error('No withdraw-ready stake account detected yet. Refresh and try again.');
      const target = withdrawTarget;
      if (target !== destination) setDestination(target);

      setBusy(true);
      setStatus('Checking stake account withdraw eligibility...');

      const stakePubkey = asPublicKey(target);
      const accountInfo = await connection.getAccountInfo(stakePubkey, 'confirmed');

      if (!accountInfo) throw new Error('Stake account not found. Refresh and try again.');
      if (!accountInfo.owner.equals(StakeProgram.programId)) {
        throw new Error('Selected account is not a stake account.');
      }

      const lamports = accountInfo.lamports;
      if (lamports <= 0) throw new Error('No lamports available to withdraw from this stake account.');
      // Withdraw full balance to close the stake account in one transaction.
      const withdrawLamports = lamports;
      if (withdrawLamports <= 0) {
        throw new Error('No withdrawable lamports yet. Wait for full deactivation and refresh.');
      }
      const activation = await connection.getStakeActivation(stakePubkey, 'confirmed').catch(() => null);
      if (activation?.state && activation.state !== 'inactive') {
        throw new Error(`Stake state is ${activation.state}; withdraw requires inactive.`);
      }

      setStatus('Submitting full-balance withdraw (account will close)...');
      const tx = await buildWithdrawStakeTx({
        connection,
        owner: asPublicKey(wallet),
        stakeAccount: asPublicKey(target),
        to: asPublicKey(wallet),
        lamports: withdrawLamports,
      });

      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Withdraw transaction');
        setStatus(`💸 Withdraw submitted for ${shortAddr(target)}. Confirming...`);
        await connection.confirmTransaction(sigs[0], 'confirmed');
        // Optimistically remove closed account from list to avoid dust-withdraw confusion.
        setStakeAccounts((prev) => prev.filter((a) => a.pubkey !== target));
        setSelected((prev) => {
          if (!prev[target]) return prev;
          const next = { ...prev };
          delete next[target];
          return next;
        });
        if (destination === target) setDestination('');
        await refreshWalletBalances(wallet);
        await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
        setStatus(`✅ Withdraw confirmed to wallet ${shortAddr(wallet)}.`);
      }
    } catch {
      suppressNextStatusModalRef.current = true;
      setStatus('Withdraw not submitted. Check account state and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onConsolidateDryRun = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select destination stake account first');
      if (sourceSelectedKeys.length === 0) throw new Error('Select source stake account(s) first');

      setBusy(true);
      setStatus('Preparing consolidation dry-run...');
      const stakeMap = new Map(stakeAccounts.map((a) => [a.pubkey, a] as const));
      const destinationAccount = stakeMap.get(destination);
      if (!destinationAccount) throw new Error('Destination stake account not found. Refresh and try again.');

      const rows = sourceSelectedKeys.map((k) => {
        const src = stakeMap.get(k);
        const verdict = describeMergeCompatibility(destinationAccount as any, src as any);
        return { pubkey: k, ok: verdict.ok, reason: verdict.reason };
      });
      const eligibleSourceKeys = rows.filter((r) => r.ok).map((r) => r.pubkey);
      if (!eligibleSourceKeys.length) {
        setStatus(`Dry-run: no eligible sources. ${summarizePreflightRows(rows)}`);
        return;
      }

      const owner = asPublicKey(wallet);
      const txs = await buildConsolidationTransactions({
        connection,
        owner,
        plan: {
          destination: asPublicKey(destination),
          sources: eligibleSourceKeys.map(asPublicKey),
          validatorVote: asPublicKey(validatorVote),
          includeDelegateTx: false,
        },
      });

      let simPassed = 0;
      let simFailed = 0;
      const failures: Array<{ index: number; error: string }> = [];
      for (let i = 0; i < txs.length; i++) {
        try {
          const tx = txs[i];
          const recent = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = recent.blockhash;
          tx.lastValidBlockHeight = recent.lastValidBlockHeight;
          tx.feePayer = owner;
          const sim: any = await connection.simulateTransaction(tx, {
            replaceRecentBlockhash: true,
            sigVerify: false,
            commitment: 'confirmed',
          } as any);
          if (sim?.value?.err) {
            simFailed += 1;
            failures.push({ index: i + 1, error: JSON.stringify(sim.value.err) });
          } else {
            simPassed += 1;
          }
        } catch (e: any) {
          simFailed += 1;
          failures.push({ index: i + 1, error: normalizeErrorMessage(e) });
        }
      }

      const report = {
        type: 'consolidation-dry-run',
        appVersion: APP_VERSION_LABEL,
        cluster,
        wallet,
        destination,
        mode: consolidationSendMode,
        selectedCount: sourceSelectedKeys.length,
        eligibleCount: eligibleSourceKeys.length,
        excludedCount: rows.length - eligibleSourceKeys.length,
        exclusionSummary: summarizePreflightRows(rows),
        txCount: txs.length,
        simulation: {
          passed: simPassed,
          failed: simFailed,
        },
        failures: failures.slice(0, 8),
        createdAt: new Date().toISOString(),
      };
      Clipboard.setString(JSON.stringify(report, null, 2));
      pushTxEvent({
        stage: 'prepared',
        label: 'Consolidation dry-run',
        note: `eligible=${eligibleSourceKeys.length}, sim=${simPassed}/${txs.length}`,
      });
      if (simFailed > 0) {
        const firstFailure = failures[0]?.error ?? 'simulation error';
        setStatus(
          `Dry-run: eligible ${eligibleSourceKeys.length}, but simulation failed ${simFailed}/${txs.length}. ` +
          `Top failure: ${firstFailure}. Report copied.`
        );
      } else {
        setStatus(`Dry-run: eligible ${eligibleSourceKeys.length}, simulation passed ${simPassed}/${txs.length}. Report copied.`);
      }
    } catch (e: any) {
      setStatus(actionError('Dry-run failed', e));
    } finally {
      setBusy(false);
    }
  };

  const onConsolidate = async () => {
    if (busy || consolidationInFlightRef.current) {
      setStatus('Consolidation already in progress.');
      return;
    }
    let sessionKey = '';
    let anySubmitted = false;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select destination stake account from list below');
      const availableSourceCount = sourceStakeAccounts.length;
      if (availableSourceCount < 1) {
        throw new Error('Need at least 2 stake accounts. Create another stake account, then select source account(s).');
      }

      if (sourceSelectedKeys.length === 0) throw new Error('Select at least one source stake account below.');
      if (compatibleSelectedCount === 0) throw new Error('No compatible source accounts selected for this destination.');
      if (sourceSelectedKeys.length > MAX_SOURCE_ACCOUNTS) throw new Error(`Max ${MAX_SOURCE_ACCOUNTS} source stake accounts`);

      setStatus('Validating merge eligibility...');

      const stakeMap = new Map(stakeAccounts.map((a) => [a.pubkey, a] as const));
      const destinationAccount = stakeMap.get(destination);
      if (!destinationAccount) throw new Error('Destination stake account not found in current list. Refresh and try again.');

      const preflight = sourceSelectedKeys.map((k) => {
        const src = stakeMap.get(k);
        const verdict = describeMergeCompatibility(destinationAccount, src);
        return { pubkey: k, ok: verdict.ok, reason: verdict.reason };
      });
      const incompatibleCount = preflight.filter((it) => !it.ok).length;
      const eligibleSourceKeys = preflight.filter((it) => it.ok).map((it) => it.pubkey);
      if (eligibleSourceKeys.length === 0) {
        suppressNextStatusModalRef.current = true;
        setStatus('No compatible source accounts selected for this destination state.');
        return;
      }
      const exclusionSummary = summarizePreflightRows(preflight);
      sessionKey = buildConsolidationSessionKey(destination, eligibleSourceKeys, consolidationSendMode);
      const now = Date.now();
      for (const [k, ts] of Object.entries(consolidationIdempotencyRef.current)) {
        if (now - ts > CONSOLIDATION_IDEMPOTENCY_WINDOW_MS) delete consolidationIdempotencyRef.current[k];
      }
      const existing = consolidationIdempotencyRef.current[sessionKey];
      if (existing && now - existing < CONSOLIDATION_IDEMPOTENCY_WINDOW_MS) {
        setStatus('Duplicate consolidation request blocked (idempotency guard). Wait 2 minutes or change selection.');
        return;
      }
      consolidationIdempotencyRef.current[sessionKey] = now;
      consolidationInFlightRef.current = true;
      setBusy(true);
      pushTxEvent({
        stage: 'prepared',
        label: 'Consolidation preflight',
        sessionKey,
        note: `eligible=${eligibleSourceKeys.length} excluded=${incompatibleCount}${exclusionSummary ? ` (${exclusionSummary})` : ''}`,
      });
      setStatus(`Preflight complete: ${eligibleSourceKeys.length} eligible, ${incompatibleCount} excluded.${exclusionSummary ? ` ${exclusionSummary}.` : ''}`);

      const owner = asPublicKey(wallet);
      // Delegate-in-consolidation has proven brittle across stake-state transitions.
      // Consolidation should only merge compatible existing stake accounts.
      const includeDelegateTx = false;
      setStatus('Building consolidation transactions...');
      const txs = await buildConsolidationTransactions({
        connection,
        owner,
        plan: {
          destination: asPublicKey(destination),
          sources: eligibleSourceKeys.map(asPublicKey),
          validatorVote: asPublicKey(validatorVote),
          includeDelegateTx,
        },
      });

      const delegateTx = includeDelegateTx ? txs[0] : null;
      const mergeTxCandidates = includeDelegateTx ? txs.slice(1) : txs;
      if (mergeTxCandidates.length === 0) {
        throw new Error('No merge transactions were created.');
      }

      const mergeTxsToSend = mergeTxCandidates;

      const chargedFeeSkr = FEATURE_FEE_ENABLED
        ? Math.min(mergeTxsToSend.length * PLATFORM_FEE_PER_SOURCE_SKR, PLATFORM_FEE_CAP_SKR)
        : 0;

      // Bundle fee instructions into consolidation txs so signature flow stays unified.
      let feeBundle:
        | {
            mint: ReturnType<typeof asPublicKey>;
            ownerAta: ReturnType<typeof getAssociatedTokenAddressSync>;
            feeAta: ReturnType<typeof getAssociatedTokenAddressSync>;
            perTxRaw: bigint[];
          }
        | null = null;
      if (chargedFeeSkr > 0 && mergeTxsToSend.length > 0) {
        const mint = asPublicKey(SKR_MINT);
        const feeWallet = asPublicKey(PLATFORM_FEE_WALLET);
        const ownerAta = getAssociatedTokenAddressSync(mint, owner);
        const feeAta = getAssociatedTokenAddressSync(mint, feeWallet);
        const decimals = Number.isFinite(skrDecimals) ? skrDecimals : SKR_FALLBACK_DECIMALS;
        const totalRaw = BigInt(Math.round(chargedFeeSkr * Math.pow(10, decimals)));
        const txCount = mergeTxsToSend.length;
        const base = totalRaw / BigInt(txCount);
        const rem = totalRaw % BigInt(txCount);
        const perTxRaw = Array.from({ length: txCount }, (_, i) => {
          return base + (BigInt(i) < rem ? 1n : 0n);
        });
        feeBundle = { mint, ownerAta, feeAta, perTxRaw };
      }

      if (delegateTx) {
        const recent = await connection.getLatestBlockhash('confirmed');
        delegateTx.recentBlockhash = recent.blockhash;
        delegateTx.lastValidBlockHeight = recent.lastValidBlockHeight;
        delegateTx.feePayer = owner;
        setStatus('Submitting destination delegate transaction...');
        pushTxEvent({ stage: 'sign_requested', label: 'Destination delegate transaction', sessionKey });
        const sigs = await walletAdapter.signAndSendTransactions([delegateTx]);
        const sig = sigs[0];
        if (!sig) throw new Error('Destination delegate transaction was not signed/submitted.');
        rememberTx(sig);
        trackPendingTx(sig, 'Destination delegate transaction');
        anySubmitted = true;
        pushTxEvent({ stage: 'submitted', label: 'Destination delegate transaction', sig, sessionKey });
        await connection.confirmTransaction(sig, 'confirmed');
        pushTxEvent({ stage: 'confirmed', label: 'Destination delegate transaction', sig, sessionKey });
      }

      const submittedMergeSigs: string[] = [];
      let failedMergeCount = 0;
      const cloneTransaction = (tx: Transaction): Transaction =>
        Transaction.from(
          tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
        );
      const buildPreparedMergeTx = async (txIndex: number): Promise<Transaction> => {
        const baseTx = mergeTxsToSend[txIndex];
        const tx = cloneTransaction(baseTx);
        const recent = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = recent.blockhash;
        tx.lastValidBlockHeight = recent.lastValidBlockHeight;
        tx.feePayer = owner;
        if (feeBundle) {
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(
              owner,
              feeBundle.feeAta,
              asPublicKey(PLATFORM_FEE_WALLET),
              feeBundle.mint
            )
          );
          const raw = feeBundle.perTxRaw[txIndex] ?? 0n;
          if (raw > 0n) {
            tx.add(createTransferInstruction(feeBundle.ownerAta, feeBundle.feeAta, owner, raw));
          }
        }
        return tx;
      };
      const submitSingleMergeTx = async (txIndex: number) => {
        const label = `Consolidation tx ${txIndex + 1}/${mergeTxsToSend.length}`;
        const tx = await buildPreparedMergeTx(txIndex);
        setStatus(`Submitting ${label}...`);
        pushTxEvent({ stage: 'prepared', label, sessionKey });
        pushTxEvent({ stage: 'sign_requested', label, sessionKey });
        const sigs = await walletAdapter.signAndSendTransactions([tx]);
        const sig = sigs[0];
        if (!sig) throw new Error('wallet returned empty signature');
        rememberTx(sig);
        trackPendingTx(sig, label);
        anySubmitted = true;
        pushTxEvent({ stage: 'submitted', label, sig, sessionKey });
        await connection.confirmTransaction(sig, 'confirmed');
        pushTxEvent({ stage: 'confirmed', label, sig, sessionKey });
        submittedMergeSigs.push(sig);
      };
      if (consolidationSendMode === 'batch') {
        const batchChunks = chunkArray(mergeTxsToSend, batchTxChunkSize);
        let globalIdx = 0;
        for (let c = 0; c < batchChunks.length; c++) {
          const chunkStart = globalIdx;
          const chunkLen = batchChunks[c].length;
          const txIndexes = Array.from({ length: chunkLen }, (_, i) => chunkStart + i);
          setStatus(`Submitting consolidation batch ${c + 1}/${batchChunks.length} (${txIndexes.length} tx)...`);
          for (const idx of txIndexes) {
            pushTxEvent({ stage: 'prepared', label: `Consolidation tx ${idx + 1}/${mergeTxsToSend.length}`, sessionKey });
          }
          try {
            const preparedChunk = await Promise.all(txIndexes.map((idx) => buildPreparedMergeTx(idx)));
            for (const idx of txIndexes) {
              pushTxEvent({ stage: 'sign_requested', label: `Consolidation tx ${idx + 1}/${mergeTxsToSend.length}`, sessionKey });
            }
            const sigs = await walletAdapter.signAndSendTransactions(preparedChunk);
            for (let i = 0; i < txIndexes.length; i++) {
              const sig = sigs[i];
              const label = `Consolidation tx ${txIndexes[i] + 1}/${mergeTxsToSend.length}`;
              if (!sig) {
                // Do not auto-retry missing signatures: wallet may have already submitted
                // the transaction and retrying can create duplicate sends.
                failedMergeCount += 1;
                pushTxEvent({ stage: 'failed', label, sessionKey, note: 'wallet returned empty signature' });
                continue;
              }
              rememberTx(sig);
              trackPendingTx(sig, label);
              anySubmitted = true;
              pushTxEvent({ stage: 'submitted', label, sig, sessionKey });
              submittedMergeSigs.push(sig);
            }
          } catch (e: any) {
            if (classifyError(e) === 'user') throw e;
            // Do not auto-fallback/resubmit on chunk errors; this can double-submit
            // if wallet partially accepted the batch before returning an error.
            failedMergeCount += txIndexes.length;
            for (const idx of txIndexes) {
              pushTxEvent({
                stage: 'failed',
                label: `Consolidation tx ${idx + 1}/${mergeTxsToSend.length}`,
                sessionKey,
                note: normalizeErrorMessage(e),
              });
            }
          }
          globalIdx += chunkLen;
        }
        await Promise.all(
          submittedMergeSigs.map(async (sig) => {
            try {
              await connection.confirmTransaction(sig, 'confirmed');
              pushTxEvent({ stage: 'confirmed', label: 'Consolidation tx', sig, sessionKey });
            } catch {
              // confirmation can lag; submitted signatures still prove signing success
            }
          })
        );
      } else {
        for (let i = 0; i < mergeTxsToSend.length; i++) {
          try {
            await submitSingleMergeTx(i);
          } catch (e: any) {
            if (classifyError(e) === 'user') throw e;
            failedMergeCount += 1;
            pushTxEvent({
              stage: 'failed',
              label: `Consolidation tx ${i + 1}/${mergeTxsToSend.length}`,
              sessionKey,
              note: normalizeErrorMessage(e),
            });
          }
        }
      }

      setSelected({});
      await refreshWalletBalances(wallet);
      const notes: string[] = [];
      if (incompatibleCount > 0) notes.push(`skipped ${incompatibleCount} incompatible`);
      if (failedMergeCount) notes.push(`failed ${failedMergeCount} during send`);
      const noteText = notes.length ? ` (${notes.join(', ')})` : '';
      const reportedMergeCount = Math.max(0, mergeTxsToSend.length - failedMergeCount);
      setStatus(`✅ Consolidation submitted (${reportedMergeCount} merge tx, mode: ${consolidationSendMode}, chunk ${batchTxChunkSize}; fee ${chargedFeeSkr.toFixed(2)} SKR).${noteText} Syncing stake state...`);
      await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
    } catch (e: any) {
      suppressNextStatusModalRef.current = true;
      pushTxEvent({
        stage: 'failed',
        label: 'Consolidation session',
        sessionKey: sessionKey || undefined,
        note: normalizeErrorMessage(e),
      });
      setStatus('Consolidation not submitted. Please try again.');
    } finally {
      consolidationInFlightRef.current = false;
      setBusy(false);
      // Prevent stale incompatible selections from poisoning the next run.
      setSelected({});
      if (sessionKey && !anySubmitted) {
        delete consolidationIdempotencyRef.current[sessionKey];
      }
    }
  };

  const fetchSwapQuote = useCallback(async () => {
    try {
      const amountNum = Number(swapAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Enter a valid swap amount');
      if (!wallet) throw new Error('Connect wallet first');

      // Pre-balance checks
      const inSymbol = swapDir === 'SOL_TO_SKR' ? 'SOL' : 'SKR';
      const available = Number(swapDir === 'SOL_TO_SKR' ? walletSolBalance : walletSkrBalance);
      if (Number.isFinite(available) && amountNum > available) {
        throw new Error(`Insufficient ${inSymbol} balance`);
      }

      setSwapBusy(true);
      setSwapQuoteText('Fetching quote...');

      const inputMint = swapDir === 'SOL_TO_SKR' ? SOL_MINT : SKR_MINT;
      const outputMint = swapDir === 'SOL_TO_SKR' ? SKR_MINT : SOL_MINT;
      const decimalsIn = swapDir === 'SOL_TO_SKR' ? 9 : skrDecimals;
      const raw = Math.floor(amountNum * Math.pow(10, decimalsIn));

      const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${raw}&slippageBps=${swapSlippageBps}`;
      const res = await fetch(url, { headers: { 'x-api-key': JUPITER_API_KEY } });
      if (!res.ok) throw new Error(`Jupiter quote failed (${res.status})`);
      const q: any = await res.json();
      const inRaw = BigInt(String(q?.inAmount ?? '0'));
      const outRaw = BigInt(String(q?.outAmount ?? '0'));
      if (inRaw <= 0n || outRaw <= 0n) throw new Error('No quote output amount');

      // Basic sanity guard to catch absurd quote parsing / decimal mismatch.
      const ratePpm = Number((outRaw * 1_000_000n) / inRaw); // scaled by 1e6
      if (!Number.isFinite(ratePpm) || ratePpm <= 0 || ratePpm > 1_000_000_000_000) {
        throw new Error('quote anomaly, retry');
      }

      setSwapQuote(q);
      setSwapQuoteAtMs(Date.now());
      setSwapStale(false);

      const decimalsOut = swapDir === 'SOL_TO_SKR' ? skrDecimals : 9;
      const outUi = formatRawAmount(outRaw.toString(), decimalsOut, 6);
      const outSym = swapDir === 'SOL_TO_SKR' ? 'SKR' : 'SOL';
      const minOutRaw = q?.otherAmountThreshold ? String(q.otherAmountThreshold) : String(outRaw);
      setSwapMinReceivedText(`${formatRawAmount(minOutRaw, decimalsOut, 6)} ${outSym}`);

      const route = Array.isArray(q?.routePlan)
        ? q.routePlan.map((r: any) => r?.swapInfo?.label).filter(Boolean).join(' → ')
        : '';
      setSwapRouteText(route || 'Route unavailable');

      const impact = Number(q?.priceImpactPct ?? 0);
      setSwapImpactPct(Number.isFinite(impact) ? impact : 0);
      setSwapQuoteText(`Quote: ~${outUi} ${outSym} (slippage ${(swapSlippageBps / 100).toFixed(2)}%)`);
    } catch (e: any) {
      setSwapQuoteText(`Quote error: ${normalizeErrorMessage(e)}`);
      setSwapQuote(null);
      setSwapRouteText('');
      setSwapMinReceivedText('');
      setSwapImpactPct(0);
    } finally {
      setSwapBusy(false);
    }
  }, [
    skrDecimals,
    swapAmount,
    swapDir,
    swapSlippageBps,
    wallet,
    walletSolBalance,
    walletSkrBalance,
  ]);

  const executeSwapInApp = async () => {
    try {
      if (!wallet) throw new Error('Connect wallet first');
      if (!swapQuote) throw new Error('Get a quote first');
      let quoteToUse = swapQuote;
      const ageMs = Date.now() - swapQuoteAtMs;
      if (!swapQuoteAtMs || ageMs > 15000 || swapStale) {
        await fetchSwapQuote();
        if (!swapQuote) throw new Error('Quote stale. Tap Get Quote again.');
        quoteToUse = swapQuote;
      }
      const amountNum = Number(swapAmount);
      const inSymbol = swapDir === 'SOL_TO_SKR' ? 'SOL' : 'SKR';
      const available = Number(swapDir === 'SOL_TO_SKR' ? walletSolBalance : walletSkrBalance);
      if (Number.isFinite(available) && Number.isFinite(amountNum) && amountNum > available) {
        throw new Error(`Insufficient ${inSymbol} balance`);
      }

      setSwapBusy(true);
      setStatus('Building Jupiter swap transaction...');

      const owner = asPublicKey(wallet);
      const outMint = asPublicKey(swapDir === 'SOL_TO_SKR' ? SKR_MINT : SOL_MINT);
      if (swapDir === 'SOL_TO_SKR') {
        const outAta = getAssociatedTokenAddressSync(outMint, owner);
        const outAtaInfo = await connection.getAccountInfo(outAta, 'confirmed');
        if (!outAtaInfo) {
          setStatus('Preparing destination token account (SKR)...');
        }
      }

      const beforeSol = Number(walletSolBalance);
      const beforeSkr = Number(walletSkrBalance);

      const res = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': JUPITER_API_KEY,
        },
        body: JSON.stringify({
          userPublicKey: wallet,
          quoteResponse: quoteToUse,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        }),
      });

      if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status})`);
      const data: any = await res.json();
      if (!data?.swapTransaction) throw new Error('No swap transaction returned');

      const raw = Buffer.from(data.swapTransaction, 'base64');
      const vtx = VersionedTransaction.deserialize(raw);

      const sim = await connection.simulateTransaction(vtx, {
        replaceRecentBlockhash: true,
        sigVerify: false,
        commitment: 'confirmed',
      });
      if (sim.value.err) {
        throw new Error(`Swap simulation failed: ${JSON.stringify(sim.value.err)}`);
      }

      const sigs = await walletAdapter.signAndSendTransactions([vtx as any]);
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Swap transaction');
        setStatus('✅ Swap submitted. Confirming...');
        await connection.confirmTransaction(sigs[0], 'confirmed');

        const ownerPk = asPublicKey(wallet);
        const ownerAta = getAssociatedTokenAddressSync(asPublicKey(SKR_MINT), ownerPk);
        let afterSol = beforeSol;
        let afterSkr = beforeSkr;
        const epsilon = 0.000001;
        // Poll briefly so post-swap balances update quickly even when RPC indexers lag.
        for (let attempt = 0; attempt < 6; attempt++) {
          const commitment = attempt < 2 ? 'processed' : 'confirmed';
          const [solLamports, skrBal] = await Promise.all([
            connection.getBalance(ownerPk, commitment as any),
            connection.getTokenAccountBalance(ownerAta, commitment as any).catch(() => null),
          ]);
          afterSol = solLamports / LAMPORTS_PER_SOL;
          afterSkr = Number(skrBal?.value?.uiAmountString ?? '0');
          setWalletSolBalance(afterSol.toFixed(4));
          setWalletSkrBalance(Number.isFinite(afterSkr) ? String(afterSkr) : '0');

          if (Math.abs(afterSol - beforeSol) > epsilon || Math.abs(afterSkr - beforeSkr) > epsilon) {
            break;
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 450 + attempt * 220));
        }
        // Final confirmed sync for consistency.
        await refreshWalletBalances(wallet);

        setWalletSolBalance(afterSol.toFixed(4));
        setWalletSkrBalance(Number.isFinite(afterSkr) ? String(afterSkr) : '0');
        const dSol = Number.isFinite(beforeSol) ? (afterSol - beforeSol).toFixed(4) : 'n/a';
        const dSkr = Number.isFinite(beforeSkr) ? (afterSkr - beforeSkr).toFixed(4) : 'n/a';
        setStatus(`✅ Swap confirmed. ΔSOL ${dSol} / ΔSKR ${dSkr}`);
      }
    } catch (e: any) {
      setStatus(actionError('Swap error', e));
    } finally {
      setSwapBusy(false);
    }
  };



  useEffect(() => {
    if (mode !== 'swap' || !isAppActive) return;
    const tick = setInterval(() => {
      if (swapBusy) return;
      if (!swapAmount || Number(swapAmount) <= 0) return;
      fetchSwapQuote().catch(() => {});
    }, 10000);
    return () => clearInterval(tick);
  }, [mode, isAppActive, swapAmount, swapBusy, fetchSwapQuote]);

  const onSend = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Connect wallet first');
      if (!sendTo.trim()) throw new Error('Enter recipient address or .sol name');

      setStatus(sendTo.trim().toLowerCase().endsWith('.sol') ? 'Resolving SNS name...' : 'Validating recipient...');
      const recipient = await resolveRecipientAddress(sendTo, connection);
      const lamports = Math.round(Number(sendSol) * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('Invalid SOL amount');

      setBusy(true);
      setStatus('Building transfer transaction...');
      const tx = await buildTransferTx({
        connection,
        from: asPublicKey(wallet),
        to: asPublicKey(recipient),
        lamports,
      });

      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Transfer transaction');
        setStatus(`🛰️ Transfer submitted. Confirming...`);
        await connection.confirmTransaction(sigs[0], 'confirmed');
        setStatus(`✅ Sent ${sendSol} SOL to ${shortAddr(recipient)}.`);
      }
    } catch (e: any) {
      setStatus(actionError('Send error', e));
    } finally {
      setBusy(false);
    }
  };

  const copyWalletAddress = () => {
    if (!wallet) return;
    Clipboard.setString(wallet);
    setStatus('Wallet address copied to clipboard.');
  };

  const onSendMax = async () => {
    try {
      if (!wallet) throw new Error('Connect wallet first');
      const balance = await connection.getBalance(asPublicKey(wallet), 'confirmed');
      const reserve = 5000; // fee buffer
      const lamports = Math.max(0, balance - reserve);
      const sol = lamports / LAMPORTS_PER_SOL;
      setSendSol(sol.toFixed(6));
      setStatus('Set max amount (minus network fee buffer).');
    } catch (e: any) {
      setStatus(actionError('Max amount error', e));
    }
  };

  const copyDebugReport = () => {
    const avgRefreshMs = refreshMetricsRef.current.count
      ? Math.round(refreshMetricsRef.current.totalMs / refreshMetricsRef.current.count)
      : null;

    const report = {
      app: 'stakeNbake',
      version: APP_VERSION_LABEL,
      cluster,
      explorer,
      mode,
      rpcHealth,
      wallet: wallet || null,
      destination: destination || null,
      stakeAccountCount: stakeAccounts.length,
      selectedSourceCount: selectedCount,
      lastSignature: lastSignature || null,
      pendingTxCount: pendingTxs.length,
      txLifecycleEvents: txLifecycleEvents.slice(0, 25),
      avgRefreshMs,
      status,
      consolidationSendMode,
      batchTxChunkSize,
      timestamp: new Date().toISOString(),
    };

    Clipboard.setString(JSON.stringify(report, null, 2));
    setStatus('Debug report copied to clipboard.');
  };

  const copySupportBundle = () => {
    const payload = {
      app: 'stakeNbake',
      version: APP_VERSION_LABEL,
      features: {
        feeEnabled: FEATURE_FEE_ENABLED,
        withdrawEnabled: FEATURE_WITHDRAW_ENABLED,
      },
      feePolicy: {
        token: 'SKR',
        mint: SKR_MINT,
        perSource: PLATFORM_FEE_PER_SOURCE_SKR,
        cap: PLATFORM_FEE_CAP_SKR,
        collector: PLATFORM_FEE_WALLET,
      },
      status,
      consolidationSendMode,
      batchTxChunkSize,
      lastSignature,
      recentTxs: txHistory,
      txLifecycleEvents: txLifecycleEvents.slice(0, 50),
      wallet,
      destination,
      timestamp: new Date().toISOString(),
    };
    Clipboard.setString(JSON.stringify(payload, null, 2));
    setStatus('Support bundle copied.');
  };

  const copyTxLifecycleReport = () => {
    const payload = {
      app: 'stakeNbake',
      version: APP_VERSION_LABEL,
      timestamp: new Date().toISOString(),
      events: txLifecycleEvents,
    };
    Clipboard.setString(JSON.stringify(payload, null, 2));
    setStatus('TX lifecycle report copied.');
  };

  const exportLogsToShare = async () => {
    try {
      const payload = {
        app: 'stakeNbake',
        version: APP_VERSION_LABEL,
        cluster,
        explorer,
        wallet,
        status,
        txLifecycleEvents,
        recentTxs: txHistory,
        generatedAt: new Date().toISOString(),
      };
      const body = JSON.stringify(payload, null, 2);
      const encoded = Buffer.from(body, 'utf8').toString('base64');
      await Share.share({
        title: 'stakeNbake-logs.json',
        message: body,
        url: `data:application/json;base64,${encoded}`,
      });
      setStatus('Logs export opened in share sheet.');
    } catch (e: any) {
      setStatus(actionError('Log export error', e));
    }
  };

  const copyFeeWallet = () => {
    Clipboard.setString(PLATFORM_FEE_WALLET);
    setStatus('Fee wallet copied.');
  };

  const copyIssueTemplate = () => {
    const template = [
      `Issue Report (${APP_VERSION_LABEL})`,
      `- What happened:`,
      `- Expected:`,
      `- Wallet: ${shortAddr(wallet)}`,
      `- Last tx: ${lastSignature || 'n/a'}`,
      `- Time: ${new Date().toISOString()}`,
      '',
      'Support bundle (paste below):',
    ].join('\n');
    Clipboard.setString(template);
    setStatus('Issue template copied. Paste support bundle below it.');
  };

  if (screen === 'splash') {
    const whitePhase = splashPhase === 0;
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, styles.centered, whitePhase ? styles.splashRootLight : styles.splashRootDark]}>
          <StatusBar barStyle={whitePhase ? 'dark-content' : 'light-content'} />
          <Image
            source={whitePhase ? solanaMobileBlackLogo : solanaMobileWhiteLogo}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === 'landing') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, styles.centered, styles.landingRootDark]}>
          <StatusBar barStyle={'light-content'} />
          <Animated.View style={{ opacity: landingFade, transform: [{ translateY: landingFade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
            <Image source={solanaMobileWhiteLogo} style={styles.splashLogo} resizeMode="contain" />
            <Text style={[styles.title, styles.landingTitle]}>{APP_NAME}</Text>
            <Text style={[styles.meta, styles.landingNetworkMeta]}>Network: Mainnet</Text>
            <Text style={[styles.subtitle, styles.landingConnectHint]}>Connect wallet to continue.</Text>
            <ActionButton label={busy ? 'Connecting…' : 'Connect Wallet'} onPress={connectWallet} />
          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <ScrollView
        contentContainerStyle={styles.content}
        style={{ transform: [{ translateY: pullShift }] }}
        onScroll={onMainScroll}
        onScrollEndDrag={onMainScrollEnd}
        onMomentumScrollEnd={onMainScrollEnd}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={palette.primary}
          />
        }
      >
        <View style={styles.headerCenter}>
          <Image source={theme === 'light' ? solanaMobileBlackLogo : solanaMobileWhiteLogo} style={styles.headerLogo} resizeMode="contain" />
        </View>
        <Text style={[styles.subtitle, { color: palette.primary }]}>Mainnet</Text>
        <Text style={[styles.rpcBadge, rpcHealth === 'degraded' && styles.rpcBadgeBad]}>
          RPC: {rpcHealth === 'healthy' ? 'healthy' : 'degraded/fallback'}
        </Text>

        <View style={[styles.card, { backgroundColor: palette.panel, borderColor: palette.border }]}>
          <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Wallet</Text>
          <View style={[styles.walletBox, theme === 'light' && styles.walletBoxLight]}>
            <View style={styles.walletSummary}>
              <Text style={[styles.walletText, theme === 'light' && styles.walletTextLight]}>{shortAddr(wallet)}</Text>
              <Text style={[styles.meta, theme === 'light' && styles.walletTextLight]}>SOL: {walletSolBalance}</Text>
              <Text style={[styles.meta, theme === 'light' && styles.walletTextLight]}>SKR: {walletSkrBalance}</Text>
            </View>
            <ActionButton label="Disconnect" onPress={disconnectWallet} />
          </View>

          <View style={styles.modeTabsRow}>
            {([
              ['stake', 'Staking'],
              ['send', 'Send'],
              ['receive', 'Receive'],
              ['swap', 'Swap'],
            ] as const).map(([k, label]) => {
              const active = mode === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setMode(k)}
                  style={[styles.modeTabBtn, active && styles.modeTabBtnActive]}
                >
                  <Text style={[styles.modeTabTxt, active && styles.modeTabTxtActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {mode === 'stake' && (
          <Animated.View style={[styles.card, theme === 'light' && styles.stakeCardLight, { opacity: modeFade, transform: [{ translateY: modeFade.interpolate({ inputRange: [0.92, 1], outputRange: [4, 0] }) }] }]}>
            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Solana Mobile Staking</Text>
            <View style={[styles.validatorBox, theme === 'dark' && styles.validatorBoxDarkHighlight]}>
              <Text style={[styles.validatorTitle, theme === 'dark' && styles.validatorTitleDarkHighlight]}>Solana Mobile Validator</Text>
              <Text style={styles.validatorAddr}>{validatorVote}</Text>
            </View>

            <TextInput
              style={[styles.input, theme === 'light' && styles.inputLight]}
              placeholder="Amount SOL to stake"
              placeholderTextColor={colors.muted}
              value={createStakeSol}
              onChangeText={setCreateStakeSol}
              keyboardType="decimal-pad"
            />
            <View style={styles.stakeActionRow}>
              <View style={styles.stakeActionCell}>
                <ActionButton
                  label={pullRefreshing ? 'Refreshing…' : busy ? 'Staking…' : 'Create Stake'}
                  onPress={onCreateStake}
                  disabled={pullRefreshing}
                  fullWidth
                />
              </View>
              <View style={styles.stakeActionCell}>
                <ActionButton
                  label={pullRefreshing ? 'Refreshing…' : busy ? 'Unstaking…' : 'Unstake'}
                  onPress={onUnstake}
                  disabled={pullRefreshing}
                  fullWidth
                />
              </View>
              <View style={styles.stakeActionCell}>
                <ActionButton
                  label={pullRefreshing ? 'Refreshing…' : busy ? 'Withdrawing…' : canWithdraw ? 'Withdraw' : 'Withdraw (not available in current state)'}
                  onPress={onWithdraw}
                  disabled={!canWithdraw || pullRefreshing}
                  fullWidth
                />
              </View>
            </View>
            <Text style={styles.meta}>
              Withdraw status (on-chain):{' '}
              <Text style={destination && isInactiveState(destinationState) ? styles.stateInactive : undefined}>
                {destination ? displayStakeState(destinationState) : 'Select destination'}
              </Text>
            </Text>
            <Text style={styles.meta}>Withdraw is enabled only when state is Inactive.</Text>
            <Text style={styles.meta}>State rules: active/activating can unstake; deactivating must finish epoch before merge/withdraw; inactive is withdraw-ready.</Text>

            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Consolidate existing stake accounts</Text>
            <Text style={styles.meta}>Authority wallet: {shortAddr(wallet)}</Text>
            <Text style={styles.meta}>Destination stake account (from connected wallet authority)</Text>
            {!destinationOrderedAccounts.length && <Text style={styles.meta}>No stake accounts available yet.</Text>}
            {!!destinationOrderedAccounts.length && (
            <Text style={styles.meta}>Withdraw-ready: {withdrawReadyAccounts.length} · Inactive: {undelegatedAccounts.length} · Active/Activating/Deactivating: {delegatedAccounts.length} · Syncing: {stakeAccounts.filter((a) => presentStakeState(a.stakeState) === 'syncing').length}</Text>
            )}
            {!!withdrawReadyAccounts.length && (
              <Text style={styles.link} onPress={() => setDestination(withdrawReadyAccounts[0].pubkey)}>
                Jump to first withdraw-ready account
              </Text>
            )}
            <FlatList
              data={destinationOrderedAccounts}
              keyExtractor={(a) => `dest-${a.pubkey}`}
              scrollEnabled={false}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={5}
              renderItem={({ item: a }) => {
                const isDest = destination === a.pubkey;
                return (
                  <Text
                    style={[styles.account, isDest && styles.accountDestination, theme === 'light' && styles.accountLight]}
                    onPress={() => setDestination(a.pubkey)}
                  >
                    {isDest ? '◉' : '◯'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {(a.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL · <Text style={isInactiveState(a.stakeState) ? styles.stateInactive : undefined}>{displayStakeState(a.stakeState)}</Text>
                  </Text>
                );
              }}
            />

            <View style={styles.row}>
              <ActionButton
                label={pullRefreshing ? 'Refreshing…' : busy ? 'Consolidating…' : 'Consolidate'}
                onPress={() => setConfirmConsolidate(true)}
                disabled={!canConsolidate || pullRefreshing}
              />
              <ActionButton
                label={pullRefreshing ? 'Refreshing…' : busy ? 'Dry Run…' : 'Dry Run'}
                onPress={onConsolidateDryRun}
                disabled={!canConsolidate || pullRefreshing}
              />
            </View>

            <Text style={styles.meta}>Source stake accounts (excluding destination · delegated first, inactive below)</Text>
            <Text style={styles.meta}>Selected source accounts: {selectedCount}/{MAX_SOURCE_ACCOUNTS}</Text>
            <Text style={styles.meta}>Preflight now: eligible {compatibleSelectedCount} · excluded {selectedIncompatibleCount}</Text>
            <Text style={styles.meta}>Exclusion reasons: {preflightSummary}</Text>
            <Text style={styles.meta}>Platform fee: {consolidationFeeSkrText} SKR (SKR only · supports maintenance & RPC costs)</Text>
            <View style={styles.row}>
              <ActionButton label={pullRefreshing ? 'Refreshing…' : `Filter: ${sourceFilter}`} onPress={() => setSourceFilter((f) => f === 'high' ? 'low' : f === 'low' ? 'all' : 'high')} disabled={pullRefreshing} />
              <ActionButton label={pullRefreshing ? 'Refreshing…' : (allFilteredSelected ? 'Deselect all' : 'Select all')} onPress={selectAllValidSources} disabled={busy || pullRefreshing || filteredSourceStakeAccounts.length === 0} />
            </View>
            {filteredSourceStakeAccounts.length === 0 && (
              <Text style={styles.meta}>No source accounts available yet. You need at least two stake accounts to consolidate.</Text>
            )}
            <FlatList
              data={filteredSourceStakeAccounts}
              keyExtractor={(a) => `src-${a.pubkey}`}
              scrollEnabled={false}
              initialNumToRender={16}
              maxToRenderPerBatch={16}
              windowSize={7}
              renderItem={({ item: a }) => {
                const checked = !!selected[a.pubkey];
                const compatibility = describeMergeCompatibility(destinationAccountMeta, a);
                const compatible = compatibility.ok;
                return (
                  <Text
                    style={[
                      styles.account,
                      checked && styles.accountSelected,
                      !compatible && styles.accountIncompatible,
                      theme === 'light' && styles.accountLight,
                    ]}
                    onPress={() => {
                      if (!compatible) return;
                      const next = { ...selected };
                      if (!checked && selectedCount >= MAX_SOURCE_ACCOUNTS) {
                        setStatus(`Maximum ${MAX_SOURCE_ACCOUNTS} source stake accounts.`);
                        return;
                      }
                      next[a.pubkey] = !checked;
                      setSelected(next);
                    }}
                  >
                    {compatible ? (checked ? '☑' : '☐') : '⛔'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {(a.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL · <Text style={isInactiveState(a.stakeState) ? styles.stateInactive : undefined}>{displayStakeState(a.stakeState)}</Text>{!compatible ? ` · ${compatibility.reason}` : ''}
                  </Text>
                );
              }}
            />
          </Animated.View>
        )}

        {mode === 'send' && (
          <Animated.View style={[styles.card, theme === 'light' && styles.cardLight, { opacity: modeFade, transform: [{ translateY: modeFade.interpolate({ inputRange: [0.92, 1], outputRange: [4, 0] }) }] }]}>
            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Send SOL (supports SNS .sol names)</Text>
            <TextInput
              style={[styles.input, theme === 'light' && styles.inputLight]}
              placeholder="Recipient pubkey or name.sol"
              placeholderTextColor={colors.muted}
              value={sendTo}
              onChangeText={setSendTo}
              autoCapitalize="none"
            />
            {sendTo.trim().toLowerCase().endsWith('.sol') && (
              <Text style={styles.meta}>
                {snsPreviewBusy
                  ? 'Resolving SNS name...'
                  : snsPreview
                    ? `Resolves to: ${shortAddr(snsPreview)}`
                    : 'Could not resolve this .sol yet'}
              </Text>
            )}
            <TextInput
              style={[styles.input, theme === 'light' && styles.inputLight]}
              placeholder="Amount SOL"
              placeholderTextColor={colors.muted}
              value={sendSol}
              onChangeText={setSendSol}
              keyboardType="decimal-pad"
            />
            <View style={styles.equalBtnRow}>
              <View style={styles.equalBtnCell}>
                <ActionButton label="Max" onPress={onSendMax} disabled={busy} />
              </View>
              <View style={styles.equalBtnCell}>
                <ActionButton label={busy ? 'Sending…' : 'Send'} onPress={onSend} />
              </View>
            </View>
          </Animated.View>
        )}

        {mode === 'swap' && (
          <Animated.View style={[styles.card, theme === 'light' && styles.cardLight, { opacity: modeFade, transform: [{ translateY: modeFade.interpolate({ inputRange: [0.92, 1], outputRange: [4, 0] }) }] }]}>
            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Swap (Jupiter)</Text>
            <Text style={styles.meta}>Pair: SOL ↔ SKR</Text>
            <View style={styles.swapTopRow}>
              <Pressable
                onPress={() => setSwapDir((d) => (d === 'SOL_TO_SKR' ? 'SKR_TO_SOL' : 'SOL_TO_SKR'))}
                style={({ pressed }) => [styles.swapTopBtn, pressed && styles.swapTopBtnPressed]}
              >
                <Text style={styles.swapTopBtnText}>{swapDir === 'SOL_TO_SKR' ? 'SOL → SKR' : 'SKR → SOL'}</Text>
              </Pressable>
              <Pressable
                onPress={() => setSwapSlippageBps((s) => Math.max(10, s - 10))}
                style={({ pressed }) => [styles.swapTinyBtn, pressed && styles.swapTopBtnPressed]}
              >
                <Text style={styles.swapTopBtnText}>-</Text>
              </Pressable>
              <Pressable
                onPress={() => {}}
                style={({ pressed }) => [styles.swapSlipBtn, pressed && styles.swapTopBtnPressed]}
              >
                <Text style={styles.swapTopBtnText}>Slip {(swapSlippageBps / 100).toFixed(2)}%</Text>
              </Pressable>
              <Pressable
                onPress={() => setSwapSlippageBps((s) => Math.min(300, s + 10))}
                style={({ pressed }) => [styles.swapTinyBtn, pressed && styles.swapTopBtnPressed]}
              >
                <Text style={styles.swapTopBtnText}>+</Text>
              </Pressable>
            </View>
            <TextInput
              style={[styles.input, theme === 'light' && styles.inputLight]}
              placeholder={swapDir === 'SOL_TO_SKR' ? 'Amount SOL' : 'Amount SKR'}
              placeholderTextColor={colors.muted}
              value={swapAmount}
              onChangeText={setSwapAmount}
              keyboardType="decimal-pad"
            />
            <View style={styles.swapActionRow}>
              <Pressable
                style={({ pressed }) => [styles.swapActionBtn, pressed && styles.swapActionBtnPressed]}
                onPress={fetchSwapQuote}
              >
                <Text style={styles.swapActionBtnText}>{swapBusy ? 'Quoting…' : 'Get Quote'}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.swapActionBtn, pressed && styles.swapActionBtnPressed]}
                onPress={executeSwapInApp}
              >
                <Text style={styles.swapActionBtnText}>{swapBusy ? 'Swapping…' : 'Swap Now'}</Text>
              </Pressable>
            </View>
            {!!swapQuoteText && <Text style={styles.swapQuote}>{swapQuoteText}</Text>}
            {!!swapMinReceivedText && <Text style={styles.meta}>Min received: {swapMinReceivedText}</Text>}
            {!!swapRouteText && <Text style={styles.meta}>Route: {swapRouteText}</Text>}
            <Text style={styles.meta}>Price impact: {(swapImpactPct * 100).toFixed(3)}%</Text>
            {swapImpactPct > 0.02 && <Text style={styles.warnText}>⚠ High price impact — consider reducing amount.</Text>}
            {swapStale && <Text style={styles.warnText}>⚠ Quote stale — auto-refreshing.</Text>}
            <Text style={styles.meta}>Swap executes in-app via Jupiter transaction.</Text>
          </Animated.View>
        )}

        {mode === 'receive' && (
          <Animated.View style={[styles.card, theme === 'light' && styles.cardLight, { opacity: modeFade, transform: [{ translateY: modeFade.interpolate({ inputRange: [0.92, 1], outputRange: [4, 0] }) }] }]}>
            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Receive</Text>
            <View style={styles.swapActionRow}>
              <Pressable
                style={({ pressed }) => [styles.swapActionBtn, pressed && styles.swapActionBtnPressed]}
                onPress={copyWalletAddress}
              >
                <Text style={styles.swapActionBtnText}>Copy Address</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.swapActionBtn, pressed && styles.swapActionBtnPressed]}
                onPress={() => setShowQr((v) => !v)}
              >
                <Text style={styles.swapActionBtnText}>{showQr ? 'Hide QR' : 'Show QR'}</Text>
              </Pressable>
            </View>
            <Text style={styles.meta}>{wallet}</Text>
            {showQr && (
              <View style={styles.qrWrap}>
                <QRCode value={wallet} size={180} backgroundColor={colors.panel} color={colors.text} />
              </View>
            )}
            <ActionButton label="Open in Explorer" onPress={() => Linking.openURL(addressUrl(wallet, cluster, explorer))} />
          </Animated.View>
        )}

        {!!status && <Text style={styles.statusMuted}>{status}</Text>}
        {!!lastSignature && (
          <View>
            <Text style={styles.meta}>Latest tx: {shortAddr(lastSignature)}</Text>
            <Text style={styles.link} onPress={() => Linking.openURL(txUrl(lastSignature, cluster, explorer))}>
              Open latest transaction on {explorerLabel}
            </Text>
          </View>
        )}

        {txHistory.length > 0 && (
          <View>
            <Text style={styles.meta}>Recent transactions</Text>
            {txHistory.map((sig, idx) => {
              const txState = pendingTxSet.has(sig) ? 'submitted' : 'confirmed';
              return (
                <Text key={sig} style={styles.link} onPress={() => Linking.openURL(txUrl(sig, cluster, explorer))}>
                  {idx + 1}. {shortAddr(sig)} [{txState}]
                </Text>
              );
            })}
          </View>
        )}
        {txLifecycleEvents.length > 0 && (
          <View>
            <Text style={styles.meta}>TX lifecycle (latest 5)</Text>
            {txLifecycleEvents.slice(0, 5).map((ev, idx) => (
              <Text key={`${ev.at}-${ev.label}-${idx}`} style={styles.meta}>
                {idx + 1}. [{ev.stage}] {ev.label}{ev.sig ? ` · ${shortAddr(ev.sig)}` : ''}{ev.note ? ` · ${ev.note}` : ''}
              </Text>
            ))}
          </View>
        )}
        </ScrollView>

        <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.gearBtnTopRight}>
          <Text style={styles.gearIcon}>⚙️</Text>
        </Pressable>

        {showSettings && (
          <View style={[styles.settingsSheet, { backgroundColor: palette.panel, borderColor: palette.border }]}>
          <Text style={[styles.label, theme === 'light' && styles.labelLight, { color: palette.text }]}>Settings</Text>
          <View style={styles.row}>
            <Text style={styles.meta}>Network: Mainnet</Text>
            <ActionButton label={`Theme: ${theme === 'dark' ? 'Dark' : 'Light'}`} onPress={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} />
          </View>
          <ActionButton label={`Explorer: ${explorerLabel}`} onPress={() => setShowExplorerOptions((v) => !v)} />
          {showExplorerOptions && (
            <View style={[styles.dropdownBox, theme === 'light' && styles.dropdownBoxLight]}>
              <Text style={[styles.dropdownItem, theme === 'light' && styles.dropdownItemLight]} onPress={() => { setExplorer('orbmarkets'); setShowExplorerOptions(false); }}>OrbMarkets.io</Text>
              <Text style={[styles.dropdownItem, theme === 'light' && styles.dropdownItemLight]} onPress={() => { setExplorer('solscan'); setShowExplorerOptions(false); }}>Solscan.io</Text>
              <Text style={[styles.dropdownItem, theme === 'light' && styles.dropdownItemLight]} onPress={() => { setExplorer('solana'); setShowExplorerOptions(false); }}>Explorer.Solana.com</Text>
            </View>
          )}

          <ActionButton label="What's New" onPress={() => setShowWhatsNew(true)} />
          <ActionButton
            label={`Consolidation Mode: ${consolidationSendMode === 'sequential' ? 'Sequential' : 'Batch'}`}
            onPress={() =>
              setConsolidationSendMode((m) => (m === 'sequential' ? 'batch' : 'sequential'))
            }
          />
          <ActionButton
            label={`Batch Chunk: ${batchTxChunkSize} tx`}
            onPress={() =>
              setBatchTxChunkSize((n) => (n === 2 ? 3 : n === 3 ? 4 : 2))
            }
          />
          <ActionButton label="Quick Tips" onPress={() => setShowTips(true)} />
          <ActionButton label="View Fee Policy" onPress={() => setShowFeePolicy(true)} />
          <ActionButton label="Copy Fee Wallet" onPress={copyFeeWallet} />
          <ActionButton label="Copy Debug Report" onPress={copyDebugReport} />
          <ActionButton label="Copy TX Lifecycle Report" onPress={copyTxLifecycleReport} />
          <ActionButton label="Export Logs (Share)" onPress={exportLogsToShare} />
          <ActionButton label="Copy Support Bundle" onPress={copySupportBundle} />
          <ActionButton label="Report Issue Template" onPress={copyIssueTemplate} />

          </View>
        )}

        {confirmConsolidate && (
          <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Confirm consolidation</Text>
            <Text style={styles.meta}>Destination: {shortAddr(destination)}</Text>
            <Text style={styles.meta}>Sources: {selectedCount}</Text>
            <Text style={styles.meta}>Platform fee: {consolidationFeeSkrText} SKR (SKR only)</Text>
            <Text style={styles.meta}>Fee wallet: {shortAddr(PLATFORM_FEE_WALLET)}</Text>
            <Text style={styles.meta}>Mode: {consolidationSendMode === 'sequential' ? 'Sequential' : 'Batch'}</Text>
            <Text style={styles.meta}>Batch chunk size: {batchTxChunkSize} tx/request</Text>
            <Text style={styles.meta}>Breakdown: fee tx 1 + merge txs {estimatedMergeTxCount}</Text>
            <Text style={styles.meta}>Preflight: eligible {compatibleSelectedCount} · excluded {selectedIncompatibleCount}</Text>
            <Text style={styles.meta}>Reasons: {preflightSummary}</Text>
            {selectedCompatibility.slice(0, 8).map((row) => (
              <Text key={`pf-${row.pubkey}`} style={styles.meta}>
                {row.ok ? '✅' : '⛔'} {shortAddr(row.pubkey)} · {row.reason}
              </Text>
            ))}
            {selectedCompatibility.length > 8 && (
              <Text style={styles.meta}>…and {selectedCompatibility.length - 8} more selected sources.</Text>
            )}
            <Text style={styles.meta}>No hidden fees.</Text>
            <View style={styles.row}>
              <ActionButton label="Cancel" onPress={() => setConfirmConsolidate(false)} />
              <ActionButton
                label={busy ? 'Consolidating…' : 'Yes, consolidate'}
                onPress={async () => {
                  setConfirmConsolidate(false);
                  await onConsolidate();
                }}
                disabled={busy}
              />
            </View>
          </View>
          </View>
        )}

        {showStatusModal && !!status && (
          <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Notice</Text>
            <Text style={styles.meta}>{status}</Text>
            <ActionButton label="OK" onPress={() => { setShowStatusModal(false); setStatus(''); }} />
          </View>
          </View>
        )}

        {showFeePolicy && (
          <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Fee Policy</Text>
            <Text style={styles.meta}>Token: SKR only</Text>
            <Text style={styles.meta}>Mint: {shortAddr(SKR_MINT)}</Text>
            <Text style={styles.meta}>Formula: {PLATFORM_FEE_PER_SOURCE_SKR} SKR × source accounts</Text>
            <Text style={styles.meta}>Cap: {PLATFORM_FEE_CAP_SKR} SKR per consolidation</Text>
            <Text style={styles.meta}>Collector wallet: {PLATFORM_FEE_WALLET}</Text>
            <Text style={styles.meta}>No hidden fees.</Text>
            <ActionButton label="Close" onPress={() => setShowFeePolicy(false)} />
          </View>
          </View>
        )}

        {showWhatsNew && (
          <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>What's New · {APP_VERSION_LABEL}</Text>
            <Text style={styles.meta}>• SKR-only consolidation fee model</Text>
            <Text style={styles.meta}>• Fee policy + no-hidden-fees transparency</Text>
            <Text style={styles.meta}>• Withdraw flow and inactive-account handling improved</Text>
            <Text style={styles.meta}>• Wallet box now shows SOL and SKR balances</Text>
            <Text style={styles.meta}>• Lifecycle/app-switch stability hardening</Text>
            <Text style={styles.meta}>• Consolidation preflight + tx lifecycle reporting + idempotency guard</Text>
            <ActionButton label="Close" onPress={() => setShowWhatsNew(false)} />
          </View>
          </View>
        )}

        {showTips && (
          <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Quick Tips</Text>
            <Text style={styles.meta}>• Create stake above rent-exempt minimum (tiny amounts fail by design).</Text>
            <Text style={styles.meta}>• Consolidate to one destination; use batch for large runs, sequential for step-by-step control.</Text>
            <Text style={styles.meta}>• Batch chunk size is configurable (2/3/4); default 3 is best reliability.</Text>
            <Text style={styles.meta}>• Use Dry Run before signing to get a simulation report and eligibility reasons.</Text>
            <Text style={styles.meta}>• Withdraw only when status is Inactive, then refresh after confirmations.</Text>
            <Text style={styles.meta}>• Pull down on the app to refresh balances and account states.</Text>
            <ActionButton label="Got it" onPress={() => setShowTips(false)} />
          </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 32, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.primary, marginBottom: 8, textAlign: 'center' },
  rpcBadge: {
    alignSelf: 'center',
    color: '#072225',
    backgroundColor: '#B8F6E8',
    borderColor: '#5FDAC1',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    marginBottom: 4,
  },
  rpcBadgeBad: {
    backgroundColor: '#FFD9D9',
    borderColor: '#FF9B9B',
  },
  splashLogo: { width: 320, height: 90 },
  splashRootLight: { backgroundColor: '#fff' },
  splashRootDark: { backgroundColor: '#000' },
  landingRootDark: { backgroundColor: '#000' },
  landingTitle: { color: '#fff' },
  landingNetworkMeta: { color: '#14F195', textAlign: 'center', marginBottom: 10 },
  landingConnectHint: { color: '#14F195' },
  bannerLogo: { width: '100%', height: 46, marginBottom: 6 },

  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardLight: {
    backgroundColor: '#DDF7F1',
    borderColor: '#8ADFD3',
  },
  stakeCardLight: {
    backgroundColor: '#DDF7F1',
    borderColor: '#8ADFD3',
  },
  label: { color: colors.text, fontWeight: '700' },
  labelLight: { color: '#072225' },
  walletBox: {
    backgroundColor: '#0f0f16',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  walletText: { color: colors.primary, fontWeight: '700' },
  walletSummary: { flex: 1, marginRight: 8 },
  walletBoxLight: { backgroundColor: '#DDF7F1', borderColor: '#8ADFD3' },
  walletTextLight: { color: '#072225' },
  validatorBox: {
    backgroundColor: '#0f0f16',
    borderColor: colors.secondary,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  validatorBoxDarkHighlight: {
    backgroundColor: '#FFFFFF',
    borderColor: '#8ADFD3',
  },
  validatorTitle: { color: '#FFFFFF', fontWeight: '700' },
  validatorTitleDarkHighlight: { color: '#072225' },
  validatorAddr: { color: colors.primary, fontSize: 12 },
  input: {
    backgroundColor: '#0f0f16',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  inputLight: {
    backgroundColor: '#FFFFFF',
    color: '#072225',
    borderColor: '#8ADFD3',
  },
  row: { flexDirection: 'row', marginBottom: 6, flexWrap: 'wrap', gap: 8 },
  stakeActionRow: { flexDirection: 'row', marginBottom: 6, gap: 8 },
  stakeActionCell: { flex: 1 },
  equalBtnRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  equalBtnCell: { flex: 1 },
  modeTabsRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  modeTabBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#101824',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabBtnActive: {
    borderColor: '#00D7C8',
    backgroundColor: '#14F195',
  },
  modeTabTxt: {
    color: '#D6EFEA',
    fontSize: 13,
    fontWeight: '700',
  },
  modeTabTxtActive: {
    color: '#072225',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerCenter: { alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 4 },
  headerLogo: { width: 240, height: 40 },
  gearBtnTopRight: {
    position: 'absolute',
    right: 14,
    top: 14,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    zIndex: 80,
  },
  gearIcon: { fontSize: 18 },
  settingsSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 58,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    zIndex: 20,
  },
  dropdownBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 6,
    backgroundColor: '#081416',
  },
  dropdownBoxLight: {
    backgroundColor: '#FFFFFF',
    borderColor: '#8ADFD3',
  },
  dropdownItem: {
    color: colors.text,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  dropdownItemLight: {
    color: '#072225',
  },
  qrWrap: { alignItems: 'center', marginVertical: 8 },
  meta: { color: colors.muted },
  stateInactive: { color: colors.primary, fontWeight: '700' },
  account: { color: colors.text, paddingVertical: 6 },
  accountLight: { color: '#072225' },
  accountSelected: { color: colors.primary },
  accountIncompatible: { color: colors.muted, opacity: 0.65 },
  accountDestination: { color: colors.secondary },
  status: { color: colors.secondary, marginTop: 10 },
  statusMuted: { color: colors.secondary, marginTop: 10, opacity: 0.7 },
  link: { color: colors.primary, textDecorationLine: 'underline', marginTop: 6 },
  swapTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  swapTopBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#00D7C8',
    backgroundColor: '#14F195',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTopBtnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
    borderColor: '#00B8AB',
    backgroundColor: '#0AD7B8',
  },
  swapSlipBtn: {
    minWidth: 92,
    borderWidth: 1,
    borderColor: '#00D7C8',
    backgroundColor: '#14F195',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTinyBtn: {
    width: 34,
    borderWidth: 1,
    borderColor: '#00D7C8',
    backgroundColor: '#14F195',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTopBtnText: { color: '#072225', fontWeight: '700', fontSize: 13 },
  swapActionRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  swapActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#00D7C8',
    backgroundColor: '#14F195',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapActionBtnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
    borderColor: '#00B8AB',
    backgroundColor: '#0AD7B8',
  },
  swapActionBtnText: { color: '#072225', fontWeight: '700', fontSize: 14 },
  swapQuote: { color: '#14F195', fontWeight: '700', marginTop: 4 },
  warnText: { color: '#FFB86B', fontWeight: '700', marginTop: 4 },
  confirmOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 50,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#081416',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
});
