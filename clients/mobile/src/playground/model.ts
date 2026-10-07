import { z } from 'zod';

import {
  categoryCodes, gameSchema, roundSchema,
  type CategoryCode, type CategoryStats, type Round, type Side,
} from '../api/contracts';
import { ClientError } from '../api/errors';
import { resultStatus } from '../game/rounds';

export const demoPlayer = { userId: '00000000-0000-4000-8000-000000000001', displayName: 'Demo player' };
export const outcomeChoices = ['SideA', 'SideB', 'Void'] as const;
export type OutcomeChoice = typeof outcomeChoices[number];
const draftOutcome = z.enum(outcomeChoices).nullable();
const localGameSchema = gameSchema.extend({ currentRound: roundSchema });

export const playgroundStateSchema = z.object({
  version: z.literal(1),
  roundNumber: z.number().int().min(1).max(1_000_000),
  game: localGameSchema,
  drafts: z.object({ sports: draftOutcome, finance: draftOutcome, pop_culture: draftOutcome }).strict(),
}).strict().refine((state) => {
  const { currentRound: round, previousRound: previous, stats } = state.game;
  const now = Date.parse(state.game.serverTimeUtc);
  return now >= Date.parse(round.dropAtUtc) && now <= Date.parse(round.locksAtUtc)
    && Date.parse(round.locksAtUtc) - Date.parse(round.dropAtUtc) === 120_000
    && round.isOpen === (now < Date.parse(round.locksAtUtc))
    && round.questions.every((question) => question.outcome === 'Unresolved')
    && (!previous || (!previous.isOpen && previous.id !== round.id
      && Date.parse(previous.locksAtUtc) <= Date.parse(round.dropAtUtc)
      && previous.questions.every((question) => question.outcome !== 'Unresolved')))
    && stats.categories.every((category) => category.currentStreak <= category.bestStreak && category.bestStreak <= category.totalCorrect)
    && stats.totalScore === stats.categories.reduce((sum, category) => sum + category.totalCorrect, 0)
    && stats.overallStreak === stats.categories.reduce((sum, category) => sum + category.currentStreak, 0);
}, 'The local save has inconsistent round or score state.');
export type PlaygroundState = z.infer<typeof playgroundStateSchema>;

const samples: Record<CategoryCode, { name: string; text: string }> = {
  sports: { name: 'Sports', text: '[LOCAL SAMPLE] Will the Comets beat the Rockets?' },
  finance: { name: 'Finance', text: '[LOCAL SAMPLE] Will the fictional Demo Index finish higher?' },
  pop_culture: { name: 'Pop Culture', text: '[LOCAL SAMPLE] Will the Neon Nights trailer top the chart?' },
};

function makeRound(number: number, now: number): Round {
  return {
    id: `10000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`,
    dropAtUtc: new Date(now).toISOString(),
    locksAtUtc: new Date(now + 120_000).toISOString(),
    isOpen: true,
    questions: categoryCodes.map((categoryCode, index) => ({
      questionId: `20000000-0000-4000-8000-${(number * 3 + index).toString(16).padStart(12, '0')}`,
      categoryCode,
      categoryName: samples[categoryCode].name,
      text: samples[categoryCode].text,
      sideALabel: 'Yes',
      sideBLabel: 'No',
      myPick: null,
      mySkip: false,
      outcome: 'Unresolved',
    })),
  };
}

const emptyDrafts = (): PlaygroundState['drafts'] => ({ sports: null, finance: null, pop_culture: null });

export function initialPlayground(now: number): PlaygroundState {
  return playgroundStateSchema.parse({
    version: 1, roundNumber: 1, drafts: emptyDrafts(),
    game: {
      serverTimeUtc: new Date(now).toISOString(),
      currentRound: makeRound(1, now),
      previousRound: null,
      stats: {
        totalScore: 0, overallStreak: 0,
        categories: categoryCodes.map((categoryCode) => ({
          categoryCode, categoryName: samples[categoryCode].name,
          currentStreak: 0, bestStreak: 0, totalCorrect: 0,
        })),
      },
    },
  });
}

function requireRound(state: PlaygroundState, id: string) {
  if (state.game.currentRound.id !== id) {
    throw new ClientError('http', 'That local round has already ended. Refresh the controls; published outcomes cannot be edited.', 409);
  }
}

export function savePick(state: PlaygroundState, questionId: string, pick: Side | null): PlaygroundState {
  const round = state.game.currentRound;
  if (!round.isOpen || state.game.previousRound?.questions.some((question) => question.questionId === questionId)) {
    throw new ClientError('http', 'Submission window closed. This local round is locked.', 423);
  }
  if (!round.questions.some((question) => question.questionId === questionId)) {
    throw new ClientError('http', 'That question is not in the current local round.', 404);
  }
  if (pick !== 'A' && pick !== 'B' && pick !== null) throw new ClientError('http', 'Choose Side A, Side B, or Skip.', 400);
  return {
    ...state,
    game: {
      ...state.game,
      currentRound: {
        ...round,
        questions: round.questions.map((question) => question.questionId === questionId
          ? { ...question, myPick: pick, mySkip: pick === null }
          : question),
      },
    },
  };
}

export function advanceClock(state: PlaygroundState, roundId: string, seconds: number): PlaygroundState {
  requireRound(state, roundId);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 120) {
    throw new ClientError('http', 'Fast forward must advance 1 to 120 whole seconds.', 400);
  }
  const round = state.game.currentRound;
  if (!round.isOpen) return state;
  const lock = Date.parse(round.locksAtUtc);
  const now = Math.min(lock, Date.parse(state.game.serverTimeUtc) + seconds * 1000);
  return {
    ...state,
    game: { ...state.game, serverTimeUtc: new Date(now).toISOString(), currentRound: { ...round, isOpen: now < lock } },
  };
}

export function lockRound(state: PlaygroundState, roundId: string): PlaygroundState {
  return advanceClock(state, roundId, 120);
}

export function chooseOutcome(state: PlaygroundState, roundId: string, category: CategoryCode, outcome: OutcomeChoice): PlaygroundState {
  requireRound(state, roundId);
  if (!categoryCodes.includes(category) || !outcomeChoices.includes(outcome)) {
    throw new ClientError('http', 'Choose a supported category and Side A, Side B, or Void outcome.', 400);
  }
  return { ...state, drafts: { ...state.drafts, [category]: outcome } };
}

function scoreCategory(stats: CategoryStats, round: Round): CategoryStats {
  const question = round.questions.find((item) => item.categoryCode === stats.categoryCode);
  if (!question) throw new ClientError('invalid-response', 'A category is missing from the local round. Reset the demo.');
  const status = resultStatus(question);
  if (status === 'Correct') {
    return {
      ...stats, totalCorrect: stats.totalCorrect + 1, currentStreak: stats.currentStreak + 1,
      bestStreak: Math.max(stats.bestStreak, stats.currentStreak + 1),
    };
  }
  if (status === 'Wrong' || status === 'Missed') return { ...stats, currentStreak: 0 };
  return stats;
}

export function publishOutcomes(state: PlaygroundState, roundId: string): PlaygroundState {
  if (state.game.previousRound?.id === roundId) return state;
  requireRound(state, roundId);
  if (state.game.currentRound.isOpen) throw new ClientError('http', 'Lock the round before publishing its outcomes.', 409);
  if (state.roundNumber >= 1_000_000) throw new ClientError('http', 'This demo has reached its round limit. Reset it to start over.', 409);
  const completed: Round = {
    ...state.game.currentRound,
    questions: state.game.currentRound.questions.map((question) => {
      const outcome = state.drafts[question.categoryCode];
      if (outcome === null) throw new ClientError('http', 'Choose an outcome for all three categories before publishing.', 400);
      return { ...question, outcome };
    }),
  };
  const categories = state.game.stats.categories.map((stats) => scoreCategory(stats, completed));
  return {
    ...state,
    roundNumber: state.roundNumber + 1,
    drafts: emptyDrafts(),
    game: {
      serverTimeUtc: state.game.serverTimeUtc,
      currentRound: makeRound(state.roundNumber + 1, Date.parse(state.game.serverTimeUtc)),
      previousRound: completed,
      stats: {
        categories,
        totalScore: categories.reduce((sum, category) => sum + category.totalCorrect, 0),
        overallStreak: categories.reduce((sum, category) => sum + category.currentStreak, 0),
      },
    },
  };
}
