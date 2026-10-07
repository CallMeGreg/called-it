import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ApiClient, SessionSnapshot } from '../api/client';
import { CancelledRequest, describeError } from '../api/errors';
import { Badge, Brand, Button, Notice } from '../ui/components';
import { colors, fonts, layout } from '../ui/theme';

export function Welcome({ client, session, online }: {
  client: ApiClient;
  session: SessionSnapshot;
  online: boolean;
}) {
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (busy || !online || session.cleanupRequired) return;
    const code = inviteCode;
    setInviteCode('');
    setBusy(true);
    setError(null);
    try {
      await client.login(code, displayName);
    } catch (cause) {
      if (!(cause instanceof CancelledRequest)) setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={layout.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Brand light />
          <View style={styles.hero}>
            <Badge dark>Simulated demo</Badge>
            <Text accessibilityRole="header" style={styles.title}>Big opinions.{'\n'}Tiny timer.</Text>
            <Text style={styles.intro}>Three calls. Two minutes. Go with your gut and see what sticks.</Text>
            <View style={styles.steps}>
              <View style={styles.step}><Text style={styles.stepNumber}>01</Text><Text style={styles.stepLabel}>Pick a side</Text></View>
              <View style={styles.step}><Text style={styles.stepNumber}>02</Text><Text style={styles.stepLabel}>Beat the clock</Text></View>
              <View style={styles.step}><Text style={styles.stepNumber}>03</Text><Text style={styles.stepLabel}>Build a streak</Text></View>
            </View>
          </View>

          <View style={styles.form}>
            <View style={{ gap: 6 }}>
              <Text style={layout.eyebrow}>YOUR INVITE. YOUR INSTINCT.</Text>
              <Text accessibilityRole="header" style={layout.subtitle}>You&apos;re on the list.</Text>
              <Text style={layout.muted}>Use the private invite you received. No phone number, SMS, or social account needed.</Text>
            </View>

            {!online && <Notice title="You're offline" tone="warning">Reconnect before joining the demo.</Notice>}
            {session.notice && (
              <Notice
                title={session.cleanupRequired ? 'Session needs attention' : 'Sign in again'}
                tone="warning"
                action={session.cleanupRequired ? 'Clear saved session' : undefined}
                onAction={() => { void client.signOut(); }}
              >{session.notice}</Notice>
            )}
            {session.storageWarning && <Notice title="Temporary session" tone="warning">{session.storageWarning}</Notice>}
            {error && <Notice title="Could not join" tone="error">{error} Re-enter your invite code to try again.</Notice>}

            <View style={styles.field}>
              <Text style={styles.label}>Display name</Text>
              <TextInput
                accessibilityLabel="Display name"
                accessibilityHint="Visible to other invited testers on the global leaderboard."
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="What should we call you?"
                placeholderTextColor="#71807D"
                maxLength={60}
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
                returnKeyType="next"
                style={styles.input}
              />
              <Text style={styles.help}>Visible on the TEST leaderboard. A nickname is fine.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Invite code</Text>
              <TextInput
                accessibilityLabel="Invite code"
                accessibilityHint="Paste the full private invitation. This code is never saved on your device."
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Paste your private invite"
                placeholderTextColor="#71807D"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                secureTextEntry
                maxLength={256}
                editable={!busy}
                returnKeyType="go"
                onSubmitEditing={() => { void join(); }}
                style={styles.input}
              />
              <Text style={styles.help}>Paste exactly as received, without spaces. We never save it.</Text>
            </View>
            <Button
              label={busy ? 'Joining...' : 'Join the demo'}
              onPress={() => { void join(); }}
              busy={busy}
              disabled={!online || !displayName.trim() || !inviteCode || session.cleanupRequired}
            />
          </View>

          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerTitle}>A real game. Simulated outcomes.</Text>
            <Text style={styles.disclaimerText}>
              Sports, Finance, and Pop Culture questions are samples. Outcomes are explicitly simulated, not real-world forecasts.
              Your calls, skips, streaks, and points are really stored. No money, odds, or prizes.
            </Text>
            <Text style={styles.footnote}>Invite-only TEST playground / iOS + Android + web</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingBottom: 24 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, gap: 24 },
  hero: { paddingTop: 18, gap: 20 },
  title: { fontFamily: fonts.display, fontSize: 46, lineHeight: 50, letterSpacing: -1.5, color: colors.surface },
  intro: { color: '#C8D7CE', fontSize: 18, lineHeight: 27, maxWidth: 360 },
  steps: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  step: { flex: 1, gap: 7, borderTopWidth: 1, borderTopColor: '#405854', paddingTop: 13 },
  stepNumber: { color: colors.lime, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  stepLabel: { color: colors.surface, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  form: { backgroundColor: colors.surface, padding: 22, borderRadius: 24, gap: 20 },
  field: { gap: 8 },
  label: { color: colors.ink, fontWeight: '700', fontSize: 14, lineHeight: 20 },
  input: { minHeight: 54, backgroundColor: '#F5F6EF', color: colors.ink, fontSize: 16, lineHeight: 22, paddingHorizontal: 14, paddingVertical: 15, borderWidth: 1, borderColor: '#C9D2C5', borderRadius: 12 },
  help: { fontSize: 12, lineHeight: 18, color: colors.muted },
  disclaimer: { gap: 9, paddingHorizontal: 4 },
  disclaimerTitle: { color: colors.lime, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  disclaimerText: { color: '#C4D2CE', fontSize: 13, lineHeight: 21 },
  footnote: { color: '#9DB3AC', fontSize: 11, lineHeight: 17, paddingTop: 12 },
});
