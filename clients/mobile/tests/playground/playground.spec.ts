import { expect, test, type Page } from '@playwright/test';

import { SESSION_KEY } from '../../src/auth/store';
import { playgroundStateSchema } from '../../src/playground/model';
import { PLAYGROUND_KEY } from '../../src/playground/storage';

function watchNetwork(page: Page) {
  const forbidden: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:43819' || url.pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  page.on('pageerror', (error) => forbidden.push(`Runtime error: ${error.message}`));
  return forbidden;
}

async function open(page: Page) {
  const remoteHost = await page.request.get('/', { headers: { Host: 'not-loopback.example' } });
  expect(remoteHost.status()).toBe(403);
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 1 / Open');
  await expect(page.getByRole('heading', { name: 'Make your call.' })).toBeVisible();
  await expect(page.getByLabel('Invite code', { exact: true })).toHaveCount(0);
}

async function chooseAllA(page: Page) {
  for (const name of ['Sports', 'Finance', 'Pop Culture']) {
    await page.getByRole('button', { name: `${name} outcome: Side A`, exact: true }).click();
  }
}

async function stored(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PLAYGROUND_KEY);
  return playgroundStateSchema.parse(JSON.parse(raw ?? 'null'));
}

test('real local controls fast-forward, lock, score and update shared player screens without backend calls', async ({ page }, testInfo) => {
  const forbidden = watchNetwork(page);
  await open(page);
  await expect(page.getByTestId('round-countdown')).toHaveText('02:00');
  await expect(page.locator('[data-testid^="question-"]')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Skip Finance', exact: true }).click();
  await page.getByRole('button', { name: 'Pick B: No for Pop Culture', exact: true }).click();

  await page.getByRole('button', { name: 'Show local controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sports outcome: Side A', exact: true })).toBeVisible();
  for (const button of await page.getByTestId('local-controls').getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  const forward = page.getByRole('button', { name: 'Fast forward +30s', exact: true });
  const bounds = await forward.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(48);
  expect(bounds!.width).toBeGreaterThanOrEqual(48);
  await page.getByRole('button', { name: 'Sports outcome: Side A', exact: true }).click();
  await page.getByRole('button', { name: 'Finance outcome: Side B', exact: true }).click();
  await page.getByRole('button', { name: 'Pop Culture outcome: Void', exact: true }).click();
  const draft = await stored(page);
  expect(draft.game.currentRound.questions.every((question) => question.outcome === 'Unresolved')).toBe(true);
  expect(draft.game.previousRound).toBeNull();
  expect(draft.game.stats.totalScore).toBe(0);
  await expect(page.getByRole('button', { name: 'Publish outcomes', exact: true })).toBeDisabled();
  await forward.click();
  await expect(page.getByTestId('round-countdown')).toHaveText('01:30');
  await page.clock.install();
  await page.clock.fastForward(120_000);
  await expect(page.getByTestId('round-countdown')).toHaveText('01:30');
  await page.getByRole('button', { name: 'Lock round', exact: true }).click();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 1 / Locked');
  await expect(page.getByTestId('round-countdown')).toHaveText('00:00');
  await expect(page.getByRole('button', { name: 'Pick B: No for Sports', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('local-admin-locked.png'), fullPage: true });
  await page.getByRole('button', { name: 'Publish outcomes', exact: true }).click();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 2 / Open');
  await expect(page.getByTestId('round-countdown')).toHaveText('02:00');
  await expect(page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Hide local controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByTestId('result-sports').getByText('Correct', { exact: true })).toBeVisible();
  await expect(page.getByTestId('result-finance').getByText('Skipped', { exact: true })).toBeVisible();
  await expect(page.getByTestId('result-pop_culture').getByText('Void', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('local-results.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Boards', exact: true }).click();
  await expect(page.getByTestId('leaderboard-me').getByText('1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Category best', exact: true }).click();
  await expect(page.getByTestId('leaderboard-me').getByText('1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect(page.getByTestId('leaderboard-me').getByText('0', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'You', exact: true }).click();
  await expect(page.getByTestId('total-score').getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByTestId('overall-streak').getByText('1', { exact: true })).toBeVisible();
  expect(forbidden).toEqual([]);
});

test('reload persists actual local picks, clock, drafts and results; reset needs confirmation and leaves real auth untouched', async ({ page }) => {
  const forbidden = watchNetwork(page);
  await page.addInitScript((key) => sessionStorage.setItem(key, 'unchanged-real-session-marker'), SESSION_KEY);
  await open(page);
  await page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true }).click();
  await page.getByRole('button', { name: 'Show local controls', exact: true }).click();
  await chooseAllA(page);
  await page.getByRole('button', { name: 'Lock round', exact: true }).click();
  await page.getByRole('button', { name: 'Publish outcomes', exact: true }).click();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 2 / Open');
  await page.getByRole('button', { name: 'Fast forward +30s', exact: true }).click();
  await page.getByRole('button', { name: 'Finance outcome: Void', exact: true }).click();
  await page.getByRole('button', { name: 'Pick B: No for Sports', exact: true }).click();
  const before = await stored(page);
  await page.reload();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 2 / Open');
  await expect(page.getByTestId('round-countdown')).toHaveText('01:30');
  await expect(page.getByRole('button', { name: 'Pick B: No for Sports', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: 'Show local controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finance outcome: Void', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset demo now', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel reset', exact: true }).click();
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset demo now', exact: true }).click();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 1 / Open');
  const reset = await stored(page);
  expect(reset.game.stats.totalScore).toBe(0);
  expect(reset.game.previousRound).toBeNull();
  expect(reset.game.currentRound.questions.every((question) => question.myPick === null && !question.mySkip)).toBe(true);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBe('unchanged-real-session-marker');
  await page.reload();
  await expect(page.getByTestId('round-countdown')).toHaveText('02:00');
  expect((await stored(page)).game.stats.totalScore).toBe(0);
  expect(forbidden).toEqual([]);
});

test('browser storage failure never fakes successful picks or reset', async ({ page }) => {
  const forbidden = watchNetwork(page);
  await open(page);
  const before = await stored(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (item, value) {
      if (item === key) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, item, value);
    };
  }, PLAYGROUND_KEY);
  await page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true }).click();
  await expect(page.getByText('Local action needs attention', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pick A: Yes for Sports', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: 'Show local controls', exact: true }).click();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset demo now', exact: true }).click();
  await expect(page.getByText('Reset was not saved', { exact: true })).toBeVisible();
  expect(await stored(page)).toEqual(before);
  expect(forbidden).toEqual([]);
});

test('a corrupt local save is a visible recovery state, not a fabricated player round', async ({ page }) => {
  const forbidden = watchNetwork(page);
  await page.addInitScript((key) => localStorage.setItem(key, '{invalid-local-save'), PLAYGROUND_KEY);
  await page.goto('/');
  await expect(page.getByText('Local demo could not load', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make your call.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset demo now', exact: true }).click();
  await expect(page.getByTestId('local-round-state')).toHaveText('Round 1 / Open');
  expect((await stored(page)).game.stats.totalScore).toBe(0);
  expect(forbidden).toEqual([]);
});
