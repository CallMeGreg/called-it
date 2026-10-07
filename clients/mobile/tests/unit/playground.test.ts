import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gameSchema, leaderboardSchema, categoryCodes } from '../../src/api/contracts';
import { ClientError } from '../../src/api/errors';
import { SESSION_KEY } from '../../src/auth/store';
import { secondsRemaining } from '../../src/game/rounds';
import { resolveLaunchMode } from '../../src/launch-mode';
import { PlaygroundClient } from '../../src/playground/client';
import { advanceClock, chooseOutcome, initialPlayground, lockRound, publishOutcomes, savePick, type PlaygroundState } from '../../src/playground/model';
import { PLAYGROUND_KEY, PlaygroundStorage } from '../../src/playground/storage';

const start = Date.parse('2026-10-07T12:00:00Z');
function withOutcomes(state: PlaygroundState): PlaygroundState {
  for (const category of categoryCodes) state = chooseOutcome(state, state.game.currentRound.id, category, 'SideA');
  return state;
}

function harness() {
  const entries = new Map<string, string>();
  let failReads = false;
  let failWrites = false;
  const adapter = {
    getItem: (key: string) => {
      if (failReads) throw new Error('storage blocked');
      return entries.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('quota exceeded');
      entries.set(key, value);
    },
  };
  const create = () => new PlaygroundClient(new PlaygroundStorage(() => adapter), () => start, () => 100);
  const client = create();
  client.load();
  return { client, entries, create, blockReads: () => { failReads = true; }, blockWrites: () => { failWrites = true; } };
}

test('playground opt-in requires development web on literal loopback; ordinary launches remain API mode', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(resolveLaunchMode('1', 'web', true, host), 'playground');
    assert.equal(resolveLaunchMode(undefined, 'web', true, host), 'api');
    assert.throws(() => resolveLaunchMode('1', 'web', false, host), /release builds cannot/);
  }
  for (const host of ['example.com', 'localhost.example.com', '192.168.1.2', undefined]) {
    assert.throws(() => resolveLaunchMode('1', 'web', true, host), /loopback/);
  }
  for (const platform of ['ios', 'android']) assert.throws(() => resolveLaunchMode('1', platform, true, 'localhost'));
  assert.equal(resolveLaunchMode(undefined, 'ios', false, undefined), 'api');
  assert.equal(resolveLaunchMode('true', 'web', true, 'localhost'), 'api');
});

test('mock time advances by explicit steps, clamps at lock, and remains frozen between actions', async () => {
  const { client } = harness();
  const before = await client.game();
  const round = before.game.currentRound!;
  assert.equal(secondsRemaining(round, before.clock, 100), 120);
  assert.equal(secondsRemaining(round, before.clock, 3_600_100), 120);
  client.fastForward(round.id);
  const advanced = await client.game();
  assert.equal(secondsRemaining(advanced.game.currentRound!, advanced.clock, 1_000), 90);
  client.lock(round.id);
  const locked = await client.game();
  assert.equal(locked.game.currentRound!.isOpen, false);
  assert.equal(secondsRemaining(locked.game.currentRound!, locked.clock, 1_000), 0);
  client.fastForward(round.id);
  assert.equal((await client.game()).game.serverTimeUtc, locked.game.serverTimeUtc);
});

test('invalid time steps and stale controls cannot mutate a round', () => {
  const state = initialPlayground(start);
  for (const step of [0, -30, 0.5, Number.NaN, 121]) {
    assert.throws(() => advanceClock(state, state.game.currentRound.id, step), /whole seconds/);
  }
  assert.throws(() => lockRound(state, 'stale-round'), /already ended/);
});

test('draft outcomes are invisible in player snapshots; lock rejects picks with 423', async () => {
  const { client } = harness();
  const round = (await client.game()).game.currentRound!;
  await client.submit(round.questions[0]!.questionId, 'A');
  client.choose(round.id, 'sports', 'SideB');
  const visible = (await client.game()).game;
  assert.equal(visible.currentRound!.questions[0]!.outcome, 'Unresolved');
  assert.equal(visible.stats.totalScore, 0);
  assert.equal(visible.previousRound, null);
  client.lock(round.id);
  await assert.rejects(client.submit(round.questions[0]!.questionId, 'B'),
    (error) => error instanceof ClientError && error.status === 423);
  assert.equal((await client.game()).game.currentRound!.questions[0]!.myPick, 'A');
});

test('publish requires lock and all outcomes, scores once, and opens the next round', () => {
  let state = initialPlayground(start);
  const firstId = state.game.currentRound.id;
  state = savePick(state, state.game.currentRound.questions[0]!.questionId, 'A');
  assert.throws(() => publishOutcomes(withOutcomes(state), firstId), /Lock the round/);
  state = lockRound(state, firstId);
  assert.throws(() => publishOutcomes(state, firstId), /all three/);
  state = withOutcomes(state);
  const published = publishOutcomes(state, firstId);
  assert.equal(published.roundNumber, 2);
  assert.equal(published.game.stats.totalScore, 1);
  assert.equal(published.game.stats.overallStreak, 1);
  assert.equal(published.game.currentRound.isOpen, true);
  assert.equal(published.game.previousRound!.id, firstId);
  assert.equal(publishOutcomes(published, firstId), published);
  assert.equal(state.game.stats.totalScore, 0);
  assert.ok(published.game.currentRound.questions.every((question) => question.myPick === null && !question.mySkip && question.outcome === 'Unresolved'));
  assert.deepEqual(published.drafts, { sports: null, finance: null, pop_culture: null });
  assert.throws(() => chooseOutcome(published, firstId, 'sports', 'Void'), /cannot be edited/);
});

test('correct grows streak/best, wrong and missed reset, skip and void preserve, total never falls', () => {
  let state = initialPlayground(start);
  for (const question of state.game.currentRound.questions) state = savePick(state, question.questionId, 'A');
  state = publishOutcomes(withOutcomes(lockRound(state, state.game.currentRound.id)), state.game.currentRound.id);
  assert.equal(state.game.stats.totalScore, 3);
  assert.deepEqual(state.game.stats.categories.map((item) => item.currentStreak), [1, 1, 1]);
  const second = state.game.currentRound;
  state = savePick(state, second.questions[0]!.questionId, null);
  state = savePick(state, second.questions[1]!.questionId, 'B');
  state = withOutcomes(lockRound(state, second.id));
  state = chooseOutcome(state, second.id, 'pop_culture', 'Void');
  state = publishOutcomes(state, second.id);
  assert.equal(state.game.stats.totalScore, 3);
  assert.deepEqual(state.game.stats.categories.map((item) => item.currentStreak), [1, 0, 1]);
  assert.deepEqual(state.game.stats.categories.map((item) => item.bestStreak), [1, 1, 1]);
  const third = state.game.currentRound;
  state = savePick(state, third.questions[0]!.questionId, 'A');
  state = publishOutcomes(withOutcomes(lockRound(state, third.id)), third.id);
  assert.equal(state.game.stats.totalScore, 4);
  assert.deepEqual(state.game.stats.categories.map((item) => item.currentStreak), [2, 0, 0]);
  assert.deepEqual(state.game.stats.categories.map((item) => item.bestStreak), [2, 1, 1]);
  assert.throws(() => publishOutcomes(state, second.id), /already ended/);
});

test('reload restores only local time/picks/drafts/stats, independent of elapsed wall time and real auth', async () => {
  const { client, entries, create } = harness();
  entries.set(SESSION_KEY, 'untouched-real-auth-marker');
  const round = (await client.game()).game.currentRound!;
  await client.submit(round.questions[0]!.questionId, 'B');
  client.choose(round.id, 'sports', 'Void');
  client.fastForward(round.id);
  const restored = create();
  restored.load();
  assert.deepEqual((await restored.game()).game, (await client.game()).game);
  assert.equal(restored.getSnapshot().state!.drafts.sports, 'Void');
  assert.equal(entries.get(SESSION_KEY), 'untouched-real-auth-marker');
  assert.notEqual(PLAYGROUND_KEY, SESSION_KEY);
  assert.doesNotMatch(entries.get(PLAYGROUND_KEY)!, /accessToken|refreshToken|inviteCode/);
});

test('storage failure refuses pick/reset mutations and displays an explicit error', async () => {
  const harnessed = harness();
  const before = harnessed.client.getSnapshot().state;
  harnessed.blockWrites();
  await assert.rejects(harnessed.client.submit(before!.game.currentRound.questions[0]!.questionId, 'A'), /No action was applied/);
  assert.equal(harnessed.client.getSnapshot().state, before);
  assert.match(harnessed.client.getSnapshot().error!, /could not be saved/);
  assert.throws(() => harnessed.client.reset(), /No action was applied/);
  assert.equal(harnessed.client.getSnapshot().state, before);
});

test('corrupt or blocked storage does not invent a successful session; reset replaces only local state', async () => {
  const { entries, create, blockReads } = harness();
  entries.set(PLAYGROUND_KEY, '{corrupt');
  entries.set(SESSION_KEY, 'real-auth-untouched');
  const corrupted = create();
  corrupted.load();
  assert.equal(corrupted.getSnapshot().state, null);
  assert.match(corrupted.getSnapshot().error!, /unreadable/);
  corrupted.reset();
  assert.equal((await corrupted.game()).game.stats.totalScore, 0);
  assert.equal(entries.get(SESSION_KEY), 'real-auth-untouched');
  blockReads();
  corrupted.load();
  assert.equal(corrupted.getSnapshot().state, null);
  assert.match(corrupted.getSnapshot().error!, /storage is unavailable/);
});

test('stale tabs must reload instead of overwriting another local save', () => {
  const { client, create } = harness();
  const second = create();
  second.load();
  const id = client.getSnapshot().state!.game.currentRound.id;
  client.fastForward(id);
  assert.throws(() => second.lock(id), /Another tab changed/);
  second.load();
  second.lock(id);
  assert.equal(second.getSnapshot().state!.game.currentRound.isOpen, false);
});

test('the actual local adapter produces contract-shaped boards and never calls fetch or uses tokens', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('No network is allowed'); };
  try {
    const { client } = harness();
    const round = (await client.game()).game.currentRound!;
    await client.submit(round.questions[0]!.questionId, 'A');
    client.lock(round.id);
    for (const category of categoryCodes) client.choose(round.id, category, 'SideA');
    client.publish(round.id);
    gameSchema.parse((await client.game()).game);
    for (const filter of [
      { type: 'TotalScore' }, { type: 'OverallStreak' },
      { type: 'CategoryStreak', category: 'sports' }, { type: 'CategoryBestStreak', category: 'sports' },
    ] as const) {
      const board = leaderboardSchema.parse(await client.leaderboard(filter));
      assert.equal(board.rows[0]!.score, 1);
    }
    client.reset();
    assert.equal((await client.game()).game.stats.totalScore, 0);
    assert.equal((await client.game()).game.previousRound, null);
    assert.equal(calls, 0);
    assert.doesNotMatch(JSON.stringify(client.getSnapshot()), /accessToken|refreshToken|inviteCode/);
  } finally {
    globalThis.fetch = original;
  }
});
