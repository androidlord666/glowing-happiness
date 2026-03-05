import { ClusterName, ExplorerName } from '../config';

function clusterSuffix(cluster: ClusterName): string {
  return cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
}

export function txUrl(signature: string, cluster: ClusterName, explorer: ExplorerName): string {
  if (explorer === 'orbmarkets') {
    return `https://orbmarkets.io/tx/${signature}${clusterSuffix(cluster)}`;
  }
  return `https://solscan.io/tx/${signature}${clusterSuffix(cluster)}`;
}

export function addressUrl(address: string, cluster: ClusterName, explorer: ExplorerName): string {
  if (explorer === 'orbmarkets') {
    return `https://orbmarkets.io/address/${address}${clusterSuffix(cluster)}`;
  }
  return `https://solscan.io/account/${address}${clusterSuffix(cluster)}`;
}
