/**
 * METRORUMA · CONTROL DE ABASTECIMIENTO
 * Plan vs ingresos reales + complemento Gmail, por proveedor y por semana.
 *
 * Fuentes de datos (misma planilla):
 * - Ingresos      cantidades reales por Fecha Contab.
 * - Plan          plan mensual por proveedor / faena, una columna por mes.
 * - Informegmail  detalle diario importado de los correos "INGRESOS METROS RUMA".
 * - Apuntes       bitácora semanal del comprador (la escribe el dashboard).
 *
 * Regla de complemento:
 * - Hasta la última Fecha Contab. mandan los datos reales.
 * - Desde el día siguiente y hasta el último informe Gmail se usa
 *   CUMPLIMIENTO x FACTOR por proveedor.
 * - Nunca se duplica un día que ya existe en Ingresos.
 *
 * Plan prorrateado en días hábiles:
 * - El plan del mes se reparte linealmente entre los días hábiles.
 * - "Plan a la fecha" = plan x (días hábiles transcurridos / días hábiles del mes).
 * - La fecha de referencia es la mayor entre la última Fecha Contab. y el último
 *   informe Gmail, acotada a hoy y al mes consultado. En meses cerrados la
 *   referencia es el último día del mes.
 */

const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1wNCovRpMc7EpZFwk4UeIadTjueLUNf5Ien-gwJ0jPhQ',
  SHEET_INGRESOS: 'Ingresos',
  SHEET_PLAN: 'Plan',
  SHEET_GMAIL: 'Informegmail',
  SHEET_APUNTES: 'Apuntes',
  SHEET_HOMOLOGACION: 'Homologacion',
  HTML_FILE: 'Index',
  TIMEZONE: 'America/Santiago',

  FACTOR_CUMPLIMIENTO: 18,
  FUZZY_THRESHOLD: 0.72,

  // Días de la semana hábiles para prorratear el plan.
  // 0=domingo ... 6=sábado. Agrega el 6 si trabajan los sábados.
  WORKDAYS: Object.freeze([1, 2, 3, 4, 5]),

  // Días sin recepción propios de la operación, en 'yyyy-MM-dd': paradas de
  // planta, cierre de camino, semana de Fiestas Patrias completa. Se
  // descuentan del prorrateo igual que un feriado legal.
  // Ejemplo: ['2026-09-17'] para no contar el jueves previo al 18.
  FERIADOS: Object.freeze([]),

  // Días que sí se trabajaron aunque el calendario los excluya (un sábado
  // de recuperación, un feriado con turno). Manda sobre WORKDAYS y sobre
  // cualquier feriado.
  DIAS_HABILES_EXTRA: Object.freeze([]),

  // Descuenta los feriados legales de Chile del prorrateo del plan.
  // Ponlo en false para volver al comportamiento anterior (solo lunes a viernes).
  USAR_FERIADOS_CHILE: true,

  GMAIL_LABEL: 'Informes de ingresos',
  GMAIL_SUBJECT: 'INGRESOS METROS RUMA',
  GMAIL_PROCESSED_LABEL: 'MetroRuma/Detalle procesado',
  GMAIL_SEARCH_DAYS: 62,
  GMAIL_MAX_THREADS: 250,
  TRIGGER_MINUTES: 10,

  // Índices base cero de Ingresos.
  // C=2, D=3, E=4, I=8, K=10, M=12, P=15, Q=16.
  INGRESOS_COLUMNS: Object.freeze({
    MATERIAL: 2,
    DESCRIPCION_MATERIAL: 3,
    FECHA_CONTABLE: 4,
    CANTIDAD: 8,
    UM: 10,
    DESCRIPCION_PROVEEDOR: 12,
    ROL: 15,
    PREDIO: 16
  })
});

/* =====================================================================
 * FERIADOS LEGALES DE CHILE
 *
 * Se calculan, no se escriben a mano. Una lista fija caduca sin avisar:
 * al pasar su último año todos los feriados desaparecen y el plan a la
 * fecha vuelve a salir inflado, que es justo el error que se buscaba
 * evitar. Aquí cada regla está en el código:
 *
 * - Fijos              1-ene, 1-may, 21-may, 16-jul, 15-ago, 18 y 19-sep,
 *                      1-nov, 8-dic, 25-dic.
 * - Semana Santa       Viernes y Sábado Santo, a partir de la Pascua.
 * - Ley 21.357         Pueblos Indígenas, el día del solsticio de junio.
 * - Ley 19.668         29-jun y 12-oct se corren al lunes si caen martes,
 *                      miércoles o jueves, y al lunes siguiente si caen
 *                      viernes.
 * - Ley 20.299         31-oct se corre al viernes anterior si cae martes y
 *                      al viernes siguiente si cae miércoles.
 * - Ley 20.215         feriado puente de Fiestas Patrias: el 17 cuando el
 *                      18 cae martes y el 20 cuando el 19 cae miércoles.
 *                      En 2029 esto deja cuatro feriados seguidos.
 *
 * Los feriados regionales (Arica, Chillán) no entran: no aplican a esta
 * operación. Si el gobierno decreta un feriado extraordinario (elecciones,
 * censo), agrégalo en CONFIG.FERIADOS.
 * ===================================================================== */

/**
 * Domingo de Pascua ('yyyy-MM-dd') por el algoritmo gregoriano anónimo
 * (Meeus/Jones/Butcher).
 */
function pascua_(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);

  return buildDateKey_(
    year,
    Math.floor((h + l - 7 * m + 114) / 31),
    ((h + l - 7 * m + 114) % 31) + 1
  );
}

/* Términos periódicos de Meeus, Astronomical Algorithms, tabla 27.C. */
const SOLSTICIO_TERMINOS = Object.freeze([
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186],
  [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
  [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513],
  [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417],
  [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
  [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756],
  [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]
]);

/**
 * Solsticio de junio en hora de Chile ('yyyy-MM-dd'): el 20 o el 21.
 * Reproduce las fechas oficiales 2022-2027 (21, 21, 20, 20, 21, 21).
 * En junio Chile está siempre en horario estándar, UTC-4.
 */
function solsticioJunio_(year) {
  const rad = function(deg) { return deg * Math.PI / 180; };
  const y = (year - 2000) / 1000;

  const jde0 = 2451716.56767 + 365241.62603 * y + 0.00325 * y * y +
    0.00888 * Math.pow(y, 3) - 0.00030 * Math.pow(y, 4);

  const t = (jde0 - 2451545) / 36525;
  const w = rad(35999.373 * t - 2.47);
  const lambda = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w);

  let periodic = 0;

  SOLSTICIO_TERMINOS.forEach(function(term) {
    periodic += term[0] * Math.cos(rad(term[1] + term[2] * t));
  });

  // De tiempo dinámico a UT, y de UT a hora de Chile.
  const years = year - 2000;
  const deltaT = 62.92 + 0.32217 * years + 0.005589 * years * years;
  const jd = jde0 + (0.00001 * periodic) / lambda - deltaT / 86400 - 4 / 24;

  return julianDayToDateKey_(jd);
}

function julianDayToDateKey_(jd) {
  const z = Math.floor(jd + 0.5);
  const fraction = jd + 0.5 - z;
  let a = z;

  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }

  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);

  const day = Math.floor(b - d - Math.floor(30.6001 * e) + fraction);
  const month = e < 14 ? e - 1 : e - 13;

  return buildDateKey_(month > 2 ? c - 4716 : c - 4715, month, day);
}

/**
 * Ley 19.668: el feriado se corre al lunes de su semana si cae martes,
 * miércoles o jueves, y al lunes siguiente si cae viernes.
 */
function lunesLey19668_(dateKey) {
  const dayOfWeek = dayOfWeekOfKey_(dateKey);

  if (dayOfWeek >= 2 && dayOfWeek <= 4) {
    return addDaysToDateKey_(dateKey, 1 - dayOfWeek);
  }

  if (dayOfWeek === 5) {
    return addDaysToDateKey_(dateKey, 3);
  }

  return dateKey;
}

/**
 * Ley 20.299: el 31 de octubre se corre al viernes anterior si cae martes
 * y al viernes siguiente si cae miércoles.
 */
function iglesiasLey20299_(year) {
  const dateKey = buildDateKey_(year, 10, 31);
  const dayOfWeek = dayOfWeekOfKey_(dateKey);

  if (dayOfWeek === 2) { return addDaysToDateKey_(dateKey, -4); }
  if (dayOfWeek === 3) { return addDaysToDateKey_(dateKey, 2); }

  return dateKey;
}

/**
 * Feriados legales de un año como { 'yyyy-MM-dd': 'Nombre' }.
 */
function feriadosChile_(year) {
  const out = {};

  const put = function(dateKey, name) {
    if (dateKey) { out[dateKey] = name; }
  };

  const pascua = pascua_(year);

  put(buildDateKey_(year, 1, 1), 'Año Nuevo');
  put(addDaysToDateKey_(pascua, -2), 'Viernes Santo');
  put(addDaysToDateKey_(pascua, -1), 'Sábado Santo');
  put(buildDateKey_(year, 5, 1), 'Día del Trabajo');
  put(buildDateKey_(year, 5, 21), 'Glorias Navales');
  put(solsticioJunio_(year), 'Día Nacional de los Pueblos Indígenas');
  put(lunesLey19668_(buildDateKey_(year, 6, 29)), 'San Pedro y San Pablo');
  put(buildDateKey_(year, 7, 16), 'Virgen del Carmen');
  put(buildDateKey_(year, 8, 15), 'Asunción de la Virgen');

  // Fiestas Patrias y el puente de la Ley 20.215.
  const sep18 = buildDateKey_(year, 9, 18);
  const sep19 = buildDateKey_(year, 9, 19);

  if (dayOfWeekOfKey_(sep18) === 2) {
    put(buildDateKey_(year, 9, 17), 'Fiestas Patrias · puente (Ley 20.215)');
  }

  put(sep18, 'Independencia Nacional');
  put(sep19, 'Glorias del Ejército');

  if (dayOfWeekOfKey_(sep19) === 3) {
    put(buildDateKey_(year, 9, 20), 'Fiestas Patrias · puente (Ley 20.215)');
  }

  put(lunesLey19668_(buildDateKey_(year, 10, 12)), 'Encuentro de Dos Mundos');
  put(iglesiasLey20299_(year), 'Día de las Iglesias Evangélicas');
  put(buildDateKey_(year, 11, 1), 'Día de Todos los Santos');
  put(buildDateKey_(year, 12, 8), 'Inmaculada Concepción');
  put(buildDateKey_(year, 12, 25), 'Navidad');

  return out;
}

const GMAIL_HEADERS = Object.freeze([
  'Fecha Informe',
  'Fecha ISO',
  'Proveedor Informe',
  'Proveedor Canónico',
  'Programa MR',
  'Cumplimiento',
  'Factor',
  'Presupuesto Diario',
  'Rol',
  'Estatus',
  'Asunto',
  'Message ID',
  'Remitente',
  'Fecha correo',
  'Fecha procesamiento',
  'Estado',
  'Método extracción',
  'Método coincidencia',
  'Score coincidencia'
]);

const HOMOLOGACION_HEADERS = Object.freeze([
  'Nombre en origen',
  'Proveedor del Plan',
  'Fuente',
  'Notas',
  'Autor',
  'Actualizado'
]);

const APUNTES_HEADERS = Object.freeze([
  'ID',
  'Semana',
  'Inicio',
  'Fin',
  'Ámbito',
  'Proveedor',
  'Clasificación',
  'Plan semana',
  'Recibido',
  'Desvío',
  'Cumplimiento',
  'Diagnóstico',
  'Plan de acción',
  'Responsable',
  'Estado',
  'Prioridad',
  'Autor',
  'Creado',
  'Actualizado'
]);

/* =====================================================================
 * MENÚ Y APLICACIÓN WEB
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MetroRuma Dashboard')
    .addItem('Abrir dashboard', 'abrirDashboard')
    .addSeparator()
    .addItem('Importar nuevos informes Gmail', 'procesarInformesGmail')
    .addItem('Reconstruir mes actual desde Gmail', 'reconstruirInformesGmailMesActual')
    .addItem('Instalar automatización Gmail', 'instalarDisparadorGmail')
    .addItem('Eliminar automatización Gmail', 'eliminarDisparadoresGmail')
    .addSeparator()
    .addItem('Equivalencias de proveedor', 'abrirHomologacion')
    .addItem('Diagnosticar cruce de proveedores', 'diagnosticarCruceProveedores')
    .addToUi();
}

function doGet() {
  return HtmlService
    .createTemplateFromFile(CONFIG.HTML_FILE)
    .evaluate()
    .setTitle('MetroRuma · Control de abastecimiento')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function abrirDashboard() {
  const output = HtmlService
    .createTemplateFromFile(CONFIG.HTML_FILE)
    .evaluate()
    .setWidth(1600)
    .setHeight(920);

  SpreadsheetApp.getUi().showModalDialog(
    output,
    'MetroRuma · Control de abastecimiento'
  );
}

/**
 * Permite partir el HTML en archivos: <?!= include('Estilos') ?>.
 */
function include(filename) {
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

/* =====================================================================
 * API DEL DASHBOARD
 * ===================================================================== */

/**
 * @param {string=} monthPrefix Mes a consultar en formato 'yyyy-MM'.
 *   Si se omite se usa el mes vigente.
 */
function getDashboardData(monthPrefix) {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const timezone = spreadsheet.getSpreadsheetTimeZone() || CONFIG.TIMEZONE;

  const currentPrefix = Utilities.formatDate(new Date(), timezone, 'yyyy-MM');
  const month = buildMonthWindow_(
    /^\d{4}-\d{2}$/.test(String(monthPrefix || '')) ? monthPrefix : currentPrefix
  );

  // Una sola lectura de la tabla de equivalencias para todo el cruce.
  const homologacion = readHomologacion_(spreadsheet);
  const aliases = homologacion.map;

  const planResult = readPlan_(spreadsheet, month, aliases);
  const planCandidates = planResult.rows.map(function(item) {
    return item.provider;
  });

  const ingresosResult = readIngresos_(
    spreadsheet, timezone, month, planCandidates, aliases
  );

  const gmailResult = readGmailProviderRows_(
    spreadsheet, timezone, month, planCandidates, aliases
  );

  const supplement = buildSupplementRows_(
    ingresosResult.rows, gmailResult.rows
  );

  const combinedRows = ingresosResult.rows.concat(supplement.rows);

  const workdays = buildWorkdaysInfo_(
    timezone,
    month,
    supplement.lastActualDate,
    supplement.latestReportDate,
    currentPrefix
  );

  const providers = uniqueSorted_(
    combinedRows
      .map(function(item) { return item.provider; })
      .concat(planResult.rows.map(function(item) { return item.provider; }))
  );

  return {
    generatedAt: Utilities.formatDate(
      new Date(), timezone, "yyyy-MM-dd'T'HH:mm:ss"
    ),
    generatedAtLabel: Utilities.formatDate(
      new Date(), timezone, "dd/MM/yyyy HH:mm"
    ),
    timezone: timezone,
    user: getActiveUserLabel_(),
    month: month,
    isCurrentMonth: month.prefix === currentPrefix,
    availableMonths: planResult.months,
    workdays: workdays,
    factor: CONFIG.FACTOR_CUMPLIMIENTO,
    source: {
      spreadsheetName: spreadsheet.getName(),
      spreadsheetUrl: spreadsheet.getUrl(),
      lastActualDate: supplement.lastActualDate,
      lastActualDateLabel: supplement.lastActualDate
        ? formatDateKey_(supplement.lastActualDate)
        : 'Sin fecha',
      supplementStart: supplement.supplementStart,
      supplementStartLabel: supplement.supplementStart
        ? formatDateKey_(supplement.supplementStart)
        : 'Sin complemento',
      latestReportDate: supplement.latestReportDate,
      latestReportDateLabel: supplement.latestReportDate
        ? formatDateKey_(supplement.latestReportDate)
        : 'Sin informe',
      actualRows: ingresosResult.rows.length,
      supplementRows: supplement.rows.length,
      gmailProviderRows: gmailResult.rows.length,
      planProviders: planResult.rows.length,
      unmatchedProviders: buildUnmatchedProviders_(
        planResult.rows, combinedRows, planCandidates
      ),
      similarProviders: findSimilarProviders_(providers),
      duplicateRows: findDuplicateRows_(combinedRows),
      aliasCount: homologacion.rows.length
    },
    homologacion: homologacion.rows,
    filters: {
      providers: providers,
      predios: uniqueSorted_(
        combinedRows
          .map(function(item) { return item.predio; })
          .filter(Boolean)
      ),
      materials: uniqueSorted_(
        combinedRows
          .map(function(item) { return item.material; })
          .filter(Boolean)
      )
    },
    plan: planResult.rows,
    rows: combinedRows,
    apuntes: readApuntes_(spreadsheet),
    gmailAudit: gmailResult.audit
  };
}

function getActiveUserLabel_() {
  try {
    return Session.getActiveUser().getEmail() || 'Usuario';
  } catch (error) {
    return 'Usuario';
  }
}

/* =====================================================================
 * PLAN DIARIO EN DÍAS HÁBILES
 * ===================================================================== */

/**
 * Días hábiles del mes y cuántos van corridos hasta la fecha de referencia.
 * El frontend usa esto para prorratear el plan y proyectar el cierre.
 */
function buildWorkdaysInfo_(
  timezone, month, lastActualDate, latestReportDate, currentPrefix
) {
  const todayKey = Utilities.formatDate(
    new Date(), timezone || CONFIG.TIMEZONE, 'yyyy-MM-dd'
  );

  let referenceDate = latestReportDate || '';

  if (lastActualDate && lastActualDate > referenceDate) {
    referenceDate = lastActualDate;
  }

  if (!referenceDate || referenceDate > todayKey) {
    referenceDate = todayKey;
  }

  // Mes ya cerrado: la referencia es el mes completo.
  if (currentPrefix && month.prefix < currentPrefix) {
    referenceDate = month.endKey;
  }

  if (referenceDate > month.endKey) {
    referenceDate = month.endKey;
  }

  if (referenceDate < month.startKey) {
    referenceDate = month.startKey;
  }

  const holidays = buildHolidayMap_(month.year);
  const forced = {};

  CONFIG.DIAS_HABILES_EXTRA.forEach(function(key) {
    forced[key] = true;
  });

  const lastDay = Number(month.endKey.split('-')[2]);

  const workdayKeys = [];
  const weekIndex = {};
  const calendar = [];
  const discounted = [];
  let elapsed = 0;

  for (let day = 1; day <= lastDay; day++) {
    const key = buildDateKey_(month.year, month.month, day);
    const dayOfWeek = dayOfWeekOfKey_(key);

    const weekend = CONFIG.WORKDAYS.indexOf(dayOfWeek) === -1;
    const reason = holidays[key] || '';

    // Un día forzado se cuenta aunque sea sábado o feriado.
    const isWorkday = forced[key] || (!weekend && !reason);

    let kind = 'workday';

    if (!isWorkday) {
      kind = reason ? 'holiday' : 'weekend';
    } else if (forced[key] && (weekend || reason)) {
      kind = 'recovered';
    }

    const entry = {
      key: key,
      day: day,
      dayOfWeek: dayOfWeek,
      kind: kind,
      reason: forced[key] && (weekend || reason)
        ? 'Día trabajado (recuperación)'
        : reason,
      elapsed: isWorkday && key <= referenceDate,
      isReference: key === referenceDate
    };

    calendar.push(entry);

    // Solo cuenta como feriado descontado el día que, de no existir el
    // motivo, habría sido hábil: un feriado en domingo no quita nada.
    if (!isWorkday && reason && !weekend) {
      discounted.push({ key: key, reason: reason });
    }

    if (!isWorkday) { continue; }

    workdayKeys.push(key);

    const weekKey = isoWeekKey_(key);
    weekIndex[weekKey] = (weekIndex[weekKey] || 0) + 1;

    if (key <= referenceDate) {
      elapsed++;
    }
  }

  const total = workdayKeys.length;

  return {
    todayKey: todayKey,
    referenceDate: referenceDate,
    referenceDateLabel: formatDateKey_(referenceDate),
    total: total,
    elapsed: elapsed,
    remaining: Math.max(0, total - elapsed),
    fraction: total ? round_(elapsed / total, 6) : 0,
    workdayKeys: workdayKeys,
    workdaysByWeek: weekIndex,
    calendar: calendar,
    discounted: discounted,
    holidays: discounted.map(function(item) { return item.key; })
  };
}

/**
 * Días no hábiles de un año como { 'yyyy-MM-dd': 'Motivo' }: los feriados
 * legales más las paradas propias de la operación.
 */
function buildHolidayMap_(year) {
  const holidays = {};

  if (CONFIG.USAR_FERIADOS_CHILE) {
    const legal = feriadosChile_(year);

    Object.keys(legal).forEach(function(key) {
      holidays[key] = legal[key];
    });
  }

  // Las paradas de la operación pisan al feriado legal: si coinciden, el
  // motivo que interesa al comprador es el de la operación.
  CONFIG.FERIADOS.forEach(function(key) {
    holidays[key] = 'Parada de la operación';
  });

  // DIAS_HABILES_EXTRA no se aplica aquí: lo resuelve buildWorkdaysInfo_,
  // que necesita saber el motivo original para marcar el día como
  // recuperado en vez de como un día hábil cualquiera.
  return holidays;
}

function dayOfWeekOfKey_(dateKey) {
  const parts = String(dateKey || '').split('-');

  return new Date(Date.UTC(
    Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])
  )).getUTCDay();
}

/**
 * Semana ISO ('2026-W35') a partir de una fecha 'yyyy-MM-dd'.
 */
function isoWeekKey_(dateKey) {
  const parts = String(dateKey).split('-');
  const date = new Date(Date.UTC(
    Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])
  ));

  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date - yearStart) / 86400000 + 1) / 7
  );

  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

/* =====================================================================
 * LECTURA DE PLAN
 * ===================================================================== */

function readPlan_(spreadsheet, month, aliases) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_PLAN);

  if (!sheet || sheet.getLastRow() < 2) {
    return { rows: [], monthColumn: -1, months: [] };
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayed = range.getDisplayValues();

  const headerRowIndex = findPlanHeaderRow_(values);

  if (headerRowIndex === -1) {
    throw new Error('No se encontró el encabezado "Proveedores" en la hoja Plan.');
  }

  const header = values[headerRowIndex];
  const displayedHeader = displayed[headerRowIndex];

  const providerColumn = header.findIndex(function(value) {
    const key = normalizeHeader_(value);
    return key === 'proveedores' || key === 'proveedor';
  });

  if (providerColumn === -1) {
    throw new Error('No se encontró la columna Proveedores en la hoja Plan.');
  }

  const months = listPlanMonths_(header, displayedHeader);
  const monthColumn = findPlanMonthColumn_(header, displayedHeader, month);

  if (monthColumn === -1) {
    throw new Error(
      'La hoja Plan no tiene una columna para ' + month.label + '.'
    );
  }

  const groupColumn = Math.max(0, providerColumn - 1);
  const aggregate = {};
  let currentGroup = '';

  for (
    let rowIndex = headerRowIndex + 1;
    rowIndex < values.length;
    rowIndex++
  ) {
    const row = values[rowIndex];
    const displayRow = displayed[rowIndex] || [];
    const groupText = text_(row[groupColumn]);

    if (groupText) {
      currentGroup = groupText;
    }

    const providerRaw = text_(row[providerColumn]);

    if (!providerRaw || normalizeKey_(providerRaw) === 'TOTAL') {
      continue;
    }

    const planValue = toNumber_(row[monthColumn], displayRow[monthColumn]);

    const match = resolveProvider_(providerRaw, {
      source: 'PLAN',
      aliases: aliases,
      group: currentGroup,
      predio: providerRaw,
      candidates: []
    });

    if (!aggregate[match.provider]) {
      aggregate[match.provider] = {
        provider: match.provider,
        providerRaw: providerRaw,
        group: currentGroup,
        plan: 0,
        matchMethod: match.method,
        matchScore: match.score
      };
    }

    aggregate[match.provider].plan += planValue;
  }

  return {
    monthColumn: monthColumn,
    months: months,
    rows: Object.keys(aggregate)
      .map(function(key) { return aggregate[key]; })
      .sort(function(a, b) {
        return a.provider.localeCompare(b.provider, 'es', {
          sensitivity: 'base'
        });
      })
  };
}

function findPlanHeaderRow_(values) {
  const maxRows = Math.min(values.length, 20);

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    for (
      let columnIndex = 0;
      columnIndex < values[rowIndex].length;
      columnIndex++
    ) {
      const key = normalizeHeader_(values[rowIndex][columnIndex]);

      if (key === 'proveedores' || key === 'proveedor') {
        return rowIndex;
      }
    }
  }

  return -1;
}

/**
 * Todos los meses que ofrece la hoja Plan, para el selector del dashboard.
 */
function listPlanMonths_(header, displayedHeader) {
  const found = {};
  const months = [];

  for (
    let columnIndex = 0;
    columnIndex < header.length;
    columnIndex++
  ) {
    const prefix = planColumnMonth_(
      header[columnIndex], displayedHeader[columnIndex]
    );

    if (!prefix || found[prefix]) {
      continue;
    }

    found[prefix] = true;

    months.push({
      prefix: prefix,
      label: monthLabel_(prefix)
    });
  }

  return months.sort(function(a, b) {
    return a.prefix < b.prefix ? 1 : -1;
  });
}

function planColumnMonth_(raw, displayed) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM');
  }

  return parseMonthHeader_(displayed || raw);
}

function findPlanMonthColumn_(header, displayedHeader, month) {
  for (
    let columnIndex = 0;
    columnIndex < header.length;
    columnIndex++
  ) {
    const prefix = planColumnMonth_(
      header[columnIndex], displayedHeader[columnIndex]
    );

    if (prefix === month.prefix) {
      return columnIndex;
    }
  }

  return -1;
}

function parseMonthHeader_(value) {
  const text = normalizeKey_(value);

  let match = text.match(/^(\d{4})[-/](\d{1,2})/);

  if (match) {
    return String(match[1]) + '-' + String(match[2]).padStart(2, '0');
  }

  match = text.match(
    /^(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[A-Z]*[-. ]+(\d{4})/
  );

  if (!match) {
    return '';
  }

  const months = {
    ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
    JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12
  };

  return String(match[2]) + '-' + String(months[match[1]]).padStart(2, '0');
}

/* =====================================================================
 * LECTURA DE INGRESOS REALES
 * ===================================================================== */

function readIngresos_(spreadsheet, timezone, month, planCandidates, aliases) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_INGRESOS);

  if (!sheet) {
    throw new Error('No existe la hoja "' + CONFIG.SHEET_INGRESOS + '".');
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayed = range.getDisplayValues();

  if (!values.length) {
    return { rows: [] };
  }

  validateIngresosHeaders_(values[0]);

  const columns = CONFIG.INGRESOS_COLUMNS;
  const cache = {};
  const rows = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const displayRow = displayed[rowIndex] || [];

    const dateKey = toDateKey_(
      row[columns.FECHA_CONTABLE],
      displayRow[columns.FECHA_CONTABLE],
      timezone
    );

    if (!dateKey || dateKey.indexOf(month.prefix + '-') !== 0) {
      continue;
    }

    const providerRaw = text_(row[columns.DESCRIPCION_PROVEEDOR]);
    const predio = text_(row[columns.PREDIO]);
    const rol = text_(row[columns.ROL]);

    // El cruce difuso es caro: se memoiza por combinación proveedor+predio+rol.
    const cacheKey = providerRaw + '|' + predio + '|' + rol;

    if (!cache[cacheKey]) {
      cache[cacheKey] = resolveProvider_(providerRaw, {
        source: 'INGRESOS',
        aliases: aliases,
        predio: predio,
        rol: rol,
        candidates: planCandidates
      });
    }

    const match = cache[cacheKey];

    rows.push({
      fecha: dateKey,
      fechaNumero: Number(dateKey.replace(/-/g, '')),
      fechaLabel: formatDateKey_(dateKey),
      source: 'INGRESOS',
      provider: match.provider,
      providerRaw: providerRaw,
      matchMethod: match.method,
      matchScore: match.score,
      material: text_(row[columns.MATERIAL]),
      descripcion: text_(row[columns.DESCRIPCION_MATERIAL]),
      cantidad: toNumber_(row[columns.CANTIDAD], displayRow[columns.CANTIDAD]),
      cumplimiento: null,
      factor: null,
      um: text_(row[columns.UM]) || 'MR',
      predio: predio,
      rol: rol,
      estatus: '',
      messageId: ''
    });
  }

  return { rows: rows };
}

function validateIngresosHeaders_(headerRow) {
  const dateHeader = normalizeHeader_(
    headerRow[CONFIG.INGRESOS_COLUMNS.FECHA_CONTABLE]
  );

  if (
    dateHeader !== 'fecha contab' &&
    dateHeader !== 'fecha contable' &&
    dateHeader !== 'fecha contabilizacion'
  ) {
    throw new Error(
      'La columna E de Ingresos debe llamarse "Fecha Contab." y dice "' +
      dateHeader + '".'
    );
  }
}

/* =====================================================================
 * IMPORTACIÓN GMAIL
 * ===================================================================== */

function procesarInformesGmail() {
  return importGmailReports_(false);
}

function reconstruirInformesGmailMesActual() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Reconstruir Informegmail',
    'Se respaldará la tabla actual y se volverán a importar todos los ' +
    'informes del mes vigente con detalle por proveedor.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response !== ui.Button.OK) {
    return;
  }

  return importGmailReports_(true);
}

function importGmailReports_(rebuild) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const timezone = spreadsheet.getSpreadsheetTimeZone() || CONFIG.TIMEZONE;

    const month = buildMonthWindow_(
      Utilities.formatDate(new Date(), timezone, 'yyyy-MM')
    );

    const aliases = readHomologacion_(spreadsheet).map;
    const plan = readPlan_(spreadsheet, month, aliases);
    const candidates = plan.rows.map(function(item) {
      return item.provider;
    });

    const sheet = ensureGmailSheet_(spreadsheet, rebuild);
    const processedIds = rebuild ? {} : getProcessedMessageIds_(sheet);

    const query = [
      'label:"' + CONFIG.GMAIL_LABEL + '"',
      'subject:"' + CONFIG.GMAIL_SUBJECT + '"',
      'newer_than:' + CONFIG.GMAIL_SEARCH_DAYS + 'd'
    ].join(' ');

    const threads = GmailApp.search(query, 0, CONFIG.GMAIL_MAX_THREADS);

    const processedLabel =
      GmailApp.getUserLabelByName(CONFIG.GMAIL_PROCESSED_LABEL) ||
      GmailApp.createLabel(CONFIG.GMAIL_PROCESSED_LABEL);

    const output = [];

    let examined = 0;
    let reportsImported = 0;
    let providerRows = 0;
    let duplicates = 0;
    let outsideMonth = 0;
    let ignoredSubjects = 0;
    let errors = 0;

    threads.forEach(function(thread) {
      thread.getMessages().forEach(function(message) {
        examined++;

        const messageId = message.getId();
        const subject = text_(message.getSubject());

        // Excluye "SIN INGRESOS..." y "NO HAY SOLICITUD...".
        if (!/^INGRESOS METROS RUMA\b/i.test(normalizeKey_(subject))) {
          ignoredSubjects++;
          return;
        }

        if (processedIds[messageId]) {
          duplicates++;
          return;
        }

        try {
          const parsed = parseIngresoEmail_(message, timezone);

          if (parsed.fecha.indexOf(month.prefix + '-') !== 0) {
            outsideMonth++;
            return;
          }

          parsed.rows.forEach(function(item) {
            const match = resolveProvider_(item.providerRaw, {
              source: 'GMAIL',
              aliases: aliases,
              rol: item.rol,
              candidates: candidates
            });

            output.push([
              dateKeyToLocalDate_(parsed.fecha),
              parsed.fecha,
              item.providerRaw,
              match.provider,
              item.programaMr,
              item.cumplimiento,
              CONFIG.FACTOR_CUMPLIMIENTO,
              item.cumplimiento * CONFIG.FACTOR_CUMPLIMIENTO,
              item.rol,
              item.estatus,
              subject,
              messageId,
              message.getFrom(),
              message.getDate(),
              new Date(),
              'OK',
              parsed.method,
              match.method,
              match.score
            ]);

            providerRows++;
          });

          processedIds[messageId] = true;
          reportsImported++;
          thread.addLabel(processedLabel);
        } catch (error) {
          errors++;

          output.push([
            '', '', '', '', '', '',
            CONFIG.FACTOR_CUMPLIMIENTO,
            '', '', '',
            subject,
            messageId,
            message.getFrom(),
            message.getDate(),
            new Date(),
            'ERROR: ' + String(error.message || error),
            'No extraído',
            '',
            0
          ]);

          processedIds[messageId] = true;
        }
      });
    });

    if (output.length) {
      sheet
        .getRange(
          sheet.getLastRow() + 1, 1, output.length, GMAIL_HEADERS.length
        )
        .setValues(output);

      formatGmailSheet_(sheet);
    }

    const result = {
      month: month.label,
      examined: examined,
      reportsImported: reportsImported,
      providerRows: providerRows,
      duplicates: duplicates,
      outsideMonth: outsideMonth,
      ignoredSubjects: ignoredSubjects,
      errors: errors
    };

    console.log(JSON.stringify(result));

    try {
      SpreadsheetApp.getUi().alert(
        'Importación Gmail finalizada\n\n' +
        'Mes: ' + month.label + '\n' +
        'Mensajes revisados: ' + examined + '\n' +
        'Informes importados: ' + reportsImported + '\n' +
        'Filas de proveedor: ' + providerRows + '\n' +
        'Duplicados: ' + duplicates + '\n' +
        'Fuera del mes: ' + outsideMonth + '\n' +
        'Asuntos ignorados: ' + ignoredSubjects + '\n' +
        'Errores: ' + errors
      );
    } catch (ignored) {}

    return result;
  } finally {
    lock.releaseLock();
  }
}

function instalarDisparadorGmail() {
  eliminarDisparadoresGmail();

  ScriptApp
    .newTrigger('procesarInformesGmail')
    .timeBased()
    .everyMinutes(CONFIG.TRIGGER_MINUTES)
    .create();

  SpreadsheetApp.getUi().alert(
    'Automatización instalada.\n\nGmail se revisará cada ' +
    CONFIG.TRIGGER_MINUTES + ' minutos.'
  );
}

function eliminarDisparadoresGmail() {
  let removed = 0;

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'procesarInformesGmail') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  return removed;
}

function ensureGmailSheet_(spreadsheet, rebuild) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_GMAIL);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_GMAIL);
  }

  const currentHeaders = sheet.getLastColumn()
    ? sheet
        .getRange(
          1, 1, 1, Math.max(sheet.getLastColumn(), GMAIL_HEADERS.length)
        )
        .getDisplayValues()[0]
        .slice(0, GMAIL_HEADERS.length)
    : [];

  const schemaMatches =
    currentHeaders.join('|') === GMAIL_HEADERS.join('|');

  if (rebuild || (!schemaMatches && sheet.getLastRow() > 1)) {
    const backupName = uniqueSheetName_(
      spreadsheet,
      'Informegmail_respaldo_' + Utilities.formatDate(
        new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss'
      )
    );

    sheet.copyTo(spreadsheet).setName(backupName);
    sheet.clear();
  }

  sheet
    .getRange(1, 1, 1, GMAIL_HEADERS.length)
    .setValues([GMAIL_HEADERS]);

  formatGmailSheet_(sheet);
  return sheet;
}

function uniqueSheetName_(spreadsheet, baseName) {
  let name = baseName;
  let counter = 2;

  while (spreadsheet.getSheetByName(name)) {
    name = baseName + '_' + counter;
    counter++;
  }

  return name;
}

function formatGmailSheet_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 2);

  sheet.setFrozenRows(1);

  sheet
    .getRange(1, 1, 1, GMAIL_HEADERS.length)
    .setBackground('#26395c')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  sheet.getRange(2, 1, lastRow - 1, 1).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(2, 5, lastRow - 1, 4).setNumberFormat('#,##0.00');
  sheet.getRange(2, 14, lastRow - 1, 2).setNumberFormat('dd/MM/yyyy HH:mm');
  sheet.getRange(2, 19, lastRow - 1, 1).setNumberFormat('0.00');

  const widths = [
    105, 105, 310, 180, 100, 110, 75, 135, 150,
    90, 370, 180, 250, 145, 145, 220, 180, 170, 110
  ];

  widths.forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}

function getProcessedMessageIds_(sheet) {
  const ids = {};

  if (sheet.getLastRow() < 2) {
    return ids;
  }

  const values = sheet
    .getRange(2, 12, sheet.getLastRow() - 1, 5)
    .getDisplayValues();

  values.forEach(function(row) {
    const messageId = text_(row[0]);
    const state = text_(row[4]);

    if (
      messageId &&
      (state === 'OK' || state.indexOf('ERROR:') === 0)
    ) {
      ids[messageId] = true;
    }
  });

  return ids;
}

/* =====================================================================
 * EXTRACCIÓN DEL INFORME
 * ===================================================================== */

function parseIngresoEmail_(message, timezone) {
  const subject = message.getSubject() || '';
  const htmlBody = message.getBody() || '';
  const plainBody = message.getPlainBody() || '';

  const fecha =
    extractSpanishDateKey_(subject) ||
    extractSpanishDateKey_(plainBody) ||
    extractSpanishDateKey_(htmlToText_(htmlBody));

  if (!fecha) {
    throw new Error('No se encontró la fecha del informe.');
  }

  const htmlRows = extractReportRowsFromHtml_(htmlBody);

  if (htmlRows.length) {
    return {
      fecha: fecha,
      rows: aggregateReportRows_(htmlRows),
      method: 'Tabla HTML'
    };
  }

  const textRows = extractReportRowsFromText_(
    plainBody || htmlToText_(htmlBody)
  );

  if (!textRows.length) {
    throw new Error('No se encontraron proveedores con CUMPLIMIENTO.');
  }

  return {
    fecha: fecha,
    rows: aggregateReportRows_(textRows),
    method: 'Texto del correo'
  };
}

function extractReportRowsFromHtml_(html) {
  const rows = extractHtmlTableRows_(html);

  if (!rows.length) {
    return [];
  }

  let headerIndex = -1;
  let providerColumn = -1;
  let programColumn = -1;
  let cumplimientoColumn = -1;
  let rolColumn = -1;
  let statusColumn = -1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    rows[rowIndex].forEach(function(cell, columnIndex) {
      const key = normalizeKey_(cell);

      if (
        key === 'PROVEEDOR' || key === 'PROVEEDORES' ||
        key === 'EMPRESA' || key === 'FAENA' || key === 'CONTRATISTA'
      ) {
        providerColumn = columnIndex;
        headerIndex = rowIndex;
      }

      if (key.indexOf('PROGRAMA MR') !== -1) {
        programColumn = columnIndex;
        headerIndex = rowIndex;
      }

      if (key.indexOf('CUMPLIMIENTO') !== -1) {
        cumplimientoColumn = columnIndex;
        headerIndex = rowIndex;
      }

      if (key === 'ROL') {
        rolColumn = columnIndex;
      }

      if (key === 'ESTATUS' || key === 'STATUS') {
        statusColumn = columnIndex;
      }
    });

    if (headerIndex !== -1 && cumplimientoColumn !== -1) {
      break;
    }
  }

  if (cumplimientoColumn === -1) {
    return [];
  }

  if (providerColumn === -1) {
    providerColumn = 0;
  }

  const output = [];

  for (
    let rowIndex = headerIndex + 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row = rows[rowIndex];
    const providerRaw = text_(row[providerColumn]);

    if (normalizeKey_(providerRaw) === 'TOTAL') {
      break;
    }

    if (!providerRaw) {
      continue;
    }

    const cumplimiento = parseOptionalNumber_(row[cumplimientoColumn]);

    if (cumplimiento === null || !isFinite(cumplimiento)) {
      continue;
    }

    output.push({
      providerRaw: providerRaw,
      programaMr: programColumn >= 0
        ? parseOptionalNumber_(row[programColumn])
        : null,
      cumplimiento: cumplimiento,
      rol: rolColumn >= 0 ? text_(row[rolColumn]) : '',
      estatus: statusColumn >= 0 ? text_(row[statusColumn]) : ''
    });
  }

  return output;
}

function extractReportRowsFromText_(body) {
  const lines = String(body || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(function(line) {
      return decodeHtmlEntities_(line).replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);

  const output = [];
  let pendingProvider = '';

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const key = normalizeKey_(line);

    if (key === 'TOTAL' || key.indexOf('ATTE') === 0) {
      break;
    }

    if (
      key.indexOf('PROGRAMA MR') !== -1 ||
      key === 'CUMPLIMIENTO' ||
      key === 'ROL' ||
      key === 'ESTATUS' ||
      key.match(/^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)/)
    ) {
      continue;
    }

    const parsed = parsePlainReportLine_(line, pendingProvider);

    if (parsed) {
      output.push(parsed);
      pendingProvider = '';
      continue;
    }

    if (!containsNumber_(line) && !isStatus_(line)) {
      pendingProvider = line;
    }
  }

  return output;
}

function parsePlainReportLine_(line, pendingProvider) {
  const statusMatch = line.match(
    /\b(VERDE|ROJO|AMARILLO|NARANJO|NARANJA)\s*$/i
  );

  if (!statusMatch) {
    return null;
  }

  const estatus = statusMatch[1].toUpperCase();
  const withoutStatus = line.slice(0, statusMatch.index).trim();

  const roleMatch = withoutStatus.match(
    /(\d{2,4}-\d{1,4}(?:\s*\/\s*\d{2,4}-\d{1,4})*)\s*$/
  );

  if (!roleMatch) {
    return null;
  }

  const rol = roleMatch[1].replace(/\s+/g, ' ').trim();
  const beforeRole = withoutStatus.slice(0, roleMatch.index).trim();

  const numberMatches = beforeRole.match(
    /(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)$/
  );

  let providerRaw = '';
  let programaMr = null;
  let cumplimiento = null;

  if (numberMatches) {
    programaMr = parseOptionalNumber_(numberMatches[1]);
    cumplimiento = parseOptionalNumber_(numberMatches[2]);
    providerRaw = beforeRole.slice(0, numberMatches.index).trim();
  } else {
    const oneNumber = beforeRole.match(/(-?\d+(?:[.,]\d+)?)$/);

    if (!oneNumber) {
      return null;
    }

    cumplimiento = parseOptionalNumber_(oneNumber[1]);
    providerRaw = beforeRole.slice(0, oneNumber.index).trim();
  }

  if (!providerRaw) {
    providerRaw = pendingProvider;
  }

  if (!providerRaw || cumplimiento === null || !isFinite(cumplimiento)) {
    return null;
  }

  return {
    providerRaw: providerRaw,
    programaMr: programaMr,
    cumplimiento: cumplimiento,
    rol: rol,
    estatus: estatus
  };
}

function aggregateReportRows_(rows) {
  const aggregate = {};

  rows.forEach(function(item) {
    const key = [
      normalizeKey_(item.providerRaw),
      normalizeKey_(item.rol)
    ].join('|');

    if (!aggregate[key]) {
      aggregate[key] = {
        providerRaw: item.providerRaw,
        programaMr: 0,
        cumplimiento: 0,
        rol: item.rol,
        estatus: item.estatus
      };
    }

    if (item.programaMr !== null && isFinite(item.programaMr)) {
      aggregate[key].programaMr += Number(item.programaMr);
    }

    aggregate[key].cumplimiento += Number(item.cumplimiento) || 0;

    if (item.estatus) {
      aggregate[key].estatus = item.estatus;
    }
  });

  return Object.keys(aggregate).map(function(key) {
    const item = aggregate[key];

    if (!item.programaMr) {
      item.programaMr = null;
    }

    return item;
  });
}

function extractHtmlTableRows_(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while ((rowMatch = rowRegex.exec(String(html || ''))) !== null) {
    const cells = [];
    const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;

    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cleanHtmlCell_(cellMatch[1]));
    }

    if (cells.length) {
      rows.push(cells);
    }
  }

  return rows;
}

function cleanHtmlCell_(html) {
  return decodeHtmlEntities_(
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function htmlToText_(html) {
  return decodeHtmlEntities_(
    String(html || '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
  );
}

/* =====================================================================
 * LECTURA DE INFORMEGMAIL
 * ===================================================================== */

function readGmailProviderRows_(
  spreadsheet, timezone, month, planCandidates, aliases
) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_GMAIL);

  if (!sheet || sheet.getLastRow() < 2) {
    return { rows: [], audit: { reports: 0, providers: 0 } };
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayed = range.getDisplayValues();
  const headerMap = buildHeaderMap_(values[0]);

  const required = [
    'fecha iso',
    'proveedor informe',
    'cumplimiento',
    'presupuesto diario',
    'message id',
    'fecha correo',
    'estado'
  ];

  const missing = required.filter(function(key) {
    return headerMap[key] === undefined;
  });

  // El esquema antiguo solo tenía totales y no sirve para cruzar por proveedor.
  if (missing.length) {
    return {
      rows: [],
      audit: {
        reports: 0,
        providers: 0,
        schemaOld: true,
        missing: missing
      }
    };
  }

  const messagesByDate = {};

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const displayRow = displayed[rowIndex] || [];
    const state = text_(row[headerMap['estado']]);

    if (state !== 'OK') {
      continue;
    }

    const dateKey =
      parseDateText_(displayRow[headerMap['fecha iso']]) ||
      toDateKey_(
        row[headerMap['fecha informe']],
        displayRow[headerMap['fecha informe']],
        timezone
      );

    if (!dateKey || dateKey.indexOf(month.prefix + '-') !== 0) {
      continue;
    }

    const messageId = text_(row[headerMap['message id']]);

    const emailDate = row[headerMap['fecha correo']] instanceof Date
      ? row[headerMap['fecha correo']].getTime()
      : 0;

    // Por fecha de informe se conserva solo el correo más reciente.
    if (
      !messagesByDate[dateKey] ||
      emailDate > messagesByDate[dateKey].emailDate
    ) {
      messagesByDate[dateKey] = {
        messageId: messageId,
        emailDate: emailDate,
        rows: []
      };
    }

    if (messagesByDate[dateKey].messageId !== messageId) {
      continue;
    }

    const providerRaw = text_(row[headerMap['proveedor informe']]);
    const savedCanonical = text_(row[headerMap['proveedor canonico']]);

    const match = savedCanonical
      ? {
          provider: savedCanonical,
          method: text_(row[headerMap['metodo coincidencia']]) || 'Guardado',
          score: toNumber_(
            row[headerMap['score coincidencia']],
            displayRow[headerMap['score coincidencia']]
          )
        }
      : resolveProvider_(providerRaw, {
          source: 'GMAIL',
          aliases: aliases,
          rol: text_(row[headerMap['rol']]),
          candidates: planCandidates
        });

    messagesByDate[dateKey].rows.push({
      fecha: dateKey,
      provider: match.provider,
      providerRaw: providerRaw,
      matchMethod: match.method,
      matchScore: match.score,
      programaMr: toNullableNumber_(
        row[headerMap['programa mr']],
        displayRow[headerMap['programa mr']]
      ),
      cumplimiento: toNumber_(
        row[headerMap['cumplimiento']],
        displayRow[headerMap['cumplimiento']]
      ),
      factor: toNumber_(
        row[headerMap['factor']],
        displayRow[headerMap['factor']]
      ),
      cantidad: toNumber_(
        row[headerMap['presupuesto diario']],
        displayRow[headerMap['presupuesto diario']]
      ),
      rol: text_(row[headerMap['rol']]),
      estatus: text_(row[headerMap['estatus']]),
      messageId: messageId
    });
  }

  const output = [];

  Object.keys(messagesByDate).sort().forEach(function(dateKey) {
    const aggregate = {};

    messagesByDate[dateKey].rows.forEach(function(item) {
      const key = item.provider;

      if (!aggregate[key]) {
        aggregate[key] = {
          fecha: item.fecha,
          fechaNumero: Number(item.fecha.replace(/-/g, '')),
          fechaLabel: formatDateKey_(item.fecha),
          source: 'GMAIL',
          provider: item.provider,
          providerRaw: item.providerRaw,
          matchMethod: item.matchMethod,
          matchScore: item.matchScore,
          material: 'COMPLEMENTO GMAIL',
          descripcion: 'CUMPLIMIENTO × ' + CONFIG.FACTOR_CUMPLIMIENTO,
          cantidad: 0,
          cumplimiento: 0,
          programaMr: null,
          factor: CONFIG.FACTOR_CUMPLIMIENTO,
          um: 'MR',
          predio: '',
          rol: '',
          estatus: '',
          messageId: item.messageId
        };
      }

      aggregate[key].cantidad += item.cantidad;
      aggregate[key].cumplimiento += item.cumplimiento;

      // El programa comprometido del informe: sirve para ver si el
      // proveedor cumple lo que él mismo programó, no solo el plan.
      if (item.programaMr !== null && isFinite(item.programaMr)) {
        aggregate[key].programaMr =
          (aggregate[key].programaMr || 0) + Number(item.programaMr);
      }

      aggregate[key].rol = joinUnique_(aggregate[key].rol, item.rol);
      aggregate[key].estatus = joinUnique_(aggregate[key].estatus, item.estatus);
    });

    Object.keys(aggregate).forEach(function(key) {
      output.push(aggregate[key]);
    });
  });

  return {
    rows: output,
    audit: {
      reports: Object.keys(messagesByDate).length,
      providers: output.length
    }
  };
}

function buildHeaderMap_(headerRow) {
  const map = {};

  headerRow.forEach(function(value, index) {
    map[normalizeHeader_(value)] = index;
  });

  return map;
}

/* =====================================================================
 * COMPLEMENTO: ÚLTIMO DÍA REAL + INFORMES POSTERIORES
 * ===================================================================== */

function buildSupplementRows_(actualRows, gmailRows) {
  const lastActualDate = actualRows.reduce(function(maxDate, item) {
    return (!maxDate || item.fecha > maxDate) ? item.fecha : maxDate;
  }, '');

  const latestReportDate = gmailRows.reduce(function(maxDate, item) {
    return (!maxDate || item.fecha > maxDate) ? item.fecha : maxDate;
  }, '');

  const supplementStart = lastActualDate
    ? addDaysToDateKey_(lastActualDate, 1)
    : '';

  const rows = gmailRows.filter(function(item) {
    if (lastActualDate && item.fecha <= lastActualDate) {
      return false;
    }

    if (latestReportDate && item.fecha > latestReportDate) {
      return false;
    }

    return true;
  });

  return {
    rows: rows,
    lastActualDate: lastActualDate,
    latestReportDate: latestReportDate,
    supplementStart: rows.length ? supplementStart : ''
  };
}

/* =====================================================================
 * BITÁCORA SEMANAL (HOJA APUNTES)
 * ===================================================================== */

/**
 * Devuelve todos los apuntes guardados. El dashboard filtra por semana.
 */
function getApuntes() {
  return readApuntes_(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID));
}

function readApuntes_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_APUNTES);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayed = range.getDisplayValues();
  const map = buildHeaderMap_(values[0]);

  if (map['id'] === undefined) {
    return [];
  }

  const output = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const displayRow = displayed[rowIndex] || [];
    const id = text_(row[map['id']]);

    if (!id) {
      continue;
    }

    output.push({
      id: id,
      week: text_(row[map['semana']]),
      start: parseDateText_(displayRow[map['inicio']]) ||
        toDateKey_(row[map['inicio']], displayRow[map['inicio']], CONFIG.TIMEZONE),
      end: parseDateText_(displayRow[map['fin']]) ||
        toDateKey_(row[map['fin']], displayRow[map['fin']], CONFIG.TIMEZONE),
      scope: text_(row[map['ambito']]) || 'PROVEEDOR',
      provider: text_(row[map['proveedor']]),
      classification: text_(row[map['clasificacion']]),
      plan: toNumber_(row[map['plan semana']], displayRow[map['plan semana']]),
      received: toNumber_(row[map['recibido']], displayRow[map['recibido']]),
      deviation: toNumber_(row[map['desvio']], displayRow[map['desvio']]),
      compliance: toNumber_(
        row[map['cumplimiento']], displayRow[map['cumplimiento']]
      ),
      diagnosis: text_(row[map['diagnostico']]),
      action: text_(row[map['plan de accion']]),
      owner: text_(row[map['responsable']]),
      status: text_(row[map['estado']]) || 'Abierto',
      priority: text_(row[map['prioridad']]) || 'Media',
      author: text_(row[map['autor']]),
      createdAt: text_(displayRow[map['creado']]),
      updatedAt: text_(displayRow[map['actualizado']])
    });
  }

  return output;
}

/**
 * Inserta o actualiza apuntes por ID y devuelve la lista completa.
 *
 * @param {Array<Object>} notes Apuntes provenientes del dashboard.
 */
function guardarApuntes(notes) {
  if (!notes || !notes.length) {
    return getApuntes();
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ensureApuntesSheet_(spreadsheet);
    const author = getActiveUserLabel_();
    const now = new Date();

    // Una sola lectura: ID en la columna 1, fecha de creación en la 18.
    const existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, APUNTES_HEADERS.length)
          .getValues()
      : [];

    const known = {};

    existing.forEach(function(row, index) {
      const id = text_(row[0]);

      if (id) {
        known[id] = { row: index + 2, createdAt: row[17] };
      }
    });

    const appended = [];

    notes.forEach(function(note) {
      const id = text_(note.id) || Utilities.getUuid();
      const previous = known[id];

      const values = buildApunteRow_(
        note, id, author, now, previous ? previous.createdAt : null
      );

      if (previous) {
        sheet
          .getRange(previous.row, 1, 1, APUNTES_HEADERS.length)
          .setValues([values]);
      } else {
        appended.push(values);
      }
    });

    if (appended.length) {
      sheet
        .getRange(
          sheet.getLastRow() + 1, 1, appended.length, APUNTES_HEADERS.length
        )
        .setValues(appended);
    }

    formatApuntesSheet_(sheet);
    return readApuntes_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function buildApunteRow_(note, id, author, now, createdAt) {
  return [
    id,
    text_(note.week),
    note.start ? dateKeyToLocalDate_(note.start) : '',
    note.end ? dateKeyToLocalDate_(note.end) : '',
    text_(note.scope) || 'PROVEEDOR',
    text_(note.provider),
    text_(note.classification),
    Number(note.plan) || 0,
    Number(note.received) || 0,
    Number(note.deviation) || 0,
    Number(note.compliance) || 0,
    text_(note.diagnosis),
    text_(note.action),
    text_(note.owner),
    text_(note.status) || 'Abierto',
    text_(note.priority) || 'Media',
    text_(note.author) || author,
    (createdAt instanceof Date && !isNaN(createdAt.getTime())) ? createdAt : now,
    now
  ];
}

/**
 * Elimina un apunte por ID y devuelve la lista actualizada.
 */
function eliminarApunte(id) {
  const target = text_(id);

  if (!target) {
    return getApuntes();
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_APUNTES);

    if (!sheet || sheet.getLastRow() < 2) {
      return [];
    }

    const ids = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues();

    for (let index = ids.length - 1; index >= 0; index--) {
      if (text_(ids[index][0]) === target) {
        sheet.deleteRow(index + 2);
        break;
      }
    }

    return readApuntes_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function ensureApuntesSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_APUNTES);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_APUNTES);
  }

  const currentHeaders = sheet.getLastColumn()
    ? sheet
        .getRange(
          1, 1, 1, Math.max(sheet.getLastColumn(), APUNTES_HEADERS.length)
        )
        .getDisplayValues()[0]
        .slice(0, APUNTES_HEADERS.length)
    : [];

  if (currentHeaders.join('|') !== APUNTES_HEADERS.join('|')) {
    if (sheet.getLastRow() > 1) {
      sheet
        .copyTo(spreadsheet)
        .setName(uniqueSheetName_(
          spreadsheet,
          'Apuntes_respaldo_' + Utilities.formatDate(
            new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss'
          )
        ));

      sheet.clear();
    }

    sheet
      .getRange(1, 1, 1, APUNTES_HEADERS.length)
      .setValues([APUNTES_HEADERS]);
  }

  return sheet;
}

function formatApuntesSheet_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 2);

  sheet.setFrozenRows(1);

  sheet
    .getRange(1, 1, 1, APUNTES_HEADERS.length)
    .setBackground('#26395c')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  sheet.getRange(2, 3, lastRow - 1, 2).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(2, 8, lastRow - 1, 3).setNumberFormat('#,##0.0');
  sheet.getRange(2, 11, lastRow - 1, 1).setNumberFormat('0.0%');
  sheet.getRange(2, 18, lastRow - 1, 2).setNumberFormat('dd/MM/yyyy HH:mm');
  sheet.getRange(2, 12, lastRow - 1, 2).setWrap(true);

  const widths = [
    90, 90, 95, 95, 100, 210, 130, 100, 100, 100,
    110, 420, 420, 150, 100, 90, 210, 140, 140
  ];

  widths.forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}

/* =====================================================================
 * HOMOLOGACIÓN DE PROVEEDORES
 * ===================================================================== */

/* =====================================================================
 * HOMOLOGACIÓN: LA TABLA DE EQUIVALENCIAS
 *
 * SAP no escribe los nombres como los escribe el Plan. "INMOB FORESTAL E
 * INVER SAVI LTDA" y "SAVI" son el mismo proveedor, y el cruce difuso
 * acierta la mayoría de las veces pero no todas. Cuando falla, el nombre
 * de SAP entra como un proveedor nuevo: el mismo abastecedor aparece dos
 * veces, una con su plan y otra sin él, y los totales dejan de cuadrar.
 *
 * Antes eso solo se arreglaba editando specialProvider_ en el código.
 * Ahora hay una hoja que el comprador mantiene desde el tablero: cada
 * fila dice "este nombre de origen es este proveedor del Plan". Manda
 * sobre las reglas del código, porque es una decisión explícita de quien
 * conoce a los proveedores.
 *
 * Orden de resolución:
 *   1. Equivalencia guardada en la hoja   (decisión del comprador)
 *   2. Regla explícita del código          (specialProvider_)
 *   3. Coincidencia aproximada             (sobre el umbral)
 *   4. Nombre normalizado                  (queda sin homologar)
 * ===================================================================== */

/**
 * Equivalencias guardadas como { 'NOMBRE NORMALIZADO': 'Proveedor Plan' }.
 * Si la hoja no existe todavía, devuelve un mapa vacío: el tablero
 * funciona igual, solo que sin correcciones manuales.
 */
function readHomologacion_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_HOMOLOGACION);

  if (!sheet || sheet.getLastRow() < 2) {
    return { map: {}, rows: [] };
  }

  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, HOMOLOGACION_HEADERS.length)
    .getValues();

  const map = {};
  const rows = [];

  values.forEach(function(row) {
    const origin = text_(row[0]);
    const target = text_(row[1]);

    if (!origin || !target) { return; }

    map[normalizeKey_(origin)] = target;

    rows.push({
      origin: origin,
      target: target,
      source: text_(row[2]),
      notes: text_(row[3]),
      author: text_(row[4])
    });
  });

  return { map: map, rows: rows };
}

function ensureHomologacionSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_HOMOLOGACION);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_HOMOLOGACION);
  }

  sheet
    .getRange(1, 1, 1, HOMOLOGACION_HEADERS.length)
    .setValues([HOMOLOGACION_HEADERS])
    .setBackground('#153c27')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  sheet.setFrozenRows(1);

  [260, 200, 110, 300, 200, 150].forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });

  return sheet;
}

/**
 * Guarda equivalencias desde el tablero. Un mismo nombre de origen se
 * actualiza en su fila: la hoja no acumula versiones del mismo cruce.
 * Un destino vacío borra la equivalencia.
 */
function guardarEquivalencias(pairs) {
  if (!pairs || !pairs.length) {
    return { saved: 0, removed: 0 };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ensureHomologacionSheet_(spreadsheet);
    const author = getActiveUserLabel_();
    const now = new Date();

    const existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HOMOLOGACION_HEADERS.length)
          .getValues()
      : [];

    const rowOf = {};

    existing.forEach(function(row, index) {
      const key = normalizeKey_(row[0]);
      if (key) { rowOf[key] = index + 2; }
    });

    const appended = [];
    const dropRows = [];

    let saved = 0;
    let removed = 0;

    pairs.forEach(function(pair) {
      const origin = text_(pair && pair.origin);

      if (!origin) { return; }

      const key = normalizeKey_(origin);
      const target = text_(pair.target);

      // Sin destino se entiende como "olvida esta equivalencia".
      if (!target) {
        if (rowOf[key]) {
          dropRows.push(rowOf[key]);
          removed++;
        }
        return;
      }

      const values = [
        origin,
        target,
        text_(pair.source) || 'Tablero',
        text_(pair.notes),
        author,
        now
      ];

      if (rowOf[key]) {
        sheet
          .getRange(rowOf[key], 1, 1, HOMOLOGACION_HEADERS.length)
          .setValues([values]);
      } else {
        appended.push(values);
      }

      saved++;
    });

    if (appended.length) {
      sheet
        .getRange(
          sheet.getLastRow() + 1, 1,
          appended.length, HOMOLOGACION_HEADERS.length
        )
        .setValues(appended);
    }

    // De abajo hacia arriba: borrar de arriba correría las filas de abajo.
    dropRows.sort(function(a, b) { return b - a; })
      .forEach(function(row) { sheet.deleteRow(row); });

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 6, sheet.getLastRow() - 1, 1)
        .setNumberFormat('dd/MM/yyyy HH:mm');
    }

    return { saved: saved, removed: removed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Abre la hoja de equivalencias desde el menú, creándola si hace falta.
 */
function abrirHomologacion() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ensureHomologacionSheet_(spreadsheet);

  SpreadsheetApp.setActiveSheet(sheet);

  SpreadsheetApp.getUi().alert(
    'Equivalencias de proveedor\n\n' +
    'Cada fila dice que un nombre de origen (el de SAP o el del informe) ' +
    'es un proveedor del Plan.\n\n' +
    'Se puede escribir a mano acá, pero es más seguro hacerlo desde el ' +
    'tablero: pestaña Detalle, "Proveedores sin homologar". Ahí el nombre ' +
    'viene escrito tal cual llegó y no hay que copiarlo.'
  );
}

function resolveProvider_(rawName, context) {
  context = context || {};

  const raw = normalizeKey_(rawName);
  const predio = normalizeKey_(context.predio || '');
  const group = normalizeKey_(context.group || '');
  const rol = normalizeKey_(context.rol || '');

  // 1. La equivalencia que guardó el comprador manda sobre todo lo demás:
  // es una decisión explícita de quien conoce a los proveedores, y tiene
  // que poder corregir una regla del código que esté equivocada.
  const aliases = context.aliases || {};
  const alias = aliases[raw];

  if (alias) {
    return { provider: alias, method: 'Equivalencia guardada', score: 1 };
  }

  const special = specialProvider_(raw, predio, group, rol);

  if (special) {
    return { provider: special, method: 'Regla explícita', score: 1 };
  }

  const cleaned = providerComparable_(raw);
  const candidates = context.candidates || [];

  let best = null;

  candidates.forEach(function(candidate) {
    const score = providerSimilarity_(
      cleaned, providerComparable_(candidate)
    );

    if (!best || score > best.score) {
      best = { provider: candidate, score: score };
    }
  });

  if (best && best.score >= CONFIG.FUZZY_THRESHOLD) {
    return {
      provider: best.provider,
      method: 'Coincidencia aproximada',
      score: round_(best.score, 3)
    };
  }

  return {
    provider: cleaned || normalizeKey_(rawName) || 'SIN PROVEEDOR',
    method: 'Nombre normalizado',
    score: 0
  };
}

function specialProvider_(raw, predio, group, rol) {
  const text = [raw, predio, group, rol].join(' ');

  if (
    text.indexOf('CANCHA DE ACOPIO SAVI') !== -1 ||
    raw.indexOf('INMOB FORESTAL E INVER SAVI') !== -1 ||
    wholeWord_(text, 'SAVI')
  ) {
    return 'SAVI';
  }

  if (
    text.indexOf('EL CAPAO') !== -1 ||
    text.indexOf('DIGUAL') !== -1 ||
    wholeWord_(text, 'DIGUA')
  ) {
    return 'DIGUA';
  }

  if (text.indexOf('LLOHUE') !== -1) { return 'LLOHUE'; }
  if (text.indexOf('NAHUELTORO') !== -1) { return 'NAHUELTORO'; }
  if (text.indexOf('SAN FRANCISCO') !== -1) { return 'SAN FRANCISCO'; }
  if (text.indexOf('CHAPALES') !== -1) { return 'CHAPALES'; }
  if (text.indexOf('SAN ANTONIO') !== -1) { return 'SAN ANTONIO'; }
  if (text.indexOf('RANCHILLO') !== -1) { return 'RANCHILLO'; }

  if (
    text.indexOf('LA MONTANA') !== -1 ||
    text.indexOf('MONTANA') !== -1
  ) {
    return 'LA MONTAÑA';
  }

  if (raw.indexOf('PROMASA') !== -1) { return 'PROMASA'; }
  if (raw.indexOf('QUILODRAN') !== -1) { return 'QUILODRÁN'; }

  if (
    raw.indexOf('HECTOR MAURICIO SILVA') !== -1 ||
    raw.indexOf('HECTOR SILVA') !== -1 ||
    raw === 'H SILVA'
  ) {
    return 'H. SILVA';
  }

  if (
    raw.indexOf('HUGO BERNARDO ZENTENO') !== -1 ||
    raw === 'H ZENTENO'
  ) {
    return 'H. ZENTENO';
  }

  if (
    raw.indexOf('DOMINGO ALFONSO RODRIGUEZ') !== -1 ||
    raw === 'D RODRIGUEZ'
  ) {
    return 'D. RODRIGUEZ';
  }

  if (raw.indexOf('ALSAL') !== -1) { return 'ALSAL'; }
  if (raw.indexOf('SOFOTRANS') !== -1) { return 'SOFOTRANS'; }
  if (raw.indexOf('LOS SAUCES') !== -1) { return 'LOS SAUCES'; }
  if (raw.indexOf('EL MANZANO') !== -1) { return 'EL MANZANO'; }
  if (raw.indexOf('LOS TRONCO') !== -1) { return 'LOS TRONCOS'; }
  if (raw.indexOf('SERGESAL') !== -1) { return 'SERGESAL'; }

  if (
    raw.indexOf('CHILE VERDE') !== -1 ||
    raw.indexOf('CRISTIAN ARANEDA') !== -1 ||
    raw.indexOf('C ARANEDA') !== -1
  ) {
    return 'C. ARANEDA (FORESTAL CHILE VERDE)';
  }

  if (raw.indexOf('FORESTAL COLLICURA') !== -1) {
    return 'FORESTAL COLLICURA';
  }

  return '';
}

function providerComparable_(value) {
  const stopWords = {
    SA: true, SPA: true, LTDA: true, LIMITADA: true, CIA: true,
    COMPANIA: true, SOCIEDAD: true, EMPRESA: true, EMPRESAS: true,
    SERV: true, SERVICIO: true, SERVICIOS: true, AGRICOLA: true,
    FORESTAL: true, COMERCIAL: true, INMOBILIARIA: true,
    INVERSIONES: true, E: true, Y: true, DE: true, DEL: true,
    LA: true, EL: true
  };

  return normalizeKey_(value)
    .split(' ')
    .filter(function(token) {
      return token && !stopWords[token];
    })
    .join(' ')
    .trim();
}

function providerSimilarity_(a, b) {
  if (!a || !b) { return 0; }
  if (a === b) { return 1; }

  const tokensA = uniqueTokens_(a);
  const tokensB = uniqueTokens_(b);

  const intersection = tokensA.filter(function(token) {
    return tokensB.indexOf(token) !== -1;
  }).length;

  const union = uniqueTokens_(tokensA.concat(tokensB).join(' ')).length;
  const jaccard = union ? intersection / union : 0;
  const edit = 1 - levenshtein_(a, b) / Math.max(a.length, b.length);

  return Math.max(jaccard, 0.55 * jaccard + 0.45 * edit);
}

function levenshtein_(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Proveedores que llegaron con material pero no tienen fila en Plan.
 *
 * Ya no es solo una lista de nombres: trae con cuánto volumen entra cada
 * uno, cuántas filas lo traen, el nombre tal cual vino del origen y el
 * mejor candidato del Plan con su puntaje. Con eso el tablero puede
 * ofrecer la equivalencia hecha y que el comprador solo confirme, en vez
 * de mostrarle el problema y dejarlo solo.
 */
function buildUnmatchedProviders_(planRows, dataRows, planCandidates) {
  const planMap = {};

  planRows.forEach(function(item) {
    planMap[item.provider] = true;
  });

  const buckets = {};

  dataRows.forEach(function(item) {
    if (planMap[item.provider]) { return; }

    let bucket = buckets[item.provider];

    if (!bucket) {
      bucket = buckets[item.provider] = {
        provider: item.provider,
        rawNames: {},
        rows: 0,
        amount: 0,
        sources: {},
        predios: {},
        roles: {}
      };
    }

    bucket.rows++;
    bucket.amount += Number(item.cantidad) || 0;
    bucket.sources[item.source] = true;

    if (item.providerRaw) { bucket.rawNames[item.providerRaw] = true; }
    if (item.predio) { bucket.predios[item.predio] = true; }
    if (item.rol) { bucket.roles[item.rol] = true; }
  });

  const candidates = planCandidates || [];

  return Object.keys(buckets)
    .map(function(key) {
      const bucket = buckets[key];
      const rawNames = Object.keys(bucket.rawNames).sort();

      // El mejor candidato del Plan para el nombre tal cual llegó.
      const probe = providerComparable_(
        normalizeKey_(rawNames[0] || bucket.provider)
      );

      let best = null;

      candidates.forEach(function(candidate) {
        const score = providerSimilarity_(
          probe, providerComparable_(candidate)
        );

        if (!best || score > best.score) {
          best = { provider: candidate, score: round_(score, 3) };
        }
      });

      return {
        provider: bucket.provider,
        rawNames: rawNames,
        // El nombre que hay que guardar como equivalencia es el de origen.
        origin: rawNames[0] || bucket.provider,
        rows: bucket.rows,
        amount: round_(bucket.amount, 2),
        sources: Object.keys(bucket.sources).sort(),
        predios: Object.keys(bucket.predios).sort().slice(0, 4),
        roles: Object.keys(bucket.roles).sort().slice(0, 4),
        suggestion: best ? best.provider : '',
        suggestionScore: best ? best.score : 0
      };
    })
    .sort(function(a, b) { return b.amount - a.amount; });
}

/**
 * Proveedores homologados que se parecen demasiado entre sí. Si dos filas
 * del cruce son en realidad el mismo abastecedor, el plan se reparte entre
 * las dos y ninguna cumple. Solo avisa: unirlos es decisión del comprador,
 * y se hace guardando una equivalencia.
 */
function findSimilarProviders_(providers) {
  const UMBRAL = 0.80;
  const pairs = [];

  const prepared = providers.map(function(provider) {
    return { provider: provider, key: providerComparable_(normalizeKey_(provider)) };
  });

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (!prepared[i].key || !prepared[j].key) { continue; }

      const score = providerSimilarity_(prepared[i].key, prepared[j].key);

      if (score >= UMBRAL) {
        pairs.push({
          a: prepared[i].provider,
          b: prepared[j].provider,
          score: round_(score, 3)
        });
      }
    }
  }

  return pairs.sort(function(x, y) { return y.score - x.score; });
}

/**
 * Filas de Ingresos idénticas en todo lo que las identifica. Un mismo
 * despacho cargado dos veces —el export de SAP pegado de nuevo— duplica
 * el volumen sin que nada lo delate. No se borra nada: se cuenta y se
 * avisa, porque dos guías distintas pueden coincidir legítimamente en
 * todos estos campos y solo el comprador sabe cuál es cuál.
 */
function findDuplicateRows_(rows) {
  const seen = {};
  const groups = [];

  rows.forEach(function(item) {
    if (item.source !== 'INGRESOS') { return; }

    const key = [
      item.fecha,
      normalizeKey_(item.providerRaw || item.provider),
      normalizeKey_(item.material),
      normalizeKey_(item.predio),
      normalizeKey_(item.rol),
      round_(Number(item.cantidad) || 0, 3)
    ].join('|');

    if (!seen[key]) {
      seen[key] = { count: 0, item: item };
      return;
    }

    seen[key].count++;
  });

  Object.keys(seen).forEach(function(key) {
    const entry = seen[key];

    if (!entry.count) { return; }

    groups.push({
      fecha: entry.item.fecha,
      fechaLabel: entry.item.fechaLabel,
      provider: entry.item.provider,
      material: entry.item.descripcion || entry.item.material,
      predio: entry.item.predio,
      cantidad: round_(Number(entry.item.cantidad) || 0, 2),
      // Veces que aparece la fila en total, contando la primera.
      veces: entry.count + 1,
      // Lo que se contaría de más si las repeticiones fueran cargas
      // duplicadas: todas menos la primera.
      exceso: round_((Number(entry.item.cantidad) || 0) * entry.count, 2)
    });
  });

  return groups.sort(function(a, b) { return b.exceso - a.exceso; });
}

function diagnosticarCruceProveedores() {
  const data = getDashboardData();

  const lines = [
    'Diagnóstico de proveedores',
    '',
    'Mes: ' + data.month.label,
    'Días hábiles: ' + data.workdays.elapsed + ' de ' + data.workdays.total +
      ' (al ' + data.workdays.referenceDateLabel + ')',
    'Feriados descontados: ' + (
      (data.workdays.discounted || []).length
        ? data.workdays.discounted.map(function(item) {
            return formatDateKey_(item.key) + ' (' + item.reason + ')';
          }).join(', ')
        : 'ninguno'
    ),
    'Proveedores en Plan: ' + data.source.planProviders,
    'Filas reales: ' + data.source.actualRows,
    'Filas complemento Gmail: ' + data.source.supplementRows,
    'Última fecha real: ' + data.source.lastActualDateLabel,
    'Último informe: ' + data.source.latestReportDateLabel,
    '',
    'Equivalencias guardadas: ' + data.source.aliasCount,
    'Filas repetidas en Ingresos: ' + (
      data.source.duplicateRows.length
        ? data.source.duplicateRows.length + ' (' +
          fmtNumber_(data.source.duplicateRows.reduce(function(total, item) {
            return total + item.exceso;
          }, 0)) + ' MR de más si son cargas repetidas)'
        : 'ninguna'
    ),
    'Proveedores parecidos entre sí: ' + (
      data.source.similarProviders.length
        ? data.source.similarProviders.map(function(pair) {
            return pair.a + ' ≈ ' + pair.b;
          }).join(', ')
        : 'ninguno'
    ),
    '',
    'Sin coincidencia en Plan:'
  ];

  if (data.source.unmatchedProviders.length) {
    data.source.unmatchedProviders.forEach(function(item) {
      lines.push(
        '- ' + item.provider + '  (' + fmtNumber_(item.amount) + ' MR' +
        (item.suggestion
          ? ', parecido a ' + item.suggestion +
            ' ' + Math.round(item.suggestionScore * 100) + '%'
          : '') +
        ')'
      );
    });
  } else {
    lines.push('Ninguno');
  }

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

/* =====================================================================
 * FECHAS Y UTILIDADES
 * ===================================================================== */

const MONTH_NAMES = Object.freeze([
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
]);

function monthLabel_(prefix) {
  const parts = String(prefix).split('-');
  return MONTH_NAMES[Number(parts[1])] + ' de ' + parts[0];
}

function buildMonthWindow_(prefix) {
  const parts = String(prefix).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    prefix: prefix,
    year: year,
    month: month,
    startKey: buildDateKey_(year, month, 1),
    endKey: buildDateKey_(year, month, lastDay),
    label: monthLabel_(prefix)
  };
}

function toDateKey_(rawValue, displayValue, timezone) {
  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    return Utilities.formatDate(
      rawValue, timezone || CONFIG.TIMEZONE, 'yyyy-MM-dd'
    );
  }

  const displayed = parseDateText_(displayValue);

  if (displayed) {
    return displayed;
  }

  const rawText = parseDateText_(rawValue);

  if (rawText) {
    return rawText;
  }

  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    const date = new Date(
      Date.UTC(1899, 11, 30) + Math.round(rawValue * 86400000)
    );

    return buildDateKey_(
      date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()
    );
  }

  return '';
}

function parseDateText_(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);

  if (match) {
    return buildDateKey_(
      Number(match[1]), Number(match[2]), Number(match[3])
    );
  }

  match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\s.*)?$/);

  if (match) {
    return buildDateKey_(
      Number(match[3]), Number(match[2]), Number(match[1])
    );
  }

  return '';
}

function extractSpanishDateKey_(value) {
  const text = normalizeKey_(value);

  let match = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);

  if (match) {
    return buildDateKey_(
      Number(match[3]), Number(match[2]), Number(match[1])
    );
  }

  match = text.match(/\b(\d{1,2})\s+(?:DE\s+)?([A-Z]+)\s+(?:DE\s+)?(\d{4})\b/);

  if (!match) {
    return '';
  }

  const months = {
    ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
    JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9,
    OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12
  };

  return months[match[2]]
    ? buildDateKey_(Number(match[3]), months[match[2]], Number(match[1]))
    : '';
}

function buildDateKey_(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function dateKeyToLocalDate_(dateKey) {
  const parts = String(dateKey).split('-');

  return new Date(
    Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])
  );
}

function addDaysToDateKey_(dateKey, days) {
  const parts = String(dateKey).split('-');

  const date = new Date(Date.UTC(
    Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days
  ));

  return buildDateKey_(
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()
  );
}

function formatDateKey_(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

  return match
    ? [match[3], match[2], match[1]].join('/')
    : 'Sin fecha';
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim()
    .replace(/\s+/g, ' ');
}

function toNumber_(rawValue, displayValue) {
  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    return rawValue;
  }

  let value = String(
    displayValue !== null &&
    displayValue !== undefined &&
    displayValue !== ''
      ? displayValue
      : rawValue || ''
  ).trim().replace(/\s/g, '');

  if (!value) {
    return 0;
  }

  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+,\d+$/.test(value)) {
    value = value.replace(',', '.');
  } else {
    value = value.replace(/,/g, '');
  }

  const number = Number(value);

  return isFinite(number) ? number : 0;
}

function toNullableNumber_(rawValue, displayValue) {
  const text = String(
    displayValue !== null &&
    displayValue !== undefined &&
    displayValue !== ''
      ? displayValue
      : rawValue || ''
  ).trim();

  return text ? toNumber_(rawValue, displayValue) : null;
}

function parseOptionalNumber_(value) {
  const text = String(value || '')
    .replace(/\s/g, '')
    .replace(/[^\d,.\-]/g, '');

  if (!text || !/\d/.test(text)) {
    return null;
  }

  const number = toNumber_(text, text);

  return isFinite(number) ? number : null;
}

function uniqueSorted_(values) {
  const found = {};
  const output = [];

  values.forEach(function(value) {
    const display = text_(value);

    if (!display) {
      return;
    }

    const key = normalizeKey_(display);

    if (!found[key]) {
      found[key] = true;
      output.push(display);
    }
  });

  return output.sort(function(a, b) {
    return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  });
}

function uniqueTokens_(value) {
  return uniqueSorted_(String(value || '').split(' ').filter(Boolean));
}

function wholeWord_(text, word) {
  return new RegExp(
    '(^|\\s)' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)'
  ).test(text);
}

function containsNumber_(value) {
  return /\d/.test(String(value || ''));
}

function isStatus_(value) {
  return /^(VERDE|ROJO|AMARILLO|NARANJO|NARANJA)$/i.test(
    String(value || '').trim()
  );
}

function joinUnique_(current, next) {
  const values = String(current || '')
    .split(' / ')
    .concat(String(next || '').split(' / '))
    .map(function(item) { return item.trim(); })
    .filter(Boolean);

  return uniqueSorted_(values).join(' / ');
}

/** Cifra con separador de miles, para los avisos del menú. */
function fmtNumber_(value) {
  const number = Math.round(Number(value) || 0);

  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function round_(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function decodeHtmlEntities_(text) {
  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'",
    '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í',
    '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ',
    '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í',
    '&Oacute;': 'Ó', '&Uacute;': 'Ú', '&Ntilde;': 'Ñ'
  };

  let result = String(text || '');

  Object.keys(entities).forEach(function(entity) {
    result = result.split(entity).join(entities[entity]);
  });

  return result.replace(/&#(\d+);/g, function(match, code) {
    return String.fromCharCode(Number(code));
  });
}
