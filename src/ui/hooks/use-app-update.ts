import { useEffect, useState } from 'react';
import type { AppUpdateState } from 'csdm/common/types/app-update';

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({
    status: 'idle',
    version: null,
    percent: 0,
    downloaded: false,
    error: null,
  });
  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.csdm.onUpdateStateChanged(setState);
    void window.csdm.getUpdateState().then((next) => {
      if (mounted) {
        setState(next);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return state;
}
