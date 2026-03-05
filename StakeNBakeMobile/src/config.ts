export const APP_NAME = 'stakeNbake';

export type ClusterName = 'devnet' | 'mainnet-beta';
export type ExplorerName = 'orbmarkets' | 'solscan';

export const DEFAULT_CLUSTER: ClusterName = 'devnet';
export const DEFAULT_EXPLORER: ExplorerName = 'orbmarkets';

export const RPC_URLS: Record<ClusterName, string> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export const VALIDATOR_VOTE_BY_CLUSTER: Record<ClusterName, string> = {
  devnet: 'SKRuTecmFDZHjs2DxRTJNEK7m7hunKGTWJiaZ3tMVVA',
  'mainnet-beta': 'SKRuTecmFDZHjs2DxRTJNEK7m7hunKGTWJiaZ3tMVVA',
};
