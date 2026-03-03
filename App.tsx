import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { ActionButton } from './src/components/ActionButton';
import { connection, fetchStakeAccounts, StakeAccountInfo } from './src/lib/solana';
import { buildConsolidationTransactions } from './src/lib/stake';
import { asPublicKey, MockWalletAdapter } from './src/lib/mwa';
import { colors } from './src/theme/colors';
import { DEFAULT_VALIDATOR_VOTE } from './src/config';

const walletAdapter = new MockWalletAdapter();

export default function App() {
  const [wallet, setWallet] = useState<string>('');
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [destination, setDestination] = useState<string>('');
  const [validatorVote, setValidatorVote] = useState(DEFAULT_VALIDATOR_VOTE);
  const [status, setStatus] = useState('Disconnected');

  const selectedKeys = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedCount = selectedKeys.length;

  const connectWallet = async () => {
    try {
      const session = await walletAdapter.connect();
      setWallet(session.address);
      setStatus('Wallet connected');
    } catch (e: any) {
      setStatus(`Connect error: ${e?.message ?? 'unknown error'}`);
    }
  };

  const disconnectWallet = async () => {
    await walletAdapter.disconnect();
    setWallet('');
    setStakeAccounts([]);
    setSelected({});
    setStatus('Disconnected');
  };

  const loadStakeAccounts = async () => {
    try {
      if (!wallet) throw new Error('Connect wallet first');
      setStatus('Loading stake accounts...');
      const items = await fetchStakeAccounts(wallet);
      setStakeAccounts(items);
      if (!destination && items[0]) setDestination(items[0].pubkey);
      setStatus(`Loaded ${items.length} stake account(s)`);
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? 'Failed to load accounts'}`);
    }
  };

  const onConsolidate = async () => {
    try {
      if (!wallet) throw new Error('Wallet not connected');
      if (!destination) throw new Error('Choose destination stake account');

      const sources = selectedKeys.filter((k) => k !== destination).map(asPublicKey);
      if (sources.length === 0) throw new Error('Select at least one source (different from destination)');
      if (sources.length > 25) throw new Error('Max 25 source accounts');

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

      setStatus(`Signing ${txs.length} tx(s)...`);
      const sigs = await walletAdapter.signAndSendTransactions(txs);
      setStatus(`Submitted ${sigs.length} tx(s). First signature: ${sigs[0]}`);
    } catch (e: any) {
      setStatus(`Consolidation error: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>stakeNbake</Text>
        <Text style={styles.subtitle}>Solana stake consolidation · dark minimalist</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Wallet</Text>
          <TextInput
            style={styles.input}
            placeholder="Wallet pubkey"
            placeholderTextColor={colors.muted}
            value={wallet}
            onChangeText={setWallet}
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <ActionButton label="Connect" onPress={connectWallet} />
            <ActionButton label="Disconnect" onPress={disconnectWallet} />
            <ActionButton label="Send" onPress={() => setStatus('Send flow next commit')} />
            <ActionButton label="Receive" onPress={() => setStatus('Receive flow next commit')} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Staking consolidation</Text>
          <TextInput
            style={styles.input}
            placeholder="Validator vote account"
            placeholderTextColor={colors.muted}
            value={validatorVote}
            onChangeText={setValidatorVote}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Destination stake account"
            placeholderTextColor={colors.muted}
            value={destination}
            onChangeText={setDestination}
            autoCapitalize="none"
          />

          <View style={styles.row}>
            <ActionButton label="Refresh" onPress={loadStakeAccounts} />
            <ActionButton label="Consolidate" onPress={onConsolidate} />
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

        <Text style={styles.status}>{status}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 30, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, marginBottom: 8 },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  label: { color: colors.text, fontWeight: '700' },
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
  meta: { color: colors.muted },
  account: { color: colors.text, paddingVertical: 6 },
  accountSelected: { color: colors.primary },
  accountDestination: { color: colors.secondary },
  status: { color: colors.secondary, marginTop: 10 },
});
