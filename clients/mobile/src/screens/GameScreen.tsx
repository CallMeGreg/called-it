import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { GameClient, GameSnapshot } from '../api/game-client';
import { categoryCodes, type BoardFilter, type Question, type Side } from '../api/contracts';
import { CancelledRequest, ClientError, describeError } from '../api/errors';
import { formatCountdown, secondsRemaining } from '../game/rounds';
import { useResource } from '../hooks/useResource';
import { Badge, Brand, Button, Loading, Notice } from '../ui/components';
import { colors, layout } from '../ui/theme';
import { QuestionCard } from './QuestionCard';
import { Results } from './Results';
import { Standings } from './Standings';
import { Stats } from './Stats';

type Tab = 'Play' | 'Results' | 'Boards' | 'You';
const tabs: Tab[] = ['Play', 'Results', 'Boards', 'You'];

export function GameScreen({ client, displayName, storageWarning, onSignOut, foreground, online, connectivityNotice, mode = 'api', controls }: {
  client: GameClient;
  displayName: string;
  storageWarning?: string | null;
  onSignOut?: () => void;
  foreground: boolean;
  online: boolean;
  connectivityNotice: string | null;
  mode?: 'api' | 'playground';
  controls?: ReactNode;
}) {
  const local = mode === 'playground';
  const [tab, setTab] = useState<Tab>('Play');
  const [filter, setFilter] = useState<BoardFilter>({ type: 'TotalScore' });
  const [now, setNow] = useState(() => performance.now());
  const [pending, setPending] = useState<string | null>(null);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [unconfirmedSnapshot, setUnconfirmedSnapshot] = useState<GameSnapshot | null>(null);
  const [lockedRound, setLockedRound] = useState<string | null>(null);
  const expiredRound = useRef<string | null>(null);
  const submitController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const enabled = foreground && online;

  const loadGame = useCallback((signal: AbortSignal) => client.game(signal), [client]);
  const gameResource = useResource(loadGame, enabled, 8_000);
  const { error: gameError, busy: gameBusy, refresh: refreshGame } = gameResource;
  const needsConfirmation = unconfirmedSnapshot !== null && unconfirmedSnapshot === gameResource.data;
  const loadBoard = useCallback((signal: AbortSignal) => client.leaderboard(filter, signal), [client, filter]);
  const boardResource = useResource(loadBoard, enabled && tab === 'Boards', 20_000);
  const refreshBoard = boardResource.refresh;
  const game = gameResource.data?.game;
  const round = game?.currentRound;
  const remaining = round && gameResource.data ? secondsRemaining(round, gameResource.data.clock, now) : 0;

  useEffect(() => {
    if (!enabled || !client.subscribeGame) return;
    return client.subscribeGame(() => {
      void refreshGame();
      if (tab === 'Boards') void refreshBoard();
    });
  }, [client, enabled, tab, refreshGame, refreshBoard]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submitController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled) submitController.current?.abort();
  }, [enabled]);

  useEffect(() => {
    if (!foreground) return;
    const timer = setInterval(() => setNow(performance.now()), 1_000);
    return () => clearInterval(timer);
  }, [foreground]);

  useEffect(() => {
    if (!enabled || !round || remaining > 0 || gameError || gameBusy || pending) return;
    if (expiredRound.current === round.id) return;
    expiredRound.current = round.id;
    void refreshGame();
  }, [enabled, round, remaining, gameError, gameBusy, refreshGame, pending]);

  const refresh = async () => {
    if (tab === 'Boards') void boardResource.refresh();
    const result = await gameResource.refresh();
    if (result.ok && mounted.current) {
      setUnconfirmedSnapshot(null);
      setSubmissionMessage(null);
    }
  };

  const save = async (question: Question, pick: Side | null) => {
    if (!round || !enabled || pending || needsConfirmation || gameResource.error || gameResource.busy
      || !round.isOpen || remaining <= 0 || lockedRound === round.id) return;
    const controller = new AbortController();
    submitController.current = controller;
    setPending(question.questionId);
    setSubmissionMessage(null);
    try {
      await client.submit(question.questionId, pick, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setUnconfirmedSnapshot(gameResource.data);
      const result = await gameResource.refresh();
      if (!mounted.current) return;
      if (!result.ok) {
        setSubmissionMessage(local ? 'The local call was saved, but its latest view could not be loaded. Refresh to confirm.' : 'The server accepted your call, but the latest view could not be loaded. Refresh to confirm its saved state.');
      } else if (result.data.game.currentRound?.id !== round.id) {
        setSubmissionMessage('Your call was accepted as the round ended. Check Results for the latest completed round.');
      }
    } catch (cause) {
      if (!mounted.current || cause instanceof CancelledRequest) return;
      if (cause instanceof ClientError && cause.isSubmissionLocked) {
        setLockedRound(round.id);
        setSubmissionMessage(local ? 'This local round is locked. Your new call was not saved. Refreshing the round...' : 'The server locked that round before your call arrived. It was not saved. Refreshing the round...');
        await gameResource.refresh();
      } else if (cause instanceof ClientError && cause.status === 409) {
        setSubmissionMessage(`${cause.message} Refreshing the server state.`);
        await gameResource.refresh();
      } else {
        const uncertain = cause instanceof ClientError
          && (['network', 'timeout', 'invalid-response'].includes(cause.kind) || (cause.status ?? 0) >= 500);
        setUnconfirmedSnapshot(uncertain ? gameResource.data : null);
        setSubmissionMessage(uncertain
          ? 'Could not confirm whether this call reached the server. Refresh before trying again; it will not be resubmitted automatically.'
          : describeError(cause));
      }
    } finally {
      if (submitController.current === controller) {
        submitController.current = null;
        if (mounted.current) setPending(null);
      }
    }
  };

  const controlsDisabled = !enabled || !!pending || !!gameResource.error || gameResource.busy
    || needsConfirmation || !round?.isOpen || remaining <= 0 || lockedRound === round?.id;
  const savedCount = round?.questions.filter((question) => question.myPick !== null || question.mySkip).length ?? 0;

  return (
    <View style={layout.flex}>
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <Brand light local={local} />
          <Button
            label={gameResource.busy ? 'Syncing' : 'Refresh'}
            variant="dark"
            onPress={() => { void refresh(); }}
            busy={gameResource.busy}
            disabled={!enabled || !!pending}
          />
        </View>
        <Text style={styles.headerCaption}>{local ? 'LOCAL PLAYGROUND / NO BACKEND' : 'THE TWO-MINUTE PLAYGROUND'}</Text>
      </View>

      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={layout.content}
        keyboardShouldPersistTaps="handled"
      >
        {controls}
        {!online && <Notice title="You're offline. Calls are paused." tone="warning">Showing the last server-confirmed state. Nothing will be queued or submitted in the background. Reconnect to refresh.</Notice>}
        {connectivityNotice && <Notice title="Connection status" tone="warning">{connectivityNotice}</Notice>}
        {storageWarning && <Notice title="Temporary session" tone="warning">{storageWarning}</Notice>}
        {gameResource.error && (
          <Notice title="Live updates paused" tone="error" action="Retry game" onAction={() => { void refresh(); }} disabled={!enabled || !!pending}>
            {gameResource.error.message} {game ? 'The calls and scores below are from your last successful refresh.' : ''}
          </Notice>
        )}
        {submissionMessage && (
          <Notice title={needsConfirmation ? 'Refresh to confirm your call' : 'Round update'} tone="warning" action="Refresh game" onAction={() => { void refresh(); }} disabled={!enabled || !!pending}>
            {submissionMessage}
          </Notice>
        )}
        {!game && gameResource.busy && <Loading label={local ? 'Loading your local round...' : 'Getting your shared round...'} />}
        {!game && !gameResource.busy && !gameResource.error && !online && (
          <Notice title="No round loaded yet">Your game will load when you&apos;re back online.</Notice>
        )}

        {tab === 'Play' && game && (
          <>
            <View style={styles.hero}>
              <Badge dark>{local ? 'Local simulated demo' : 'Simulated demo'}</Badge>
              <Text accessibilityRole="header" style={styles.heroTitle}>Make your call.</Text>
              <Text style={styles.heroBody}>{local ? 'Sample questions. You choose the outcomes.\nPicks and scores stay in this browser only.' : 'Sample questions. Simulated outcomes.\nYour picks and streaks are the real thing.'}</Text>
              {round ? (
                <>
                  <View style={styles.timerRow}>
                    <View style={{ gap: 5 }}>
                      <Text style={styles.timerLabel}>{remaining > 0 && round.isOpen ? 'ROUND LOCKS IN' : 'ROUND ENDED'}</Text>
                      <Text
                        testID="round-countdown"
                        accessibilityLabel={`Round closes in ${remaining} seconds`}
                        style={[styles.timer, remaining <= 15 && styles.urgentTimer]}
                      >{formatCountdown(remaining)}</Text>
                    </View>
                    <View style={styles.callCount}><Text style={styles.countValue}>{savedCount} / 3</Text><Text style={styles.countLabel}>calls saved</Text></View>
                  </View>
                  <View style={styles.track} accessible={false}>
                    <View style={[styles.progress, { width: `${Math.min(100, remaining / 120 * 100)}%` }]} />
                  </View>
                  <Text style={styles.timerNote}>
                    {local
                      ? (round.isOpen ? 'Manual local clock. Use Fast forward or Lock round in local controls.' : 'Calls are locked. Choose outcomes in local controls, then publish to start the next round.')
                      : (remaining > 0 && round.isOpen ? 'Shared round. Server-synced clock. Change a call until lock.' : 'Fetching the next shared round. Last-round calls are locked.')}
                  </Text>
                </>
              ) : <Text style={styles.heroBody}>The next shared round is being prepared. Stay here or use Refresh.</Text>}
            </View>

            <View style={layout.between}>
              <Text style={layout.eyebrow}>THREE CATEGORIES. ONE INSTINCT.</Text>
            </View>
            {round && categoryCodes.map((category) => {
              const question = round.questions.find((item) => item.categoryCode === category);
              if (!question) return null;
              return <QuestionCard
                key={question.questionId}
                question={question}
                local={local}
                stats={game.stats.categories.find((item) => item.categoryCode === category)}
                disabled={controlsDisabled}
                busy={pending === question.questionId}
                onPick={(pick) => { void save(question, pick); }}
              />;
            })}
            <Text style={styles.playFootnote}>Not feeling a call? Skip to preserve that category&apos;s streak. Leaving it untouched counts as missed when the round ends. Points only - no betting, money, or prizes.</Text>
          </>
        )}

        {tab === 'Results' && game && <Results round={game.previousRound} local={local} />}
        {tab === 'Boards' && (
          <Standings
            filter={filter}
            onFilter={setFilter}
            data={boardResource.data}
            busy={boardResource.busy}
            error={boardResource.error}
            onRetry={() => { void boardResource.refresh(); }}
            online={online}
            local={local}
          />
        )}
        {tab === 'You' && (game
          ? <Stats stats={game.stats} displayName={displayName} onSignOut={onSignOut} local={local} />
          : <View style={layout.panel}>
            <Text accessibilityRole="header" style={layout.subtitle}>{displayName}</Text>
            <Text style={layout.muted}>Your stats will appear after a successful game refresh.</Text>
            {onSignOut && <Button label="Sign out" variant="secondary" onPress={onSignOut} />}
          </View>)}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.tabArea}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item }}
              aria-selected={tab === item}
              accessibilityLabel={item}
              onPress={() => {
                setTab(item);
                scroll.current?.scrollTo({ y: 0, animated: false });
              }}
              style={({ pressed }) => [styles.tab, tab === item && styles.activeTab, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.tabText, tab === item && styles.activeTabText]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.ink, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14, gap: 6 },
  headerInner: { width: '100%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' },
  headerCaption: { width: '100%', maxWidth: 680, alignSelf: 'center', color: '#AFC4BA', fontSize: 9, lineHeight: 15, letterSpacing: 1.6, fontWeight: '700' },
  scroll: { flex: 1, backgroundColor: colors.paper },
  hero: { backgroundColor: colors.ink, borderRadius: 24, padding: 23, gap: 15 },
  heroTitle: { fontSize: 31, lineHeight: 38, color: colors.surface, fontWeight: '700', letterSpacing: -0.8 },
  heroBody: { fontSize: 14, lineHeight: 22, color: '#CAD9CF' },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 5 },
  timerLabel: { color: '#B5C9B6', fontSize: 10, fontWeight: '700', lineHeight: 15, letterSpacing: 1.2 },
  timer: { fontSize: 46, lineHeight: 53, fontWeight: '700', color: colors.lime, fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  urgentTimer: { color: '#FFD7A0' },
  callCount: { alignItems: 'center', gap: 4, borderLeftWidth: 1, borderLeftColor: '#486153', paddingLeft: 22 },
  countValue: { color: colors.surface, fontSize: 22, lineHeight: 29, fontWeight: '700' },
  countLabel: { color: '#B8CBBE', fontSize: 11, lineHeight: 17 },
  track: { height: 4, backgroundColor: '#3B574B', borderRadius: 2, overflow: 'hidden' },
  progress: { backgroundColor: colors.lime, height: 4, borderRadius: 2 },
  timerNote: { color: '#B8CBBE', fontSize: 11, lineHeight: 18 },
  playFootnote: { ...layout.muted, paddingHorizontal: 3, fontSize: 12, lineHeight: 19 },
  tabArea: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  tabs: { flexDirection: 'row', gap: 4, padding: 10, width: '100%', maxWidth: 720, alignSelf: 'center' },
  tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 4 },
  activeTab: { backgroundColor: colors.sage },
  tabText: { color: colors.muted, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  activeTabText: { color: colors.ink, fontWeight: '800' },
});
