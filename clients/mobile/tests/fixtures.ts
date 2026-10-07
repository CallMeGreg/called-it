import type { AuthResult, CategoryCode, Game, Question, Round } from '../src/api/contracts';

export const userId = '10000000-0000-4000-8000-000000000001';
export const otherUserId = '10000000-0000-4000-8000-000000000002';
export const roundId = '20000000-0000-4000-8000-000000000001';
export const questionIds = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
] as const;

export function makeAuth(overrides: Partial<AuthResult> = {}): AuthResult {
  return {
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    userId,
    displayName: 'Test player',
    isAdmin: false,
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    questionId: questionIds[0],
    categoryCode: 'sports',
    categoryName: 'Sports',
    text: 'Will the home side win this simulated match?',
    sideALabel: 'Home side',
    sideBLabel: 'Away side',
    myPick: null,
    mySkip: false,
    outcome: 'Unresolved',
    ...overrides,
  };
}

export function makeRound(overrides: Partial<Round> = {}): Round {
  const now = Date.now();
  return {
    id: roundId,
    dropAtUtc: new Date(now - 30_000).toISOString(),
    locksAtUtc: new Date(now + 90_000).toISOString(),
    isOpen: true,
    questions: [
      makeQuestion(),
      makeQuestion({
        questionId: questionIds[1], categoryCode: 'finance', categoryName: 'Finance',
        text: 'Will the sample market finish this demo higher or lower?', sideALabel: 'Higher', sideBLabel: 'Lower',
      }),
      makeQuestion({
        questionId: questionIds[2], categoryCode: 'pop_culture', categoryName: 'Pop Culture',
        text: 'Which sample track wins this simulated chart battle?', sideALabel: 'The debut', sideBLabel: 'The comeback',
      }),
    ],
    ...overrides,
  };
}

export function makeGame(overrides: Partial<Game> = {}): Game {
  const categories: { categoryCode: CategoryCode; categoryName: string }[] = [
    { categoryCode: 'sports', categoryName: 'Sports' },
    { categoryCode: 'finance', categoryName: 'Finance' },
    { categoryCode: 'pop_culture', categoryName: 'Pop Culture' },
  ];
  return {
    serverTimeUtc: new Date().toISOString(),
    currentRound: makeRound(),
    previousRound: null,
    stats: {
      totalScore: 0, overallStreak: 0,
      categories: categories.map((category) => ({
        ...category, currentStreak: 0, bestStreak: 0, totalCorrect: 0,
      })),
    },
    ...overrides,
  };
}
