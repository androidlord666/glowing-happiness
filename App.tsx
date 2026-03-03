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
import { fetchStakeAccounts, StakeAccountInfo } from './src/lib/solana';
import { colors } from './src/theme/colors';

export default function App() {
  const [wallet, setWallet] = useState<string>('');
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('Disconnected');

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  const loadStakeAccounts = async () => {
    try {
      setStatus('Loading stake accounts...');
      const items = await fetchStakeAccounts(wallet);
      setStakeAccounts(items);
      setStatus(`Loaded ${items.length} stake accounts`);
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? 'Failed to load accounts'}`);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>stakeNbake</Text>
        <Text style={styles.subtitle}>Consolidate up to 25 stake accounts into 1</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Wallet (MVP placeholder)</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste wallet pubkey"
            placeholderTextColor={colors.muted}
            value={wallet}
            onChangeText={setWallet}
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <ActionButton label="Connect" onPress={() => setStatus('Wallet connected (placeholder)')} />
            <ActionButton label="Disconnect" onPress={() => setStatus('Disconnected')} />
          </View>
          <View style={styles.row}>
            <ActionButton label="Send" onPress={() => setStatus('Send flow coming next')} />
            <ActionButton label="Receive" onPress={() => setStatus('Receive flow coming next')} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Stake Accounts</Text>
          <View style={styles.row}>
            <ActionButton label="Refresh" onPress={loadStakeAccounts} />
            <ActionButton label="Consolidate" onPress={() => setStatus('Consolidation tx builder next')} />
          </View>
          <Text style={styles.meta}>Selected: {selectedCount}/25</Text>

          {stakeAccounts.map((a) => {
            const checked = !!selected[a.pubkey];
            return (
              <Text
                key={a.pubkey}
                style={[styles.account, checked && styles.accountSelected]}
                onPress={() => {
                  const next = { ...selected };
                  if (!checked && selectedCount >= 25) return;
                  next[a.pubkey] = !checked;
                  setSelected(next);
                }}
              >
                {checked ? '☑' : '☐'} {a.pubkey.slice(0, 8)}...{a.pubkey.slice(-8)} · {a.lamports} lamports
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
    gap: 10
  },
  label: { color: colors.text, fontWeight: '700' },
  input: {
    backgroundColor: '#0f0f16',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text
  },
  row: { flexDirection: 'row', marginBottom: 6 },
  meta: { color: colors.muted },
  account: { color: colors.text, paddingVertical: 6 },
  accountSelected: { color: colors.primary },
  status: { color: colors.secondary, marginTop: 10 }
});
