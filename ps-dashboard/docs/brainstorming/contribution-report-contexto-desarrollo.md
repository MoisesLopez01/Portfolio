# Contribution Report — Contexto de desarrollo y respuestas técnicas

> Documento de soporte para el capítulo de **análisis y tratamiento de datos** (análisis gráfico,
> visual y tabular). Cubre: (1) la evolución del sistema desde la exploración simple hasta el
> ecosistema de dashboards, y (2) el desarrollo de las respuestas a los Bloques A–F.
> Cada afirmación técnica cita el archivo y la línea del código fuente que la respalda.
> Lo que **no** está en el código (evidencia organizacional, fechas, decisiones) queda marcado
> como ⚠ **Dato pendiente** con la fuente sugerida para obtenerlo.

---

## 1 · La evolución: de la exploración simple al ecosistema

### 1.1 Etapa exploratoria — `Contributionintelligence .js` (tratamiento tabular)

El punto de partida no fue un dashboard sino un **script batch de segmentación** que leía dos
pestañas de Google Sheets (`Jira Raw` + `Roster`) y escribía una tercera (`Team Segmentation`)
sin llamadas adicionales a APIs (`Contributionintelligence .js:1-13`). Sus rasgos definen la
etapa "exploración de datos simples":

- **Salida tabular estática**: una pestaña de Sheets con tasas de engagement por perfil,
  clasificación categórica (Active / Needs Support / Ramp-Up / Inactive) y tendencia
  semana-contra-semana de las últimas 4 semanas (`TREND_WEEKS: 4`).
- **Umbrales fijos declarados en un objeto de configuración** (`CI_CONFIG`): ≥3 semanas activas
  de 4 = Active; 1–2 = Needs Support; 0 = Inactive (`Contributionintelligence .js:46-49`).
- **Primeras decisiones metodológicas que sobrevivieron hasta hoy**: la ventana de ramp-up de
  90 días que excluye a recién contratados del denominador (`RAMPUP_DAYS: 90`, línea 44) es el
  antecedente directo de `RAMP_UP_MONTHS = 3` del sistema actual; la clasificación de tiempo
  por porcentaje de utilización (≥60 % Active, 25–59 % Partial, línea 74-75) anticipa la
  normalización tracked/planned del score.
- **Limitaciones que motivaron el salto**: sin interactividad (cada pregunta nueva = re-ejecutar
  el script), sin control de acceso, sin serie temporal más allá de 4 semanas, y el consumidor
  final tenía que interpretar una tabla cruda.

### 1.2 El salto a dashboard — `PS Contribution Report.js` + `PS Dashboard.html`

La segunda etapa convierte el análisis en un **producto de datos servido como web app**
(GAS `doGet()` + `HtmlService`): una SPA con vista rodante de 5 semanas sobre 7 métricas
(RCR, SI, Goals, Tracked, Planned, Kudos, PTO). Lo que cambia cualitativamente:

| Dimensión | Script exploratorio | Dashboard |
|---|---|---|
| Tratamiento | Tabular (una pestaña) | Gráfico + visual + tabular (radar, tendencias, tarjetas KPI, tabla expandible) |
| Consumo | El analista re-ejecuta | Autoservicio para directivos, en segundos |
| Identidad | Nombres crudos | `normPS_()` + variantes de alias («Last, First», «Last First») |
| Acceso | Ninguno | 3 capas: bootstrap admin, defaults en código, runtime en Script Properties; roles admin/viewer/manager delegado (`PS Security.js`) |
| Frescura | Manual | Caché gzip por chunks de 90 KB + warmer cada 30 min; Refresh fuerza lectura viva |
| Interpretación | Tabla cruda | Score compuesto ponderado, brief ejecutivo semanal, narrativa Gemini |
| Calendario | Etiquetas W8, W9 sueltas | Contexto fiscal derivado automáticamente (`computeFiscalContext_`), semanas `YYYY.WN` |

El score compuesto (§ Bloques A–B) es la pieza que convierte siete series heterogéneas en un
único índice comparable — y por tanto el objeto natural del análisis de sensibilidad del
Bloque F.

### 1.3 El efecto ecosistema — la demanda que generó el dashboard

Una vez que los equipos vieron sus datos en autoservicio, la pregunta dejó de ser «¿qué pasó?»
y pasó a ser «¿por qué?» y «¿qué hacemos?». Cada dashboard derivado nació de una necesidad que
el Contribution Report hizo visible pero no podía responder en profundidad:

| Proyecto | Archivo | Necesidad que lo originó | Qué hereda del Contribution Report |
|---|---|---|---|
| **Project Demand Dashboard** | `project-demand-dashboard/Dashboard.html` | «Vemos las horas por persona — ¿y por proyecto? ¿Dónde está la demanda, la utilización, la evidencia de trabajo facturable?» | Modelo de seguridad, caché gzip + warmer + bump de versión, semanas ISO, joins Tempo/Jira |
| **CompDash** (Comp Health) | `CompDash/ViewDash.html` | «Si medimos contribución, necesitamos ver salud de compensación global: señales, cola de acciones, attrition» | Patrón de roles con RPCs gateados en servidor, tests Node sobre archivos GAS |
| **Delivery Health Dashboard** | `delivery-health-dashboard/Dashboard.html` | «Contribución individual está cubierta — falta la vista de salud de entrega por equipo (capacidad, planificado vs. tracked, backlog)» | Normalización planned≤capacity, carve-outs por familia de puesto, rollups cliente |
| **GDash** (Goal Compliance) | `GDash.html` | «Goals es la métrica con más peso del score (30 %) — necesitamos auditar calidad de goals, no solo contarlos» | Ventanas de gracia fiscales, scoping por árbol organizacional del manager, export PNG/PDF para reuniones |

El patrón de propagación es el argumento central para el capítulo: **un instrumento de medición
bien adoptado no solo responde preguntas — genera demanda de instrumentos nuevos**, y los
patrones técnicos (seguridad, caché, normalización de identidades, calendario fiscal derivado)
se reutilizan como plataforma.

---

## 2 · Bloque A — Datos que bloquean el cálculo del § 2

### A1. Horas planificadas del sujeto en 2026.W28, 2026.W29 y 2026.W30

⚠ **Dato pendiente** — no vive en el repositorio: es dato de runtime en la hoja de Planned Time.
Tres formas de obtenerlo, de menor a mayor esfuerzo:

1. En el dashboard, fila expandida del empleado → columnas semanales muestran `plannedHrs` por
   semana junto a las tracked (37, 35, 35 de tu captura).
2. Directamente en la hoja fuente de Planned Time, filtrando por el nombre y las semanas
   `2026.W28`–`2026.W30`.
3. Con nombres mock: ejecuta el flujo de `Change Names.js` (ver Bloque E, anonimización) y toma
   la captura completa con planned visible.

**Importante para el § 2**: si vas a reconstruir el score a mano necesitas además las horas de
PTO de esas semanas, porque el objetivo de planned no es 40 fijo — es `40 − PTO` (ver A4).

### A2. ¿28 h o 36 h? — Ninguna de las dos interviene en el score

Los umbrales de 28 h y 36 h **no existen en la fórmula del score**. Viven en el generador del
brief narrativo semanal (`PS_Post.js`), como banda de clasificación retórica del promedio de
horas del equipo:

- `PS_Post.js:316-321` — si el promedio ≥ 36 h se narra como «en objetivo»; si está entre 28 y
  36 se narra como «above the 28h floor, below the 36h target».
- `PS_Post.js:498` — el check de piso del brief: todas las semanas ≥ 28 h.

El score usa otra pareja de constantes (`PS Contribution Report.js:93-94`):

```
SCORE_PLANNED_CAP_HRS = 40   // objetivo de horas para normalizar Planned
SCORE_TRACKED_RATIO   = 0.9  // fracción del planned que da crédito pleno en Tracked
```

Nota histórica útil para el capítulo: existió un fallback plano de 36 h
(`DEFAULT_TARGET_WEEKLY_HRS`) que se eliminó porque anulaba el crédito de Tracked en semanas de
PTO completo — el comentario que documenta esa corrección sigue en
`PS Contribution Report.js:3221-3224`. Es decir: **36 h fue parte del score y se retiró como
medida correctiva**; hoy solo sobrevive como umbral narrativo del brief.

### A3. Fórmula exacta de Tracked

Implementada dos veces de forma espejo — servidor `buildTopPerformers_`
(`PS Contribution Report.js:3220-3230`) y cliente `computeRkScore`
(`PS Dashboard.html:3084-3088`):

```
plannedTarget = ptoAdjustedTargetHrs ?? 40          // = max(0, 40 − horas PTO de la semana)

trackedTarget = plannedHrs > 0
                  ? plannedHrs × 0.9                // caso normal: 90 % de SUS planificadas
                  : plannedTarget × 0.9             // sin plan: 90 % del objetivo ajustado por PTO

trackedNorm   = trackedTarget ≤ 0 ? 1               // semana 100 % PTO → crédito pleno
              : trackedHrs === null ? 0             // sin registro y sin PTO total → 0
              : min(1, trackedHrs / trackedTarget)  // tope en 1.0 (100 %)
```

Respuestas directas a tus sub-preguntas:

- **Sí es «registradas ÷ (0,9 × planificadas)» con tope en 1.0** — pero solo cuando la persona
  planificó > 0 horas.
- **Si planificó 0 (o null)**: el denominador NO se vuelve cero ni indefinido — cae al fallback
  `(40 − PTO) × 0.9`. Con 0 planificadas y 0 PTO, el objetivo efectivo es 36 h (40 × 0.9).
- **Semana de PTO completo** (objetivo ajustado = 0): crédito pleno (norm = 1) aunque
  `trackedHrs` sea null — el orden de los guards importa y está cubierto por test unitario
  (`PS Contribution Report.js:4168-4185`).
- Producción emite `null` (no 0) para semanas sin registros — la distinción null/0 es
  deliberada en todo el pipeline.

### A4. Fórmula exacta de Planned

Servidor `PS Contribution Report.js:3220,3231`; cliente `PS Dashboard.html:3084,3089`:

```
plannedTargetHrs = max(0, 40 − horasPTOsemana)      // ptoAdjustedTargetHrs; piso en 0
                                                    // (PTO_MIN_TARGET_HRS = 0, línea 32)

plannedNorm = plannedHrs === null ? 0
            : plannedTargetHrs ≤ 0 ? 1              // semana 100 % PTO → crédito pleno
            : min(1, plannedHrs / plannedTargetHrs) // tope en 1.0
```

- **Sí es «planificadas ÷ objetivo» con tope** — pero el denominador es `40 − PTO`, no 40 fijo.
- **El «rango 32–40 h» del tooltip NO es una banda de crédito en la fórmula.** El texto literal
  es `"Hours planned vs. 40h target (32–40h incl. PTO)"` (`PS Dashboard.html:7216`) y es
  puramente descriptivo: ilustra que con un día de PTO (8 h) el objetivo baja a 32. El único
  umbral real es el objetivo ajustado; crédito pleno = planificar ≥ (40 − PTO) horas.
- Test unitario de las tres situaciones (sin PTO, PTO parcial, PTO total):
  `PS Contribution Report.js:4180-4185`.

---

## 3 · Bloque B — Verificaciones en el sistema

### B1. Arrastre de trimestre: SÍ llega al score, pero por persona y con una conmutación que explica tu 6 %

El mecanismo (`PS Contribution Report.js:3697-3759`) es más fino que «visual vs. real»:

1. Durante la **ventana de gracia** (primeros 21 días del trimestre fiscal,
   `GOALS_GRACE_DAYS: 21`, línea 54), se congela la **última semana del trimestre saliente**
   como snapshot (`goalsFrozenSnapshot`, líneas 3700-3706).
2. Para cada semana mostrada dentro de la ventana de gracia, el snapshot se aplica
   **por empleado, no por semana completa** (líneas 3731-3757): quien aún no registró goals del
   trimestre nuevo conserva su compliance del trimestre anterior — y como eso escribe
   `goalsDetail.compliant`, **sí alimenta el score** (el score lee ese campo:
   `PS Contribution Report.js:3234-3235`, `PS Dashboard.html:3092-3093`).
3. **La conmutación**: en cuanto un empleado registra ≥ 1 goal del trimestre nuevo
   (`hasNewGoals`, línea 3742), pasa inmediatamente a sus datos reales — que en las primeras
   semanas son casi siempre no-compliant (< 8 goals cargados).

**Por qué viste 6 % en 2026.W27**: W27 fue la primera semana de FY27Q1 (arranque 1 de julio).
El 6 % no significa que el arrastre «no llega» — significa que la mayoría del equipo ya había
empezado a cargar goals nuevos (conmutando a datos reales aún incompletos), y/o que la vista
consultada cayó fuera de la ventana de gracia. Además, las semanas que solo llevan campos de
tendencia de comentarios (sin `.compliant`) se tratan como **«sin dato» y salen del
denominador** del score — no como 0 (`PS Contribution Report.js:3232-3234`).

Para el capítulo: descríbelo como *carry-forward por empleado con conmutación individual a
datos reales*, no como arrastre global de tres semanas.

### B2. Kudos en el score individual: binario 50/50, confirmado

Cliente `PS Dashboard.html:3095-3098` y servidor `PS Contribution Report.js:3237-3240`,
idénticos:

```
kudosNorm = (recibió ≥ 1 kudo ? 0.5 : 0) + (dio ≥ 1 kudo ? 0.5 : 0)
```

- Recibió y no dio = 0.5 · Dio y no recibió = 0.5 · Ambos = 1.0 · Ninguno = 0.
- **No usa el promedio del radar.** La fórmula «avg kudos/persona × 50, tope 100»
  (`PS Dashboard.html:1648`) pertenece exclusivamente al **radar de equipo** — es una
  normalización de grupo, no la del score individual. Son dos escalas distintas con el mismo
  nombre de métrica; conviene un pie de página en el capítulo para no mezclarlas.

### B3. Denominador dinámico: sí, con dos matices importantes

La forma general es exactamente `Σ(peso × valor) ÷ Σ(pesos disponibles)`
(`PS Contribution Report.js:3246-3253`, espejo en `PS Dashboard.html:3113-3123`):

```
availW = W.tracked + W.planned + W.kudos + (hayDatosGoals ? W.goals : 0)
earned = trackedNorm·W.tracked + plannedNorm·W.planned + kudosNorm·W.kudos + goals…
si RCR tiene valor      → availW += W.rcr;  earned += rcrNorm·W.rcr
score = round(100 × earned / availW)
```

Los dos matices que debes reportar con precisión:

1. **Goals y RCR se EXCLUYEN del denominador cuando no hay dato** (la semana sin ventana de
   compliance, el empleado sin RCR) — comportamiento «pesos disponibles» puro.
2. **SI y PTO NO se excluyen**: si su peso configurado es > 0, entran al denominador aunque el
   valor sea null, aportando 0 puntos (`PS Contribution Report.js:3250-3251` y el comentario de
   diseño en `PS Dashboard.html:3117-3119`). Razón documentada: excluirlos inflaría el score de
   un FTE sin rating de SI por encima del de un colega que sí fue evaluado. Excepción: los
   crew/contractors sí excluyen Goals, PTO y SI por completo (no pueden tener esos datos).

Es decir: el denominador es dinámico **por disponibilidad de dato** para Goals/RCR y dinámico
**por configuración de peso** para SI/PTO. Para el análisis de sensibilidad del Bloque F esta
asimetría es relevante: los pesos efectivos varían entre personas.

### B4. Agregación por manager: no existe promedio de índices — el grupo se recalcula desde agregados

Hallazgo importante para tus correlaciones: **el sistema nunca promedia los scores compuestos
individuales para producir un «score de equipo»**. Hay dos capas separadas:

1. **Leaderboard individual (Leading Behaviours)**: `computeRkScore` por persona
   (`PS Dashboard.html:4311-4320`); cuando un manager con scope filtrado entra, solo se
   restringe *qué personas* aparecen — cada score sigue siendo individual.
2. **Radar de equipo**: se construye con `computeGroupMetrics(empleados, …)` sobre los
   **agregados del grupo** y luego se normaliza por eje con reglas propias
   (`PS Dashboard.html:6492-6518`): kudos = promedio por persona × 50, RCR desde el ratio
   agregado de horas, etc. El polígono «Team avg» del radar individual también sale de ahí —
   no es la media de los polígonos individuales.

**Consecuencia metodológica**: si en tu análisis correlacionas «índice del equipo» contra otra
variable, ese índice de equipo **lo construyes tú** (media de los scores individuales del
scope); no lo estás leyendo del sistema. Y como los agregados del radar no son medias de
índices (Jensen: f(media) ≠ media de f cuando hay topes `min(1,·)`), las dos vías dan números
distintos por diseño. Declara cuál usas.

---

## 4 · Bloque C — Evidencia de adopción (Capítulo 6)

Nada de esto vive en el código; aquí va el estado real y de dónde sacar cada dato.

| Pregunta | Estado | Fuente sugerida |
|---|---|---|
| C1. Usuarios directivos activos por semana (serie temporal) | ⚠ No instrumentado. GAS no guarda analytics de visitas; el panel de ejecuciones del proyecto GAS retiene ~7 días de invocaciones de `doGet`/`getPSReportData` — sirve para una foto puntual, no para la serie. | **Instrumentable en ~1 hora**: `checkDashboardAccess()` ya identifica el email en cada carga (`PS Security.js`); basta persistir `{email, semanaISO}` en una hoja/Script Properties para construir la serie de aquí en adelante. Para el pasado: honestidad metodológica — reporta «no instrumentado antes de 2026.W31» y usa la foto de 7 días como muestra. |
| C2. Semanas consecutivas del brief sin interrupción | ⚠ Dato del canal de publicación. | Cuenta los posts semanales generados por `PS_Post.js` en el canal destino (Slack/Confluence); las etiquetas `YYYY.WN` de cada post permiten verificar continuidad sin ambigüedad. |
| C3. Decisiones trazables al tablero (promoción, apoyo, rebalanceo) | ⚠ Solo tú/los directivos. | Revisa actas de 1:1s y tickets Jira (el epic GTT-499 de Goal Compliance Accountability es un candidato citable: programa semanal de comentarios de estado nacido de datos del tablero). |
| C4. «De horas a segundos» — medición del antes | ⚠ Método no registrado. | Sé explícito en el capítulo: si fue estimación declarada por los propios directivos, di «estimación autorreportada»; el «después» sí es medible (payload cacheado sirve en ~1-3 s; el cómputo frío histórico era multi-minuto — el comentario del caché lo documenta: la escritura >100 KB fallaba silenciosamente y forzaba cómputo frío en cada carga, sección Cache de `CLAUDE.md`). |
| C5. Finanzas y RCR — qué, desde cuándo, por escrito | ⚠ Solo tú. | Si existe correo/acta/ticket, cítalo con fecha ISO (`2026.Wxx`); si no, degrada la afirmación a «conversaciones en curso» sin fecha. |

---

## 5 · Bloque D — Detalle de las medidas correctivas

Lo que el código y el historial del proyecto **sí** evidencian, y lo que falta:

### D1. Modelos 1 y 2 descartados

⚠ **Dato pendiente** (mes, quién, argumento) — no hay rastro en el repo de los modelos
descartados. Lo que sí puedes citar como evolución documentada del modelo vigente:

- El fallback plano de 36 h retirado del score (comentario en
  `PS Contribution Report.js:3221-3224`) — corrección por castigar semanas de PTO completo.
- La banda I: el guard-order de PTO (null tracked en semana full-PTO daba 0 y pasó a 1) quedó
  cubierto con tests (`PS Contribution Report.js:4168-4185`).
- El paso de pesos planos a **matriz por equipo/familia/nivel** («team gates, family tunes»,
  spec `ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md`) — reconocimiento de
  que un peso único era injusto entre familias de puesto.

### D2. Fallo de Tempo: fue expiración de token (auth), no zona horaria ni paginación

Documentado en el historial del proyecto: el 2026-07-23 los exports de Tempo empezaron a
fallar por **expiración del token de API** (los tokens se crean dentro de la app de Tempo, no
en el gestor de tokens de Atlassian, y caducan). La corrección fue doble: reintento automático
ante 401 + función de sondeo `probeTempoAuth` para diagnóstico temprano. Es recurrente por
diseño (los tokens volverán a caducar); el sistema ahora lo detecta en vez de fallar en
silencio. Adicionalmente, un problema de **datos** (no de API) separado: Tempo duplica el plan
por proyecto — una persona planificada en N proyectos aparece N veces — y la decisión fue
normalizar (planned ≤ capacity) en vez de marcar advertencias, criterio que aplica a todo el
ecosistema.

### D3. Mapeo de identidades

El mecanismo está en el código; los números no. Lo citable:

- Normalizador único `normPS_(name)` = minúsculas + colapso de espacios (`CLAUDE.md`, sección
  Data join keys) usado en todos los joins por nombre.
- **Planned Time necesita 3 variantes de alias** por persona («First Last», «Last, First»,
  «Last First») — evidencia estructural de que la discrepancia de formatos era sistémica, no
  anecdótica.
- Dos joins se rescataron cambiando la clave de nombre a **Employee Number** (SI y PTO) — la
  medida correctiva definitiva cuando el nombre no era confiable.
- RCR requiere un **puente de 3 hojas** (Roster → nombre → Employee ID vía hoja `3. RCR`).

⚠ **Dato pendiente**: nº de personas con discrepancia y nº de alias resueltos. Se puede
reconstruir con un script de una pasada que compare claves normalizadas entre Roster y cada
fuente — si lo quieres, es ~30 min de trabajo y te da el número exacto para el relato.

---

## 6 · Bloque E — Decisiones que solo tú puedes tomar (opciones enmarcadas)

### E1. Peso de Kudos (93 % en cero)

El diseño binario dio/recibió ya reconoce que la distribución es degenerada — no intenta
escalar por cantidad. Opciones con su argumento:

| Opción | Argumento a favor | Riesgo |
|---|---|---|
| Mantener 5 % | Es un incentivo conductual deliberado, no una medición: 5 puntos por participar en reconocimiento (valor «Think Team»). El brief ya lo trata así (nudges cuando cae a cero). | Con 93 % en cero, añade ruido de ±5 pts que domina empates en el ranking. |
| Bajar a 2–3 % | Conserva la señal conductual, reduce el ruido en el ordenamiento. | Peso tan bajo que ya no incentiva — peor de ambos mundos. |
| Contexto sin puntuar (peso 0, visible en radar/brief) | Metodológicamente el más limpio: una variable con 93 % de ceros no discrimina; el sistema ya soporta peso 0 (SI y PTO arrancan en 0 por defecto). | Pierde el único incentivo estructural de reconocimiento; esperable que los kudos caigan aún más. |

Si el capítulo es de **medición**, la defensa más sólida es la tercera con el argumento de
no-discriminación; si el sistema se defiende como **instrumento de gestión del comportamiento**,
la primera — pero entonces decláralo como incentivo, no como medida.

### E2. Estructura del capítulo

Decisión editorial tuya. Criterio práctico: si el material de los Bloques A–B (fórmulas,
denominador dinámico, carry-forward) va a ocupar > 8-10 páginas, merece capítulo propio
(renumerando 4-6); si se queda en definiciones de apoyo, apartado 3.7 y las fórmulas a un anexo.

### E3. Anonimización: SÍ puedes generar capturas con nombres mock en el propio sistema

Existe `Change Names.js` en la raíz del repo — herramienta de sustitución de nombres. El camino
de menor riesgo: copia de la hoja fuente → pasada de mock names → captura desde el dashboard
apuntando a la copia (los IDs de spreadsheet se overridean por Script Properties sin tocar
código: `ROSTER_SS_ID`, `GOALS_SS_ID`, `PTO_ACCUM_SS_ID`, ver `CLAUDE.md`). No hay que
reconstruir nada a mano.

### E4. Autorización escrita

⚠ Solo tú. Si no existe, el plan B para el § 2.5 es describir el sistema en términos
genéricos («una consultora global de servicios profesionales, ~150 personas evaluadas
semanalmente sobre 7 métricas») y usar exclusivamente capturas con datos mock — con eso el
capítulo se sostiene sin exponer a la empresa.

---

## 7 · Bloque F — El tramo ]99–100]

### F1. Análisis de sensibilidad formal: técnicamente viable con un export pequeño

Todo lo necesario ya se computa: `computeRkScore` / `buildTopPerformers_` devuelven por persona
los siete valores normalizados **y** el score (`goalsNorm, trackedNorm, plannedNorm, rcrNorm,
kudosNorm, siNorm, ptoNorm, score` — `PS Contribution Report.js:3262-3271`). Falta solo un
export CSV sin columna de nombre (~150 filas × 8 columnas para una semana dada). Es un añadido
de ~1 hora sobre el patrón de export CSV que el dashboard ya usa en otras vistas.

Dos avisos metodológicos para que la descomposición de varianza (Paruolo et al., 2013) sea
honesta:

1. **Los pesos nominales no son los efectivos ni siquiera dentro de una misma semana**: el
   denominador dinámico (B3) y la matriz por equipo/familia (pesos por empleado,
   `emp.scoreWeights`) hacen que dos personas con los mismos valores normalizados puedan tener
   pesos distintos. Exporta también `availW` o los pesos resueltos por fila, o restringe la
   muestra a un grupo homogéneo (p. ej. solo Services con base plana).
2. **Kudos y Goals son binarias/casi-binarias** — los first-order sensitivity indices sobre
   variables Bernoulli con p extrema (Kudos: 93 % ceros) saldrán minúsculos por construcción;
   repórtalo como propiedad de la variable, no como descubrimiento del método.

### F2. Validación con usuarios (5–8 directivos)

Viable y barata: el leaderboard de una semana cerrada es estable y reproducible (semana
`isPast`, datos congelados). Protocolo mínimo defendible: mostrar a cada directivo el top/bottom
de SU scope (los delegates ya ven solo su árbol organizacional) y pedir un ordenamiento a
ciegas de 6-8 personas; medir concordancia con τ de Kendall o ρ de Spearman. Con n = 5-8
jueces no da significancia — da **validación de constructo cualitativa medida**, que es
exactamente lo que el tramo pide.

### F3. Generalización: el aporte es el mecanismo, no las métricas

Argumento que el propio repositorio sostiene: nada del motor de scoring depende de qué miden
las siete métricas. Los componentes portables a cualquier índice compuesto de RR. HH.:

- Normalizaciones acotadas `min(1, valor/objetivo)` con objetivos ajustables por contexto
  (PTO-adjusted targets).
- Denominador dinámico por disponibilidad de dato (evita castigar la ausencia de dato) con la
  variante «peso retenido con 0 puntos» cuando la ausencia sí es informativa (B3, matiz 2).
- Pesos por segmento (equipo/familia/nivel) con máscara dura de métricas no aplicables
  (`maskToTeamMetrics_`) — el mismo scoring corre sobre Services, R&D y Sales con conjuntos de
  métricas distintos, que es en sí una demostración de generalización interna.
- Carry-forward por individuo en transiciones de periodo (B1).

La prueba de fuego que puedes proponer en el capítulo: instanciar el mismo motor con otras
métricas (p. ej. ventas: pipeline, actividades, win-rate) sin tocar la lógica — solo el bloque
de normalizaciones. Si eso se sostiene (y estructuralmente se sostiene), tienes un aporte al
campo, no solo al caso.

---

## Apéndice — Mapa rápido de citas de código

| Afirmación | Cita |
|---|---|
| Constantes del score (40 h / 0.9) | `PS Contribution Report.js:93-94` |
| Objetivo ajustado por PTO, piso 0 | `PS Contribution Report.js:32,3110-3113` |
| Fórmulas Tracked/Planned (servidor) | `PS Contribution Report.js:3220-3231` |
| Fórmulas Tracked/Planned (cliente) | `PS Dashboard.html:3084-3089` |
| Kudos binario 50/50 | `PS Contribution Report.js:3237-3240` · `PS Dashboard.html:3095-3098` |
| Denominador dinámico + matiz SI/PTO | `PS Contribution Report.js:3246-3253` · `PS Dashboard.html:3113-3123` |
| Ventana de gracia y carry por empleado | `PS Contribution Report.js:54,3697-3759` |
| Radar de equipo desde agregados | `PS Dashboard.html:1648,6492-6518` |
| Umbrales narrativos 28 h / 36 h | `PS_Post.js:316-321,498` |
| Tooltip «32–40 h» descriptivo | `PS Dashboard.html:7216` |
| Tests unitarios PTO/score | `PS Contribution Report.js:4141-4185` |
| Origen exploratorio (segmentación) | `Contributionintelligence .js:1-80` |
