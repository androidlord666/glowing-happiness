import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import {
  Linking,
  SafeAreaView,
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
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import { LAMPORTS_PER_SOL, StakeProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
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

const walletAdapter = createWalletAdapter();
const solanaMobileWhiteLogo = require('./src/assets/solana-mobile-white.png');
const solanaMobileBlackLogo = require('./src/assets/solana-mobile-black.png');

type Mode = 'stake' | 'send' | 'receive' | 'swap';
type Screen = 'splash' | 'landing' | 'app';
type ThemeMode = 'dark' | 'light';
type RpcHealth = 'healthy' | 'degraded';
type SourceFilter = 'all' | 'high' | 'low';

const APP_VERSION_LABEL = 'v2.39 (code 50)';
const MAX_SOURCE_ACCOUNTS = 25;

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

function isDelegatedState(state?: string): boolean {
  const s = presentStakeState(state);
  return s === 'delegated' || s === 'activating' || s === 'active' || s === 'deactivating';
}

function isWithdrawReadyState(state?: string): boolean {
  const s = presentStakeState(state);
  // In practice, some warming-up accounts can still be withdrawable.
  return s === 'undelegated' || s === 'inactive' || s === 'activating';
}

function isMergeStateCompatible(destinationState?: string, sourceState?: string): boolean {
  const dest = presentStakeState(destinationState);
  const source = presentStakeState(sourceState);
  if (dest === 'syncing' || source === 'syncing') return true;
  const destDelegated = isDelegatedState(dest);
  const sourceDelegated = isDelegatedState(source);
  if (destDelegated !== sourceDelegated) return false;
  if (!destDelegated) {
    return source === 'undelegated' || source === 'inactive';
  }
  return source === 'delegated' || source === 'active' || source === 'activating' || source === 'deactivating';
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
};

async function getStakeParsedMeta(connection: any, account: string): Promise<StakeParsedMeta> {
  const pubkey = asPublicKey(account);
  const info = await connection.getParsedAccountInfo(pubkey, 'confirmed');
  const parsed = (info.value?.data as any)?.parsed;
  const stake = parsed?.info?.stake;

  let delegationState = parsed?.type as string | undefined;
  if (delegationState === 'delegated') {
    try {
      const activation = await connection.getStakeActivation(pubkey, 'confirmed');
      if (activation?.state) delegationState = activation.state;
    } catch {
      // keep delegated fallback when activation lookup is unavailable
    }
  }

  return {
    delegationVote: stake?.delegation?.voter,
    delegationState,
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [splashPhase, setSplashPhase] = useState<0 | 1>(0);
  const [wallet, setWallet] = useState<string>('');
  const [mode, setMode] = useState<Mode>('stake');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [cluster, setCluster] = useState<ClusterName>(DEFAULT_CLUSTER);
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
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [isAppActive, setIsAppActive] = useState(true);
  const modeFade = useState(new Animated.Value(1))[0];
  const landingFade = useState(new Animated.Value(0))[0];
  const lastStakeAccountsRef = useRef<StakeAccountInfo[]>([]);
  const lastRefreshAtRef = useRef(0);
  const refreshMetricsRef = useRef({ count: 0, totalMs: 0 });

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
    const s = status.toLowerCase();
    if (s.includes('error') || s.includes('failed') || s.includes('issue')) {
      setShowStatusModal(true);
    }
  }, [status]);

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
  const validatorVote = VALIDATOR_VOTE_BY_CLUSTER[cluster];
  const canConsolidate = !busy && !!destination && selectedCount > 0 && selectedCount <= MAX_SOURCE_ACCOUNTS;
  const destinationState = presentStakeState(stakeAccounts.find((a) => a.pubkey === destination)?.stakeState);
  const withdrawReadyAccounts = useMemo(
    () => stakeAccounts.filter((a) => isWithdrawReadyState(a.stakeState)),
    [stakeAccounts]
  );
  const canWithdraw = FEATURE_WITHDRAW_ENABLED && !busy && !!destination && isWithdrawReadyState(destinationState);
  const consolidationFeeSkr = FEATURE_FEE_ENABLED
    ? Math.min(selectedCount * PLATFORM_FEE_PER_SOURCE_SKR, PLATFORM_FEE_CAP_SKR)
    : 0;
  const consolidationFeeSkrText = consolidationFeeSkr.toFixed(2);
  const pendingTxSet = useMemo(() => new Set(pendingTxs.map((p) => p.sig)), [pendingTxs]);

  const rememberTx = (sig: string) => {
    setLastSignature(sig);
    setTxHistory((prev) => [sig, ...prev.filter((s) => s !== sig)].slice(0, 5));
  };

  const trackPendingTx = (sig: string, label: string) => {
    setPendingTxs((prev) => {
      if (prev.some((p) => p.sig === sig)) return prev;
      return [...prev, { sig, label }];
    });
  };

  const refreshWalletBalances = async (walletAddr?: string) => {
    const active = walletAddr ?? wallet;
    if (!active) return;
    try {
      const owner = asPublicKey(active);
      const mint = asPublicKey(SKR_MINT);
      const ownerAta = getAssociatedTokenAddressSync(mint, owner);

      const [lamports, skrBal] = await Promise.all([
        connection.getBalance(owner, 'confirmed'),
        connection.getTokenAccountBalance(ownerAta, 'confirmed').catch(() => null),
      ]);

      setWalletSolBalance((lamports / LAMPORTS_PER_SOL).toFixed(4));
      setWalletSkrBalance(skrBal?.value?.uiAmountString ?? '0');
    } catch {
      // keep last-known balances to avoid flicker/disappearing values
    }
  };

  const onPullRefresh = async () => {
    if (!wallet) return;
    setPullRefreshing(true);

    // Make pull-to-refresh feel snappy; finish spinner early while sync continues.
    const fallback = setTimeout(() => setPullRefreshing(false), 1800);
    try {
      await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
    } finally {
      clearTimeout(fallback);
      setPullRefreshing(false);
    }
  };

  const allFilteredSelected = useMemo(() => {
    if (!filteredSourceStakeAccounts.length) return false;
    const subset = filteredSourceStakeAccounts.slice(0, MAX_SOURCE_ACCOUNTS);
    return subset.every((a) => !!selected[a.pubkey]);
  }, [filteredSourceStakeAccounts, selected]);

  const selectAllValidSources = () => {
    const subset = filteredSourceStakeAccounts.slice(0, MAX_SOURCE_ACCOUNTS);
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
  }, [pendingTxs, connection, isAppActive]);

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

      const now = Date.now();
      if (!walletOverride && now - lastRefreshAtRef.current < 3500) {
        setStatus('rpc request cooldown 🙏😎');
        if (lastStakeAccountsRef.current.length) {
          setStakeAccounts(lastStakeAccountsRef.current);
        }
        return;
      }

      lastRefreshAtRef.current = now;
      if (!opts?.skipBusy) setBusy(true);
      setStatus('Refreshing stake accounts...');
      const startedAt = Date.now();

      const items = await withRetries(
        () => fetchStakeAccounts(connection, activeWallet, cluster),
        2,
        500
      );

      // Accuracy-first: resolve stake state for all accounts in this refresh pass.
      const seeded = items.map((a) => ({ ...a, stakeState: a.stakeState ?? 'syncing' }));
      setRpcHealth('healthy');
      setStakeAccounts(seeded);

      const resolved = await Promise.all(
        seeded.map(async (a) => {
          try {
            const meta = await getStakeParsedMeta(connection, a.pubkey);
            return { ...a, stakeState: meta.delegationState ?? 'unknown' };
          } catch {
            return { ...a, stakeState: 'unknown' };
          }
        })
      );

      lastStakeAccountsRef.current = resolved;
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
      if (!opts?.skipBusy) setBusy(false);
    }
  };

  const onCreateStake = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      const amount = Number(createStakeSol);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter valid SOL amount');

      const balLamports = await connection.getBalance(asPublicKey(wallet));
      if (balLamports < Math.round(amount * LAMPORTS_PER_SOL)) {
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
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Stake transaction');
        setStatus(`🛰️ Stake transaction submitted. Confirming...`);
        await connection.confirmTransaction(sigs[0], 'confirmed');
      }
      setDestination(stakeAddress);
      await refreshWalletBalances(wallet);
      setStatus(`✅ Delegated ${createStakeSol} SOL to validator ${shortAddr(validatorVote)}. Swipe down from top to sync new stake account state.`);
    } catch (e: any) {
      setStatus(actionError('Create+stake error', e));
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
            nextHint = `State: ${activation.state} (epoch ${epochInfo.epoch}). Withdraw enables when inactive/undelegated.`;
          }
        } catch {
          // keep default hint
        }
        await refreshWalletBalances(wallet);
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
      if (!destination) throw new Error('Select a stake account first');

      setBusy(true);
      setStatus('Checking stake account withdraw eligibility...');

      const stakePubkey = asPublicKey(destination);
      const accountInfo = await connection.getAccountInfo(stakePubkey, 'confirmed');

      if (!accountInfo) throw new Error('Stake account not found. Refresh and try again.');
      if (!accountInfo.owner.equals(StakeProgram.programId)) {
        throw new Error('Selected account is not a stake account.');
      }

      const lamports = accountInfo.lamports;
      if (lamports <= 0) throw new Error('No lamports available to withdraw from this stake account.');

      setStatus('Submitting withdraw transaction...');
      const tx = await buildWithdrawStakeTx({
        connection,
        owner: asPublicKey(wallet),
        stakeAccount: asPublicKey(destination),
        to: asPublicKey(wallet),
        lamports,
      });

      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      if (sigs[0]) {
        rememberTx(sigs[0]);
        trackPendingTx(sigs[0], 'Withdraw transaction');
        setStatus(`💸 Withdraw submitted for ${shortAddr(destination)}. Confirming...`);
        await connection.confirmTransaction(sigs[0], 'confirmed');
        await refreshWalletBalances(wallet);
        setStatus(`✅ Withdraw confirmed to wallet ${shortAddr(wallet)}. Swipe down from top to sync stake list.`);
      }
    } catch (e: any) {
      setStatus(actionError('Withdraw error', e));
    } finally {
      setBusy(false);
    }
  };

  const onConsolidate = async () => {
    if (busy) return;
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select destination stake account from list below');
      const availableSourceCount = sourceStakeAccounts.length;
      if (availableSourceCount < 1) {
        throw new Error('Need at least 2 stake accounts. Create another stake account, then select source account(s).');
      }

      if (sourceSelectedKeys.length === 0) throw new Error('Select at least one source stake account below.');
      if (sourceSelectedKeys.length > MAX_SOURCE_ACCOUNTS) throw new Error(`Max ${MAX_SOURCE_ACCOUNTS} source stake accounts`);

      setBusy(true);
      setStatus('Validating merge eligibility...');

      const [destMeta, ...sourceMeta] = await Promise.all([
        getStakeParsedMeta(connection, destination),
        ...sourceSelectedKeys.map((k) => getStakeParsedMeta(connection, k)),
      ]);
      const eligibilityReasons: string[] = [];
      const eligibleSourceKeys = sourceSelectedKeys.filter((key, idx) => {
        const meta = sourceMeta[idx];
        if (destMeta.delegationVote && meta.delegationVote && meta.delegationVote !== destMeta.delegationVote) {
          eligibilityReasons.push(`${shortAddr(key)}: delegated to different validator`);
          return false;
        }
        if (!isMergeStateCompatible(destMeta.delegationState, meta.delegationState)) {
          eligibilityReasons.push(`${shortAddr(key)}: incompatible stake state (${presentStakeState(meta.delegationState)})`);
          return false;
        }
        return true;
      });

      if (eligibleSourceKeys.length === 0) {
        throw new Error(`No merge-eligible source accounts. ${eligibilityReasons[0] ?? ''}`.trim());
      }

      const owner = asPublicKey(wallet);
      const includeDelegateTx = !isDelegatedState(destMeta.delegationState);
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

      const mergeTxCandidates = includeDelegateTx ? txs.slice(1) : txs;
      if (mergeTxCandidates.length === 0) {
        throw new Error('No merge transactions were created.');
      }

      setStatus('Preflighting merge transactions...');
      const preflight = await Promise.all(
        mergeTxCandidates.map(async (tx) => {
          try {
            const sim = await connection.simulateTransaction(tx as any, {
              sigVerify: false,
              replaceRecentBlockhash: true,
              commitment: 'confirmed',
            } as any);
            return { ok: !sim.value.err, err: sim.value.err };
          } catch (e: any) {
            return { ok: false, err: e?.message ?? 'simulation failed' };
          }
        })
      );

      const preflightValid = mergeTxCandidates.filter((_, i) => preflight[i].ok);
      const mergeTxsToSend = preflightValid.length ? preflightValid : mergeTxCandidates;
      const skippedByPreflight = preflight.length - preflightValid.length;

      const submittedMergeSigs: string[] = [];
      let failedMergeCount = 0;
      for (let i = 0; i < mergeTxsToSend.length; i++) {
        const tx = mergeTxsToSend[i];
        try {
          const recent = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = recent.blockhash;
          tx.lastValidBlockHeight = recent.lastValidBlockHeight;
          tx.feePayer = owner;

          setStatus(`Submitting consolidation tx ${i + 1}/${mergeTxsToSend.length}...`);
          const sigs = await walletAdapter.signAndSendTransactions([tx]);
          const sig = sigs[0];
          if (!sig) throw new Error('wallet returned empty signature');
          rememberTx(sig);
          trackPendingTx(sig, `Consolidation tx ${i + 1}/${mergeTxsToSend.length}`);
          await connection.confirmTransaction(sig, 'confirmed');
          submittedMergeSigs.push(sig);
        } catch (e: any) {
          if (classifyError(e) === 'user') throw e;
          failedMergeCount += 1;
        }
      }

      if (submittedMergeSigs.length === 0) {
        throw new Error('No consolidation transaction was confirmed. Refresh and try smaller batches.');
      }

      let feeSig = '';
      const chargedFeeSkr = FEATURE_FEE_ENABLED
        ? Math.min(submittedMergeSigs.length * PLATFORM_FEE_PER_SOURCE_SKR, PLATFORM_FEE_CAP_SKR)
        : 0;

      if (chargedFeeSkr > 0) {
        const mint = asPublicKey(SKR_MINT);
        const feeWallet = asPublicKey(PLATFORM_FEE_WALLET);
        const ownerAta = getAssociatedTokenAddressSync(mint, owner);
        const feeAta = getAssociatedTokenAddressSync(mint, feeWallet);

        const [mintInfo, ownerTokenBal] = await Promise.all([
          connection.getParsedAccountInfo(mint, 'confirmed'),
          connection.getTokenAccountBalance(ownerAta, 'confirmed').catch(() => null),
        ]);

        const decimals = Number((mintInfo.value?.data as any)?.parsed?.info?.decimals ?? NaN);
        if (!Number.isFinite(decimals)) {
          throw new Error('Could not read SKR mint decimals.');
        }

        if (!ownerTokenBal?.value?.amount) {
          throw new Error('No SKR token account found in connected wallet.');
        }

        const rawAmount = BigInt(Math.round(chargedFeeSkr * Math.pow(10, decimals)));
        const ownerRaw = BigInt(ownerTokenBal.value.amount);
        if (ownerRaw < rawAmount) {
          throw new Error(`Insufficient SKR for fee. Need ${chargedFeeSkr.toFixed(2)} SKR.`);
        }

        const recent = await connection.getLatestBlockhash('confirmed');
        const feeTx = new Transaction({
          feePayer: owner,
          blockhash: recent.blockhash,
          lastValidBlockHeight: recent.lastValidBlockHeight,
        });

        const feeAtaInfo = await connection.getAccountInfo(feeAta, 'confirmed');
        if (!feeAtaInfo) {
          feeTx.add(createAssociatedTokenAccountInstruction(owner, feeAta, feeWallet, mint));
        }

        feeTx.add(
          createTransferCheckedInstruction(
            ownerAta,
            mint,
            feeAta,
            owner,
            Number(rawAmount),
            decimals
          )
        );

        const feeSim = await connection.simulateTransaction(feeTx as any, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'confirmed',
        } as any);
        if (feeSim.value.err) {
          throw new Error(`Fee transaction simulation failed: ${JSON.stringify(feeSim.value.err)}`);
        }

        setStatus('Submitting platform fee transaction...');
        const feeSigs = await walletAdapter.signAndSendTransactions([feeTx]);
        feeSig = feeSigs[0] ?? '';
        if (feeSig) {
          rememberTx(feeSig);
          trackPendingTx(feeSig, 'Platform fee transaction (SKR)');
          await connection.confirmTransaction(feeSig, 'confirmed');
        }
      }

      setSelected({});
      await refreshWalletBalances(wallet);
      const notes: string[] = [];
      if (eligibilityReasons.length) notes.push(`skipped ${eligibilityReasons.length} ineligible`);
      if (preflightValid.length && skippedByPreflight) notes.push(`skipped ${skippedByPreflight} preflight-failed`);
      if (failedMergeCount) notes.push(`failed ${failedMergeCount} during send`);
      const noteText = notes.length ? ` (${notes.join(', ')})` : '';
      setStatus(`✅ Consolidation confirmed (${submittedMergeSigs.length} merge tx${feeSig ? ' + fee tx' : ''}; fee ${chargedFeeSkr.toFixed(2)} SKR).${noteText} Syncing stake state...`);
      await loadStakeAccounts(wallet, { skipBalances: true, skipBusy: true });
    } catch (e: any) {
      setStatus(actionError('Consolidation error', e));
    } finally {
      setBusy(false);
    }
  };

  const fetchSwapQuote = async () => {
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
  };

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
        const owner = asPublicKey(wallet);
        const ownerAta = getAssociatedTokenAddressSync(asPublicKey(SKR_MINT), owner);
        const [solLamports, skrBal] = await Promise.all([
          connection.getBalance(owner, 'confirmed'),
          connection.getTokenAccountBalance(ownerAta, 'confirmed').catch(() => null),
        ]);
        const afterSol = solLamports / LAMPORTS_PER_SOL;
        const afterSkr = Number(skrBal?.value?.uiAmountString ?? '0');
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
  }, [mode, isAppActive, swapAmount, swapDir, swapSlippageBps, swapBusy, walletSolBalance, walletSkrBalance]);

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
      avgRefreshMs,
      status,
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
      lastSignature,
      recentTxs: txHistory,
      wallet,
      destination,
      timestamp: new Date().toISOString(),
    };
    Clipboard.setString(JSON.stringify(payload, null, 2));
    setStatus('Support bundle copied.');
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
      <SafeAreaView style={[styles.root, styles.centered, { backgroundColor: whitePhase ? '#fff' : '#000' }]}>
        <StatusBar barStyle={whitePhase ? 'dark-content' : 'light-content'} />
        <Image
          source={whitePhase ? solanaMobileBlackLogo : solanaMobileWhiteLogo}
          style={styles.splashLogo}
          resizeMode="contain"
        />
      </SafeAreaView>
    );
  }

  if (screen === 'landing') {
    return (
      <SafeAreaView style={[styles.root, styles.centered, { backgroundColor: '#000' }]}>
        <StatusBar barStyle={'light-content'} />
        <Animated.View style={{ opacity: landingFade, transform: [{ translateY: landingFade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
          <Image source={solanaMobileWhiteLogo} style={styles.splashLogo} resizeMode="contain" />
          <Text style={[styles.title, { color: '#fff' }]}>{APP_NAME}</Text>
          <Text style={[styles.meta, { color: '#14F195', textAlign: 'center', marginBottom: 10 }]}>Network: Mainnet</Text>
          <Text style={[styles.subtitle, { color: '#14F195' }]}>Connect wallet to continue.</Text>
          <ActionButton label={busy ? 'Connecting…' : 'Connect Wallet'} onPress={connectWallet} />
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentContainerStyle={styles.content}
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
            <View style={{ flex: 1, marginRight: 8 }}>
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
            <View style={styles.row}>
              <ActionButton
                label={pullRefreshing ? 'Refreshing…' : busy ? 'Staking…' : 'Create + Delegate'}
                onPress={onCreateStake}
                disabled={pullRefreshing}
              />
              <ActionButton
                label={pullRefreshing ? 'Refreshing…' : busy ? 'Unstaking…' : 'Unstake'}
                onPress={onUnstake}
                disabled={pullRefreshing}
              />
              <ActionButton
                label={pullRefreshing ? 'Refreshing…' : busy ? 'Withdrawing…' : canWithdraw ? 'Withdraw' : 'Withdraw (not available in current state)'}
                onPress={onWithdraw}
                disabled={!canWithdraw || pullRefreshing}
              />
            </View>
            <Text style={styles.meta}>Withdraw status: {destination ? destinationState : 'select destination'}</Text>

            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Consolidate existing stake accounts</Text>
            <Text style={styles.meta}>Authority wallet: {shortAddr(wallet)}</Text>
            <Text style={styles.meta}>Destination stake account (from connected wallet authority)</Text>
            {!destinationOrderedAccounts.length && <Text style={styles.meta}>No stake accounts available yet.</Text>}
            {!!destinationOrderedAccounts.length && (
              <Text style={styles.meta}>Withdraw-ready: {withdrawReadyAccounts.length} · Undelegated: {undelegatedAccounts.length} · Delegated/activating: {delegatedAccounts.length} · Syncing: {stakeAccounts.filter((a) => presentStakeState(a.stakeState) === 'syncing').length}</Text>
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
                    {isDest ? '◉' : '◯'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports · {presentStakeState(a.stakeState)}
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
            </View>
            <Text style={styles.meta}>Swipe down from top near Mainnet to refresh.</Text>

            <Text style={styles.meta}>Source stake accounts (excluding destination · delegated first, undelegated below)</Text>
            <Text style={styles.meta}>Selected source accounts: {selectedCount}/{MAX_SOURCE_ACCOUNTS}</Text>
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
                return (
                  <Text
                    style={[styles.account, checked && styles.accountSelected, theme === 'light' && styles.accountLight]}
                    onPress={() => {
                      const next = { ...selected };
                      if (!checked && selectedCount >= MAX_SOURCE_ACCOUNTS) {
                        setStatus(`Maximum ${MAX_SOURCE_ACCOUNTS} source stake accounts.`);
                        return;
                      }
                      next[a.pubkey] = !checked;
                      setSelected(next);
                    }}
                  >
                    {checked ? '☑' : '☐'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports · {presentStakeState(a.stakeState)}
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
            <View style={styles.row}>
              <ActionButton label="Max" onPress={onSendMax} disabled={busy} />
              <ActionButton label={busy ? 'Sending…' : 'Send'} onPress={onSend} />
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
                style={styles.swapTopBtn}
              >
                <Text style={styles.swapTopBtnText}>{swapDir === 'SOL_TO_SKR' ? 'SOL → SKR' : 'SKR → SOL'}</Text>
              </Pressable>
              <Pressable onPress={() => setSwapSlippageBps((s) => Math.max(10, s - 10))} style={styles.swapTinyBtn}>
                <Text style={styles.swapTopBtnText}>-</Text>
              </Pressable>
              <Pressable onPress={() => {}} style={styles.swapSlipBtn}>
                <Text style={styles.swapTopBtnText}>Slip {(swapSlippageBps / 100).toFixed(2)}%</Text>
              </Pressable>
              <Pressable onPress={() => setSwapSlippageBps((s) => Math.min(300, s + 10))} style={styles.swapTinyBtn}>
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
              <Pressable style={styles.swapActionBtn} onPress={fetchSwapQuote}>
                <Text style={styles.swapActionBtnText}>{swapBusy ? 'Quoting…' : 'Get Quote'}</Text>
              </Pressable>
              <Pressable style={styles.swapActionBtn} onPress={executeSwapInApp}>
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
              <Pressable style={styles.swapActionBtn} onPress={copyWalletAddress}>
                <Text style={styles.swapActionBtnText}>Copy Address</Text>
              </Pressable>
              <Pressable style={styles.swapActionBtn} onPress={() => setShowQr((v) => !v)}>
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
      </ScrollView>

      <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.gearBtnTopRight}>
        <Text style={{ fontSize: 18 }}>⚙️</Text>
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
          <ActionButton label="Quick Tips" onPress={() => setShowTips(true)} />
          <ActionButton label="View Fee Policy" onPress={() => setShowFeePolicy(true)} />
          <ActionButton label="Copy Fee Wallet" onPress={copyFeeWallet} />
          <ActionButton label="Copy Debug Report" onPress={copyDebugReport} />
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
            <Text style={styles.meta}>Breakdown: merge txs {selectedCount + 1} + fee tx 1</Text>
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
            <Text style={styles.meta}>• Withdraw flow and undelegated handling improved</Text>
            <Text style={styles.meta}>• Wallet box now shows SOL and SKR balances</Text>
            <Text style={styles.meta}>• Lifecycle/app-switch stability hardening</Text>
            <ActionButton label="Close" onPress={() => setShowWhatsNew(false)} />
          </View>
        </View>
      )}

      {showTips && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Quick Tips</Text>
            <Text style={styles.meta}>• Unstake (deactivate) first, then withdraw when undelegated.</Text>
            <Text style={styles.meta}>• Consolidation fee is always shown before you sign.</Text>
            <Text style={styles.meta}>• Use Refresh after confirmations to sync balances and state.</Text>
            <ActionButton label="Got it" onPress={() => setShowTips(false)} />
          </View>
        </View>
      )}
    </SafeAreaView>
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
  account: { color: colors.text, paddingVertical: 6 },
  accountLight: { color: '#072225' },
  accountSelected: { color: colors.primary },
  accountDestination: { color: colors.secondary },
  status: { color: colors.secondary, marginTop: 10 },
  statusMuted: { color: colors.secondary, marginTop: 10, opacity: 0.7 },
  link: { color: colors.primary, textDecorationLine: 'underline', marginTop: 6 },
  swapTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  swapTopBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#101824',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapSlipBtn: {
    minWidth: 92,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#101824',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTinyBtn: {
    width: 34,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#101824',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTopBtnText: { color: '#D6EFEA', fontWeight: '700', fontSize: 13 },
  swapActionRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  swapActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#101824',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapActionBtnText: { color: '#D6EFEA', fontWeight: '800', fontSize: 14 },
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
