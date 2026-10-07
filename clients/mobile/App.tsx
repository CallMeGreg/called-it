import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ApiClient } from './src/api/client';
import { resolveApiBaseUrl } from './src/api/config';
import { describeError } from './src/api/errors';
import { createPlatformStore } from './src/auth/platformStore';
import { useActivity } from './src/hooks/useActivity';
import { resolveLaunchMode } from './src/launch-mode';
import { GameScreen } from './src/screens/GameScreen';
import { Welcome } from './src/screens/Welcome';
import { Brand, Notice } from './src/ui/components';
import { colors } from './src/ui/theme';

type Runtime = { client: ApiClient; error: null } | { client: null; error: string };

function createRuntime(): Runtime {
  try {
    const baseUrl = resolveApiBaseUrl(
      process.env.EXPO_PUBLIC_API_BASE_URL,
      Platform.OS === 'web' ? 'web' : 'native',
      __DEV__,
    );
    const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'same-origin');
    return { client: new ApiClient({ baseUrl, store: createPlatformStore(origin) }), error: null };
  } catch (error) {
    return { client: null, error: describeError(error) };
  }
}

export default function App() {
  const [launch] = useState(() => {
    try {
      return { mode: resolveLaunchMode(process.env.EXPO_PUBLIC_LOCAL_PLAYGROUND, Platform.OS, __DEV__, typeof window !== 'undefined' ? window.location.hostname : undefined), error: null };
    } catch (error) {
      return { mode: null, error: describeError(error) };
    }
  });
  let content;
  if (__DEV__ && launch.mode === 'playground') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro must prune this development-only module from release graphs.
    const { PlaygroundApp }: typeof import('./src/playground/PlaygroundApp') = require('./src/playground/PlaygroundApp');
    content = <PlaygroundApp />;
  } else if (launch.error) {
    content = <View style={styles.configuration}><Brand light /><Notice title="Client configuration needed" tone="error">{launch.error}</Notice></View>;
  } else {
    content = <ApiApp />;
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.app}>
        <StatusBar style="light" />
        {content}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ApiApp() {
  const [runtime] = useState(createRuntime);
  return (
    <>
      {runtime.client
          ? <ConnectedApp client={runtime.client} />
          : <View style={styles.configuration}><Brand light /><Notice title="TEST API configuration needed" tone="error">{runtime.error}</Notice></View>}
    </>
  );
}

function ConnectedApp({ client }: { client: ApiClient }) {
  const session = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const activity = useActivity();
  useEffect(() => { void client.restore(); }, [client]);

  if (session.status === 'loading') {
    return <View style={styles.loading}><Brand light /><ActivityIndicator color={colors.lime} /><Text style={styles.loadingText}>Restoring your private session...</Text></View>;
  }
  if (session.auth) {
    return <GameScreen
      key={`${session.generation}:${session.auth.userId}`}
      client={client}
      displayName={session.auth.displayName}
      storageWarning={session.storageWarning}
      onSignOut={() => { void client.signOut(); }}
      foreground={activity.foreground}
      online={activity.online}
      connectivityNotice={activity.notice}
    />;
  }
  return <SafeAreaView edges={['bottom']} style={styles.app}><Welcome client={client} session={session} online={activity.online} /></SafeAreaView>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.ink },
  configuration: { padding: 24, gap: 24, maxWidth: 600, width: '100%', alignSelf: 'center' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 24 },
  loadingText: { color: '#D1DFD2', fontSize: 15, lineHeight: 22 },
});
