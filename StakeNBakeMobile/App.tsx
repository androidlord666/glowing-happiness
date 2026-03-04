import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ActionButton } from './src/components/ActionButton';
import { connection, fetchStakeAccounts, StakeAccountInfo } from './src/lib/solana';
import {
  buildConsolidationTransactions,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
} from './src/lib/stake';
import { asPublicKey, createWalletAdapter } from './src/lib/mwa';
import { colors } from './src/theme/colors';
import { CLUSTER, DEFAULT_VALIDATOR_VOTE } from './src/config';
import { addressExplorerUrl, txSolscanUrl } from './src/lib/explorer';
import { buildTransferTx } from './src/lib/walletActions';
import { resolveRecipientAddress } from './src/lib/sns';

const walletAdapter = createWalletAdapter();

type Mode = 'stake' | 'send' | 'receive';
type Screen = 'splash' | 'landing' | 'app';

function shortAddr(v: string) {
  if (!v) return '';
  return `${v.slice(0, 6)}...${v.slice(-6)}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [wallet, setWallet] = useState<string>('');
  const [mode, setMode] = useState<Mode>('stake');
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

  useEffect(() => {
    const t = setTimeout(() => setScreen('landing'), 1200);
    return () => clearTimeout(t);
  }, []);

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

  const selectedKeys = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedCount = selectedKeys.length;

  const connectWallet = async () => {
    try {
      setBusy(true);
      const session = await walletAdapter.connect();
      setWallet(session.address);
      setScreen('app');
      setStatus('Wallet connected.');
      await loadStakeAccounts(session.address);
    } catch (e: any) {
      setStatus(`Connect error: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnectWallet = async () => {
    await walletAdapter.disconnect();
    setWallet('');
    setStakeAccounts([]);
    setSelected({});
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
      const items = await fetchStakeAccounts(activeWallet);
      setStakeAccounts(items);
      if (!destination && items[0]) setDestination(items[0].pubkey);
      setStatus(items.length ? `Loaded ${items.length} stake account(s)` : 'No stake accounts yet. Tap Create + Stake first.');
    } catch (e: any) {
      setStatus(`Refresh failed: ${e?.message ?? 'Please retry'}`);
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
        validatorVote: asPublicKey(DEFAULT_VALIDATOR_VOTE),
        solAmount: createStakeSol,
        seed,
      });

      const sigs = await walletAdapter.signAndSendTransactions([tx]);
      if (sigs[0]) setLastSignature(sigs[0]);
      setDestination(stakeAddress);
      setStatus(`✅ Staked ${createStakeSol} SOL to Solana Mobile validator.`);
      await loadStakeAccounts();
    } catch (e: any) {
      setStatus(`Create+stake error: ${e?.message ?? 'unknown error'}`);
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
      setStatus(`Unstake error: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const onConsolidate = async () => {
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Select destination stake account from list below');

      const sources = selectedKeys.filter((k) => k !== destination).map(asPublicKey);
      if (sources.length === 0) throw new Error('Select source stake account(s) below');
      if (sources.length > 25) throw new Error('Max 25 source stake accounts');

      setBusy(true);
      setStatus('Building consolidation transactions...');
      const txs = await buildConsolidationTransactions({
        connection,
        owner: asPublicKey(wallet),
        plan: {
          destination: asPublicKey(destination),
          sources,
          validatorVote: asPublicKey(DEFAULT_VALIDATOR_VOTE),
        },
      });

      const sigs = await walletAdapter.signAndSendTransactions(txs);
      if (sigs[0]) setLastSignature(sigs[0]);
      setStatus(`✅ Consolidation submitted (${sigs.length} tx).`);
    } catch (e: any) {
      setStatus(`Consolidation error: ${e?.message ?? 'unknown error'}`);
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
      setStatus(`Send error: ${e?.message ?? 'unknown error'}`);
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
    return (
      <SafeAreaView style={[styles.root, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.title}>stakeNbake</Text>
        <Text style={styles.subtitle}>Solana Mobile Staking</Text>
      </SafeAreaView>
    );
  }

  if (screen === 'landing') {
    return (
      <SafeAreaView style={[styles.root, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.title}>stakeNbake</Text>
        <Text style={styles.subtitle}>Connect wallet to continue.</Text>
        <ActionButton label={busy ? 'Connecting…' : 'Connect Wallet'} onPress={connectWallet} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>stakeNbake</Text>
        <Text style={styles.subtitle}>Stake-first dApp · {CLUSTER}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Wallet</Text>
          <View style={styles.walletBox}>
            <Text style={styles.walletText}>{shortAddr(wallet)}</Text>
            <ActionButton label="Disconnect" onPress={disconnectWallet} />
          </View>

          <View style={styles.row}>
            <ActionButton label="Stake" onPress={() => setMode('stake')} />
            <ActionButton label="Send" onPress={() => setMode('send')} />
            <ActionButton label="Receive" onPress={() => setMode('receive')} />
          </View>
        </View>

        {mode === 'stake' && (
          <View style={styles.card}>
            <Text style={styles.label}>Stake (primary)</Text>
            <View style={styles.validatorBox}>
              <Text style={styles.validatorTitle}>Solana Mobile Validator</Text>
              <Text style={styles.validatorAddr}>{DEFAULT_VALIDATOR_VOTE}</Text>
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
            <Text style={styles.meta}>Pick destination and source accounts from the list below (same connected wallet authority).</Text>
            <TextInput
              style={styles.input}
              placeholder="Destination stake account"
              placeholderTextColor={colors.muted}
              value={destination}
              onChangeText={setDestination}
              autoCapitalize="none"
            />
            <View style={styles.row}>
              <ActionButton label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => loadStakeAccounts()} />
              <ActionButton label={busy ? 'Consolidating…' : 'Consolidate'} onPress={onConsolidate} />
            </View>

            <Text style={styles.meta}>Selected source accounts: {selectedCount}/25</Text>
            {stakeAccounts.map((a) => {
              const checked = !!selected[a.pubkey];
              const isDest = destination === a.pubkey;
              return (
                <Text
                  key={a.pubkey}
                  style={[styles.account, checked && styles.accountSelected, isDest && styles.accountDestination]}
                  onPress={() => {
                    const next = { ...selected };
                    if (!checked && selectedCount >= 25) return;
                    next[a.pubkey] = !checked;
                    setSelected(next);
                  }}
                >
                  {checked ? '☑' : '☐'} {a.pubkey.slice(0, 6)}...{a.pubkey.slice(-6)} · {a.lamports} lamports
                  {isDest ? '  (destination)' : ''}
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
            <ActionButton label="Open in Explorer" onPress={() => Linking.openURL(addressExplorerUrl(wallet, CLUSTER))} />
          </View>
        )}

        <Text style={styles.status}>{status}</Text>
        {!!lastSignature && (
          <Text style={styles.link} onPress={() => Linking.openURL(txSolscanUrl(lastSignature, CLUSTER))}>
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
  qrWrap: { alignItems: 'center', marginVertical: 8 },
  meta: { color: colors.muted },
  account: { color: colors.text, paddingVertical: 6 },
  accountSelected: { color: colors.primary },
  accountDestination: { color: colors.secondary },
  status: { color: colors.secondary, marginTop: 10 },
  link: { color: colors.primary, textDecorationLine: 'underline', marginTop: 6 },
});
