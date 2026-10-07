import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryCodes } from '../api/contracts';
import { describeError } from '../api/errors';
import { Button, Notice } from '../ui/components';
import { colors, layout } from '../ui/theme';
import type { PlaygroundClient } from './client';
import { outcomeChoices, type OutcomeChoice, type PlaygroundState } from './model';

const outcomeLabels: Record<OutcomeChoice, string> = { SideA: 'Side A', SideB: 'Side B', Void: 'Void' };

export function AdminControls({ client, state, error }: {
  client: PlaygroundClient;
  state: PlaygroundState;
  error: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const round = state.game.currentRound;
  const ready = !round.isOpen && categoryCodes.every((category) => state.drafts[category] !== null);
  const run = (action: () => void) => {
    setActionError(null);
    try { action(); } catch (cause) { setActionError(describeError(cause)); }
  };
  return (
    <View style={styles.panel} testID="local-controls">
      <View style={{ gap: 6 }}>
        <Text style={styles.eyebrow}>LOCAL PLAYGROUND</Text>
        <Text style={styles.title} testID="local-round-state">Round {state.roundNumber} / {round.isOpen ? 'Open' : 'Locked'}</Text>
        <Text style={layout.muted} testID="local-clock">Local clock: {state.game.serverTimeUtc.slice(0, 19).replace('T', ' ')} UTC</Text>
        <Text style={layout.muted}>No backend or account. Time moves only with these controls; leaving this page does not play more rounds.</Text>
      </View>
      {(error || actionError) && <Notice title="Local action needs attention" tone="error" action="Reload saved demo" onAction={client.load}>{error ?? actionError}</Notice>}
      <Button
        label={expanded ? 'Hide local controls' : 'Show local controls'}
        expanded={expanded}
        variant="dark"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <>
        <View style={styles.actions}>
          <View style={styles.action}><Button label="Fast forward +30s" variant="secondary" disabled={!round.isOpen} onPress={() => run(() => client.fastForward(round.id))} /></View>
          <View style={styles.action}><Button label="Lock round" variant="secondary" disabled={!round.isOpen} onPress={() => run(() => client.lock(round.id))} /></View>
        </View>
        <Text style={layout.muted}>Choose each simulated outcome. Choices stay private to these controls until you publish; locked picks cannot change.</Text>
        {categoryCodes.map((category) => {
          const question = round.questions.find((item) => item.categoryCode === category);
          return (
            <View key={category} style={{ gap: 9 }}>
              <Text style={styles.category}>{question?.categoryName}</Text>
              <View style={styles.choices}>
                {outcomeChoices.map((outcome) => {
                  const selected = state.drafts[category] === outcome;
                  return <Pressable
                    key={outcome}
                    accessibilityRole="button"
                    accessibilityLabel={`${question?.categoryName} outcome: ${outcomeLabels[outcome]}`}
                    accessibilityState={{ selected }}
                    aria-pressed={selected}
                    onPress={() => run(() => client.choose(round.id, category, outcome))}
                    style={({ pressed }) => [styles.choice, selected && styles.selected, pressed && { opacity: 0.75 }]}
                  ><Text style={styles.choiceText}>{outcomeLabels[outcome]}</Text></Pressable>;
                })}
              </View>
            </View>
          );
        })}
        <Button label="Publish outcomes" disabled={!ready} onPress={() => run(() => client.publish(round.id))} />
        <Text style={layout.muted}>{round.isOpen ? 'Lock the round, then publish all three chosen outcomes.' : 'Publishing scores this round once and starts the next playable round. Past outcomes cannot be edited.'}</Text>
        <ResetDemo client={client} />
      </>}
    </View>
  );
}

export function ResetDemo({ client }: { client: PlaygroundClient }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: 12 }}>
      {error && <Notice title="Reset was not saved" tone="error">{error}</Notice>}
      {confirming ? (
        <View style={styles.reset} accessibilityRole="alert">
          <Text style={styles.category}>Reset this local demo?</Text>
          <Text style={layout.muted}>This replaces all local picks, outcomes, points, and streaks with a fresh demo. Your real API session and account data are not touched.</Text>
          <Button label="Cancel reset" variant="secondary" onPress={() => setConfirming(false)} />
          <Button label="Reset demo now" onPress={() => {
            try {
              client.reset();
              setConfirming(false);
              setError(null);
            } catch (cause) {
              setError(describeError(cause));
            }
          }} />
        </View>
      ) : <Button label="Reset demo" variant="secondary" onPress={() => { setError(null); setConfirming(true); }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 17, gap: 16, borderRadius: 20, backgroundColor: '#EAF1D8', borderColor: '#C0D79B', borderWidth: 1 },
  eyebrow: { ...layout.eyebrow, color: colors.limeDark },
  title: { fontSize: 18, lineHeight: 25, fontWeight: '800', color: colors.ink },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  action: { flex: 1, minWidth: 110 },
  category: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.ink },
  choices: { flexDirection: 'row', gap: 7 },
  choice: { flex: 1, minHeight: 50, paddingHorizontal: 6, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface },
  selected: { borderColor: colors.finance, backgroundColor: colors.lime },
  choiceText: { fontSize: 13, lineHeight: 20, fontWeight: '700', color: colors.ink },
  reset: { padding: 15, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: '#E4C99A', backgroundColor: colors.warningBg },
});
