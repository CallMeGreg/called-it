import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CategoryStats, Question, Side } from '../api/contracts';
import { pickLabel } from '../game/rounds';
import { colors, layout } from '../ui/theme';

const categoryStyles = {
  sports: { color: colors.sports, backgroundColor: colors.sportsBg, index: '01' },
  finance: { color: colors.finance, backgroundColor: colors.financeBg, index: '02' },
  pop_culture: { color: colors.pop_culture, backgroundColor: colors.pop_cultureBg, index: '03' },
};

export function QuestionCard({ question, stats, disabled, busy, onPick }: {
  question: Question;
  stats: CategoryStats | undefined;
  disabled: boolean;
  busy: boolean;
  onPick: (pick: Side | null) => void;
}) {
  const category = categoryStyles[question.categoryCode];
  const hasSelection = question.mySkip || question.myPick !== null;
  return (
    <View style={styles.card} testID={`question-${question.categoryCode}`}>
      <View style={layout.between}>
        <View style={layout.row}>
          <View style={[styles.categoryIndex, { backgroundColor: category.backgroundColor }]}>
            <Text style={[styles.indexText, { color: category.color }]}>{category.index}</Text>
          </View>
          <Text style={[styles.category, { color: category.color }]}>{question.categoryName}</Text>
        </View>
        {stats && <Text style={styles.streak} accessibilityLabel={`${question.categoryName} current streak ${stats.currentStreak}`}>{stats.currentStreak} streak</Text>}
      </View>
      <Text accessibilityRole="header" style={styles.question}>{question.text}</Text>
      <View style={styles.choices}>
        {(['A', 'B'] as const).map((side) => {
          const label = side === 'A' ? question.sideALabel : question.sideBLabel;
          const selected = !question.mySkip && question.myPick === side;
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityLabel={`Pick ${side}: ${label} for ${question.categoryName}`}
              accessibilityState={{ selected, disabled: disabled || busy }}
              aria-pressed={Platform.OS === 'web' ? selected : undefined}
              accessibilityHint="You can change your call until the server locks this round."
              disabled={disabled || busy}
              onPress={() => onPick(side)}
              style={({ pressed }) => [styles.choice, selected && styles.selectedChoice, disabled && !selected && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={[styles.side, selected && styles.selectedSide]}>{side}</Text>
              <Text style={styles.choiceText}>{label}</Text>
              {selected && <Text style={styles.savedIndicator}>SAVED</Text>}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip ${question.categoryName}`}
          accessibilityState={{ selected: question.mySkip, disabled: disabled || busy }}
          aria-pressed={Platform.OS === 'web' ? question.mySkip : undefined}
          accessibilityHint="Skip preserves this category's streak without earning a point."
          disabled={disabled || busy}
          onPress={() => onPick(null)}
          style={({ pressed }) => [styles.skip, question.mySkip && styles.selectedSkip, disabled && !question.mySkip && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>{question.mySkip ? 'Skip saved' : 'Skip'}</Text>
        </Pressable>
        <View style={styles.savedState} accessibilityLiveRegion="polite">
          {busy
            ? <><ActivityIndicator size="small" color={colors.finance} /><Text style={styles.status}>Saving...</Text></>
            : <Text style={[styles.status, hasSelection && styles.confirmed]}>
              {hasSelection ? `Saved: ${pickLabel(question)}` : 'No call yet'}
            </Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 17 },
  categoryIndex: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 11, fontWeight: '800' },
  category: { fontSize: 12, fontWeight: '800', lineHeight: 18, letterSpacing: 0.3 },
  streak: { color: colors.muted, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  question: { color: colors.ink, fontSize: 21, fontWeight: '700', lineHeight: 29, letterSpacing: -0.3 },
  choices: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  choice: { flex: 1, padding: 14, minHeight: 106, borderWidth: 1, borderColor: '#C9D2C5', backgroundColor: '#F6F7F0', borderRadius: 15, alignItems: 'flex-start', gap: 8 },
  selectedChoice: { backgroundColor: '#E6F6BF', borderWidth: 2, borderColor: colors.finance, padding: 13 },
  side: { fontSize: 11, fontWeight: '800', lineHeight: 15, backgroundColor: '#E6E9DF', color: colors.muted, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' },
  selectedSide: { color: colors.white, backgroundColor: colors.finance },
  choiceText: { fontSize: 16, lineHeight: 23, color: colors.ink, fontWeight: '600' },
  savedIndicator: { fontSize: 9, lineHeight: 14, fontWeight: '800', color: colors.finance, letterSpacing: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopColor: '#E8EBE1', borderTopWidth: 1, paddingTop: 9 },
  skip: { minHeight: 48, minWidth: 72, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line },
  selectedSkip: { backgroundColor: colors.sage, borderColor: colors.finance },
  skipText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  savedState: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
  status: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  confirmed: { color: colors.finance, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
});
