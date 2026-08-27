/**
 * Comprobaciones de interacción sobre la copia autónoma del tablero.
 * Requiere haber corrido antes `node preview/build.mjs`.
 *
 *   node preview/pruebas.mjs
 */

import { chromium } from 'playwright';
const proxy = process.env.HTTPS_PROXY;
const b = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const ok = (name, cond, extra='') => console.log((cond ? 'PASA  ' : 'FALLA ') + name + (extra ? ' · ' + extra : ''));

await p.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await p.waitForSelector('.gauge'); await p.waitForTimeout(900);

ok('velo de carga oculto', await p.locator('#veil').isHidden());
ok('KPIs pintados', await p.locator('.gauge').count() === 9);
ok('lista de ataque', await p.locator('.attack-item').count() > 0);

// --- Proveedores: orden y ficha ---
await p.click('#tab-proveedores'); await p.waitForTimeout(700);
const firstRisk = await p.locator('#providerBody tr').first().locator('td').nth(9).innerText();
await p.click('#providerTable th[data-sort="plan"]'); await p.waitForTimeout(300);
const firstPlan = await p.locator('#providerBody tr').first().locator('td').nth(1).innerText();
ok('ordena por plan', firstPlan.replace(/\D/g,'') === '5200', 'primero=' + firstPlan);

await p.locator('#providerBody tr').first().click(); await p.waitForTimeout(500);
ok('abre la ficha', await p.locator('.drawer').isVisible());
const drawerName = await p.locator('.drawer-name').innerText();
ok('ficha del proveedor correcto', drawerName === 'SAVI', drawerName);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok('Escape cierra la ficha', await p.locator('.drawer').count() === 0);

await p.click('#btnGapMode'); await p.waitForTimeout(400);
ok('alterna desvío a %', (await p.locator('#btnGapMode').innerText()).includes('MR'));

// --- Semana: guardar apunte con cifras reales ---
await p.click('#tab-semana'); await p.waitForTimeout(800);
const notes = await p.locator('#notesList .note').count();
ok('borradores automáticos', notes > 1, notes + ' apuntes');

const card = p.locator('#notesList .note').nth(1);
const provider = await card.getAttribute('data-provider');
const planAttr = Number(await card.getAttribute('data-plan'));
await card.locator('textarea[data-key="action"]').fill('Llamar a las 8:30 y confirmar dos camiones.');
await card.locator('input[data-key="owner"]').fill('I. Ortiz');
await card.locator('[data-act="save"]').click();
await p.waitForTimeout(900);

const saved = await p.evaluate(() => window.DATA.apuntes);
const mine = saved.find(n => n.provider === provider);
ok('apunte guardado', !!mine, provider);
ok('conserva el plan de la semana', mine && Math.abs(mine.plan - planAttr) < 0.01, mine ? String(mine.plan) : '-');
ok('conserva el texto editado', mine && mine.action.startsWith('Llamar a las 8:30'));
ok('conserva el responsable', mine && mine.owner === 'I. Ortiz');

await p.selectOption('#fNoteFilter', 'guardados'); await p.waitForTimeout(500);
ok('filtro "guardados" muestra 1', await p.locator('#notesList .note').count() === 1);
const tags = await p.$$eval('#notesList .note .tag', ns => ns.map(n => n.textContent.trim()));
ok('marcado como guardado', tags.includes('Guardado'), tags.join('|'));

await p.selectOption('#fNoteFilter', 'todos'); await p.waitForTimeout(600);
ok('filtro "todos" amplía la lista', await p.locator('#notesList .note').count() > notes);

// --- Filtro de proveedor recalcula todo ---
await p.click('#tab-panorama'); await p.waitForTimeout(500);
await p.selectOption('#fProvider', 'DIGUA'); await p.waitForTimeout(700);
const kpi = await p.locator('.gauge').first().locator('.gauge-value').innerText();
ok('filtra por proveedor', kpi.replace(/\D/g,'') === '2116', 'recibido=' + kpi);
await p.click('#btnClear'); await p.waitForTimeout(600);
const kpi2 = await p.locator('.gauge').first().locator('.gauge-value').innerText();
ok('limpiar restaura', kpi2.replace(/\D/g,'') === '28925', 'recibido=' + kpi2);

await p.click('#btnCurveMode'); await p.waitForTimeout(500);
const curveLabels = await p.$$eval('#chartCurve text', ns => ns.map(n => n.textContent || ''));
ok('curva en %', curveLabels.some(t => t.trim().endsWith('%')), curveLabels.slice(0,3).join('|'));

// --- Movimiento reducido ---
const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('RM: ' + e.message));
await p2.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await p2.waitForSelector('.gauge'); await p2.waitForTimeout(700);
const strataOpacity = await p2.locator('#rumaFigure rect.strata').first().evaluate(el =>
  getComputedStyle(el).transform);
ok('sin movimiento: estratos visibles', strataOpacity === 'none' || strataOpacity.includes('matrix(1,'), strataOpacity);

await b.close();
console.log(errs.length ? '\nERRORES:\n' + errs.join('\n') : '\nsin errores de consola');

/* ================= funciones nuevas ================= */
const b2 = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
const c3 = await b2.newContext({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });
const q = await c3.newPage();
const errs2 = [];
q.on('pageerror', e => errs2.push('PAGEERROR: ' + e.message));
q.on('console', m => { if (m.type() === 'error') errs2.push('CONSOLE: ' + m.text()); });
await q.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await q.waitForSelector('.gauge'); await q.waitForTimeout(900);

// Atajos de teclado
await q.keyboard.press('3'); await q.waitForTimeout(500);
ok('atajo 3 abre la bitácora', await q.locator('#view-semana').isVisible());
await q.keyboard.press('2'); await q.waitForTimeout(400);
ok('atajo 2 abre proveedores', await q.locator('#view-proveedores').isVisible());

// Tendencia semanal
ok('columna de tendencia', await q.locator('#providerBody .trend-block').count() > 0,
   (await q.locator('#providerBody tr').first().locator('.trend-block').count()) + ' semanas por fila');

// Ficha: foco atrapado y devuelto
const row = q.locator('#providerBody tr').first();
const rowProvider = await row.getAttribute('data-provider');
await row.click(); await q.waitForTimeout(500);
const focusInDrawer = await q.evaluate(() => !!document.activeElement.closest('.drawer'));
ok('la ficha toma el foco', focusInDrawer);
await q.locator('.drawer [data-close]').last().click(); await q.waitForTimeout(400);
const focusBack = await q.evaluate(() => {
  const el = document.activeElement;
  return el.classList.contains('linkish') ? el.dataset.provider : el.tagName;
});
ok('el foco vuelve a la tabla', focusBack === rowProvider, `${focusBack} vs ${rowProvider}`);

// Del análisis al apunte
await q.keyboard.press('1'); await q.waitForTimeout(500);
const target = await q.locator('#attackList .attack-note').first().getAttribute('data-provider');
await q.locator('#attackList .attack-note').first().click(); await q.waitForTimeout(900);
ok('salta a la bitácora', await q.locator('#view-semana').isVisible());
const focused = await q.evaluate(() => {
  const el = document.activeElement.closest('.note');
  return el ? el.dataset.provider : null;
});
ok('enfoca el apunte correcto', focused === target, `${focused} vs ${target}`);

// Guardia de cambios sin guardar
await q.locator('#notesList .note').first().locator('textarea[data-key="action"]').fill('Editado sin guardar');
await q.waitForTimeout(250);
ok('marca la tarjeta tocada', await q.locator('#notesList .note.is-dirty').count() === 1);
ok('muestra los pendientes', (await q.locator('#weekPending').innerText()).includes('sin guardar'));

q.on('dialog', d => d.dismiss());
await q.click('#tab-panorama'); await q.waitForTimeout(500);
ok('bloquea el cambio de vista', await q.locator('#view-semana').isVisible());

q.removeAllListeners('dialog');
q.on('dialog', d => d.accept());
await q.click('#tab-panorama'); await q.waitForTimeout(600);
ok('permite salir al confirmar', await q.locator('#view-panorama').isVisible());

// Informe semanal
await q.keyboard.press('3'); await q.waitForTimeout(600);
await q.click('#btnWeekReport'); await q.waitForTimeout(500);
const reportOk = await q.evaluate(() => weekReportLines().join('\n'));
ok('arma el informe', reportOk.includes('INFORME SEMANAL') && reportOk.includes('COMPROMISOS POR PROVEEDOR'),
   reportOk.split('\n').length + ' líneas');

// Detalle: orden y ver todo
await q.keyboard.press('4'); await q.waitForTimeout(600);
const before = await q.locator('#detailBody tr').count();
await q.click('#detailTable th[data-sort="cantidad"]'); await q.waitForTimeout(400);
const cells = await q.$$eval('#detailBody tr td:nth-child(8)', ns =>
  ns.slice(0, 3).map(n => parseFloat(n.textContent.replace(/\./g,'').replace(',','.'))));
ok('ordena por cantidad', cells[0] >= cells[1] && cells[1] >= cells[2], cells.join(' ≥ '));
await q.click('#btnDetailAll'); await q.waitForTimeout(600);
ok('muestra todas las filas', await q.locator('#detailBody tr').count() > before,
   `${before} → ${await q.locator('#detailBody tr').count()}`);

// Memoria entre sesiones
const q2 = await c3.newPage();
await q2.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await q2.waitForSelector('#detailBody tr'); await q2.waitForTimeout(700);
ok('recuerda la última vista', await q2.locator('#view-detalle').isVisible());
ok('recuerda el filtro de fuente', await q2.locator('#fSource').inputValue() === '');

await b2.close();
console.log(errs2.length ? '\nERRORES NUEVOS:\n' + errs2.join('\n') : 'sin errores de consola en las pruebas nuevas');
