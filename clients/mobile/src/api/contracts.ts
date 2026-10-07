import { z } from 'zod';

export const categoryCodes = ['sports', 'finance', 'pop_culture'] as const;
export const categorySchema = z.enum(categoryCodes);
export type CategoryCode = z.infer<typeof categorySchema>;
export const sideSchema = z.enum(['A', 'B']);
export type Side = z.infer<typeof sideSchema>;
const timestamp = z.iso.datetime({ offset: true });
const score = z.number().int().nonnegative();

export const authSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: timestamp,
  refreshToken: z.string().min(1),
  userId: z.uuid(),
  displayName: z.string().min(1),
  isAdmin: z.boolean(),
});
export type AuthResult = z.infer<typeof authSchema>;

export const questionSchema = z.object({
  questionId: z.uuid(),
  categoryCode: categorySchema,
  categoryName: z.string().min(1),
  text: z.string().min(1),
  sideALabel: z.string().min(1),
  sideBLabel: z.string().min(1),
  myPick: sideSchema.nullable(),
  mySkip: z.boolean(),
  outcome: z.enum(['Unresolved', 'SideA', 'SideB', 'Void']),
}).refine((question) => !(question.mySkip && question.myPick !== null), {
  message: 'A question cannot contain both a pick and a skip.',
});
export type Question = z.infer<typeof questionSchema>;

export const roundSchema = z.object({
  id: z.uuid(),
  dropAtUtc: timestamp,
  locksAtUtc: timestamp,
  isOpen: z.boolean(),
  questions: z.array(questionSchema).length(3),
}).refine((round) => new Set(round.questions.map((q) => q.categoryCode)).size === 3, {
  message: 'A round must contain one question in each category.',
}).refine((round) => Date.parse(round.locksAtUtc) > Date.parse(round.dropAtUtc), {
  message: 'Round lock must follow its opening time.',
});
export type Round = z.infer<typeof roundSchema>;

export const categoryStatsSchema = z.object({
  categoryCode: categorySchema,
  categoryName: z.string().min(1),
  currentStreak: score,
  bestStreak: score,
  totalCorrect: score,
});
export type CategoryStats = z.infer<typeof categoryStatsSchema>;

export const gameSchema = z.object({
  serverTimeUtc: timestamp,
  currentRound: roundSchema.nullable(),
  previousRound: roundSchema.nullable(),
  stats: z.object({
    totalScore: score,
    overallStreak: score,
    categories: z.array(categoryStatsSchema).length(3).refine(
      (categories) => new Set(categories.map((c) => c.categoryCode)).size === 3,
      'Stats must include each category once.',
    ),
  }),
});
export type Game = z.infer<typeof gameSchema>;

export const guessSchema = z.object({
  questionId: z.uuid(),
  categoryCode: categorySchema,
  pick: sideSchema.nullable(),
  isSkip: z.boolean(),
  submittedAt: timestamp,
});

export const boardTypes = ['TotalScore', 'OverallStreak', 'CategoryStreak', 'CategoryBestStreak'] as const;
export type BoardType = typeof boardTypes[number];
export type BoardFilter =
  | { type: 'TotalScore' | 'OverallStreak' }
  | { type: 'CategoryStreak' | 'CategoryBestStreak'; category: CategoryCode };
export const leaderboardSchema = z.object({
  type: z.enum(boardTypes),
  scope: z.enum(['Global', 'Friends']),
  categoryCode: categorySchema.nullable(),
  rows: z.array(z.object({
    rank: z.number().int().positive(),
    userId: z.uuid(),
    displayName: z.string().min(1),
    score: z.number().nonnegative(),
    isMe: z.boolean(),
  })),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

export const problemSchema = z.object({
  title: z.string().optional(),
  detail: z.string().optional(),
  status: z.number().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});
