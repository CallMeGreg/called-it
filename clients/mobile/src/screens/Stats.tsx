import { StyleSheet, Text, View } from 'react-native';

import { categoryCodes, type Game } from '../api/contracts';
import { Button, Notice } from '../ui/components';
import { colors, layout } from '../ui/theme';

export function Stats({ stats, displayName, onSignOut, local = false }: {
  stats: Game['stats'];
  displayName: string;
  onSignOut?: () => void;
  local?: boolean;
}) {
  return (
    <View style={layout.stack}>
      <View style={{ gap: 8 }}>
        <Text style={layout.eyebrow}>YOUR TRACK RECORD</Text>
        <Text accessibilityRole="header" style={layout.title}>{displayName}, by the numbers.</Text>
        <Text style={layout.muted}>{local ? 'Simulated points and streaks saved only in this browser. No real account or server is involved.' : 'Your TEST history is stored on the server, not made up on this device.'}</Text>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric} testID="total-score"><Text style={styles.number}>{stats.totalScore}</Text><Text style={styles.label}>Lifetime points</Text></View>
        <View style={styles.metric} testID="overall-streak"><Text style={styles.number}>{stats.overallStreak}</Text><Text style={styles.label}>Combined streak</Text></View>
      </View>
      {categoryCodes.map((category) => {
        const item = stats.categories.find((entry) => entry.categoryCode === category);
        if (!item) return null;
        return (
          <View key={category} style={layout.panel} testID={`stats-${category}`}>
            <Text style={layout.subtitle}>{item.categoryName}</Text>
            <View style={styles.categoryMetrics}>
              <Metric label="CURRENT" value={item.currentStreak} />
              <Metric label="BEST" value={item.bestStreak} />
              <Metric label="CORRECT" value={item.totalCorrect} />
            </View>
          </View>
        );
      })}
      <Notice title="A streak in every lane">
        A correct call adds 1 point and grows that category&apos;s streak. A wrong or missed call resets only that category&apos;s streak.
        Skip preserves it without earning a point. Void outcomes change nothing. Combined streak adds your three current streaks together.
      </Notice>
      {local ? <Notice title="Local data only">Use Reset demo in local controls to clear these demo scores, picks, and rounds. Your API-connected session is separate and will not be changed.</Notice> : <View style={layout.panel}>
        <Text style={layout.subtitle}>Your session</Text>
        <Text style={layout.muted}>Keep your original invitation to return to this account. Your invite code is never saved. Signing out clears this device&apos;s session, not your stored picks or account.</Text>
        {onSignOut && <Button label="Sign out" variant="secondary" onPress={onSignOut} />}
      </View>}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={{ flex: 1, gap: 6 }}><Text style={styles.categoryNumber}>{value}</Text><Text style={layout.eyebrow}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 12 },
  metric: { flex: 1, padding: 18, gap: 7, borderRadius: 20, backgroundColor: colors.ink },
  number: { fontSize: 38, lineHeight: 46, fontWeight: '800', color: colors.lime, letterSpacing: -1 },
  label: { fontSize: 13, lineHeight: 20, fontWeight: '600', color: '#D4E1D6' },
  categoryMetrics: { flexDirection: 'row', gap: 10 },
  categoryNumber: { fontSize: 27, lineHeight: 34, fontWeight: '700', color: colors.ink },
});
