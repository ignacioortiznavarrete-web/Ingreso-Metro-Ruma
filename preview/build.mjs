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

const FERIADOS = new Set([
  '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21',
  '2026-06-21', '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18',
  '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08',
  '2026-12-25'
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
  const holidays = [];

  for (let day = 1; day <= month.lastDay; day++) {
    const k = `${prefix}-${String(day).padStart(2, '0')}`;
    const dow = new Date(Date.UTC(month.year, month.month - 1, day)).getUTCDay();

    if (dow === 0 || dow === 6) { continue; }
    if (FERIADOS.has(k)) { holidays.push(k); continue; }

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

      const amount = perDay * (0.55 + rnd() * 0.95) * (workdayKeys.length / elapsed > 1 ? 1 : 1);
      const gmail = k > lastActual;

      rows.push({
        fecha: k,
        fechaNumero: Number(k.replace(/-/g, '')),
        fechaLabel: dmy(k),
        source: gmail ? 'GMAIL' : 'INGRESOS',
        provider,
        providerRaw: RAW_NAMES[provider] || provider,
        matchMethod: RAW_NAMES[provider] ? 'Regla explícita' : 'Nombre normalizado',
        matchScore: RAW_NAMES[provider] ? 1 : 0,
        material: gmail ? 'COMPLEMENTO GMAIL' : '4000123',
        descripcion: gmail ? 'CUMPLIMIENTO × 18' : 'ROLLIZO PULPABLE PINO',
        cantidad: Math.round(amount * 10) / 10,
        cumplimiento: gmail ? Math.round((amount / 18) * 100) / 100 : null,
        factor: gmail ? 18 : null,
        um: 'MR',
        predio: gmail ? '' : `PREDIO ${provider.split(' ')[0]}`,
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
      material: '4000123', descripcion: 'ROLLIZO PULPABLE PINO',
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
    availableMonths: ['2026-08', '2026-07', '2026-06', '2026-05'].map((p) => ({
      prefix: p, label: monthWindow(p).label
    })),
    workdays: {
      todayKey: today,
      referenceDate,
      referenceDateLabel: dmy(referenceDate),
      total, elapsed,
      remaining: total - elapsed,
      fraction: total ? elapsed / total : 0,
      workdayKeys, workdaysByWeek, holidays
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

if (existsSync(localFonts)) {
  styles = styles
    .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
    .replace(/<link\s+rel="stylesheet"[\s\S]*?fonts\.googleapis[\s\S]*?>/,
      '<link rel="stylesheet" href="fonts/fonts.css">');
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
