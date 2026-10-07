import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

import { SESSION_KEY } from '../../src/auth/store';
import type { Game, Side } from '../../src/api/contracts';
import { makeAuth, makeGame, makeRound, otherUserId, userId } from '../fixtures';

async function mockApi(page: Page, initial: Game = makeGame()) {
  let game = initial;
  let auth = makeAuth();
  let gameRequests = 0;
  let loginRequests = 0;
  let submitted = 0;
  let rejectPick = false;
  let unreachable = false;
  let pickGate: Promise<void> | null = null;
  let advanceOnExpiry = false;
  const boards: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (url.pathname === '/api/test/login') {
      loginRequests += 1;
      const payload = route.request().postDataJSON();
      auth = makeAuth({ displayName: String(payload.displayName), userId: loginRequests === 1 ? userId : otherUserId });
      if (loginRequests > 1) game = makeGame();
      return reply(auth);
    }
    if (url.pathname === '/api/auth/refresh') {
      auth = { ...auth, accessToken: 'rotated-browser-fixture', refreshToken: 'rotated-refresh-fixture' };
      return reply(auth);
    }
    if (url.pathname === '/api/test/game') {
      gameRequests += 1;
      if (unreachable) return route.abort('internetdisconnected');
      if (advanceOnExpiry && game.currentRound && Date.parse(game.currentRound.locksAtUtc) <= Date.now()) {
        game = {
          ...game,
          previousRound: { ...game.currentRound, isOpen: false, questions: game.currentRound.questions.map((question) => ({ ...question, outcome: 'SideA' })) },
          currentRound: makeRound({ id: '20000000-0000-4000-8000-000000000002' }),
        };
      }
      return reply({ ...game, serverTimeUtc: new Date().toISOString() });
    }
    if (url.pathname === '/api/guesses') {
      submitted += 1;
      if (pickGate) await pickGate;
      if (rejectPick) return reply({ title: 'Submission window closed', detail: 'This round is locked.', status: 423 }, 423);
      const payload = route.request().postDataJSON() as { questionId: string; pick: Side | null; skip: boolean };
      const question = game.currentRound?.questions.find((item) => item.questionId === payload.questionId);
      if (!question) return reply({ title: 'Not found' }, 404);
      question.myPick = payload.pick;
      question.mySkip = payload.skip;
      return reply({ questionId: question.questionId, categoryCode: question.categoryCode, pick: payload.pick, isSkip: payload.skip, submittedAt: new Date().toISOString() });
    }
    if (url.pathname === '/api/leaderboards') {
      boards.push(url.search);
      return reply({
        type: url.searchParams.get('type'), scope: 'Global', categoryCode: url.searchParams.get('category'),
        rows: [{ rank: 1, userId: auth.userId, displayName: auth.displayName, score: 7, isMe: true }],
      });
    }
    throw new Error(`Unexpected API request in isolated browser test: ${url.pathname}`);
  });
  return {
    gameRequests: () => gameRequests,
    loginRequests: () => loginRequests,
    submitted: () => submitted,
    boards,
    rejectPick: () => { rejectPick = true; },
    setUnreachable: (value: boolean) => { unreachable = value; },
    holdPick: (gate: Promise<void>) => { pickGate = gate; },
    advance: () => { advanceOnExpiry = true; },
  };
}

async function login(page: Page, name = 'Avery') {
  const invite = randomBytes(32).toString('base64url');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Invite code', { exact: true }).fill(invite);
  await page.getByRole('button', { name: 'Join the demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make your call.' })).toBeVisible();
  return invite;
}

test('phone flow saves only acknowledged calls, persists tab session, filters boards, and isolates logout', async ({ page }, testInfo) => {
  const api = await mockApi(page);
  await page.goto('/');
  await expect(page.getByText('Simulated demo', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true });
  const invite = await login(page);
  await expect(page.locator('[data-testid^="question-"]')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  let finishPick!: () => void;
  api.holdPick(new Promise<void>((resolve) => { finishPick = resolve; }));
  const sports = page.getByTestId('question-sports');
  const sideA = page.getByRole('button', { name: 'Pick A: Home side for Sports', exact: true });
  const bounds = await sideA.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(48);
  expect(bounds?.width).toBeGreaterThanOrEqual(48);
  await sideA.click();
  await expect(sports.getByText('Saving...', { exact: true })).toBeVisible();
  await expect(sideA).toHaveAttribute('aria-pressed', 'false');
  finishPick();
  await expect(sideA).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Skip Finance', exact: true }).click();
  await expect(page.getByTestId('question-finance').getByText('Skip saved', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('play.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('play-top.png'), fullPage: true });

  const saved = await page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY);
  expect(saved).not.toContain(invite);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY)).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pick A: Home side for Sports', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(api.loginRequests()).toBe(1);

  await page.getByRole('tab', { name: 'Boards', exact: true }).click();
  await expect(page.getByText("THAT'S YOU", { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Category best', exact: true }).click();
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect.poll(() => api.boards.some((query) => query.includes('type=CategoryBestStreak') && query.includes('category=finance'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('boards.png'), fullPage: true });

  await page.getByRole('tab', { name: 'You', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Avery, by the numbers.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stats.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Join the demo', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  await expect(page.getByLabel('Invite code', { exact: true })).toHaveValue('');
  await login(page, 'Another player');
  await expect(page.getByRole('button', { name: 'Pick A: Home side for Sports', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-finance').getByText('No call yet', { exact: true })).toBeVisible();
});

test('authoritative lock rejection never shows the rejected pick as saved', async ({ page }) => {
  const api = await mockApi(page);
  api.rejectPick();
  await page.goto('/');
  await login(page);
  const sideA = page.getByRole('button', { name: 'Pick A: Home side for Sports', exact: true });
  await sideA.click();
  await expect(page.getByText(/It was not saved/)).toBeVisible();
  await expect(sideA).toHaveAttribute('aria-pressed', 'false');
  await expect(sideA).toBeDisabled();
  expect(api.submitted()).toBe(1);
});

test('previous-round results show correct, wrong, and skip without pretending outcomes are real', async ({ page }, testInfo) => {
  const previous = makeRound({
    id: '20000000-0000-4000-8000-000000000003', isOpen: false,
    questions: makeRound().questions.map((question, index) => ({
      ...question,
      outcome: 'SideA',
      myPick: index === 0 ? 'A' : index === 1 ? 'B' : null,
      mySkip: index === 2,
    })),
  });
  await mockApi(page, makeGame({ previousRound: previous }));
  await page.goto('/');
  await login(page);
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByTestId('result-sports').getByText('Correct', { exact: true })).toBeVisible();
  await expect(page.getByTestId('result-finance').getByText('Wrong', { exact: true })).toBeVisible();
  await expect(page.getByTestId('result-pop_culture').getByText('Skipped', { exact: true })).toBeVisible();
  await expect(page.getByText('SIMULATED OUTCOME', { exact: true })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('results.png'), fullPage: true });
});

test('the countdown triggers a new shared round and exposes missed previous results', async ({ page }) => {
  const now = Date.now();
  const api = await mockApi(page, makeGame({
    currentRound: makeRound({ dropAtUtc: new Date(now - 118_000).toISOString(), locksAtUtc: new Date(now + 2_000).toISOString() }),
  }));
  api.advance();
  await page.goto('/');
  await login(page);
  await expect.poll(() => api.gameRequests()).toBeGreaterThanOrEqual(2);
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByText('Missed', { exact: true })).toHaveCount(3);
});

test('offline and background stop polling, then foreground reconnect refreshes', async ({ page, context }) => {
  await page.clock.install();
  const api = await mockApi(page);
  await page.goto('/');
  await login(page);
  await context.setOffline(true);
  await expect(page.getByText("You're offline. Calls are paused.", { exact: true })).toBeVisible();
  const beforeOffline = api.gameRequests();
  await page.clock.fastForward(60_000);
  expect(api.gameRequests()).toBe(beforeOffline);
  await expect(page.getByRole('button', { name: 'Skip Sports', exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect.poll(() => api.gameRequests()).toBeGreaterThan(beforeOffline);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeBackground = api.gameRequests();
  await page.clock.fastForward(60_000);
  expect(api.gameRequests()).toBe(beforeBackground);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => api.gameRequests()).toBeGreaterThan(beforeBackground);
});

test('an unreachable API pauses automatic retries until manual recovery', async ({ page }) => {
  await page.clock.install();
  const api = await mockApi(page);
  await page.goto('/');
  await login(page);
  api.setUnreachable(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Live updates paused', { exact: true })).toBeVisible();
  const failedCount = api.gameRequests();
  await page.clock.fastForward(60_000);
  expect(api.gameRequests()).toBe(failedCount);
  api.setUnreachable(false);
  await page.getByRole('button', { name: 'Retry game', exact: true }).click();
  await expect(page.getByText('Live updates paused', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Skip Sports', exact: true })).toBeEnabled();
});

test('blocked browser storage explicitly announces memory-only mode and reload signs out', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Storage disabled', 'SecurityError'); },
    });
  });
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByText(/This is a memory-only session/)).toBeVisible();
  await login(page);
  await expect(page.getByText(/This is a memory-only session/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Join the demo', exact: true })).toBeVisible();
});

test('an unavailable TEST endpoint is visible and still allows local sign-out', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/test/game', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.getByLabel('Display name', { exact: true }).fill('Avery');
  await page.getByLabel('Invite code', { exact: true }).fill(randomBytes(32).toString('base64url'));
  await page.getByRole('button', { name: 'Join the demo', exact: true }).click();
  await expect(page.getByText(/The TEST game is unavailable at this address/)).toBeVisible();
  await page.getByRole('tab', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Join the demo', exact: true })).toBeVisible();
});
