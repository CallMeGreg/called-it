import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

export function useActivity() {
  const [foreground, setForeground] = useState(
    Platform.OS === 'web'
      ? typeof document === 'undefined' || document.visibilityState !== 'hidden'
      : AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [online, setOnline] = useState(
    Platform.OS !== 'web' || typeof navigator === 'undefined' || navigator.onLine,
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVisibility = () => setForeground(document.visibilityState !== 'hidden');
      const onConnection = () => setOnline(navigator.onLine);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onConnection);
      window.addEventListener('offline', onConnection);
      onVisibility();
      onConnection();
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onConnection);
        window.removeEventListener('offline', onConnection);
      };
    }

    let disposed = false;
    const updateConnection = (state: Network.NetworkState) => {
      if (!disposed) {
        setOnline(state.isConnected !== false && state.isInternetReachable !== false);
        setNotice(null);
      }
    };
    const checkConnection = () => {
      void Network.getNetworkStateAsync().then(updateConnection).catch(() => {
        if (!disposed) setNotice('Connection status is unavailable. Failed requests will pause live updates until you retry.');
      });
    };
    const networkSubscription = Network.addNetworkStateListener(updateConnection);
    const appSubscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') checkConnection();
    });
    checkConnection();
    return () => {
      disposed = true;
      networkSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  return { foreground, online, notice };
}
