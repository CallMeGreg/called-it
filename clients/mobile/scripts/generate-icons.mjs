import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const source = await readFile(new URL('../assets/brand.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, size, mode] of [
    ['icon.png', 1024, 'full'],
    ['favicon.png', 64, 'full'],
    ['android-icon-foreground.png', 1024, 'foreground'],
    ['android-icon-monochrome.png', 1024, 'monochrome'],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.evaluate((variant) => {
      if (variant !== 'full') document.getElementById('background')?.remove();
      if (variant === 'monochrome') {
        document.getElementById('tile')?.remove();
        document.getElementById('stroke')?.setAttribute('fill', '#FFFFFF');
        document.getElementById('dot')?.setAttribute('fill', '#FFFFFF');
      }
    }, mode);
    await page.screenshot({
      path: fileURLToPath(new URL(`../assets/${name}`, import.meta.url)),
      omitBackground: mode !== 'full',
    });
  }
} finally {
  await browser.close();
}
