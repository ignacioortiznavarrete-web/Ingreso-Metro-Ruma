/**
 * Comprobaciones del backend sin desplegar nada.
 *
 *   node preview/backend.mjs
 *
 * Carga Codigo.gs en un ámbito con los pocos servicios de Apps Script que
 * las funciones puras necesitan, y comprueba lo que no se puede ver desde
 * el navegador: el calendario de días hábiles y el orden de resolución de
 * proveedores. Las pruebas de interacción viven en pruebas.mjs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'apps-script', 'Codigo.gs'), 'utf8');

// Lo justo para que corran las funciones puras.
const stubs = {
  Utilities: {
    formatDate: (date, tz, format) => {
      const iso = date.toISOString();
      return format === 'yyyy-MM' ? iso.slice(0, 7) : iso.slice(0, 10);
    }
  },
  console
};

const api = new Function(
  ...Object.keys(stubs),
  src + `
  return {
    buildWorkdaysInfo_, feriadosChile_, pascua_, solsticioJunio_,
    resolveProvider_, normalizeKey_, buildUnmatchedProviders_,
    findDuplicateRows_, findSimilarProviders_, fmtNumber_
  };`
)(...Object.values(stubs));

let passed = 0;
let failed = 0;

function ok(name, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  good ? passed++ : failed++;
  console.log(
    (good ? 'PASA  ' : 'FALLA ') + name +
    (good ? '' : `  -> ${JSON.stringify(got)} (esperado ${JSON.stringify(want)})`)
  );
}

function monthWindow(prefix) {
  const [year, month] = prefix.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (d) => String(d).padStart(2, '0');

  return {
    prefix, year, month,
    startKey: `${prefix}-01`,
    endKey: `${prefix}-${pad(lastDay)}`,
    label: prefix
  };
}

const workdays = (prefix, reference) =>
  api.buildWorkdaysInfo_('America/Santiago', monthWindow(prefix), '', reference || '', '2099-12');

/* ================= calendario de días hábiles ================= */
console.log('--- días hábiles ---');

ok('septiembre 2026 tiene 21 días hábiles', workdays('2026-09').total, 21);
ok('  descuenta solo el 18 (el 19 cae sábado)',
   workdays('2026-09').discounted.map((d) => d.key), ['2026-09-18']);
ok('septiembre 2025 tiene 20', workdays('2025-09').total, 20);
ok('septiembre 2027 tiene 22 (18 y 19 caen fin de semana)',
   workdays('2027-09').total, 22);

// El puente de la Ley 20.215: el 18 cae martes y el 19 miércoles.
ok('septiembre 2029 tiene 16 por el puente de la Ley 20.215',
   workdays('2029-09').total, 16);
ok('  y descuenta los cuatro días seguidos',
   workdays('2029-09').discounted.map((d) => d.key),
   ['2029-09-17', '2029-09-18', '2029-09-19', '2029-09-20']);

ok('el calendario cubre el mes entero', workdays('2026-09').calendar.length, 30);

// Fechas oficiales conocidas, que es contra lo que se validó el algoritmo.
ok('Pascua 2026', api.pascua_(2026), '2026-04-05');
ok('Pascua 2027', api.pascua_(2027), '2027-03-28');
ok('solsticio 2025 (20 de junio)', api.solsticioJunio_(2025), '2025-06-20');
ok('solsticio 2026 (21 de junio)', api.solsticioJunio_(2026), '2026-06-21');

/* ================= homologación de proveedores ================= */
console.log('\n--- orden de resolución de proveedores ---');

const PLAN = ['SAVI', 'DIGUA', 'LLOHUE', 'PROMASA'];
const alias = (name, target) => {
  const map = {};
  map[api.normalizeKey_(name)] = target;
  return map;
};

const sapName = 'INMOB FORESTAL E INVER SAVI LTDA';

ok('1. la regla del código homologa el nombre de SAP',
   api.resolveProvider_(sapName, { candidates: PLAN }).provider, 'SAVI');

// Lo que hace que el comprador pueda arreglar cualquier cruce sin tocar
// el código: su equivalencia gana incluso contra una regla del script.
const corregido = api.resolveProvider_(sapName, {
  candidates: PLAN, aliases: alias(sapName, 'PROMASA')
});
ok('2. la hoja manda sobre la regla del código', corregido.provider, 'PROMASA');
ok('   y el método lo declara', corregido.method, 'Equivalencia guardada');

const huerfano = 'TRANSPORTES PENA Y CIA LTDA';
ok('3. sin regla ni parecido queda sin homologar',
   api.resolveProvider_(huerfano, { candidates: PLAN }).method,
   'Nombre normalizado');
ok('4. con su equivalencia cruza',
   api.resolveProvider_(huerfano, {
     candidates: PLAN, aliases: alias(huerfano, 'DIGUA')
   }).provider, 'DIGUA');
ok('   y no contagia a otro nombre',
   api.resolveProvider_('OTRO CUALQUIERA', {
     candidates: PLAN, aliases: alias(huerfano, 'DIGUA')
   }).provider !== 'DIGUA', true);

/* ================= duplicidad ================= */
console.log('\n--- duplicidad ---');

const planRows = PLAN.map((provider) => ({ provider }));
const dataRows = [
  { provider: 'TRANSPORTES PEÑA', providerRaw: 'TRANSPORTES PEÑA Y CIA LTDA',
    cantidad: 100, source: 'INGRESOS', predio: 'EL ROBLE', rol: '1-1' },
  { provider: 'TRANSPORTES PEÑA', providerRaw: 'TRANSPORTES PEÑA Y CIA LTDA',
    cantidad: 50, source: 'INGRESOS', predio: 'EL ROBLE', rol: '1-1' },
  { provider: 'SAVI', providerRaw: 'SAVI', cantidad: 900,
    source: 'INGRESOS', predio: '', rol: '' }
];

const unmatched = api.buildUnmatchedProviders_(planRows, dataRows, PLAN);
ok('solo reporta al que no cruza con Plan', unmatched.length, 1);
ok('  suma el volumen que arrastra', unmatched[0].amount, 150);
ok('  cuenta sus filas', unmatched[0].rows, 2);
ok('  conserva el nombre de origen para guardarlo',
   unmatched[0].origin, 'TRANSPORTES PEÑA Y CIA LTDA');

const fila = {
  source: 'INGRESOS', fecha: '2026-09-01', fechaLabel: '01/09/2026',
  provider: 'SAVI', providerRaw: 'SAVI', material: 'M', descripcion: 'PINO',
  predio: 'P', rol: 'R', cantidad: 100
};

ok('una fila sola no es duplicado',
   api.findDuplicateRows_([fila]).length, 0);
ok('tres iguales cuentan tres veces',
   api.findDuplicateRows_([fila, fila, fila])[0].veces, 3);
ok('  y 200 MR de exceso',
   api.findDuplicateRows_([fila, fila, fila])[0].exceso, 200);
ok('distinta fecha no es duplicado',
   api.findDuplicateRows_([fila, { ...fila, fecha: '2026-09-02' }]).length, 0);
ok('el complemento Gmail no se revisa por duplicado',
   api.findDuplicateRows_([
     { ...fila, source: 'GMAIL' }, { ...fila, source: 'GMAIL' }
   ]).length, 0);

ok('detecta dos nombres del mismo proveedor',
   api.findSimilarProviders_(['SAVI', 'SAVI LTDA', 'DIGUA']).length, 1);
ok('no inventa parecidos entre proveedores distintos',
   api.findSimilarProviders_(['SAVI', 'DIGUA', 'LLOHUE']).length, 0);

console.log(`\n${passed} pasan, ${failed} fallan`);
process.exit(failed ? 1 : 0);
