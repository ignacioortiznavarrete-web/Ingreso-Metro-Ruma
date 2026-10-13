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
    findDuplicateRows_, findSimilarProviders_, fmtNumber_,
    summarizeMonth_, previousMonthPrefix_, mergeAvailableMonths_,
    buildHistoricoSeries_, readHistorico_, HISTORICO_HEADERS,
    readDisplayFallback_, makeMatchContext_, matchRow_,
    providerSimilarity_, providerComparable_
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

/* ============ historico ============ */
console.log('\n--- historico ---');

// El mes anterior, incluido el salto de año.
ok('el mes anterior a octubre es septiembre',
   api.previousMonthPrefix_('2026-10'), '2026-09');
ok('el mes anterior a enero es diciembre del año pasado',
   api.previousMonthPrefix_('2026-01'), '2025-12');
ok('el mes anterior a marzo es febrero',
   api.previousMonthPrefix_('2026-03'), '2026-02');

// La foto del mes: plan y movimiento juntos, por proveedor.
const mesCerrado = {
  plan: [
    { provider: 'SAVI', plan: 5200 },
    { provider: 'DIGUA', plan: 3100 },
    { provider: 'SIN MOVIMIENTO', plan: 0 }
  ],
  rows: [
    { provider: 'SAVI', cantidad: 2000, source: 'INGRESOS' },
    { provider: 'SAVI', cantidad: 900, source: 'GMAIL' },
    { provider: 'DIGUA', cantidad: 3300, source: 'INGRESOS' },
    { provider: 'NO ESTA EN EL PLAN', cantidad: 400, source: 'INGRESOS' }
  ],
  workdays: { total: 22 }
};

const foto = api.summarizeMonth_(mesCerrado);

ok('una fila por proveedor con plan o movimiento', foto.length, 3);
ok('ordena alfabético para que el mes se lea igual siempre',
   foto.map((item) => item.provider),
   ['DIGUA', 'NO ESTA EN EL PLAN', 'SAVI']);
ok('separa lo que vino por SAP de lo que vino por Gmail',
   foto.filter((item) => item.provider === 'SAVI')[0],
   { provider: 'SAVI', plan: 5200, actual: 2000, gmail: 900, total: 2900 });
ok('el total es SAP más Gmail',
   foto.every((item) => Math.abs(item.total - item.actual - item.gmail) < 0.01),
   true);
ok('guarda al que entregó sin estar en el plan',
   foto.filter((item) => item.provider === 'NO ESTA EN EL PLAN')[0].total, 400);
ok('descarta al que no tiene plan ni movimiento',
   foto.filter((item) => item.provider === 'SIN MOVIMIENTO').length, 0);

// La serie que grafica el tablero sale de las filas de la hoja.
const historico = {
  months: {
    '2026-08': {
      prefix: '2026-08', workdays: 21, closedBy: 'comprador', closedAt: 2,
      providers: {
        SAVI: { plan: 5000, actual: 4000, gmail: 1200, total: 5200 },
        DIGUA: { plan: 3000, actual: 2400, gmail: 0, total: 2400 }
      }
    },
    '2026-07': {
      prefix: '2026-07', workdays: 22, closedBy: 'comprador', closedAt: 1,
      providers: {
        SAVI: { plan: 5000, actual: 4100, gmail: 300, total: 4400 }
      }
    }
  },
  rows: [
    { prefix: '2026-08', provider: 'SAVI', plan: 5000, actual: 4000, gmail: 1200, total: 5200 },
    { prefix: '2026-08', provider: 'DIGUA', plan: 3000, actual: 2400, gmail: 0, total: 2400 },
    { prefix: '2026-07', provider: 'SAVI', plan: 5000, actual: 4100, gmail: 300, total: 4400 }
  ]
};

const serie = api.buildHistoricoSeries_(historico, '2026-09');

ok('los meses salen del más viejo al más nuevo',
   serie.months.map((item) => item.prefix), ['2026-07', '2026-08']);
ok('suma el plan del mes', serie.months[1].plan, 8000);
ok('suma lo recibido del mes', serie.months[1].total, 7600);
ok('el cumplimiento es recibido sobre plan', serie.months[1].compliance, 0.95);
ok('cuenta los proveedores del mes', serie.months[1].providers, 2);
ok('conserva los días hábiles con que se cerró', serie.months[1].workdays, 21);
ok('arma la trayectoria por proveedor',
   Object.keys(serie.providers).sort(), ['DIGUA', 'SAVI']);
ok('un proveedor que falta un mes no inventa el dato',
   serie.providers.DIGUA['2026-07'], undefined);
ok('guarda el cumplimiento de cada celda',
   serie.providers.SAVI['2026-07'].compliance, 0.88);
ok('un mes sin plan no divide por cero',
   api.buildHistoricoSeries_({
     months: {
       '2026-06': { prefix: '2026-06', workdays: 20, providers: {
         X: { plan: 0, actual: 100, gmail: 0, total: 100 }
       } }
     },
     rows: [{ prefix: '2026-06', provider: 'X', plan: 0, actual: 100, gmail: 0, total: 100 }]
   }, '2026-09').months[0].compliance, null);

// El selector ofrece los meses del Plan y los cerrados, sin repetir.
const meses = api.mergeAvailableMonths_(
  [{ prefix: '2026-09', label: 'septiembre de 2026' },
   { prefix: '2026-08', label: 'agosto de 2026' }],
  { '2026-08': true, '2026-07': true },
  { prefix: '2026-09', label: 'septiembre de 2026' },
  '2026-09'
);

ok('ofrece los meses del Plan más los cerrados',
   meses.map((item) => item.prefix), ['2026-09', '2026-08', '2026-07']);
ok('el más nuevo va primero', meses[0].prefix, '2026-09');
ok('marca cuáles están cerrados',
   meses.map((item) => item.closed), [false, true, true]);
ok('no repite un mes que está en las dos listas',
   meses.filter((item) => item.prefix === '2026-08').length, 1);
ok('un mes cerrado sin columna en Plan igual aparece',
   meses.filter((item) => item.prefix === '2026-07')[0].label,
   'julio de 2026');
ok('el mes consultado nunca falta del selector',
   api.mergeAvailableMonths_(
     [], {}, { prefix: '2026-04', label: 'abril de 2026' }, '2026-09'
   ).map((item) => item.prefix), ['2026-09', '2026-04']);

// La hoja y el lector tienen que hablar de las mismas columnas.
ok('la hoja Historico guarda diez columnas',
   api.HISTORICO_HEADERS.length, 10);
ok('la primera columna es el mes', api.HISTORICO_HEADERS[0], 'Mes');

/* ============ lectura de la hoja ============ */
console.log('\n--- lectura de la hoja ---');

// El respaldo con formato es lo que colgaba el tablero: formatear cada
// celda de la hoja entera, mes tras mes, se come los seis minutos que
// Apps Script da por ejecución. Ahora solo se pide cuando hace falta, y
// solo las columnas que se usan.
function hojaStub() {
  const calls = [];

  return {
    calls,
    getRange(row, column, rows, columns) {
      calls.push({ row, column, rows, columns });

      return {
        getDisplayValues: () =>
          Array.from({ length: rows }, (unused, r) =>
            Array.from({ length: columns }, (unused2, c) =>
              `f${r}c${column - 1 + c}`))
      };
    }
  };
}

const typed = [
  ['cab', 'cab', 'cab', 'cab', 'cab'],
  ['a', new Date('2026-09-01'), 'b', 120, 'c'],
  ['a', new Date('2026-09-02'), 'b', 240, 'c']
];

const sinFalta = hojaStub();

ok('no pide formato si los valores alcanzan',
   api.readDisplayFallback_(sinFalta, typed, 3, 5, [1, 3], () => false), null);
ok('  y por lo tanto no toca la hoja', sinFalta.calls.length, 0);

// SAP a veces exporta la fecha como texto: ahí sí hace falta el formato.
const comoTexto = [
  typed[0],
  typed[1],
  ['a', '02.09.2026', 'b', 240, 'c']
];

const conFalta = hojaStub();
const respaldo = api.readDisplayFallback_(
  conFalta, comoTexto, 3, 5, [1, 3], (row) => !(row[1] instanceof Date)
);

ok('pide formato cuando una fila no trae fecha usable',
   conFalta.calls.length, 1);
ok('  pide solo el tramo de columnas que se usa',
   conFalta.calls[0], { row: 1, column: 2, rows: 3, columns: 3 });
ok('  devuelve las celdas en su columna original',
   [respaldo[1][1], respaldo[1][3]], ['f1c1', 'f1c3']);
ok('  y deja vacío lo que no pidió', respaldo[1][0], undefined);
ok('  con una fila por fila de la hoja', respaldo.length, 3);

// Una sola columna no puede pedir un tramo de cero.
const unaSola = hojaStub();
api.readDisplayFallback_(unaSola, typed, 3, 5, [3], () => true);
ok('una sola columna pide una sola columna',
   unaSola.calls[0], { row: 1, column: 4, rows: 3, columns: 1 });

// El tramo nunca puede pasarse del ancho leído.
const alBorde = hojaStub();
api.readDisplayFallback_(alBorde, typed, 3, 5, [4], () => true);
ok('no pide más allá del ancho de la hoja',
   alBorde.calls[0].column + alBorde.calls[0].columns - 1, 5);

/* ============ costo del cruce ============ */
console.log('\n--- costo del cruce ---');

// Esto es lo que colgaba el tablero. El cruce aproximado arma una matriz de
// distancia de edición contra cada proveedor del Plan. Se memoizaba por
// proveedor + predio + rol, pero en el bosque el predio y el rol cambian casi
// en cada fila: la memoria no acertaba nunca y la matriz se armaba una vez por
// fila. Con un mes eran algunos miles; con dos, el doble, y Apps Script corta
// a los seis minutos sin avisarle al navegador.
const PLAN_LARGO = [
  'SAVI', 'DIGUA', 'LLOHUE', 'NAHUELTORO', 'SAN FRANCISCO', 'CHAPALES',
  'SAN ANTONIO', 'RANCHILLO', 'LA MONTANA', 'PROMASA', 'QUILODRAN',
  'H. SILVA', 'H. ZENTENO', 'D. RODRIGUEZ', 'ALSAL'
];

const NOMBRES_SAP = PLAN_LARGO.map((n) => `INMOB FORESTAL E INVER ${n} LTDA`);

function filasSimuladas(total) {
  return Array.from({ length: total }, (unused, i) => ({
    raw: NOMBRES_SAP[i % NOMBRES_SAP.length],
    // Alta cardinalidad a propósito: es lo que rompía la memoria vieja.
    predio: `FUNDO ${i % 900}`,
    rol: `${100 + (i % 1700)}-${i % 40}`
  }));
}

// El parecido solo depende del nombre, así que miles de filas del mismo
// proveedor con miles de predios distintos tienen que barrer el Plan una sola
// vez por nombre. Se cuentan los barridos, que es lo que cuesta caro.
function barridos(usarContexto) {
  let veces = 0;

  const espia = new Proxy(PLAN_LARGO, {
    get(target, prop) {
      if (prop === 'forEach') { veces++; }
      return Reflect.get(target, prop);
    }
  });

  const filas = filasSimuladas(3000);

  if (usarContexto) {
    const c = api.makeMatchContext_(espia, {}, 'INGRESOS');
    // El contexto precalcula las formas de los candidatos: ese barrido no
    // es del cruce, así que no cuenta.
    veces = 0;
    filas.forEach((row) => { api.matchRow_(c, row.raw, row.predio, row.rol); });
  } else {
    filas.forEach((row) => {
      api.resolveProvider_(row.raw, {
        aliases: {}, predio: row.predio, rol: row.rol, candidates: espia
      });
    });
  }

  return veces;
}

const sinContexto = barridos(false);
const conContexto = barridos(true);

// Los demás nombres los atrapa antes una regla explícita del código, así que
// nunca llegan al cruce aproximado.
ok('sin contexto compartido barre el Plan una vez por fila',
   sinContexto > 500, true);
ok('con contexto compartido barre una vez por nombre',
   conContexto <= NOMBRES_SAP.length, true);
console.log(`      (${sinContexto} barridos antes, ${conContexto} ahora)`);

// Y el resultado tiene que ser el mismo que sin memoria.
const sinMemoria = filasSimuladas(40).map((row) =>
  api.resolveProvider_(row.raw, {
    aliases: {}, predio: row.predio, rol: row.rol, candidates: PLAN_LARGO
  }).provider);

const conMemoria = (() => {
  const c = api.makeMatchContext_(PLAN_LARGO, {}, 'INGRESOS');
  return filasSimuladas(40).map((row) =>
    api.matchRow_(c, row.raw, row.predio, row.rol).provider);
})();

ok('la memoria no cambia a quién cruza', conMemoria, sinMemoria);

// El atajo de la distancia de edición es exacto: lo que devuelve al saltarse
// el cálculo nunca alcanza el piso, así que ninguna decisión cambia.
const paresDePrueba = [];
PLAN_LARGO.forEach((a) => {
  PLAN_LARGO.forEach((b) => { paresDePrueba.push([a, b]); });
  paresDePrueba.push([a, `SOC ${a} SPA`]);
  paresDePrueba.push([a, a.slice(0, Math.max(3, a.length - 2))]);
  paresDePrueba.push([a, a.split('').reverse().join('')]);
  paresDePrueba.push([a, `COMERCIAL ${a.replace(/A/g, 'E')}`]);
});

const PISO = 0.8;
const desacuerdos = paresDePrueba.filter(([a, b]) => {
  const x = api.providerComparable_(a);
  const y = api.providerComparable_(b);

  return (api.providerSimilarity_(x, y) >= PISO) !==
         (api.providerSimilarity_(x, y, PISO) >= PISO);
});

ok('el atajo no cambia ninguna decisión del umbral',
   desacuerdos.length, 0);

// Sin piso el parecido tiene que seguir siendo el de siempre, exacto.
ok('sin piso, el parecido no cambia',
   api.providerSimilarity_('SAVI', 'SAVI LTDA').toFixed(6),
   api.providerSimilarity_('SAVI', 'SAVI LTDA', 0).toFixed(6));

// La red de seguridad: un mes grande tiene que cruzarse en un parpadeo. El
// umbral es generoso a propósito —esta máquina no es la de Apps Script—, pero
// atrapa una regresión de orden de magnitud, que es la que rompe el tablero.
const inicio = Date.now();
const ctxGrande = api.makeMatchContext_(PLAN_LARGO, {}, 'INGRESOS');
filasSimuladas(20000).forEach((row) => {
  api.matchRow_(ctxGrande, row.raw, row.predio, row.rol);
});
const transcurrido = Date.now() - inicio;

ok('20.000 filas se cruzan en menos de 2 segundos',
   transcurrido < 2000, true);
console.log(`      (${transcurrido} ms)`);

console.log(`\n${passed} pasan, ${failed} fallan`);
process.exit(failed ? 1 : 0);
