import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const url = 'file://' + join(out, 'index.html');
const errors = [];

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  ignoreHTTPSErrors: true
});
const page = await ctx.newPage();

page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.gauge', { timeout: 8000 });
await page.waitForTimeout(1400);

const shots = [
  ['panorama', null],
  ['proveedores', '#tab-proveedores'],
  ['semana', '#tab-semana'],
  ['detalle', '#tab-detalle']
];

for (const [name, sel] of shots) {
  if (sel) { await page.click(sel); await page.waitForTimeout(900); }
  await page.screenshot({ path: join(out, name + '.png'), fullPage: true });
}

// Vista de impresión del informe semanal
await page.click('#tab-semana');
await page.waitForTimeout(700);
await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: join(out, 'impresion.png'), fullPage: true });
await page.emulateMedia({ media: 'screen' });

// Móvil
const mobileCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  ignoreHTTPSErrors: true
});
const mobile = await mobileCtx.newPage();
mobile.on('pageerror', (e) => errors.push('MOBILE: ' + e.message));
await mobile.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
await mobile.goto(url, { waitUntil: 'networkidle' });
await mobile.waitForSelector('.gauge', { timeout: 8000 });
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: join(out, 'movil.png'), fullPage: true });

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
const overflowM = await mobile.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

await browser.close();

console.log('desbordamiento horizontal escritorio:', overflow, '· móvil:', overflowM);
console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'sin errores de consola');
