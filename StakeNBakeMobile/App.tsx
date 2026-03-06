import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Image
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ActionButton } from './src/components/ActionButton';
import { createConnection, fetchStakeAccounts, StakeAccountInfo } from './src/lib/solana';
import {
  buildConsolidationTransactions,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
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

type Mode = 'stake' | 'send' | 'receive';
type Screen = 'splash' | 'landing' | 'app';
type ThemeMode = 'dark' | 'light';
type RpcHealth = 'healthy' | 'degraded';
type SourceFilter = 'all' | 'mergeable' | 'high';

const MAX_SOURCE_ACCOUNTS = 99;

function shortAddr(v: string) {
  if (!v) return '';
  return `${v.slice(0, 6)}...${v.slice(-6)}`;
}

function normalizeErrorMessage(e: any): string {
  const raw = String(e?.message ?? e ?? 'unknown error');
  const lower = raw.toLowerCase();
  if (
    lower.includes('cancel') ||
    lower.includes('declin') ||
    lower.includes('rejected') ||
    lower.includes('user denied') ||
    lower.includes('user aborted')
  ) {
    return 'Transaction cancelled by user.';
  }
  return raw;
}

function actionError(prefix: string, e: any): string {
  return `${prefix}: ${normalizeErrorMessage(e)}`;
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
  const info = await connection.getParsedAccountInfo(asPublicKey(account), 'confirmed');
  const parsed = (info.value?.data as any)?.parsed;
  const stake = parsed?.info?.stake;
  return {
    delegationVote: stake?.delegation?.voter,
    delegationState: parsed?.type,
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
  const [snsPreview, setSnsPreview] = useState('');
  const [snsPreviewBusy, setSnsPreviewBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [lastSignature, setLastSignature] = useState('');
  const [txHistory, setTxHistory] = useState<string[]>([]);
  const [pendingTxs, setPendingTxs] = useState<Array<{ sig: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [rpcHealth, setRpcHealth] = useState<RpcHealth>('healthy');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [confirmConsolidate, setConfirmConsolidate] = useState(false);
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
  }, [sendTo, connection]);

  useEffect(() => {
    if (!destination) return;
    if (!selected[destination]) return;
    setSelected((prev) => ({ ...prev, [destination]: false }));
  }, [destination, selected]);

  const sourceStakeAccounts = useMemo(
    () => stakeAccounts.filter((a) => a.pubkey !== destination),
    [stakeAccounts, destination]
  );

  const filteredSourceStakeAccounts = useMemo(() => {
    let items = [...sourceStakeAccounts];
    if (sourceFilter === 'mergeable') {
      items = items.filter((a) => a.lamports > 0);
    }
    if (sourceFilter === 'high') {
      items.sort((a, b) => b.lamports - a.lamports);
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

  const refreshSoon = async (delayMs = 1200) => {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
    await loadStakeAccounts();
  };

  const selectAllValidSources = () => {
    const valid = filteredSourceStakeAccounts.slice(0, MAX_SOURCE_ACCOUNTS);
    const next: Record<string, boolean> = {};
    for (const a of valid) next[a.pubkey] = true;
    setSelected(next);
    setStatus(`Selected ${valid.length} source account(s).`);
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
          await refreshSoon(300);
        }
      } catch {
        // no-op
      }
    }, 3500);

    return () => clearInterval(t);
  }, [pendingTxs, connection]);

  const connectWallet = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const session = await walletAdapter.connect(cluster);
      setWallet(session.address);
      setScreen('app');
      setStatus('Wallet connected.');
      await loadStakeAccounts(session.address);
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
    setStatus('Disconnected');
    setScreen('landing');
  };

  const loadStakeAccounts = async (walletOverride?: string) => {
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
      setBusy(true);
      setStatus('Refreshing stake accounts...');
      const startedAt = Date.now();

      const items = await withRetries(
        () => fetchStakeAccounts(connection, activeWallet, cluster),
        2,
        500
      );

      const withState = await Promise.all(
        items.map(async (a) => {
          try {
            const meta = await getStakeParsedMeta(connection, a.pubkey);
            return { ...a, stakeState: meta.delegationState };
          } catch {
            return a;
          }
        })
      );

      const elapsed = Date.now() - startedAt;
      refreshMetricsRef.current.count += 1;
      refreshMetricsRef.current.totalMs += elapsed;

      setRpcHealth('healthy');
      lastStakeAccountsRef.current = withState;
      setStakeAccounts(withState);
      setSelected((prev) => {
        const valid = new Set(withState.map((i) => i.pubkey));
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v && valid.has(k)) next[k] = true;
        }
        return next;
      });
      if (!withState.length) {
        setDestination('');
      } else if (!destination || !withState.some((i) => i.pubkey === destination)) {
        setDestination(withState[0].pubkey);
      }
      setStatus(withState.length ? `Loaded ${withState.length} stake account(s)` : 'No stake accounts yet. Tap Create + Stake first.');
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
      setBusy(false);
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
      setStatus(`✅ Staked ${createStakeSol} SOL to Solana Mobile validator.`);
      await refreshSoon();
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
        setStatus(`✅ Unstake confirmed for ${shortAddr(destination)}.`);
        await refreshSoon();
      }
    } catch (e: any) {
      setStatus(actionError('Unstake error', e));
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

      const incompatible = sourceMeta.find((m) => {
        if (!destMeta.delegationVote || !m.delegationVote) return false;
        return m.delegationVote !== destMeta.delegationVote;
      });

      if (incompatible) {
        throw new Error('Selected source account has different delegated validator than destination.');
      }

      const sources = sourceSelectedKeys.map(asPublicKey);
      setStatus('Building consolidation transactions...');
      const txs = await buildConsolidationTransactions({
        connection,
        owner: asPublicKey(wallet),
        plan: {
          destination: asPublicKey(destination),
          sources,
          validatorVote: asPublicKey(validatorVote),
        },
      });

      setStatus(`Submitting consolidation transactions (${txs.length})...`);
      const sigs = await walletAdapter.signAndSendTransactions(txs);
      sigs.forEach((sig, i) => {
        if (!sig) return;
        rememberTx(sig);
        trackPendingTx(sig, `Consolidation tx ${i + 1}/${txs.length}`);
      });

      setSelected({});
      setStatus(`✅ Consolidation submitted (${sigs.length}/${txs.length} tx). Refreshing accounts...`);
      await refreshSoon();
    } catch (e: any) {
      setStatus(actionError('Consolidation error', e));
    } finally {
      setBusy(false);
    }
  };

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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCenter}>
          <Image source={theme === 'light' ? solanaMobileBlackLogo : solanaMobileWhiteLogo} style={styles.headerLogo} resizeMode="contain" />
        </View>
        <Text style={[styles.subtitle, { color: palette.primary }]}>Solana Mobile · Mainnet</Text>
        <Text style={[styles.rpcBadge, rpcHealth === 'degraded' && styles.rpcBadgeBad]}>
          RPC: {rpcHealth === 'healthy' ? 'healthy' : 'degraded/fallback'}
        </Text>

        <View style={[styles.card, { backgroundColor: palette.panel, borderColor: palette.border }]}>
          <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Wallet</Text>
          <View style={[styles.walletBox, theme === 'light' && styles.walletBoxLight]}>
            <Text style={[styles.walletText, theme === 'light' && styles.walletTextLight]}>{shortAddr(wallet)}</Text>
            <ActionButton label="Disconnect" onPress={disconnectWallet} />
          </View>

          <View style={styles.row}>
            <ActionButton label="Staking" onPress={() => setMode('stake')} />
            <ActionButton label="Send" onPress={() => setMode('send')} />
            <ActionButton label="Receive" onPress={() => setMode('receive')} />
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
              <ActionButton label={busy ? 'Staking…' : 'Create + Stake'} onPress={onCreateStake} />
              <ActionButton label={busy ? 'Unstaking…' : 'Unstake'} onPress={onUnstake} />
            </View>

            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Consolidate existing stake accounts</Text>
            <Text style={styles.meta}>Authority wallet: {shortAddr(wallet)}</Text>
            <Text style={styles.meta}>Destination stake account (from connected wallet authority)</Text>
            {!stakeAccounts.length && <Text style={styles.meta}>No stake accounts available yet.</Text>}
            {stakeAccounts.map((a) => {
              const isDest = destination === a.pubkey;
              return (
                <Text
                  key={`dest-${a.pubkey}`}
                  style={[styles.account, isDest && styles.accountDestination, theme === 'light' && styles.accountLight]}
                  onPress={() => setDestination(a.pubkey)}
                >
                  {isDest ? '◉' : '◯'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports · {a.stakeState ?? 'unknown'}
                </Text>
              );
            })}

            <View style={styles.row}>
              <ActionButton label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => loadStakeAccounts()} />
              <ActionButton
                label={busy ? 'Consolidating…' : 'Consolidate'}
                onPress={() => setConfirmConsolidate(true)}
                disabled={!canConsolidate}
              />
            </View>

            <Text style={styles.meta}>Source stake accounts (excluding destination)</Text>
            <Text style={styles.meta}>Selected source accounts: {selectedCount}/{MAX_SOURCE_ACCOUNTS}</Text>
            <View style={styles.row}>
              <ActionButton label={`Filter: ${sourceFilter}`} onPress={() => setSourceFilter((f) => f === 'all' ? 'mergeable' : f === 'mergeable' ? 'high' : 'all')} />
              <ActionButton label="Select all valid" onPress={selectAllValidSources} disabled={busy || filteredSourceStakeAccounts.length === 0} />
            </View>
            {filteredSourceStakeAccounts.length === 0 && (
              <Text style={styles.meta}>No source accounts available yet. You need at least two stake accounts to consolidate.</Text>
            )}
            {filteredSourceStakeAccounts.map((a) => {
              const checked = !!selected[a.pubkey];
              return (
                <Text
                  key={`src-${a.pubkey}`}
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
                  {checked ? '☑' : '☐'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports · {a.stakeState ?? 'unknown'}
                </Text>
              );
            })}
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

        {mode === 'receive' && (
          <Animated.View style={[styles.card, theme === 'light' && styles.cardLight, { opacity: modeFade, transform: [{ translateY: modeFade.interpolate({ inputRange: [0.92, 1], outputRange: [4, 0] }) }] }]}>
            <Text style={[styles.label, theme === 'light' && styles.labelLight]}>Receive</Text>
            <View style={styles.row}>
              <ActionButton label="Copy Address" onPress={copyWalletAddress} />
              <ActionButton label={showQr ? 'Hide QR' : 'Show QR'} onPress={() => setShowQr((v) => !v)} />
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

        <Text style={styles.status}>{status}</Text>
        <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.gearBtnBottomRight}>
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </Pressable>
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
            {txHistory.map((sig, idx) => (
              <Text key={sig} style={styles.link} onPress={() => Linking.openURL(txUrl(sig, cluster, explorer))}>
                {idx + 1}. {shortAddr(sig)}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

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

          <ActionButton label="Copy Debug Report" onPress={copyDebugReport} />

        </View>
      )}

      {confirmConsolidate && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.label}>Confirm consolidation</Text>
            <Text style={styles.meta}>Destination: {shortAddr(destination)}</Text>
            <Text style={styles.meta}>Sources: {selectedCount}</Text>
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerCenter: { alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 4 },
  headerLogo: { width: 240, height: 40 },
  gearBtnBottomRight: {
    position: 'absolute',
    right: 14,
    bottom: 12,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    zIndex: 30,
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
  link: { color: colors.primary, textDecorationLine: 'underline', marginTop: 6 },
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
