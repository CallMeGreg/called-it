import { StyleSheet, Text, View } from 'react-native';

import { categoryCodes, type Round } from '../api/contracts';
import { outcomeLabel, pickLabel, resultStatus, type ResultStatus } from '../game/rounds';
import { Badge, Notice } from '../ui/components';
import { colors, layout } from '../ui/theme';

const resultCopy: Record<ResultStatus, string> = {
  Correct: '+1 point. Category streak grows.',
  Wrong: 'No point. Category streak resets.',
  Skipped: 'No point. Category streak preserved.',
  Missed: 'No call was saved. Category streak resets.',
  Void: 'No score or streak change.',
  Pending: 'The server is still resolving this sample question.',
};

export function Results({ round, local = false }: { round: Round | null; local?: boolean }) {
  return (
    <View style={layout.stack}>
      <View style={{ gap: 8 }}>
        <Text style={layout.eyebrow}>THE LAST WORD</Text>
        <Text accessibilityRole="header" style={layout.title}>How&apos;d you call it?</Text>
        <Text style={layout.muted}>{local ? 'Your most recently published local round. All outcomes below were chosen in local controls.' : 'Your most recent completed shared round. All outcomes below are simulated.'}</Text>
      </View>
      {!round ? (
        <Notice title="No results yet">{local ? 'Make your calls in Play, lock the round, and publish chosen outcomes in local controls. No waiting or backend is required.' : 'Once a shared round ends, your calls and its simulated outcomes appear here. Pick a side or Skip in Play while the timer is running.'}</Notice>
      ) : (
        <>
          <View style={[layout.panel, styles.summary]}>
            <View style={{ gap: 5 }}>
              <Text style={styles.summaryNumber}>{round.questions.filter((question) => resultStatus(question) === 'Correct').length} / 3</Text>
              <Text style={layout.muted}>correct calls</Text>
            </View>
            <Badge>Simulated demo</Badge>
          </View>
          {categoryCodes.map((category) => {
            const question = round.questions.find((item) => item.categoryCode === category);
            if (!question) return null;
            const status = resultStatus(question);
            const good = status === 'Correct';
            const reset = status === 'Wrong' || status === 'Missed';
            return (
              <View key={question.questionId} style={layout.panel} testID={`result-${category}`}>
                <View style={layout.between}>
                  <Text style={layout.eyebrow}>{question.categoryName.toUpperCase()}</Text>
                  <Text style={[styles.result, good && styles.correct, reset && styles.reset]}>{status}</Text>
                </View>
                <Text style={styles.question}>{question.text}</Text>
                <View style={styles.answer}>
                  <Text style={layout.eyebrow}>YOUR CALL</Text>
                  <Text style={layout.body}>{pickLabel(question)}</Text>
                </View>
                <View style={styles.answer}>
                  <Text style={layout.eyebrow}>SIMULATED OUTCOME</Text>
                  <Text style={[layout.body, { fontWeight: '700' }]}>{outcomeLabel(question)}</Text>
                </View>
                <Text style={layout.muted}>{resultCopy[status]}</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  summaryNumber: { fontSize: 36, lineHeight: 43, color: colors.ink, fontWeight: '800', letterSpacing: -1 },
  result: { fontSize: 12, lineHeight: 18, fontWeight: '700', backgroundColor: colors.sage, color: colors.muted, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9, overflow: 'hidden' },
  correct: { color: colors.finance, backgroundColor: colors.financeBg },
  reset: { color: colors.error, backgroundColor: colors.errorBg },
  question: { fontSize: 18, lineHeight: 26, fontWeight: '600', color: colors.ink },
  answer: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13, gap: 5 },
});
