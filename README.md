# MetroRuma · Control de abastecimiento

Tablero de Google Apps Script que cruza el **plan mensual de compra** con los
**ingresos reales** y el **complemento diario que llega por Gmail**, y deja la
bitácora semanal del comprador escrita en la misma planilla.

Planilla: `1wNCovRpMc7EpZFwk4UeIadTjueLUNf5Ien-gwJ0jPhQ`

---

## Qué hay en cada archivo

| Archivo | Qué es | Líneas |
|---|---|---|
| `apps-script/Codigo.gs` | Backend: calendario de días hábiles, lee `Plan`, `Ingresos` e `Informegmail`, importa los correos y guarda los apuntes. | ~2.690 |
| `apps-script/Index.html` | Estructura del tablero. Une los demás con `include()`. | ~750 |
| `apps-script/Estilos.html` | Sistema visual: tokens, componentes, movimiento e impresión. | ~1.890 |
| `apps-script/Base.html` | Estado compartido, navegación, carga, preferencias y formato. | ~700 |
| `apps-script/Analisis.html` | Todas las métricas: proveedor, día, semana y origen del suministro. | ~805 |
| `apps-script/Graficos.html` | Motor SVG propio: ruma, calendario, curva, diario, desvío, Pareto, mix, frentes, semáforo, matriz y sparkline. | ~1.720 |
| `apps-script/Tablero.html` | Panorama, proveedores, forestal, detalle y la ficha lateral. | ~1.230 |
| `apps-script/Bitacora.html` | Mapa semanal, apuntes e informe de la semana. | ~970 |
| `apps-script/appsscript.json` | Manifiesto: zona horaria, permisos y publicación web. | |
| `preview/build.mjs` | Arma una copia autónoma con datos simulados para el navegador. | |
| `preview/pruebas.mjs` | 64 comprobaciones de interacción sobre la copia autónoma. | |
| `preview/shot.mjs` | Captura las vistas para revisar el diseño. | |

El frontend está partido por responsabilidad, no por tamaño: cada archivo se
puede leer entero sin tener el resto en la cabeza. En Apps Script todos
comparten el mismo ámbito global, así que el orden de carga no importa.

## Cómo instalarlo

1. Abre la planilla → **Extensiones › Apps Script**.
2. Crea o reemplaza estos archivos con el mismo nombre:
   - `Codigo.gs` (archivo de script)
   - `Index`, `Estilos`, `Base`, `Analisis`, `Graficos`, `Tablero` y
     `Bitacora` (archivos **HTML**; Apps Script agrega el `.html` solo)
3. En **Configuración del proyecto**, marca *Mostrar el archivo de manifiesto*
   y pega `appsscript.json`.
4. Guarda, recarga la planilla y usa el menú **MetroRuma Dashboard › Abrir
   dashboard**. La primera vez pedirá autorización.

Los siete archivos HTML son obligatorios: `Index` los une con
`<?!= include('Estilos') ?>` y un `include()` por cada módulo.

## Cómo revisarlo sin desplegar

```bash
node preview/build.mjs          # genera preview/out/index.html con datos simulados
node preview/pruebas.mjs        # 64 comprobaciones de interacción sobre Chromium
node preview/shot.mjs           # captura las cinco vistas, la impresión y el móvil
```

Las pruebas y las capturas necesitan Playwright (`npm i playwright`).
`node preview/pruebas.mjs` arma su propia copia con fecha fija (25/09/2026),
así que no depende de cuándo se corrió `build.mjs`. Se eligió septiembre a
propósito: es el mes con feriado en día hábil. Si la versión de Playwright no
coincide con el Chromium instalado, `CHROME_PATH=/ruta/a/chrome` fuerza el
binario.

Abre `preview/out/index.html` en el navegador. Trae un `google.script.run`
simulado, así que se puede navegar, generar apuntes y guardarlos en memoria
sin tocar la planilla.

## Atajos

| Tecla | Qué hace |
|---|---|
| `1` `2` `3` `4` `5` | Cambia de vista |
| `/` | Abre los filtros y va a la búsqueda |
| `Esc` | Cierra la ficha del proveedor |

Los atajos no se disparan mientras se escribe un apunte.

---

## Las cinco vistas

**Panorama.** La ruma del mes (el plan como regla graduada, el avance apilado
por día hábil, la proyección en silueta), el tablero de mediciones, la lista
de ataque, **el calendario de días hábiles**, la curva de avance y la
recepción diaria.

**Proveedores.** Desvío contra el plan a la fecha, concentración de la brecha
(Pareto) y el cruce mensual completo. Al hacer clic en una fila se abre la
ficha del proveedor con su historia semanal y sus últimos apuntes.

**Forestal.** De dónde viene el metro ruma y qué tan frágil es esa fuente:
la matriz riesgo/esfuerzo, el semáforo que el proveedor se pone en su propio
informe, el mix por producto, los frentes de cosecha y la tabla de decisión de
compra. Está aparte del panorama porque responde otra pregunta: el panorama
dice *cuánto falta*, forestal dice *a quién llamar y por qué*.

**Semana.** El mapa de cumplimiento por proveedor y semana, y la bitácora: al
entrar, el tablero ya trae redactado un diagnóstico y un plan de acción por
proveedor con los números de la semana. Se corrigen y se guardan en la hoja
`Apuntes`. Desde aquí sale el **informe semanal**: se copia como texto para
mandarlo por correo o se imprime a PDF con los apuntes abiertos.

**Detalle.** Salud de los datos, proveedores sin fila en Plan y la auditoría
fila por fila, ordenable por cualquier columna y copiable a una planilla.

### Del análisis a la acción

La lista de ataque y la ficha del proveedor tienen un botón **Escribir
apunte** que salta a la bitácora, abre el apunte de ese proveedor y deja el
cursor en el plan de acción. No hay que buscarlo a mano.

### Nada se guarda solo

Un apunte tocado queda marcado en naranja y aparece un contador de pendientes
junto a *Guardar la semana*. Si intentas cambiar de semana, de mes, de vista o
recargar con cambios sin guardar, el tablero pregunta antes de descartarlos.

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
- **Tendencia semanal** en la tabla de proveedores: una casilla por semana con
  el color de su cumplimiento, para separar al que falla siempre del que falló
  una vez.

### Análisis forestal: de dónde viene el metro ruma

El cruce plan/real dice si llega el volumen. Esto dice de dónde llega y qué tan
frágil es, que es lo que decide una compra. Sale todo de columnas que la
planilla ya traía y nadie estaba mirando: `Material`, `Descripción`, `Predio`,
`Rol` y el `Estatus` del informe.

- **Matriz riesgo / esfuerzo.** Cada proveedor en dos ejes: los MR que se
  pierden si nada cambia, y cuántas veces su ritmo actual habría que exigir
  para cerrar. El tamaño es su plan del mes. Separa las cuatro decisiones
  reales: cierra solo, con un llamado llega, hay que empujar el programa, o no
  llega y ese volumen se busca en otra parte.
- **Semáforo declarado.** El estatus que el proveedor se pone en su propio
  informe diario. Es un indicador adelantado: se declara en rojo antes de que
  deje de llegar el camión.
- **Mix por producto.** Qué se está comprando, no solo cuánto. Una sola línea
  concentrando el mes es un riesgo de precio y de destino.
- **Frentes de cosecha.** Predios que movieron material. Cada predio es un
  frente: si bajan los frentes activos, el mes se cae aunque el volumen
  todavía no lo muestre. Un frente se marca detenido cuando lleva más del
  **doble de su propia cadencia** sin entregar, no a los tres días fijos: un
  predio que entrega cada cuatro días no está detenido al cuarto, y con el
  umbral fijo salían casi todos en naranja y el dato no decía nada.
- **Autonomía del mes.** Los días hábiles que quedan divididos por los que
  tomaría cerrar la brecha al ritmo actual. Bajo 1× el mes no cierra sin
  cambiar algo.
- **Concentración.** Cuántos nombres hacen el 80% del suministro, más el
  Herfindahl normalizado para comparar un mes con otro.
- **Sin desglose.** Qué parte del volumen llega por el informe diario, que no
  trae material ni predio. Es la ceguera del mes, y conviene tenerla a la
  vista: el mix y los frentes solo pueden desglosar lo que viene de `Ingresos`.

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

## Días hábiles: por qué septiembre salía mal

Todo el tablero cuelga de un número: cuántos días hábiles tiene el mes y
cuántos van corridos. El "plan a la fecha", el desvío, la proyección y la
clasificación de la bitácora son todos ese número multiplicado por algo. Si
sobra un día, el plan a la fecha sale inflado y el mes parece peor de lo que
está.

Septiembre es el mes donde eso duele: el 18 y el 19 son feriados y caen en
distinto día de la semana cada año.

**Los feriados ahora se calculan, no se escriben a mano.** Había una lista fija
que llegaba hasta 2027 y traía dos errores (el 17 de septiembre de 2027 como
feriado, que no lo es, y el 19 de septiembre de 2027 ausente). Peor que los
errores: al pasar 2027 la lista se vacía sin avisar y el 18 de septiembre
vuelve a contar como día hábil, que es exactamente el problema que la lista
venía a resolver. Ahora cada regla está en el código:

| Regla | Qué hace |
|---|---|
| Fijos | 1-ene, 1-may, 21-may, 16-jul, 15-ago, 18 y 19-sep, 1-nov, 8-dic, 25-dic |
| Semana Santa | Viernes y Sábado Santo, desde la Pascua (algoritmo gregoriano) |
| Ley 21.357 | Pueblos Indígenas, el día del solsticio de junio en hora de Chile |
| Ley 19.668 | 29-jun y 12-oct se corren al lunes si caen martes, miércoles o jueves; al lunes siguiente si caen viernes |
| Ley 20.299 | 31-oct se corre al viernes anterior si cae martes; al siguiente si cae miércoles |
| **Ley 20.215** | **Feriado puente de Fiestas Patrias: el 17 cuando el 18 cae martes, y el 20 cuando el 19 cae miércoles** |

El puente de la Ley 20.215 no estaba contemplado de ninguna forma. En **2029**
se juntan los cuatro: 17, 18, 19 y 20 de septiembre. Ese mes tiene **16 días
hábiles, no 20**; con la lista anterior el plan a la fecha habría salido un 25%
inflado todo el mes.

Septiembre queda así:

| Año | Días hábiles | Descontados |
|---|---|---|
| 2025 | 20 | 18 (jueves) y 19 (viernes) |
| 2026 | 21 | 18 (viernes); el 19 cae sábado y no descuenta nada |
| 2027 | 22 | ninguno: el 18 cae sábado y el 19 domingo |
| 2029 | 16 | 17, 18, 19 y 20, con el puente de la Ley 20.215 |

Un feriado que cae sábado o domingo ya no se cuenta como "descontado": no
quitaba ningún día hábil y solo confundía el mensaje del tablero.

**Dos ajustes para la operación real**, porque el calendario legal no es el
calendario de la faena:

- `CONFIG.FERIADOS` — días sin recepción propios: parada de planta, cierre de
  camino, la semana de Fiestas Patrias completa. Se descuentan igual que un
  feriado legal. Ejemplo: `['2026-09-17']` para no contar el jueves previo al 18.
- `CONFIG.DIAS_HABILES_EXTRA` — días que sí se trabajaron aunque el calendario
  los excluya: un sábado de recuperación, un feriado con turno. Manda sobre
  todo lo demás y el calendario los marca como *recuperados*.

**El conteo se puede revisar sin abrir el código.** La vista Panorama trae el
calendario del mes: cada día con su motivo, el feriado tachado con su nombre,
el día recuperado marcado y un recuadro en la fecha de corte. Es la forma de
comprobar el prorrateo de un vistazo en vez de confiar en él.

`CONFIG.USAR_FERIADOS_CHILE` sigue existiendo: en `false` vuelve a contar solo
lunes a viernes.

## Cambios en el backend

- `getDashboardData(monthPrefix)` acepta un mes y devuelve `availableMonths`.
- `workdays` trae ahora `calendar` (un registro por día del mes con su tipo y
  motivo) y `discounted` (los feriados que sí quitaron un día hábil, con su
  nombre).
- Las filas del complemento Gmail arrastran `programaMr`: el programa que el
  proveedor comprometió en su informe, para poder medirlo contra lo que
  entregó y no solo contra el plan.
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

**La marca es verde bosque oscuro, y el verde también es un dato.** Las dos
cosas a la vez, que es el problema a resolver. El estatus VERDE del informe y
el proveedor sobre plan son verdes que significan algo; si la marca usa el
mismo verde, el semáforo deja de leerse. Se separan por **saturación**, no por
tono:

| | Croma | Papel |
|---|---|---|
| Marca (estructura) | 0,058 | verde bosque apagado: riel, cifras, estratos de la ruma |
| Semáforo (señal) | 0,140 | verde pasto saturado: el estatus que declara el proveedor |

2,6 veces de diferencia en saturación es lo que hace que una sea superficie y
la otra aviso. Y el semáforo nunca se identifica solo por color: siempre lleva
su palabra al lado ("Verde", "Rojo") o su leyenda.

Esta versión partió del azul acero por ese riesgo. El verde oscuro es una
decisión posterior del comprador, y se sostiene: el par verde bosque + naranja
de alta visibilidad es el de la faena —el chaleco, la pintura en la cabeza del
trozo— y no el de un tablero corporativo cualquiera. Los neutros llevan un
asomo del mismo verde (croma 0,005 a 0,017) para que el gris no pelee con la
marca; nada de la banda cálida donde vive el beige de moda.

**La escala de desempeño es divergente**, del verde (sobre plan) al rojo (bajo
plan crítico), con el naranja como aviso. Con la marca en verde la rampa quedó
en el orden que un comprador ya espera leer, que antes había que aprender.

**El aviso informativo es neutro, no verde.** Explica de dónde sale el dato, no
da un visto bueno. Teñirlo de marca lo hacía leer como aprobación.

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

## Accesibilidad y robustez

- Todos los pares de color pasan 4,5:1, medido sobre cada nodo de texto de
  las cinco vistas y no sobre una muestra (el gris apagado da 5,71:1 sobre el
  panel y 4,73:1 sobre la superficie hundida, que es el par más justo).
- La ficha lateral es un diálogo modal de verdad: atrapa el tabulador, se
  cierra con `Esc` y devuelve el foco al botón que la abrió.
- Los nombres de proveedor son botones, no filas de tabla: se llega con el
  teclado.
- `prefers-reduced-motion` respetado. El estado final de cada animación es el
  estado por defecto, así que si el movimiento no corre igual se ve todo.
- El tablero recuerda la última vista y los filtros. Si el navegador bloquea
  el almacenamiento dentro del recuadro de Apps Script, sigue funcionando.
- Un error del servidor muestra la causa probable y un botón de reintento, en
  vez de un mensaje crudo.

## Pasada de diseño

Revisión con las skills `impeccable` y `frontend-design`. La tipografía y la
ruma no se tocaron: el sistema visual estaba decidido y documentado, y la
identidad manda sobre el gusto de una pasada. Lo que se arregló es lo que no
estaba a la altura de ese sistema.

La paleta cambió después y por otra razón: el comprador pidió verde oscuro.
Eso es una decisión suya sobre su propia marca, no un criterio de la pasada
—ver *Decisiones de diseño*, donde está cómo se resolvió la colisión con el
verde del semáforo—. El resto de esta sección es anterior al cambio de color
y vale igual: ninguno de los arreglos dependía del tono.

**La pantalla decía dos veces lo mismo.** La lectura de la ruma y la banda
de mediciones traían las mismas cuatro cifras —27.907, −8.813, 32.558 y
4.978— separadas por 200 px, y la banda las mostraba en tipografía *más
grande* que la lectura de la ruma. La jerarquía estaba invertida y la vista
no tenía dónde caer. Ahora cada superficie tiene un trabajo:

| Superficie | Qué contesta | Escala |
|---|---|---|
| Ruma + lectura | Dónde está el mes: recibido, desvío, cierre proyectado, ritmo exigido | 22 px |
| Banda de diagnóstico | Qué hacer al respecto: MR en riesgo, ritmo diario, bajo plan, sin recibir, concentración | 17 px |

De nueve mediciones quedaron cinco, ninguna repetida. La chispa que traía
una sola celda también se fue: la nota ya dice la tendencia con palabras
("parejo en los últimos 5 días") y la serie completa está dibujada en
*Recepción diaria*.

**El techo del eje desperdiciaba medio gráfico.** `niceMax` solo ofrecía
1-2-5-10 × 10ⁿ, así que un máximo de 2.754 subía a 5.000: las barras de la
recepción diaria salían chicas y el gráfico parecía vacío. Peor en la curva
en modo porcentaje, donde el eje llegaba al **200%** para datos que no
pasaban del 114%. Con una escala de escalones intermedios el sobrante baja
del 82% al 9% en los peores casos, y afecta a los ocho gráficos.

**El movimiento era el mismo reflejo en todas partes.** Cada panel de cada
vista entraba con el mismo desplazamiento de 9 px, encima de la animación
que sí dice algo del dato (los estratos de la ruma suben, las barras crecen
desde su base, las líneas se dibujan). El panel ahora solo aparece; el
desplazamiento se guardó para lo que no tiene movimiento propio adentro: las
filas de la lista de ataque y las tarjetas de apuntes.

**La columna de acción no informaba.** Las dieciséis filas de la tabla de
decisión decían lo mismo: *"No llega: hay que reemplazar volumen"*. No era
un error de cálculo sino del criterio: el múltiplo del ritmo promedio se
dispara solo cuando se acaban los días hábiles, así que a tres días del
cierre cualquier brecha clasifica igual a todo el mundo. Ahora se compara
contra **el mejor día que el proveedor ya entregó ese mes**, que es su
capacidad demostrada:

| Zona | Criterio |
|---|---|
| Cierra su plan | No pierde nada al ritmo actual |
| Ya entregó ese ritmo | El ritmo que falta ≤ su mejor día · basta llamarlo |
| Exige más camiones | Hasta 1,5× su mejor día |
| Fuera de su alcance | Más de 1,5× su mejor día · el volumen se busca en otra parte |

Con eso la columna se reparte y la tabla **se ordena por decisión, no por
tamaño**: primero los que se recuperan hoy, después los que exigen camiones,
después el volumen que hay que comprar afuera, al final los que ya cierran.
Ordenada por riesgo ponía arriba justo a los proveedores con los que no se
puede hacer nada.

**Otros ajustes.** Ritmo de espaciado (24 px entre bandas, 14 px dentro de
una banda, antes 14 px para todo); `text-wrap: balance` en los títulos de
panel; el encabezado del sábado y el domingo en el calendario pasó de 1,7:1
a 5,71:1 de contraste; fuera el token `--lift-2` y la ranura `.gauge-spark`,
que no los usaba nadie.

### Arreglos de esta tanda

- **El color de los rótulos de los gráficos se perdía.** Iba en el atributo
  `fill` del `<text>`, y cualquier regla CSS —`.chart-label`, `.chart-value`—
  le gana a un atributo de presentación. Ocho rótulos salían en gris en vez de
  su color (el "80% de la brecha", las banderas de la ruma, los ejes del
  desvío). Ahora el color viaja por `fillStyle` en `attr()`, que lo emite como
  estilo en línea.
- **Los tramos del semáforo eligen su tinta por contraste medido**
  (`inkOn()`), no a ojo: blanco o tinta oscura, la que dé más razón de
  contraste. Los tres tramos quedan sobre 4,5:1.
- **La leyenda se reparte midiendo el texto ya pintado**, no estimando a 5,4 px
  por carácter. La estimación se pisaba mientras Archivo no había cargado —el
  respaldo del sistema ignora `font-stretch`— y las entradas quedaban una
  encima de otra. Si no caben en el ancho, bajan a una segunda fila y el SVG
  crece.
- **Sin desbordamiento horizontal a 390 px.** Faltaba `min-width: 0` en las
  casillas de la reja, así que una barra de controles ancha empujaba la página
  entera en vez de dejar rodar la tabla en su marco. Los controles del panel y
  los cinco botones de la bitácora ahora se reparten en dos filas.
- **La última fila incompleta de las mediciones ya no es un bloque gris.** El
  filete de 1px lo pone cada celda con su propio anillo, así el hueco sigue
  siendo papel; `auto-fit` decide las columnas, así que no se puede rellenar
  con una celda fantasma.
- **La etiqueta del riel se recorta con puntos suspensivos** en vez de cortarse
  a media letra: el ancho del riel no puede depender de que la tipografía ya
  haya cargado.
- **Las etiquetas de la matriz no se pisan**: se colocan al lado que tiene
  sitio y se omiten si chocarían con una ya puesta.

## Verificación

`preview/` incluye una suite de 64 comprobaciones de interacción sobre
Chromium: carga, filtros, orden de tablas, ficha del proveedor, foco, atajos,
guardado de apuntes con ida y vuelta de las cifras, guardia de cambios sin
guardar, informe semanal y memoria entre sesiones.

Sobre los días hábiles se comprueba el caso concreto: que septiembre de 2026
dé **21** días hábiles, que el feriado descontado sea el 18 con su nombre, que
el calendario pinte una casilla por día y que la suma de días hábiles del
calendario cuadre con el total que usa el prorrateo. Sobre la vista forestal,
que el mix cuadre exactamente con lo que vino de `Ingresos` y que las
participaciones sumen 100%.

De la pasada de diseño se comprueba que la banda de diagnóstico no repita
ninguna cifra de la lectura de la ruma y que la jerarquía tipográfica siga en
el orden correcto (la lectura de la ruma por sobre la banda).

El contraste se mide sobre **cada nodo de texto de las cinco vistas**, no
sobre una lista de selectores elegidos a mano: se resuelve el `oklch()` a
sRGB, se compone la transparencia contra el fondo real y se exige 4,5:1 (3:1
en texto grande). Así apareció la insignia naranja del riel, que llevaba
tiempo en 3,42:1 y ninguna revisión por muestreo había visto.

También se comprueba que no haya desbordamiento horizontal en 1600 px, 1280 px
ni 390 px, recorriendo las cinco vistas en cada ancho.
