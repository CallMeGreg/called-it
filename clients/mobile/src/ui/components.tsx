import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { colors, layout } from './theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'dark';
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, busy = false, hint }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: disabled || busy, busy }}
      aria-busy={busy}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        variant === 'dark' && styles.dark,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={variant === 'dark' ? colors.lime : colors.ink} />}
      <Text style={[styles.buttonText, variant === 'dark' && { color: colors.lime }]}>{label}</Text>
    </Pressable>
  );
}

export function Notice({ title, children, tone = 'info', action, onAction, disabled }: {
  title: string;
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error';
  action?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.notice, tone === 'warning' && styles.warning, tone === 'error' && styles.error]}
    >
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={layout.muted}>{children}</Text>
      {action && onAction && <Button variant="secondary" label={action} onPress={onAction} disabled={disabled} />}
    </View>
  );
}

export function Badge({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <View style={[styles.badge, dark && styles.darkBadge]}>
      <View style={[styles.dot, dark && { backgroundColor: colors.lime }]} />
      <Text style={[styles.badgeText, dark && { color: colors.lime }]}>{children}</Text>
    </View>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <View style={layout.row} accessibilityLabel="Called It TEST">
      <View style={styles.logoMark}><Text style={styles.logoText}>!</Text></View>
      <Text style={[styles.brand, light && { color: colors.surface }]}>called it.</Text>
      <Text style={[styles.test, light && { color: colors.lime, borderColor: '#56734C' }]}>TEST</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={layout.muted}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 50, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderColor: 'transparent' },
  primary: { backgroundColor: colors.lime, borderColor: '#C4E667' },
  secondary: { backgroundColor: colors.surface, borderColor: colors.line },
  quiet: { backgroundColor: 'transparent' },
  dark: { backgroundColor: colors.ink },
  buttonText: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
  notice: { padding: 16, borderRadius: 16, gap: 8, backgroundColor: colors.sage, borderWidth: 1, borderColor: colors.line },
  warning: { backgroundColor: colors.warningBg, borderColor: '#E4C99A' },
  error: { backgroundColor: colors.errorBg, borderColor: '#E8BDB1' },
  noticeTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.ink },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 20, backgroundColor: colors.sage, paddingHorizontal: 11, paddingVertical: 7 },
  darkBadge: { backgroundColor: '#284347' },
  dot: { height: 6, width: 6, borderRadius: 3, backgroundColor: colors.finance },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700', color: colors.finance, letterSpacing: 0.2 },
  logoMark: { width: 33, height: 33, borderRadius: 10, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  logoText: { fontSize: 25, fontWeight: '900', color: colors.ink, lineHeight: 29 },
  brand: { fontSize: 23, fontWeight: '800', letterSpacing: -1, color: colors.ink },
  test: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: colors.muted, borderWidth: 1, borderColor: colors.line, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  loading: { paddingVertical: 26, gap: 12, alignItems: 'center' },
});
