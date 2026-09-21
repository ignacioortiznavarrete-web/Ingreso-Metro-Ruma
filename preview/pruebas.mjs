/**
 * Comprobaciones de interacción sobre la copia autónoma del tablero.
 *
 *   node preview/pruebas.mjs
 *
 * La suite arma su propia copia con una fecha fija, así que no depende de
 * cuándo se corrió build.mjs ni del día real. La fecha elegida cae en
 * septiembre a propósito: es el mes con feriado en día hábil (el 18), con
 * días hábiles todavía por correr y con filas de sobra para que la tabla
 * de detalle pagine.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FECHA = '2026-09-25';

execFileSync(process.execPath, [join(here, 'build.mjs'), FECHA], {
  stdio: 'inherit'
});

const proxy = process.env.HTTPS_PROXY;

// CHROME_PATH permite usar un Chromium ya instalado en el sistema cuando la
// version de Playwright no coincide con la descargada.
const launch = {};
if (proxy) { launch.proxy = { server: proxy }; }
if (process.env.CHROME_PATH) { launch.executablePath = process.env.CHROME_PATH; }

const b = await chromium.launch(launch);
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const ok = (name, cond, extra='') => console.log((cond ? 'PASA  ' : 'FALLA ') + name + (extra ? ' · ' + extra : ''));

await p.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await p.waitForSelector('.gauge'); await p.waitForTimeout(900);

ok('velo de carga oculto', await p.locator('#veil').isHidden());
ok('KPIs pintados', await p.locator('#gauges .gauge').count() === 9,
   (await p.locator('#gauges .gauge').count()) + ' mediciones');
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
const num = (text) => Number(String(text).replace(/\./g, '').replace(',', '.')) || 0;
const recibido = () => p.locator('#gauges .gauge').first()
  .locator('.gauge-value').innerText();

// Contra la cifra que entrega el propio tablero, no contra una constante:
// así la prueba sigue valiendo cuando cambian los datos simulados.
const totalTodos = num(await recibido());
const totalDigua = await p.evaluate(() => {
  const rows = DATA.rows.filter((row) => row.provider === 'DIGUA');
  return rows.reduce((sum, row) => sum + (Number(row.cantidad) || 0), 0);
});

await p.selectOption('#fProvider', 'DIGUA'); await p.waitForTimeout(700);
const kpi = num(await recibido());
ok('filtra por proveedor',
   kpi > 0 && kpi < totalTodos && Math.abs(kpi - totalDigua) <= 1,
   'recibido=' + kpi + ' esperado=' + Math.round(totalDigua));

await p.click('#btnClear'); await p.waitForTimeout(600);
ok('limpiar restaura', num(await recibido()) === totalTodos,
   'recibido=' + num(await recibido()) + ' de ' + totalTodos);

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
const b2 = await chromium.launch(launch);
const c3 = await b2.newContext({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });
const q = await c3.newPage();
const errs2 = [];
q.on('pageerror', e => errs2.push('PAGEERROR: ' + e.message));
q.on('console', m => { if (m.type() === 'error') errs2.push('CONSOLE: ' + m.text()); });
await q.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html', { waitUntil: 'networkidle' });
await q.waitForSelector('.gauge'); await q.waitForTimeout(900);

// Atajos de teclado
await q.keyboard.press('4'); await q.waitForTimeout(500);
ok('atajo 4 abre la bitácora', await q.locator('#view-semana').isVisible());
await q.keyboard.press('3'); await q.waitForTimeout(400);
ok('atajo 3 abre forestal', await q.locator('#view-forestal').isVisible());
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
await q.keyboard.press('4'); await q.waitForTimeout(600);
await q.click('#btnWeekReport'); await q.waitForTimeout(500);
const reportOk = await q.evaluate(() => weekReportLines().join('\n'));
ok('arma el informe', reportOk.includes('INFORME SEMANAL') && reportOk.includes('COMPROMISOS POR PROVEEDOR'),
   reportOk.split('\n').length + ' líneas');

// Detalle: orden y ver todo
await q.keyboard.press('5'); await q.waitForTimeout(600);
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

/* ============ calendario de dias habiles ============ */
await q.keyboard.press('1'); await q.waitForTimeout(700);

const cal = await q.evaluate(() => {
  const wd = DATA.workdays;
  const count = (kind) => wd.calendar.filter((d) => d.kind === kind).length;

  return {
    total: wd.total,
    elapsed: wd.elapsed,
    dias: wd.calendar.length,
    habiles: count('workday'),
    feriados: count('holiday'),
    finde: count('weekend'),
    descontados: wd.discounted.map((d) => d.key + ' ' + d.reason),
    corridos: wd.calendar.filter((d) => d.elapsed).length
  };
});

// Septiembre 2026 tiene 21 dias habiles: 22 de lunes a viernes menos el
// 18, que es viernes. El 19 cae sabado, asi que no descuenta nada.
ok('septiembre descuenta el 18', cal.total === 21,
   cal.total + ' dias habiles');
ok('el feriado en habil queda registrado',
   cal.descontados.length === 1 &&
   cal.descontados[0] === '2026-09-18 Independencia Nacional',
   cal.descontados.join(' | ') || 'ninguno');
ok('el calendario cubre el mes', cal.dias === 30, cal.dias + ' dias');
ok('el conteo cuadra', cal.habiles === cal.total,
   `habiles=${cal.habiles} total=${cal.total}`);
ok('transcurridos coinciden', cal.corridos === cal.elapsed,
   `${cal.corridos} vs ${cal.elapsed}`);

const celdas = await q.locator('#chartCalendar .cal-cell:not(.is-pad)').count();
ok('pinta una casilla por dia', celdas === 30, celdas + ' casillas');
ok('marca el feriado',
   await q.locator('#chartCalendar .cal-cell.is-holiday').count() === 2,
   (await q.locator('#chartCalendar .cal-cell.is-holiday').count()) + ' tachadas');
ok('marca la fecha de corte',
   await q.locator('#chartCalendar .cal-cell.is-cut').count() === 1);
ok('lista el feriado descontado',
   (await q.locator('#chartCalendar .cal-list li').innerText())
     .includes('Independencia'));

/* ============ vista forestal ============ */
await q.keyboard.press('3'); await q.waitForTimeout(900);

ok('mediciones forestales',
   await q.locator('#gaugesForestal .gauge').count() === 9,
   (await q.locator('#gaugesForestal .gauge').count()) + ' mediciones');
ok('matriz riesgo/esfuerzo',
   await q.locator('#chartPortfolio svg circle.blip').count() > 0,
   (await q.locator('#chartPortfolio svg circle.blip').count()) + ' burbujas');
ok('semaforo declarado',
   await q.locator('#chartStatus svg rect.bar-wide').count() >= 2,
   (await q.locator('#chartStatus svg rect.bar-wide').count()) + ' tramos');
ok('mix por producto',
   await q.locator('#chartProduct svg rect.bar-wide').count() >= 3,
   (await q.locator('#chartProduct svg rect.bar-wide').count()) + ' lineas');
ok('frentes de cosecha',
   await q.locator('#chartEstates svg rect.bar-wide').count() >= 3,
   (await q.locator('#chartEstates svg rect.bar-wide').count()) + ' predios');
ok('tabla de decision',
   await q.locator('#forestalBody tr').count() > 0,
   (await q.locator('#forestalBody tr').count()) + ' filas');
ok('cada fila trae una accion',
   await q.locator('#forestalBody .zone').count() ===
     await q.locator('#forestalBody tr').count());

// El mix solo desglosa Ingresos: el complemento Gmail no trae material.
const mix = await q.evaluate(() => {
  const product = buildProductMix(ROWS);
  const estates = buildEstateMix(ROWS);
  const declared = ROWS
    .filter((row) => row.source === 'INGRESOS')
    .reduce((sum, row) => sum + (Number(row.cantidad) || 0), 0);

  return {
    declared: Math.round(product.declared),
    esperado: Math.round(declared),
    lineas: product.list.length,
    suma: Math.round(product.list.reduce((s, i) => s + i.total, 0)),
    share: product.list.reduce((s, i) => s + i.share, 0),
    predios: estates.active,
    complemento: Math.round(product.complement)
  };
});

ok('el mix cuadra con Ingresos', mix.declared === mix.esperado,
   `${mix.declared} vs ${mix.esperado}`);
ok('las lineas suman el total', mix.suma === mix.declared,
   `${mix.suma} vs ${mix.declared}`);
ok('las participaciones suman 100%', Math.abs(mix.share - 1) < 0.001,
   (mix.share * 100).toFixed(2) + '%');
ok('deja el complemento fuera del mix', mix.complemento > 0,
   mix.complemento + ' MR sin material');
ok('cuenta los frentes', mix.predios > 1, mix.predios + ' predios');

// La ficha se abre desde la tabla forestal.
await q.locator('#forestalBody .linkish').first().click();
await q.waitForTimeout(500);
ok('la tabla forestal abre la ficha',
   await q.locator('.drawer').count() > 0);
await q.keyboard.press('Escape'); await q.waitForTimeout(300);

/* ============ sin desborde horizontal ============ */
for (const width of [1600, 1280, 390]) {
  const page = await c3.newPage();
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('file:///home/user/Ingreso-Metro-Ruma/preview/out/index.html',
    { waitUntil: 'networkidle' });
  await page.waitForSelector('.gauge'); await page.waitForTimeout(600);

  let worst = 0;

  for (const view of ['panorama', 'proveedores', 'forestal', 'semana', 'detalle']) {
    await page.click('#tab-' + view); await page.waitForTimeout(450);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > worst) { worst = over; }
  }

  ok('sin desborde a ' + width + 'px', worst <= 1, worst + 'px de exceso');
  await page.close();
}

await b2.close();
console.log(errs2.length ? '\nERRORES NUEVOS:\n' + errs2.join('\n') : 'sin errores de consola en las pruebas nuevas');
