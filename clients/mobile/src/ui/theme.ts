import { Platform, StyleSheet } from 'react-native';

export const colors = {
  ink: '#142F32',
  paper: '#F2F3EB',
  surface: '#FFFEF8',
  muted: '#546565',
  line: '#D9DFD3',
  lime: '#D7F879',
  limeDark: '#365317',
  sage: '#E6EEDC',
  white: '#FFFFFF',
  error: '#9E302D',
  errorBg: '#FFF0E9',
  warning: '#794715',
  warningBg: '#FFF1D5',
  sports: '#A6442A',
  sportsBg: '#FCEDE1',
  finance: '#1A6556',
  financeBg: '#E1F1E8',
  pop_culture: '#68438E',
  pop_cultureBg: '#EFE5F8',
};

export const fonts = {
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' }),
};

export const layout = StyleSheet.create({
  flex: { flex: 1 },
  body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.6, color: colors.muted },
  title: { fontFamily: fonts.display, fontSize: 34, lineHeight: 41, color: colors.ink },
  subtitle: { fontSize: 21, lineHeight: 28, fontWeight: '700', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stack: { gap: 16 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 20, gap: 16 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, gap: 20, paddingBottom: 28 },
});
