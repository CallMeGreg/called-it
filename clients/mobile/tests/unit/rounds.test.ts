import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCountdown, outcomeLabel, pickLabel, resultStatus, secondsRemaining, synchronizeClock } from '../../src/game/rounds';
import { makeQuestion, makeRound } from '../fixtures';

test('countdown uses server time, half-trip compensation, and monotonic elapsed time', () => {
  const serverTime = '2026-10-07T12:00:00Z';
  const round = makeRound({ dropAtUtc: serverTime, locksAtUtc: '2026-10-07T12:02:00Z' });
  const wrongLocalClock = Date.parse('2032-01-01T00:00:00Z');
  const clock = synchronizeClock(serverTime, wrongLocalClock, wrongLocalClock + 200, 50);
  assert.equal(secondsRemaining(round, clock, 50), 120);
  assert.equal(secondsRemaining(round, clock, 30_050), 90);
  assert.equal(secondsRemaining(round, clock, 120_050), 0);
  assert.equal(secondsRemaining(round, clock, 900_000), 0);
  assert.equal(formatCountdown(90), '01:30');
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-1), '00:00');
});

test('a backwards wall clock during the request cannot add negative latency', () => {
  const clock = synchronizeClock('2026-10-07T12:00:00Z', 5_000, 4_000, 20);
  assert.equal(clock.serverAtSyncMs, Date.parse('2026-10-07T12:00:00Z'));
});

test('results mirror server precedence for unresolved, void, skip, missed, and both sides', () => {
  assert.equal(resultStatus(makeQuestion({ outcome: 'Unresolved', mySkip: true })), 'Pending');
  assert.equal(resultStatus(makeQuestion({ outcome: 'Void', mySkip: true })), 'Void');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideA', mySkip: true })), 'Skipped');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideA' })), 'Missed');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideA', myPick: 'A' })), 'Correct');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideB', myPick: 'B' })), 'Correct');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideB', myPick: 'A' })), 'Wrong');
  assert.equal(resultStatus(makeQuestion({ outcome: 'SideA', myPick: 'B' })), 'Wrong');
});

test('result labels explain the actual pick and simulated outcome', () => {
  assert.equal(pickLabel(makeQuestion()), 'No call');
  assert.equal(pickLabel(makeQuestion({ mySkip: true })), 'Skip');
  assert.equal(pickLabel(makeQuestion({ myPick: 'B' })), 'Away side');
  assert.equal(outcomeLabel(makeQuestion({ outcome: 'SideA' })), 'Home side');
  assert.equal(outcomeLabel(makeQuestion({ outcome: 'Void' })), 'Voided - no score change');
  assert.equal(outcomeLabel(makeQuestion()), 'Awaiting simulated outcome');
});
