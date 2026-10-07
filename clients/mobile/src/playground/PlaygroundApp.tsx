import { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';

import { useActivity } from '../hooks/useActivity';
import { GameScreen } from '../screens/GameScreen';
import { Brand, Button, Loading, Notice } from '../ui/components';
import { layout } from '../ui/theme';
import { AdminControls, ResetDemo } from './controls';
import { PlaygroundClient } from './client';
import { demoPlayer } from './model';
import { PlaygroundStorage } from './storage';

export function PlaygroundApp() {
  const [client] = useState(() => new PlaygroundClient(new PlaygroundStorage(() => window.localStorage)));
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const { foreground } = useActivity();
  useEffect(() => client.load(), [client]);
  useEffect(() => {
    const title = document.title;
    document.title = 'Called It - Local Playground';
    return () => { document.title = title; };
  }, []);

  if (!snapshot.state) {
    return <ScrollView contentContainerStyle={layout.content}>
      <Brand light local />
      {snapshot.error ? (
        <View style={layout.stack}>
          <Notice title="Local demo could not load" tone="error">{snapshot.error}</Notice>
          <Button label="Retry loading local demo" onPress={client.load} />
          <ResetDemo client={client} />
        </View>
      ) : <Loading label="Loading your local playground..." />}
    </ScrollView>;
  }

  return <GameScreen
    key={snapshot.generation}
    client={client}
    displayName={demoPlayer.displayName}
    foreground={foreground}
    online
    connectivityNotice={null}
    mode="playground"
    controls={<AdminControls client={client} state={snapshot.state} error={snapshot.error} />}
  />;
}
