# Gobernanza de datos y control de acceso basado en roles (RBAC) del dashboard de contribución

**Documento de arquitectura para el Proyecto Final**
Máster en Ciencia de Datos aplicada a la Inteligencia de Negocios
Caso: empresa SaaS multinacional de servicios profesionales con centro de entrega en El Salvador

| | |
|---|---|
| **Versión** | 1.0 |
| **Fecha** | 2026-09-12 (semana ISO **2026.W37**) |
| **Sistema documentado** | Global Contribution — tablero web semanal de contribución del talento |
| **Componentes** | `PS Security.js` (1 361 líneas), `PS Contribution Report.js` (4 894), `PS Teams.js`, `PS Usage.js`, `PS Dashboard.html` |
| **Ámbito de la evidencia** | Código en producción a 2026.W37, suite de pruebas `tests/` (8 ficheros) |
| **Relación con los objetivos** | Insumo de OE1 (diagnóstico), soporte de la dimensión ética/legal de OE2–OE4 y base del componente de gobernanza del plan de gestión de OE5 |

> **Nota de anonimización.** Este documento reproduce fragmentos de código con fines
> demostrativos. Se han sustituido por identificadores genéricos todos los correos,
> nombres propios e identificadores de hojas de cálculo. No contiene datos personales,
> salariales ni identificadores de empleado, en coherencia con las consideraciones
> éticas declaradas en el anteproyecto (minimización, anonimización y publicación
> agregada).

---

## 1. Objeto del documento

El anteproyecto plantea una intervención sobre el **modelo de medición** de la
contribución del talento. Esa intervención solo es defendible si el sistema que la
soporta demuestra que la información sensible de desempeño —evaluaciones del manager,
cumplimiento de objetivos, horas, ausencias, contribución a ingreso— llega **únicamente
a quien tiene una responsabilidad jerárquica legítima sobre la persona evaluada**, y
que lo hace sin depender de la diligencia administrativa de nadie.

Este documento describe y justifica dos elementos que, en la literatura de *people
analytics*, suelen quedar fuera del diseño y aparecen después como incidentes:

1. El **modelo de gobernanza de datos** del tablero: qué fuentes entran, con qué
   claves se unen, quién es propietario de cada dato, qué se persiste y qué se
   descarta.
2. El **mecanismo de RBAC con derivación automática de alcance jerárquico**: cómo un
   supervisor obtiene acceso exacto a su propio árbol organizativo —ni una persona más,
   ni una menos— sin que nadie lo dé de alta manualmente, y cómo se garantiza que los
   managers pares no se vean entre sí.

La tesis central que se defiende aquí es que **el control de acceso no es una capa
añadida sobre el modelo de datos, sino una consecuencia derivada de él**. El árbol
organizativo que el sistema usa para autorizar es el mismo árbol que la organización
mantiene en su HRIS para operar. No hay una segunda lista que sincronizar y, por tanto,
no hay una segunda lista que se desincronice.

---

## 2. Marco conceptual aplicado

| Referente | Aplicación en el sistema |
|---|---|
| **ISO/IEC 30414:2018** (reporte de capital humano) | El tablero publica métricas de capital humano; la norma exige declarar alcance, fuente y método de cálculo de cada indicador. El sistema lo materializa en la pestaña 📖 *Documentation*, generada desde las mismas constantes que calculan. |
| **Minimización y limitación de finalidad** (principios RGPD, aplicables por la matriz multinacional) | El payload servido a cada usuario se recorta *antes* de salir del servidor, no se oculta en el cliente. Lo que un manager no debe ver, no viaja por la red. |
| **RBAC / NIST RBAC-1 con restricción jerárquica** | Cinco roles sobre **dos ejes independientes** (poder y alcance), con herencia jerárquica parcial deliberadamente rota en un punto (§5.3). |
| **ABAC (control por atributos)** | El alcance no es un atributo asignado sino **derivado** de atributos del registro maestro: campo `Supervisor`, estado de empleo, clase de puesto, familia de puesto. Es un híbrido RBAC/ABAC: el rol otorga los verbos, los atributos del HRIS otorgan el conjunto de filas. |
| **Privacidad diferencial (intuición, no técnica formal)** | La exclusión del propio registro se hace **antes del cálculo de agregados** en el caso de árboles pequeños, precisamente porque un total de equipo permite reconstruir por diferencia la fila omitida (§6.2). |
| **Fail-closed / defensa en profundidad** | Toda degradación del dato de origen (pestaña renombrada, columna ausente, sesión no identificada) cierra el acceso y deja traza, nunca lo amplía silenciosamente. |

---

## 3. Arquitectura de datos y gobernanza de las fuentes

### 3.1 Inventario de fuentes y propiedad del dato

El índice compuesto integra siete métricas procedentes de cinco plataformas con
cadencias y propietarios distintos. La **propiedad funcional** del dato no cambia al
entrar en el tablero: el sistema es un consumidor de solo lectura.

| Métrica | Sistema de origen | Propietario funcional | Clave de unión | Cadencia |
|---|---|---|---|---|
| Plantilla / árbol organizativo | HRIS (export a hoja `Data`) | Recursos Humanos | — (registro maestro) | Diaria |
| RCR (contribución a ingreso) | Modelo financiero | Finanzas | Nombre → *Employee ID* vía hoja puente | Mensual |
| SI (valoración del manager) | Small Improvements | RR. HH. / manager | *Employee Number* | Trimestral |
| Objetivos (RADAR) | Hoja RD | Manager | Nombre normalizado | Semanal |
| Tiempo planificado | Tempo | Planificación (WFP) | Nombre + variantes de alias | Semanal |
| Tiempo registrado | Tempo | Consultor / PMO | Nombre normalizado | Diaria |
| Reconocimientos (*kudos*) | Canal interno | Cualquier persona | Nombre receptor / emisor | Continua |
| Ausencias (PTO) | *Accumulation Cost* | RR. HH. | *Employee Number* | Semanal |

**Regla de gobernanza nº 1 — las fuentes son de solo lectura.** El sistema nunca
escribe en las hojas del HRIS ni en las fuentes financieras. Todo lo que el tablero
persiste vive en su **propio** libro contenedor: la configuración (`PS Settings`), la
matriz de ponderación (`PS Scoring Matrix`) y el registro de uso (`PS Access Log`). La
regla está declarada en el encabezado de `PS Usage.js` y es la razón por la que un
fallo del tablero no puede corromper el sistema de registro de personas.

### 3.2 El problema de identidad y su normalización

La barrera dominante de la analítica de personas es la integración y la calidad del
dato, no la visualización (Ramachandran et al., 2024; Espegren y Hugosson, 2025). En
este caso concreto se manifiesta como un **problema de resolución de entidades**: cinco
plataformas identifican a la misma persona de cuatro formas distintas (nombre libre,
*Employee Number*, *Internal ID*, correo corporativo), con variantes de escritura
(`"Apellido, Nombre"`, `"Apellido Nombre"`, dobles espacios, mayúsculas inconsistentes).

La respuesta del sistema es una **única función de normalización** usada en todo punto
de unión, sin excepciones:

```js
normPS_(name) === String(name).toLowerCase().replace(/\s+/g, " ").trim()
```

Su equivalente en la capa de seguridad es `_normName_()`, deliberadamente idéntica. Que
autorización y cálculo normalicen igual no es una coincidencia estilística: **si
divergieran, el árbol que autoriza dejaría de ser el árbol que se calcula**, y aparecerían
personas visibles pero no computadas, o computadas pero no visibles.

Esta decisión tiene un coste documentado que conviene declarar en la memoria: dos
personas con nombre normalizado idéntico colisionan. El sistema no lo esconde, lo
registra explícitamente (`⚠️ Roster: duplicate normalized name …`), porque una colisión
silenciosa mezclaría las métricas de dos personas reales. Es un ejemplo del criterio
transversal del diseño: **degradar ruidosamente antes que fallar en silencio**.

### 3.3 Poblaciones y exclusiones declaradas

La gobernanza exige que el denominador de cada métrica sea explícito y auditable. El
sistema define su población con reglas escritas en código y documentadas al usuario:

- **Personas en rampa** (contratadas en los últimos 3 meses): excluidas de RCR, SI,
  objetivos y *kudos*; incluidas en tiempo y ausencias. Anulable individualmente por
  columna `Ramp-Up` en el registro maestro.
- **Personas en licencia larga** (maternidad, paternidad, parental, sabática):
  permanecen en la plantilla, señalizadas, y salen de las poblaciones de métrica. La
  historia del código es instructiva: antes se descartaban por completo, lo que las
  hacía invisibles *y* arrastraba los agregados sin que nadie lo notara.
- **Personas en prácticas** y **clases de puesto desconocidas**: fuera del informe.
- **Personal externo (*crew*)**: separado en una vista propia, nunca mezclado con
  plantilla en los agregados.

Cada exclusión se registra con recuento y muestra en el log de ejecución. Esto es lo que
convierte una decisión metodológica en un dato auditable, requisito directo de OE2
(cobertura de las métricas).

---

## 4. Principios de gobernanza del sistema

Los cinco principios siguientes están implementados, no declarados. Cada uno se sostiene
en un mecanismo concreto citado en las secciones posteriores.

1. **Finalidad limitada y uso no punitivo.** El índice alimenta conversaciones de
   reconocimiento, desarrollo y equilibrio de carga; toda decisión derivada requiere
   revisión humana. El sistema apoya esto negando a cualquier persona la vista de su
   propia evaluación (§6): el dato existe para la conversación manager–colaborador, no
   como puntuación de autoconsumo.
2. **Minimización en el servidor.** El recorte es previo al transporte. Ocultar en el
   cliente sería una ilusión de control.
3. **Derivación sobre asignación.** Todo alcance se deriva del registro maestro. Las
   listas manuales existen solo para las excepciones que el registro no puede expresar.
4. **Cierre ante la duda (*fail-closed*).** Sesión no identificada, registro maestro
   ilegible, ancla organizativa inexistente: todos deniegan.
5. **Trazabilidad completa.** Cada carga —permitida y denegada— deja una fila. La traza
   se declara al usuario en el pie de página y en la documentación del propio tablero,
   porque un registro de uso no declarado sería, él mismo, un problema de gobernanza.

---

## 5. El modelo RBAC: dos ejes, cinco roles

### 5.1 La separación poder / alcance

La aportación de diseño más relevante de este modelo es que **«qué puedo hacer» y «a
quién puedo ver» son dos preguntas distintas**, que la mayoría de implementaciones RBAC
colapsan en un único nombre de rol. Aquí el código las pregunta por separado:

```js
hasAdminPower_(access)   // ¿puede cambiar la configuración?
canManageAdmins_(access) // ¿puede otorgar privilegios?
seesFullRoster_(access)  // ¿ve a toda la compañía?
isTeamScoped_(access)    // ¿está anclado a un solo equipo?
```

Consultar el *string* del rol directamente (`role === "admin"`) se considera un defecto,
y la suite de pruebas `tests/access-tier-checks.js` **rompe la compilación** si alguna
comparación de ese tipo reaparece. Es gobernanza como prueba automatizada: la regla no
depende de que un revisor se acuerde de ella.

### 5.2 Matriz de roles

| Rol | Ve | Equipos | Puede cambiar | Ve su propio registro |
|---|---|---|---|---|
| **Super Admin** | toda la compañía | los 3 | todo, incl. la lista de super admins | ✅ |
| **Admin** | toda la compañía | los 3 | toda configuración y toda lista de acceso | ❌ |
| **Org Admin** | **su propio árbol** | aquellos donde estén sus reportes | configuración + listas de viewers/delegados | ❌ |
| **Viewer** | su propio equipo | **1 (fijado)** | nada | ❌ |
| **Manager** | su propio árbol | aquellos donde estén sus reportes | nada | ❌ |

### 5.3 Org Admin: la herencia jerárquica rota a propósito

El rol **Org Admin** resuelve un caso real: un Director que debe administrar el tablero
para su organización sin ver la de sus pares. Tiene poderes de administrador y alcance
de manager. Su existencia obliga a romper deliberadamente la herencia RBAC clásica:

> Un administrador con alcance restringido que pudiera otorgar el rol de administrador
> pleno **se lo otorgaría a sí mismo**, y el alcance no valdría nada.

Por eso `canManageAdmins_()` lo excluye, y el servidor **lanza una excepción** en lugar
de ignorar el intento: una escalada fallida debe quedar en el log, no desvanecerse. Es
la aplicación del principio de separación de funciones al caso de un administrador
parcial, y es el punto del modelo que más valor aporta como contribución transferible a
otras organizaciones de servicios.

### 5.4 La superficie de exposición: un hallazgo de auditoría documentado

En Google Apps Script **toda función global sin guion bajo final es un endpoint
invocable** desde el navegador por cualquiera que pueda cargar la aplicación. «Esto se
ejecuta desde el editor» es una convención de nombres, no un control.

La auditoría del propio sistema encontró tres funciones sensibles alcanzables por esa
vía: instalación de disparadores, reescritura de una hoja y borrado de una propiedad de
configuración. Hoy **todas** invocan `checkDashboardAccess()`, y
`tests/callable-surface-checks.js` recorre los cinco ficheros del proyecto para impedir
que reaparezca una: añadir un global sin control de acceso falla la compilación salvo
que se declare en el mapa `UNGATED_OK` con una razón escrita.

Este hallazgo merece figurar en el diagnóstico (OE1) como ejemplo empírico de que la
superficie de ataque de una plataforma *low-code* no coincide con la intuición de quien
la desarrolla.

---

## 6. El mecanismo central: alcance jerárquico derivado

Esta sección responde a la pregunta que da origen al documento: *cómo un manager accede
automáticamente a su grupo de empleados sin ser dado de alta, con privacidad total frente
a los demás managers*.

### 6.1 Resolución de identidad y autorización (orden estricto)

`checkDashboardAccess()` produce un **veredicto** memoizado por ejecución. El orden de
resolución es normativo:

```
super admin → admin → org admin → viewer → delegado → supervisor del registro maestro → acceso abierto
```

Dos decisiones de orden merecen defensa explícita:

1. **Las comprobaciones de manager preceden al *fallback* de acceso abierto.** Si se
   activa el modo abierto para una sesión plenaria, un manager no debe ser promovido
   silenciosamente a *viewer* de toda la compañía. El alcance restringido gana siempre.
2. **Estar en una lista anula la derivación automática.** Añadir a un supervisor a la
   lista de Admin descarta su alcance organizativo y le entrega la compañía entera. Es un
   efecto contraintuitivo y peligroso, por lo que la herramienta de auditoría
   `diagnosePSAccess()` imprime una **auditoría de listas** que marca con ⚠️ a todo
   supervisor sentado en un nivel de alcance company-wide.

### 6.2 Derivación del alcance: un recorrido en anchura sobre el campo `Supervisor`

Cuando el correo de la sesión corresponde a una persona activa del registro maestro con
al menos un reporte directo activo, el sistema la ancla en su propio nombre canónico y
construye su árbol:

```js
function resolveManagerScope_(roster, managerNorm, bridges) {
  const scope = new Set([managerNorm]);   // semilla del recorrido
  const seen  = new Set([managerNorm]);
  const queue = [managerNorm];
  while (queue.length > 0) {
    const supNorm = queue.shift();
    roster.forEach((profile, norm) => {
      if (!seen.has(norm) && normPS_(profile.supervisor) === supNorm) {
        seen.add(norm); scope.add(norm); queue.push(norm);  // puede supervisar a otros
      }
    });
    // … puentes: ver §6.3
  }
  return scope;
}
```

Propiedades relevantes para la memoria:

- **Es un BFS transitivo, no una consulta de reportes directos.** Un Director ve a sus
  managers, a los reportes de sus managers y así sucesivamente.
- **La autorización se resuelve contra la plantilla completa antes de cualquier filtro
  de equipo.** Una vista restringida no debe hacer perder a nadie su condición de
  manager solo porque sus reportes caigan fuera del equipo consultado.
- **El conjunto resultante filtra la plantilla**, y todo el cálculo posterior —métricas,
  agregados, ranking, narrativa de IA— opera exclusivamente sobre esa partición. No
  existe una vista completa que luego se recorte: el dato ajeno nunca se calcula.
- **El ancla se elimina antes del cálculo**: `scope.delete(managerNorm)`.

Esta última línea es el punto más sutil del diseño y conviene desarrollarlo. La
exclusión del propio registro podría hacerse al final, filtrando el payload. Para un
manager **no basta**: si su árbol tiene seis personas y el total del equipo se calcula
sobre siete, la fila omitida se reconstruye por diferencia aritmética. Eliminar el ancla
*antes* de agregar es, en términos conceptuales, un control contra **ataques de
inferencia sobre agregados**, no un control de visualización. El comentario del código
lo dice sin ambages: «*a small org tree cannot be back-solved from its own totals*».

### 6.3 Integridad del árbol: el problema del nodo caído

Un recorrido en anchura solo puede pasar por personas que tienen fila. El lector del
registro maestro descarta filas por clase de puesto desconocida, título de prácticas o
estado inactivo. La consecuencia era un fallo **silencioso y grave**: la baja de un
manager intermedio cuyos reportes aún no han sido reasignados **amputaba todo su
subárbol** del tablero del Director, sin aviso alguno.

La solución conserva las **aristas organizativas** de las filas descartadas
(`recordRosterBridge_`) y permite que el recorrido las atraviese, bajo dos invariantes
que el sistema de pruebas verifica (§5c-bis de `access-tier-checks.js`):

- **Los nodos puente son solo de tránsito.** Entran en `seen`, nunca en `scope`: una
  fila descartada no llega a ningún payload, agregado ni ranking. Se recupera la
  conectividad del grafo sin recuperar el dato de la persona.
- **Un puente no amplía nada.** Cada arista es una relación `Supervisor` real de la hoja,
  luego el árbol reconstruido es el árbol que existe de verdad.

Además, un puente que efectivamente transportó a alguien emite una traza nominal para
que **el registro maestro se corrija** en lugar de que el parche se vuelva permanente.
Es una decisión de gobernanza, no de ingeniería: el sistema señala hacia la fuente de
verdad en vez de sustituirla.

### 6.4 La política de puerta de entrada

La derivación automática es, reconocidamente, **la puerta más ancha del modelo**: un
supervisor entra abriendo el enlace, sin aprobación y sin más constancia que el registro
de uso. El sistema lo hace explícito y configurable en un único punto:

| Modo | Quién se resuelve automáticamente |
|---|---|
| `"any-org"` *(actual)* | cualquier persona activa con ≥1 reporte directo activo, en cualquier organización |
| `"classes"` | solo supervisores cuya clase o departamento figure en el ámbito declarado (lista vacía ⇒ nadie: falla cerrado) |
| `"off"` | nadie; los managers se otorgan explícitamente como delegados |

La frontera exterior es la configuración de despliegue de Google («cualquier persona
dentro del dominio»), que —y el comentario del código insiste— **detiene a Internet, no
a los colegas**. Reconocer con precisión dónde termina el control técnico es parte de la
honestidad metodológica del diagnóstico.

Dos matices de política, ambos defendibles como criterios de *leadership* sobre datos de
personas:

- Un supervisor en **licencia larga** no se autoresuelve. El acceso es una decisión
  distinta de la visibilidad y debe concederse explícitamente.
- Un empleado cuyo campo `Supervisor` se apunta a sí mismo **no es manager**: se exige
  al menos un reporte directo activo *distinto de sí mismo*.

### 6.5 Fijación de equipo para roles de equipo (*viewers*)

Un *viewer* ve un solo equipo organizativo, derivado —no configurado— de su propia fila
mediante la misma regla con la que el informe etiqueta a toda la plantilla. Derivar en
vez de almacenar significa que **la fijación sigue a la persona cuando cambia de
organización**, sin nada que sincronizar.

El detalle crítico es de implementación:

```js
// El teamKey solicitado se SOBREESCRIBE, nunca se limita a validarse,
// y ocurre ANTES de construir la clave de caché.
```

Ambas mitades importan. La petición procede del cliente y no es de fiar; y como los
*viewers* comparten entradas de caché con los administradores, servir datos de I+D bajo
la clave de Servicios **envenenaría lo que después lee todo administrador**. Es un caso
de manual de cómo una decisión de rendimiento (caché compartida) crea un vector de
seguridad si el control de acceso se aplica en el orden equivocado.

---

## 7. Privacidad entre pares y frente a uno mismo

### 7.1 Exclusión del propio registro

Ningún rol salvo Super Admin ve su propia fila. La justificación es organizativa antes
que técnica: **la evaluación de una persona pertenece al tablero de su manager**. Se
aplica en dos puntos deliberadamente distintos:

| Caso | Dónde | Por qué ahí |
|---|---|---|
| Managers, Org Admins, delegados | antes del cálculo (`scope.delete`) | impide la reconstrucción por diferencia en árboles pequeños (§6.2) |
| Admins, viewers | al salir del payload (`applySelfExclusion_`) | una fila entre ~230 no constituye una evaluación legible; permite compartir la caché |

La eliminación alcanza `employees[]`, el ranking, la auditoría de objetivos y **todos**
los mapas por persona (SI, RCR, historial de ausencias, historial de objetivos). El
frontend recibe `meta.selfExcluded` / `meta.selfName` para poder **decir al usuario que
falta su fila y por qué**: una omisión explicada es transparencia; una omisión
silenciosa sería opacidad.

Mención especial merece el tratamiento del caso no resuelto: si el correo de Google no
casa con ninguna celda de correo activa, no se puede excluir nada. El sistema **no
afirma** entonces que la exclusión se aplicó; marca `selfUnresolved`, registra una
advertencia y lo dice. El comentario del código formula el principio con claridad
utilizable en la memoria: *«el incumplimiento silencioso más una falsa garantía es peor
que cualquiera de los dos por separado»*.

### 7.2 Privacidad entre managers pares

De la combinación de §6.2 y §7.1 se sigue la propiedad que el proyecto quiere demostrar:

- Un manager A y un manager B, pares bajo el mismo Director, obtienen conjuntos de
  alcance **disjuntos** salvo por las personas que efectivamente comparten en su cadena
  de mando.
- Ninguno de los dos aparece en el tablero del otro, porque ninguno está en el subárbol
  del otro.
- Ninguno se ve a sí mismo.
- El Director ve a ambos y a sus equipos, pero no se ve a sí mismo ni ve a sus pares.
- Las cachés de A y B son **entradas distintas** (`ps_v<ver>_<team>_<email>`), de modo
  que ni siquiera por error de infraestructura puede servirse a uno el payload del otro.

Esta propiedad **no requiere mantenimiento**. Cuando una persona cambia de manager en el
HRIS, la visibilidad cambia con el siguiente refresco. Cuando alguien es promovido a
supervisor, obtiene su tablero sin trámite. Cuando causa baja, lo pierde. El coste
administrativo del control de acceso para ~30 supervisores y ~230 evaluables es, en
régimen permanente, **nulo**, y este es el argumento de eficiencia que conecta
directamente con el caso de negocio de OE5.

### 7.3 Caché compartida y personalización por llamante

La entrada de caché de plantilla completa se comparte entre super admin, admin y viewer
por razones de rendimiento (el cálculo completo es de varios minutos). Esa entrada se
almacena **impersonal** y se personaliza en la lectura. El riesgo que esto cierra está
documentado con precisión: sin el reestampado de rol, *un viewer que aterrizara sobre
una entrada construida por un super admin recibiría `userRole: "superadmin"`* y con él
la pestaña de Registro de Desempeño. La regla derivada es una norma de diseño para
cualquier ampliación futura: **lo que se añada a la entrada compartida debe ser
impersonal; lo personal se aplica en la personalización, nunca en el cálculo**.

### 7.4 Vista previa supervisada (*view as*)

Un super admin puede previsualizar el tablero de otra persona. El diseño acota el
privilegio de tres formas: se resuelve al objetivo **por su propia ruta de
autorización** (de modo que la previsualización es fiel, incluidas sus denegaciones);
**solo el payload del informe** se impersona —todo endpoint de configuración sigue
resolviendo al llamante real, luego la vista previa es de solo lectura por construcción—;
y el intento por parte de un no-super-admin **lanza excepción** y queda en el log como
sondeo de privilegios. Existe para responder «¿qué ve realmente este Director?» sin
pedirle prestado su navegador, que es la práctica que este mecanismo viene a sustituir.

---

## 8. Trazabilidad, auditoría y verificación

### 8.1 Registro de uso

Cada carga de página —permitida y denegada— añade una fila a `PS Access Log` con
`Timestamp, Week, Email, Role, Allowed, Scope`, en semanas ISO (`2026.W37`). El registro
es *best-effort*: una fila perdida es aceptable, una carga lenta no. Solo registra la
entrada de usuario real; el proceso de precalentamiento de caché no contamina el dato.

Sobre él, `getUsageAnalytics()` (solo super admin) construye un consolidado de 13
semanas ISO y, sobre todo, la **audiencia elegible**: la unión de las listas explícitas
con los supervisores que la política vigente admitiría, señalando **quién no ha
utilizado nunca el sistema**. Esto convierte la adopción en un dato medible y no en una
percepción, y alimenta directamente los indicadores de seguimiento de OE5. La matemática
del consolidado es pura y está cubierta por pruebas en Node
(`tests/usage-analytics-checks.js`).

**La traza está declarada al usuario** en el pie de página y en la pestaña de
documentación del propio tablero.

### 8.2 Herramientas de diagnóstico

`diagnosePSAccess()` imprime el estado completo del modelo: build desplegada, política
vigente, listas resueltas, auditoría de listas con las advertencias de §6.1 y, por
correo, el rol resultante, las personas cubiertas y los equipos. `traceAccess()` es su
forma unitaria ejecutable desde el editor. La existencia de estas herramientas es un
requisito de gobernanza: **un modelo de acceso que no se puede explicar a un auditor en
términos de «esta persona ve exactamente a estas otras y por esta razón» no es
gobernable**.

### 8.3 Controles convertidos en pruebas

| Prueba | Invariante que protege |
|---|---|
| `access-tier-checks.js` | orden de resolución de roles; prohibición de comparar *strings* de rol; exclusión del propio registro; personalización de la caché compartida; reconstrucción del árbol con puentes **y** demostración de que sin puentes el subárbol se pierde |
| `callable-surface-checks.js` | ningún global invocable sin control de acceso |
| `open-access-gate-checks.js` | el modo abierto no promueve managers restringidos |
| `access-list-editor-checks.js` | integridad del editor de listas |
| `perf-record-checks.js` | el Registro de Desempeño se sirve solo desde el payload ya restringido |

El caso más elegante del conjunto es que la prueba del árbol organizativo **conserva la
comprobación de que el recorrido sin puentes pierde el subárbol**: el fixture debe seguir
demostrando aquello que la corrección arregla. Es una práctica de verificación
directamente citable en la memoria.

---

## 9. Análisis de riesgos residuales

Declararlos es parte del diagnóstico (OE1) y son el insumo de las mejoras de gobernanza
del plan de gestión (OE5).

| # | Riesgo residual | Severidad | Control actual | Mejora propuesta |
|---|---|---|---|---|
| R1 | Modo `any-org`: cualquier supervisor de la compañía que reciba el enlace entra sin aprobación | Media | registro de uso; frontera de dominio | Migrar a `"classes"` para el ámbito de Servicios y formalizar la concesión por delegación |
| R2 | Estar en una lista anula el alcance derivado y puede ampliarlo sin intención | Media | auditoría de listas con ⚠️ | Rechazo activo (no solo advertencia) al añadir un supervisor a un nivel company-wide |
| R3 | Calidad del registro maestro: una celda de correo vacía impide la exclusión del propio registro | Media | `selfUnresolved` + advertencia | Indicador semanal de completitud de la columna `Email` como control de calidad del dato |
| R4 | Colisión de nombres normalizados | Baja | traza de duplicados | Migrar las uniones por nombre a *Employee Number* donde la fuente lo permita |
| R5 | Latencia de gobernanza: los cambios organizativos tardan hasta el intervalo de refresco | Baja | botón de refresco en vivo | Documentar la latencia máxima en la declaración de servicio |
| R6 | La narrativa generada por IA consume el payload ya restringido, pero su prompt sale a un servicio externo | Media | payload restringido en origen | Declaración explícita de tratamiento y revisión del contenido enviado |

---

## 10. Indicadores de seguimiento propuestos (insumo de OE5)

| Indicador | Definición | Fuente | Frecuencia |
|---|---|---|---|
| Cobertura de acceso legítimo | supervisores elegibles que han accedido ≥1 vez / supervisores elegibles | `getUsageAnalytics()` | Semanal ISO |
| Adopción sostenida | usuarios únicos permitidos por semana ISO, serie de 13 semanas | `PS Access Log` | Semanal ISO |
| Tasa de denegación | cargas denegadas / cargas totales | `PS Access Log` | Semanal ISO |
| Integridad del árbol | nº de puentes atravesados (filas descartadas que aún transportan subárbol) | log de ejecución | Semanal ISO |
| Completitud de identidad | filas activas con `Email` no vacío / filas activas | registro maestro | Semanal ISO |
| Exclusiones no resueltas | eventos `selfUnresolved` | log de ejecución | Semanal ISO |
| Deuda de control | globals en `UNGATED_OK` con justificación | suite de pruebas | Por versión |

Los cuatro últimos son, estrictamente, **indicadores de calidad del dato que se comportan
como indicadores de seguridad**. Esa equivalencia —la calidad del registro maestro *es*
la eficacia del control de acceso— es una de las conclusiones transferibles del caso.

---

## 11. Correspondencia con los objetivos del Proyecto Final

| Objetivo | Aportación de este documento |
|---|---|
| **OE1** — Diagnóstico | Inventario de fuentes, propiedad del dato y exclusiones declaradas (§3); hallazgos de auditoría reales: superficie invocable (§5.4), nodo caído (§6.3), riesgos residuales (§9) |
| **OE2** — Análisis del índice | Define la población exacta sobre la que se calcula y por qué, condición previa para interpretar la descomposición de varianza y la cobertura de métricas |
| **OE3** — Propuesta de mejora | El modelo de gobernanza es el marco donde se insertan la normalización por banda de coste, la frontera de trimestre y el estatuto de los reconocimientos, sin abrir alcance de visibilidad |
| **OE4** — Validación | El ejercicio de ordenamiento a ciegas es viable **porque** cada manager ve exactamente su propio árbol: los perfiles anonimizados que ordena son, por construcción, personas sobre las que tiene juicio directo |
| **OE5** — Plan de gestión | Riesgos (§9), indicadores (§10) y mejoras de gobernanza como componente presupuestable; coste administrativo marginal nulo del control de acceso como línea del caso de negocio |

---

## 12. Conclusiones

1. **El control de acceso se derivó, no se administró.** Al anclar la autorización en el
   mismo campo `Supervisor` que la organización ya mantiene para operar, el sistema
   eliminó la lista paralela que, en la práctica, es la causa habitual de las fugas de
   información de desempeño: aquella que nadie actualiza cuando alguien cambia de equipo.

2. **La privacidad entre pares es una propiedad emergente del grafo**, no una regla
   escrita: dos managers pares no se ven porque ninguno pertenece al subárbol del otro.
   Las propiedades emergentes no se desactualizan.

3. **El momento de aplicar un control importa tanto como el control.** Eliminar el ancla
   antes de agregar (§6.2) y sobreescribir el equipo antes de construir la clave de caché
   (§6.5) son dos decisiones de *orden de ejecución* sin las cuales los mismos controles,
   aplicados después, serían decorativos.

4. **La calidad del dato maestro es el límite superior de la eficacia del control.** Una
   celda de correo vacía no produce un error visible: produce una persona que ve su
   propia evaluación. De ahí que los indicadores de calidad y los de seguridad sean, en
   este sistema, los mismos.

5. **Un modelo de gobernanza solo es real si es verificable y explicable.** Las pruebas
   que rompen la compilación (§8.3) y las herramientas de diagnóstico que responden
   «esta persona ve exactamente a estas otras, por esta razón» (§8.2) son lo que
   distingue un modelo de acceso gobernado de uno meramente implementado.

---

## Referencias

- Dykes, B. (2019). *Effective Data Storytelling*. Wiley.
- Espegren, Y. y Hugosson, M. (2025). *People analytics: data integration and quality as the dominant barrier*.
- ISO (2018). *ISO 30414:2018 — Human resource management: Guidelines for internal and external human capital reporting*.
- Knaflic, C. N. (2015). *Storytelling with Data*. Wiley.
- Lavalle, A. et al. (2025). *Visual narrative design for decision support*.
- Majrashi, K. (2025). *Perceived fairness constructs in algorithmic evaluation systems*.
- Marler, J. H. y Boudreau, J. W. (2017). An evidence-based review of HR analytics. *The International Journal of Human Resource Management*, 28(1).
- Nguyen, T. y Gigliarano, C. (2025). *Sensitivity-based weighting for composite indicators*.
- OECD y Joint Research Centre (2008). *Handbook on Constructing Composite Indicators: Methodology and User Guide*. OECD Publishing.
- Ramachandran, R. et al. (2024). *Barriers to people analytics adoption*.
- Sandhu, R. et al. (1996). Role-Based Access Control Models. *IEEE Computer*, 29(2).

---

*Documento generado a partir del código en producción del sistema a 2026.W37. Los fragmentos de código citados son literales salvo anonimización de identificadores.*
