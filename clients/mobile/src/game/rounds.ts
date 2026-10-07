import type { Question, Round } from '../api/contracts';

export interface ServerClock {
  serverAtSyncMs: number;
  monotonicAtSyncMs: number;
}

export function synchronizeClock(
  serverTimeUtc: string,
  requestStartedMs: number,
  responseReceivedMs: number,
  monotonicAtReceiptMs: number,
): ServerClock {
  return {
    serverAtSyncMs: Date.parse(serverTimeUtc) + Math.max(0, responseReceivedMs - requestStartedMs) / 2,
    monotonicAtSyncMs: monotonicAtReceiptMs,
  };
}

export function secondsRemaining(round: Round, clock: ServerClock, monotonicNowMs: number) {
  const elapsed = Math.max(0, monotonicNowMs - clock.monotonicAtSyncMs);
  return Math.max(0, Math.ceil((Date.parse(round.locksAtUtc) - clock.serverAtSyncMs - elapsed) / 1000));
}

export function formatCountdown(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export type ResultStatus = 'Correct' | 'Wrong' | 'Skipped' | 'Missed' | 'Void' | 'Pending';
export function resultStatus(question: Question): ResultStatus {
  if (question.outcome === 'Unresolved') return 'Pending';
  if (question.outcome === 'Void') return 'Void';
  if (question.mySkip) return 'Skipped';
  if (question.myPick === null) return 'Missed';
  return (
    (question.myPick === 'A' && question.outcome === 'SideA')
    || (question.myPick === 'B' && question.outcome === 'SideB')
  ) ? 'Correct' : 'Wrong';
}

export function pickLabel(question: Question) {
  if (question.mySkip) return 'Skip';
  if (question.myPick === null) return 'No call';
  return question.myPick === 'A' ? question.sideALabel : question.sideBLabel;
}

export function outcomeLabel(question: Question) {
  switch (question.outcome) {
    case 'SideA': return question.sideALabel;
    case 'SideB': return question.sideBLabel;
    case 'Void': return 'Voided - no score change';
    case 'Unresolved': return 'Awaiting simulated outcome';
  }
}
