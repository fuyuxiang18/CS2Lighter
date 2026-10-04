/** This distribution imports local recordings only, including when old settings still enable downloads. */
export function assertNetworkDemoDownloadsEnabled(): void {
  throw new Error('Network demo downloads are disabled. Add a local demo folder in Settings.');
}
