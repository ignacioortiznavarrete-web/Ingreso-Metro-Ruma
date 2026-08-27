# MetroRuma · Control de abastecimiento

Tablero de Google Apps Script que cruza el **plan mensual de compra** con los
**ingresos reales** y el **complemento diario que llega por Gmail**, y deja la
bitácora semanal del comprador escrita en la misma planilla.

Planilla: `1wNCovRpMc7EpZFwk4UeIadTjueLUNf5Ien-gwJ0jPhQ`

---

## Qué hay en cada archivo

| Archivo | Qué es |
|---|---|
| `apps-script/Codigo.gs` | Backend: lee `Plan`, `Ingresos` e `Informegmail`, importa los correos y guarda los apuntes. |
| `apps-script/Index.html` | Estructura del tablero. Incluye los otros dos con `include()`. |
| `apps-script/Estilos.html` | Sistema visual completo (tokens, componentes, movimiento, impresión). |
| `apps-script/Panel.html` | Analítica, gráficos SVG propios y la bitácora semanal. |
| `apps-script/appsscript.json` | Manifiesto: zona horaria, permisos y publicación web. |
| `preview/build.mjs` | Arma una copia autónoma con datos simulados para revisar en el navegador. |

## Cómo instalarlo

1. Abre la planilla → **Extensiones › Apps Script**.
2. Crea o reemplaza estos archivos con el mismo nombre:
   - `Codigo.gs` (archivo de script)
   - `Index`, `Estilos` y `Panel` (archivos **HTML**; Apps Script agrega el
     `.html` solo)
3. En **Configuración del proyecto**, marca *Mostrar el archivo de manifiesto*
   y pega `appsscript.json`.
4. Guarda, recarga la planilla y usa el menú **MetroRuma Dashboard › Abrir
   dashboard**. La primera vez pedirá autorización.

Los tres archivos HTML son obligatorios: `Index` los une con
`<?!= include('Estilos') ?>` y `<?!= include('Panel') ?>`.

## Cómo revisarlo sin desplegar

```bash
node preview/build.mjs          # genera preview/out/index.html con datos simulados
```

Abre `preview/out/index.html` en el navegador. Trae un `google.script.run`
simulado, así que se puede navegar, generar apuntes y guardarlos en memoria
sin tocar la planilla.

---

## Las cuatro vistas

**Panorama.** La ruma del mes (el plan como regla graduada, el avance apilado
por día hábil, la proyección en silueta), el tablero de mediciones, la lista
de ataque, la curva de avance y la recepción diaria.

**Proveedores.** Desvío contra el plan a la fecha, concentración de la brecha
(Pareto) y el cruce mensual completo. Al hacer clic en una fila se abre la
ficha del proveedor con su historia semanal y sus últimos apuntes.

**Semana.** El mapa de cumplimiento por proveedor y semana, y la bitácora: al
entrar, el tablero ya trae redactado un diagnóstico y un plan de acción por
proveedor con los números de la semana. Se corrigen y se guardan en la hoja
`Apuntes`.

**Detalle.** Salud de los datos, proveedores sin fila en Plan y la auditoría
fila por fila.

## Análisis que se agregó

Además del cruce plan/real que ya existía:

- **MR en riesgo** por proveedor: lo que se pierde del plan si mantiene su
  ritmo actual. La lista de ataque se ordena por esto y no por porcentaje,
  porque un 15% de brecha en un proveedor de 4.000 MR pesa más que un 50% en
  uno de 200 MR.
- **Ritmo exigido y esfuerzo**: cuántos MR/día hábil se necesitan para cerrar
  y cuántas veces es eso el ritmo actual.
- **Días hábiles sin recibir**: detecta al proveedor que se detuvo antes de
  que el mes lo muestre.
- **Concentración de la brecha**: cuántos proveedores explican el 80% de lo
  que falta.
- **Regularidad**: si un proveedor entrega parejo o a golpes.
- **Corredor de ±5%** en la curva, media móvil de 5 días hábiles en la
  recepción diaria y **ritmo exigido** dibujado contra la proyección.
- **Selector de mes**: la hoja `Plan` puede consultarse en cualquiera de sus
  columnas mensuales, no solo el mes vigente.

## Bitácora semanal (hoja `Apuntes`)

Se crea sola la primera vez que guardas. Una fila por apunte:

`ID · Semana · Inicio · Fin · Ámbito · Proveedor · Clasificación · Plan semana ·
Recibido · Desvío · Cumplimiento · Diagnóstico · Plan de acción · Responsable ·
Estado · Prioridad · Autor · Creado · Actualizado`

La clasificación sale del cumplimiento contra el plan de la semana,
prorrateado por los días hábiles ya corridos (una semana en curso no se
castiga por los días que le faltan):

| Cumplimiento | Clasificación |
|---|---|
| ≥ 115% | Sobre stock |
| 95% – 115% | En línea |
| 80% – 95% | Bajo stock |
| < 80% | Bajo stock crítico |

Los borradores son eso: un punto de partida con los números ya calculados. El
comprador los corrige antes de guardar.

## Cambios en el backend

- **Feriados de Chile.** `CONFIG.USAR_FERIADOS_CHILE` viene en `true` y
  descuenta los feriados legales del prorrateo (lista `FERIADOS_CHILE`, hasta
  2027). Antes solo se excluían sábados y domingos, así que el 18 de
  septiembre contaba como día hábil y el plan a la fecha salía inflado.
  **Esto cambia el "plan a la fecha" respecto de la versión anterior**; para
  volver al comportamiento previo, ponlo en `false`.
- `getDashboardData(monthPrefix)` acepta un mes y devuelve `availableMonths`.
- Corregido: `parseOptionalNumber_` devolvía `null` para celdas vacías y
  `isFinite(null)` es `true`, así que las filas de Gmail sin CUMPLIMIENTO
  entraban como cero en vez de descartarse.
- La tabla del correo ahora detecta la columna de proveedor por su
  encabezado en vez de asumir la primera.
- `readPlan_` leía el rango completo dos veces; `readIngresos_` memoiza el
  cruce difuso por proveedor+predio+rol.
- En un mes ya cerrado la fecha de referencia es el último día del mes.
- `guardarApuntes` / `eliminarApunte` con bloqueo de script y respaldo
  automático si el esquema de la hoja cambió.

## Decisiones de diseño

**El verde no es color de marca.** En esta operación el verde es un *dato*: el
estatus VERDE del informe y el proveedor sobre plan. Usarlo también como color
corporativo hacía ilegible el semáforo. La marca es el azul acero de la
maquinaria y del libro de pesaje; el naranja de alta visibilidad —el mismo de
la pintura en la cabeza de los trozos— marca solo lo que exige acción.

**La escala de desempeño es divergente**, del azul (sobre plan) al rojo (bajo
plan crítico), con el naranja como aviso. Es la codificación que un comprador
necesita: por encima o por debajo, y cuánto.

**Un solo instrumento en vez de doce tarjetas.** Las mediciones viven en una
superficie dividida por filetes de 1px. La ruma es el elemento firma: el plan
del mes como regla graduada y el avance apilado día a día, sólido cuando viene
de Ingresos y rayado cuando viene del complemento, para que la procedencia del
dato se vea sin leer una leyenda.

**Tipografía.** Archivo variable (se usa el eje de ancho: condensado en
encabezados de tabla y etiquetas, expandido en títulos) y JetBrains Mono para
todas las cifras, con numeración tabular para que las columnas no bailen.

**Movimiento.** Los estratos de la ruma suben escalonados como se apila una
ruma de verdad; las barras crecen desde su base; las líneas se dibujan. Todo
con curvas de salida exponenciales, sin rebote, y con `prefers-reduced-motion`
respetado: el estado final es siempre el estado por defecto, así que si la
animación no corre igual se ve todo.

**Sin dependencias externas.** Los gráficos son SVG propios: se eliminó Google
Charts. Solo quedan las dos familias tipográficas de Google Fonts.
