/**
 * Arma un HTML autónomo con los tres archivos de Apps Script y un
 * google.script.run simulado, para revisar el tablero en el navegador
 * sin desplegar nada. Solo sirve para desarrollo.
 *
 *   node preview/build.mjs [yyyy-MM-dd]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'apps-script');
const today = process.argv[2] || '2026-08-27';

const read = (name) => readFileSync(join(src, name), 'utf8');

/* ---------------------------------------------------------------- */
/* Datos de prueba con la forma real de la planilla                  */
/* ---------------------------------------------------------------- */

// Mismos feriados que calcula Codigo.gs, con su motivo.
const FERIADOS = new Map([
  ['2026-01-01', 'Año Nuevo'],
  ['2026-04-03', 'Viernes Santo'],
  ['2026-04-04', 'Sábado Santo'],
  ['2026-05-01', 'Día del Trabajo'],
  ['2026-05-21', 'Glorias Navales'],
  ['2026-06-21', 'Día Nacional de los Pueblos Indígenas'],
  ['2026-06-29', 'San Pedro y San Pablo'],
  ['2026-07-16', 'Virgen del Carmen'],
  ['2026-08-15', 'Asunción de la Virgen'],
  ['2026-09-18', 'Independencia Nacional'],
  ['2026-09-19', 'Glorias del Ejército'],
  ['2026-10-12', 'Encuentro de Dos Mundos'],
  ['2026-10-31', 'Día de las Iglesias Evangélicas'],
  ['2026-11-01', 'Día de Todos los Santos'],
  ['2026-12-08', 'Inmaculada Concepción'],
  ['2026-12-25', 'Navidad']
]);

const PROVIDERS = [
  ['SAVI', 5200, 1.04], ['DIGUA', 4100, 0.72], ['LLOHUE', 3600, 0.95],
  ['NAHUELTORO', 3200, 1.18], ['SAN FRANCISCO', 2900, 0.55],
  ['CHAPALES', 2600, 1.01], ['SAN ANTONIO', 2400, 0.88],
  ['RANCHILLO', 2200, 1.32], ['LA MONTAÑA', 2100, 0.63],
  ['PROMASA', 1900, 0.98], ['QUILODRÁN', 1750, 1.09],
  ['H. SILVA', 1600, 0.41], ['H. ZENTENO', 1450, 0.93],
  ['D. RODRIGUEZ', 1300, 1.22], ['ALSAL', 1150, 0.79],
  ['SOFOTRANS', 1050, 1.06], ['LOS SAUCES', 950, 0.0],
  ['EL MANZANO', 880, 0.91], ['LOS TRONCOS', 760, 1.15],
  ['SERGESAL', 640, 0.68], ['C. ARANEDA (FORESTAL CHILE VERDE)', 590, 1.03],
  ['FORESTAL COLLICURA', 520, 0.86]
];

// Mix de producto real de una compra de metro ruma en la zona centro-sur.
// El peso es la probabilidad relativa de cada linea.
const PRODUCTOS = [
  ['4000123', 'ROLLIZO PULPABLE PINO RADIATA', 46],
  ['4000124', 'ROLLIZO PULPABLE EUCALIPTUS GLOBULUS', 22],
  ['4000131', 'ROLLIZO ASERRABLE PINO RADIATA', 14],
  ['4000140', 'METRO RUMA PINO 2,44 M', 11],
  ['4000155', 'ASTILLA PINO', 7]
];

const PESO_TOTAL = PRODUCTOS.reduce((total, item) => total + item[2], 0);

// Varios predios por proveedor: cada uno es un frente de cosecha distinto.
const PREDIOS = {
  SAVI: ['FUNDO EL PEUMO', 'LOTE SANTA ELENA', 'CANCHA DE ACOPIO SAVI'],
  DIGUA: ['FUNDO EL CAPAO', 'HIJUELA DIGUAL'],
  LLOHUE: ['FUNDO LLOHUE ALTO', 'FUNDO LLOHUE BAJO'],
  NAHUELTORO: ['FUNDO NAHUELTORO', 'LOTE B NAHUELTORO'],
  'SAN FRANCISCO': ['FUNDO SAN FRANCISCO'],
  CHAPALES: ['FUNDO LOS CHAPALES', 'LOTE 3 CHAPALES'],
  'SAN ANTONIO': ['FUNDO SAN ANTONIO DE QUILVO'],
  RANCHILLO: ['FUNDO EL RANCHILLO', 'LOTE RANCHILLO SUR'],
  'LA MONTAÑA': ['FUNDO LA MONTAÑA'],
  PROMASA: ['PLANTA PROMASA', 'CANCHA PROMASA NORTE']
};

const RAW_NAMES = {
  SAVI: 'INMOB FORESTAL E INVER SAVI LTDA',
  DIGUA: 'AGRICOLA Y FORESTAL DIGUA SPA',
  LLOHUE: 'SOC AGRICOLA LLOHUE LIMITADA',
  'H. SILVA': 'HECTOR MAURICIO SILVA CONTRERAS',
  'H. ZENTENO': 'HUGO BERNARDO ZENTENO FUENTES',
  'D. RODRIGUEZ': 'DOMINGO ALFONSO RODRIGUEZ SOTO'
};

const key = (d) => d.toISOString().slice(0, 10);
const dmy = (k) => k.slice(8) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4);

function monthWindow(prefix) {
  const [year, month] = prefix.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const names = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  return {
    prefix, year, month,
    startKey: `${prefix}-01`,
    endKey: `${prefix}-${String(lastDay).padStart(2, '0')}`,
    label: `${names[month]} de ${year}`,
    lastDay
  };
}

function isoWeek(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - start) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Ruido reproducible: el mismo build da siempre el mismo tablero.
let seed = 20260827;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function build(prefix, referenceDate) {
  const month = monthWindow(prefix);
  const workdayKeys = [];
  const workdaysByWeek = {};
  const discounted = [];
  const calendar = [];

  for (let day = 1; day <= month.lastDay; day++) {
    const k = `${prefix}-${String(day).padStart(2, '0')}`;
    const dow = new Date(Date.UTC(month.year, month.month - 1, day)).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const reason = FERIADOS.get(k) || '';
    const isWorkday = !weekend && !reason;

    calendar.push({
      key: k,
      day,
      dayOfWeek: dow,
      kind: isWorkday ? 'workday' : (reason ? 'holiday' : 'weekend'),
      reason,
      elapsed: isWorkday && k <= referenceDate,
      isReference: k === referenceDate
    });

    if (!isWorkday) {
      if (reason && !weekend) { discounted.push({ key: k, reason }); }
      continue;
    }

    workdayKeys.push(k);
    workdaysByWeek[isoWeek(k)] = (workdaysByWeek[isoWeek(k)] || 0) + 1;
  }

  const elapsedKeys = workdayKeys.filter((k) => k <= referenceDate);
  const total = workdayKeys.length;
  const elapsed = elapsedKeys.length;

  const lastActual = elapsedKeys[Math.max(0, elapsedKeys.length - 4)];
  const rows = [];

  for (const [provider, plan, rate] of PROVIDERS) {
    const perDay = (plan / total) * rate;

    for (const k of elapsedKeys) {
      // Vacío deliberado: LOS SAUCES se detiene, se ve en "sin recibir".
      if (rate === 0) { continue; }
      if (rnd() < 0.18) { continue; }

      const amount = perDay * (0.55 + rnd() * 0.95);
      const gmail = k > lastActual;

      // Producto por sorteo ponderado: el mix no es uniforme.
      let ticket = rnd() * PESO_TOTAL;
      let producto = PRODUCTOS[0];

      for (const item of PRODUCTOS) {
        ticket -= item[2];
        if (ticket <= 0) { producto = item; break; }
      }

      const fincas = PREDIOS[provider] || [`PREDIO ${provider.split(' ')[0]}`];
      const finca = fincas[Math.floor(rnd() * fincas.length)];

      rows.push({
        fecha: k,
        fechaNumero: Number(k.replace(/-/g, '')),
        fechaLabel: dmy(k),
        source: gmail ? 'GMAIL' : 'INGRESOS',
        provider,
        providerRaw: RAW_NAMES[provider] || provider,
        matchMethod: RAW_NAMES[provider] ? 'Regla explícita' : 'Nombre normalizado',
        matchScore: RAW_NAMES[provider] ? 1 : 0,
        material: gmail ? 'COMPLEMENTO GMAIL' : producto[0],
        descripcion: gmail ? 'CUMPLIMIENTO × 18' : producto[1],
        cantidad: Math.round(amount * 10) / 10,
        cumplimiento: gmail ? Math.round((amount / 18) * 100) / 100 : null,
        programaMr: gmail ? Math.round((perDay / 18) * 100) / 100 : null,
        factor: gmail ? 18 : null,
        um: 'MR',
        predio: gmail ? '' : finca,
        rol: `${100 + Math.floor(rnd() * 800)}-${Math.floor(rnd() * 90) + 1}`,
        estatus: gmail ? (rate < 0.8 ? 'ROJO' : rate > 1.1 ? 'VERDE' : 'AMARILLO') : '',
        messageId: gmail ? 'mock' + k : ''
      });
    }
  }

  // Un proveedor que llega sin plan asociado.
  for (const k of elapsedKeys.slice(-5)) {
    rows.push({
      fecha: k, fechaNumero: Number(k.replace(/-/g, '')), fechaLabel: dmy(k),
      source: 'INGRESOS', provider: 'TRANSPORTES PEÑA',
      providerRaw: 'TRANSPORTES PEÑA Y CIA LTDA',
      matchMethod: 'Nombre normalizado', matchScore: 0,
      material: '4000124', descripcion: 'ROLLIZO PULPABLE EUCALIPTUS GLOBULUS',
      cantidad: Math.round(rnd() * 60 * 10) / 10,
      cumplimiento: null, factor: null, um: 'MR',
      predio: 'PREDIO EL ROBLE', rol: '311-4', estatus: '', messageId: ''
    });
  }

  const latestReport = elapsedKeys[elapsedKeys.length - 1];

  return {
    generatedAt: `${today}T08:12:00`,
    generatedAtLabel: `${dmy(today)} 08:12`,
    timezone: 'America/Santiago',
    user: 'comprador@metroruma.cl',
    month, isCurrentMonth: true,
    // El mes consultado va primero: si no está en la lista, el selector
    // aparece vacío y parece roto.
    availableMonths: Array.from({ length: 4 }, (unused, back) => {
      const date = new Date(Date.UTC(month.year, month.month - 1 - back, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }).map((p) => ({ prefix: p, label: monthWindow(p).label })),
    workdays: {
      todayKey: today,
      referenceDate,
      referenceDateLabel: dmy(referenceDate),
      total, elapsed,
      remaining: total - elapsed,
      fraction: total ? elapsed / total : 0,
      workdayKeys, workdaysByWeek, calendar, discounted,
      holidays: discounted.map((item) => item.key)
    },
    factor: 18,
    source: {
      spreadsheetName: 'Control MetroRuma',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/mock',
      lastActualDate: lastActual, lastActualDateLabel: dmy(lastActual),
      supplementStart: elapsedKeys[elapsedKeys.indexOf(lastActual) + 1] || '',
      supplementStartLabel: dmy(elapsedKeys[elapsedKeys.indexOf(lastActual) + 1] || lastActual),
      latestReportDate: latestReport, latestReportDateLabel: dmy(latestReport),
      actualRows: rows.filter((r) => r.source === 'INGRESOS').length,
      supplementRows: rows.filter((r) => r.source === 'GMAIL').length,
      gmailProviderRows: rows.filter((r) => r.source === 'GMAIL').length,
      planProviders: PROVIDERS.length,
      unmatchedProviders: ['TRANSPORTES PEÑA']
    },
    filters: {
      providers: [...PROVIDERS.map(([p]) => p), 'TRANSPORTES PEÑA'].sort(),
      predios: [], materials: []
    },
    plan: PROVIDERS.map(([provider, plan]) => ({
      provider, providerRaw: provider, group: 'ZONA CENTRO', plan,
      matchMethod: 'Regla explícita', matchScore: 1
    })),
    rows,
    apuntes: [],
    gmailAudit: { reports: 6, providers: 22 }
  };
}

const prefix = today.slice(0, 7);
const workKeys = build(prefix, today).workdays.workdayKeys;
const reference = [...workKeys].filter((k) => k <= today).pop() || today;
const payload = build(prefix, reference);

/* ---------------------------------------------------------------- */

const mock = `
<script>
var MOCK = ${JSON.stringify(payload)};
var MOCK_NOTES = [];

window.google = {
  script: {
    run: (function() {
      function api(ok, fail) {
        return {
          withSuccessHandler: function(fn) { return api(fn, fail); },
          withFailureHandler: function(fn) { return api(ok, fn); },
          getDashboardData: function() {
            setTimeout(function() {
              MOCK.apuntes = MOCK_NOTES;
              ok(JSON.parse(JSON.stringify(MOCK)));
            }, 260);
          },
          guardarApuntes: function(notes) {
            setTimeout(function() {
              notes.forEach(function(note) {
                var id = note.id || 'n' + Math.random().toString(36).slice(2, 10);
                var found = -1;

                MOCK_NOTES.forEach(function(item, index) {
                  if (item.id === id) { found = index; }
                });

                var saved = Object.assign({}, note, {
                  id: id,
                  author: 'comprador@metroruma.cl',
                  updatedAt: '${dmy(today)} 08:40',
                  draft: false
                });

                if (found >= 0) { MOCK_NOTES[found] = saved; }
                else { MOCK_NOTES.push(saved); }
              });

              ok(JSON.parse(JSON.stringify(MOCK_NOTES)));
            }, 220);
          },
          eliminarApunte: function(noteId) {
            setTimeout(function() {
              MOCK_NOTES = MOCK_NOTES.filter(function(n) { return n.id !== noteId; });
              ok(JSON.parse(JSON.stringify(MOCK_NOTES)));
            }, 180);
          }
        };
      }

      return api(function() {}, function() {});
    })()
  }
};
<\/script>`;

// En la vista previa las fuentes se sirven desde preview/out/fonts para
// no depender de la red; el archivo que se sube a Apps Script mantiene el
// enlace a Google Fonts.
let styles = read('Estilos.html');
const localFonts = join(here, 'out', 'fonts', 'fonts.css');

styles = styles.replace(/<link rel="preconnect"[^>]*>\s*/g, '');

if (existsSync(localFonts)) {
  styles = styles.replace(
    /<link\s+rel="stylesheet"[\s\S]*?fonts\.googleapis[\s\S]*?>/,
    '<link rel="stylesheet" href="fonts/fonts.css">'
  );
} else {
  // Sin copia local y sin red, el enlace a Google Fonts solo ensucia la
  // consola de las pruebas. Se cae a la pila de respaldo del CSS, que ya
  // está declarada en --sans y --mono.
  styles = styles.replace(
    /<link\s+rel="stylesheet"[\s\S]*?fonts\.googleapis[\s\S]*?>/,
    '<!-- Google Fonts omitido en la vista previa -->'
  );
}

const modules = ['Base', 'Analisis', 'Graficos', 'Tablero', 'Bitacora'];

// Ojo: el reemplazo va como función. Con un string, replace() interpreta
// $& y $' dentro del contenido insertado y corrompe el código.
let html = read('Index.html')
  .replace("<?!= include('Estilos'); ?>", () => styles + mock);

for (const name of modules) {
  html = html.replace(`<?!= include('${name}'); ?>`, () => read(`${name}.html`));
}

mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', 'index.html'), html);
console.log('preview/out/index.html · ' + payload.rows.length + ' filas simuladas');
