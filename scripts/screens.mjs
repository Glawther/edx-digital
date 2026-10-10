/**
 * EDX Digital - Pictures of the screens, for looking at a change before publishing it.
 *
 *   node scripts/screens.mjs [pasta de saída]
 *
 * Opens the demonstration (sample data, nothing real) in the Edge or Chrome installed on this
 * machine and saves one picture per screen, as administrator and as salesperson, wide and narrow.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'telas'));

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 50; attempt++) {
  try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}

let browser = null;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ }
}
if (!browser) {
  server.kill();
  console.error('Edge ou Chrome não encontrado.');
  process.exit(1);
}

await fs.mkdir(out, { recursive: true });
const views = ['today', 'pipeline', 'customers', 'tasks', 'metrics'];
for (const [role, button] of [['admin', '#btn-quick-login-admin'], ['vendedor', '#btn-quick-login-employee']]) {
  for (const [size, viewport] of [['largo', { width: 1300, height: 900 }], ['estreito', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'pt-BR' });
    const page = await context.newPage();
    await page.goto(base + '/');
    await page.click(button);
    await page.waitForSelector('#today-content > *');
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `${view}-${role}-${size}.png`), fullPage: true });
    }
    await context.close();
  }
}
await browser.close();
server.kill();
console.log(`Telas salvas em ${out}`);
