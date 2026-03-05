import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable
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

type Mode = 'stake' | 'send' | 'receive';
type Screen = 'splash' | 'landing' | 'app';
type ThemeMode = 'dark' | 'light';

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Disconnected');

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
  }, [mode]);

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
  }, [sendTo]);

  useEffect(() => {
    if (!destination) return;
    if (!selected[destination]) return;
    setSelected((prev) => ({ ...prev, [destination]: false }));
  }, [destination, selected]);

  const sourceSelectedKeys = useMemo(
    () => Object.keys(selected).filter((k) => selected[k] && k !== destination),
    [selected, destination]
  );
  const selectedCount = sourceSelectedKeys.length;
  const validatorVote = VALIDATOR_VOTE_BY_CLUSTER[cluster];

  useEffect(() => {
    if (!wallet) return;
    setStakeAccounts([]);
    setSelected({});
    setDestination('');
    loadStakeAccounts(wallet);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  const connectWallet = async () => {
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
    setStatus('Disconnected');
    setScreen('landing');
  };

  const loadStakeAccounts = async (walletOverride?: string) => {
    try {
      const activeWallet = walletOverride ?? wallet;
      if (!activeWallet) throw new Error('Connect wallet first');
      setBusy(true);
      setStatus('Refreshing stake accounts...');
      const items = await fetchStakeAccounts(connection, activeWallet);
      setStakeAccounts(items);
      if (!items.length) {
        setDestination('');
      } else if (!destination || !items.some((i) => i.pubkey === destination)) {
        setDestination(items[0].pubkey);
      }
      setStatus(items.length ? `Loaded ${items.length} stake account(s)` : 'No stake accounts yet. Tap Create + Stake first.');
    } catch (e: any) {
      setStatus(actionError('Refresh failed', e));
    } finally {
      setBusy(false);
    }
  };

  const onCreateStake = async () => {
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
      if (sigs[0]) setLastSignature(sigs[0]);
      setDestination(stakeAddress);
      setStatus(`✅ Staked ${createStakeSol} SOL to Solana Mobile validator.`);
      await loadStakeAccounts();
    } catch (e: any) {
      setStatus(actionError('Create+stake error', e));
    } finally {
      setBusy(false);
    }
  };

  const onUnstake = async () => {
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
      if (sigs[0]) setLastSignature(sigs[0]);
      setStatus(`⏸️ Unstake submitted for ${shortAddr(destination)}.`);
    } catch (e: any) {
      setStatus(actionError('Unstake error', e));
    } finally {
      setBusy(false);
    }
  };

  const onConsolidate = async () => {
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select destination stake account from list below');
      const availableSourceCount = stakeAccounts.filter((a) => a.pubkey !== destination).length;
      if (availableSourceCount < 1) {
        throw new Error('Need at least 2 stake accounts. Create another stake account, then select source account(s).');
      }

      const sources = sourceSelectedKeys.map(asPublicKey);
      if (sources.length === 0) throw new Error('Select at least one source stake account below.');
      if (sources.length > 25) throw new Error('Max 25 source stake accounts');

      setBusy(true);
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

      const sigs = await walletAdapter.signAndSendTransactions(txs);
      if (sigs[0]) setLastSignature(sigs[0]);
      setStatus(`✅ Consolidation submitted (${sigs.length} tx).`);
    } catch (e: any) {
      setStatus(actionError('Consolidation error', e));
    } finally {
      setBusy(false);
    }
  };

  const onSend = async () => {
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
      if (sigs[0]) setLastSignature(sigs[0]);
      setStatus(`✅ Sent ${sendSol} SOL to ${shortAddr(recipient)}.`);
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

  if (screen === 'splash') {
    const black = splashPhase === 0;
    return (
      <SafeAreaView style={[styles.root, styles.centered, { backgroundColor: black ? '#000' : '#fff' }]}>
        <StatusBar barStyle={black ? 'light-content' : 'dark-content'} />
        <Text style={[styles.title, { color: black ? '#fff' : '#000' }]}>SOLANA MOBILE</Text>
      </SafeAreaView>
    );
  }

  if (screen === 'landing') {
    return (
      <SafeAreaView style={[styles.root, styles.centered, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <Text style={[styles.title, { color: palette.text }]}>{APP_NAME}</Text>
        <View style={[styles.card, { width: '100%', backgroundColor: palette.panel, borderColor: palette.border }]}> 
          <Text style={[styles.label, { color: palette.text }]}>SOLANA MOBILE</Text>
          <Text style={[styles.meta, { color: palette.primary }]}>Network: {cluster}</Text>
        </View>
        <Text style={[styles.subtitle, { color: palette.primary }]}>Connect wallet to continue.</Text>
        <ActionButton label={busy ? 'Connecting…' : 'Connect Wallet'} onPress={connectWallet} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rowBetween}>
          <Text style={[styles.title, { color: palette.text }]}>{APP_NAME}</Text>
          <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.gearBtn}>
            <Text style={{ fontSize: 18 }}>⚙️</Text>
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: palette.primary }]}>Solana Mobile · {cluster}</Text>

        {showSettings && (
          <View style={[styles.card, { backgroundColor: palette.panel, borderColor: palette.border }]}>
            <Text style={[styles.label, { color: palette.text }]}>Settings</Text>
            <View style={styles.row}>
              <ActionButton label={`Network: ${cluster === 'devnet' ? 'Devnet' : 'Mainnet'}`} onPress={() => setCluster((c) => c === 'devnet' ? 'mainnet-beta' : 'devnet')} />
              <ActionButton label={`Theme: ${theme === 'dark' ? 'Dark' : 'Light'}`} onPress={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} />
            </View>
            <ActionButton label={`Explorer: ${explorerLabel}`} onPress={() => setShowExplorerOptions((v) => !v)} />
            {showExplorerOptions && (
              <View style={styles.dropdownBox}>
                <Text style={styles.dropdownItem} onPress={() => { setExplorer('orbmarkets'); setShowExplorerOptions(false); }}>OrbMarkets.io</Text>
                <Text style={styles.dropdownItem} onPress={() => { setExplorer('solscan'); setShowExplorerOptions(false); }}>Solscan.io</Text>
                <Text style={styles.dropdownItem} onPress={() => { setExplorer('solana'); setShowExplorerOptions(false); }}>Explorer.Solana.com</Text>
              </View>
            )}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: palette.panel, borderColor: palette.border }]}>
          <Text style={styles.label}>Wallet</Text>
          <View style={styles.walletBox}>
            <Text style={styles.walletText}>{shortAddr(wallet)}</Text>
            <ActionButton label="Disconnect" onPress={disconnectWallet} />
          </View>

          <View style={styles.row}>
            <ActionButton label="Staking" onPress={() => setMode('stake')} />
            <ActionButton label="Send" onPress={() => setMode('send')} />
            <ActionButton label="Receive" onPress={() => setMode('receive')} />
          </View>
        </View>

        {mode === 'stake' && (
          <View style={styles.card}>
            <Text style={styles.label}>Solana Mobile Staking</Text>
            <View style={styles.validatorBox}>
              <Text style={styles.validatorTitle}>Solana Mobile Validator</Text>
              <Text style={styles.validatorAddr}>{validatorVote}</Text>
            </View>

            <TextInput
              style={styles.input}
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

            <Text style={styles.label}>Consolidate existing stake accounts</Text>
            <Text style={styles.meta}>Authority wallet: {shortAddr(wallet)}</Text>
            <Text style={styles.meta}>Destination stake account (from connected wallet authority)</Text>
            {!stakeAccounts.length && <Text style={styles.meta}>No stake accounts available yet.</Text>}
            {stakeAccounts.map((a) => {
              const isDest = destination === a.pubkey;
              return (
                <Text
                  key={`dest-${a.pubkey}`}
                  style={[styles.account, isDest && styles.accountDestination]}
                  onPress={() => setDestination(a.pubkey)}
                >
                  {isDest ? '◉' : '◯'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports
                </Text>
              );
            })}

            <View style={styles.row}>
              <ActionButton label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => loadStakeAccounts()} />
              <ActionButton label={busy ? 'Consolidating…' : 'Consolidate'} onPress={onConsolidate} />
            </View>

            <Text style={styles.meta}>Source stake accounts (excluding destination)</Text>
            <Text style={styles.meta}>Selected source accounts: {selectedCount}/25</Text>
            {stakeAccounts.filter((a) => a.pubkey !== destination).length === 0 && (
              <Text style={styles.meta}>No source accounts available yet. You need at least two stake accounts to consolidate.</Text>
            )}
            {stakeAccounts.filter((a) => a.pubkey !== destination).map((a) => {
              const checked = !!selected[a.pubkey];
              return (
                <Text
                  key={`src-${a.pubkey}`}
                  style={[styles.account, checked && styles.accountSelected]}
                  onPress={() => {
                    const next = { ...selected };
                    if (!checked && selectedCount >= 25) {
                      setStatus('Maximum 25 source stake accounts.');
                      return;
                    }
                    next[a.pubkey] = !checked;
                    setSelected(next);
                  }}
                >
                  {checked ? '☑' : '☐'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports
                </Text>
              );
            })}
          </View>
        )}

        {mode === 'send' && (
          <View style={styles.card}>
            <Text style={styles.label}>Send SOL (supports SNS .sol names)</Text>
            <TextInput
              style={styles.input}
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
              style={styles.input}
              placeholder="Amount SOL"
              placeholderTextColor={colors.muted}
              value={sendSol}
              onChangeText={setSendSol}
              keyboardType="decimal-pad"
            />
            <ActionButton label={busy ? 'Sending…' : 'Send'} onPress={onSend} />
          </View>
        )}

        {mode === 'receive' && (
          <View style={styles.card}>
            <Text style={styles.label}>Receive</Text>
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
          </View>
        )}

        <Text style={styles.status}>{status}</Text>
        {!!lastSignature && (
          <Text style={styles.link} onPress={() => Linking.openURL(txUrl(lastSignature, cluster, explorer))}>
            Open latest transaction on Solscan
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 32, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.primary, marginBottom: 8, textAlign: 'center' },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  label: { color: colors.text, fontWeight: '700' },
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
  validatorBox: {
    backgroundColor: '#0f0f16',
    borderColor: colors.secondary,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  validatorTitle: { color: colors.text, fontWeight: '700' },
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
  row: { flexDirection: 'row', marginBottom: 6, flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gearBtn: { padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  dropdownBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 6,
    backgroundColor: '#081416',
  },
  dropdownItem: {
    color: colors.text,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  qrWrap: { alignItems: 'center', marginVertical: 8 },
  meta: { color: colors.muted },
  account: { color: colors.text, paddingVertical: 6 },
  accountSelected: { color: colors.primary },
  accountDestination: { color: colors.secondary },
  status: { color: colors.secondary, marginTop: 10 },
  link: { color: colors.primary, textDecorationLine: 'underline', marginTop: 6 },
});
