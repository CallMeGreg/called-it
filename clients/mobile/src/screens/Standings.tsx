import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { boardTypes, categoryCodes, type BoardFilter, type BoardType, type Leaderboard } from '../api/contracts';
import type { ClientError } from '../api/errors';
import { Loading, Notice } from '../ui/components';
import { colors, layout } from '../ui/theme';

const filterNames: Record<BoardType, string> = {
  TotalScore: 'Points',
  OverallStreak: 'Combined streak',
  CategoryStreak: 'Category streak',
  CategoryBestStreak: 'Category best',
};
const categoryNames = { sports: 'Sports', finance: 'Finance', pop_culture: 'Pop Culture' };

export function Standings({ filter, onFilter, data, busy, error, onRetry, online, local = false }: {
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
  data: Leaderboard | null;
  busy: boolean;
  error: ClientError | null;
  onRetry: () => void;
  online: boolean;
  local?: boolean;
}) {
  const matchingData = data?.type === filter.type
    && data.categoryCode === ('category' in filter ? filter.category : null) ? data : null;
  return (
    <View style={layout.stack}>
      <View style={{ gap: 8 }}>
        <Text style={layout.eyebrow}>A LITTLE FRIENDLY COMPETITION</Text>
        <Text accessibilityRole="header" style={layout.title}>The bragging board.</Text>
        <Text style={layout.muted}>{local ? 'Local-only demo board. Your simulated score updates when you publish outcomes; there are no live competitors.' : 'Global TEST rankings. Real stored points from simulated rounds.'}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityLabel="Leaderboard metric filters">
        {boardTypes.map((type) => (
          <FilterButton
            key={type}
            label={filterNames[type]}
            selected={filter.type === type}
            onPress={() => onFilter(type === 'CategoryStreak' || type === 'CategoryBestStreak'
              ? { type, category: 'category' in filter ? filter.category : 'sports' }
              : { type })}
          />
        ))}
      </ScrollView>
      {'category' in filter && (
        <View style={styles.categories}>
          {categoryCodes.map((category) => <FilterButton
            key={category}
            label={categoryNames[category]}
            selected={filter.category === category}
            onPress={() => onFilter({ ...filter, category })}
          />)}
        </View>
      )}
      {error && <Notice title="Board updates paused" tone="error" action="Retry leaderboard" onAction={onRetry} disabled={!online}>{error.message}</Notice>}
      {busy && !matchingData && <Loading label="Loading the leaderboard..." />}
      {matchingData && (
        <View style={[layout.panel, { gap: 0, padding: 0, overflow: 'hidden' }]}>
          <View style={styles.tableHeader}><Text style={layout.eyebrow}>PLAYER</Text><Text style={layout.eyebrow}>{filter.type === 'TotalScore' ? 'POINTS' : 'STREAK'}</Text></View>
          {matchingData.rows.length === 0
            ? <View style={{ padding: 20 }}><Text style={layout.body}>Room at the top.</Text><Text style={layout.muted}>No rankings yet. Completed rounds will put players on this board.</Text></View>
            : matchingData.rows.map((row) => (
              <View key={row.userId} testID={row.isMe ? 'leaderboard-me' : undefined} style={[styles.row, row.isMe && styles.me]} accessibilityLabel={`Rank ${row.rank}, ${row.displayName}${row.isMe ? ', you' : ''}, ${row.score} ${filter.type === 'TotalScore' ? 'points' : 'streak'}`}>
                <Text style={styles.rank}>{row.rank.toString().padStart(2, '0')}</Text>
                <View style={styles.player}>
                  <Text style={styles.name}>{row.displayName}</Text>
                  {row.isMe && <Text style={styles.you}>THAT&apos;S YOU</Text>}
                </View>
                <Text style={styles.score}>{row.score}</Text>
              </View>
            ))}
        </View>
      )}
      {!online && !matchingData && <Notice title="Leaderboard unavailable offline" tone="warning">Reconnect to load this board. No rankings are made up or cached across accounts.</Notice>}
      <Text style={layout.muted}>Points never decrease. Combined streak is the sum of all three current category streaks. Boards update while this tab is open.</Text>
    </View>
  );
}

function FilterButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={Platform.OS === 'web' ? selected : undefined} onPress={onPress} style={({ pressed }) => [styles.filter, selected && styles.selected, pressed && { opacity: 0.75 }]}>
      <Text style={[styles.filterText, selected && { color: colors.surface }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 8, paddingVertical: 2 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { fontSize: 13, fontWeight: '600', lineHeight: 20, color: colors.ink },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { minHeight: 76, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: '#E9EDE2' },
  me: { backgroundColor: '#EAF4D4' },
  rank: { minWidth: 22, fontSize: 12, fontWeight: '700', color: colors.muted, fontVariant: ['tabular-nums'] },
  player: { flex: 1, gap: 4 },
  name: { fontSize: 16, lineHeight: 23, fontWeight: '600', color: colors.ink },
  you: { fontSize: 9, lineHeight: 14, letterSpacing: 1.2, color: colors.finance, fontWeight: '800' },
  score: { fontSize: 24, lineHeight: 31, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
});
