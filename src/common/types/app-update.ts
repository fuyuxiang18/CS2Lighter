export type AppUpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'unavailable';
  version: string | null;
  percent: number;
  downloaded: boolean;
  error: 'network' | 'busy' | 'install' | null;
};
