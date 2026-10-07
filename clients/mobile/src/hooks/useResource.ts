import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { PollingResource } from '../api/resource';

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled: boolean,
  intervalMs: number,
) {
  const resource = useMemo(() => new PollingResource(load, intervalMs), [load, intervalMs]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    if (enabled) void resource.resume();
    else resource.pause();
    return () => resource.pause();
  }, [resource, enabled]);
  return { ...snapshot, refresh: resource.refresh };
}
