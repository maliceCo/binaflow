# PLAN DE EJECUCION: Hito 1 - Ejecucion independiente de la interfaz

> **ATENCION SUB-AGENTE:** Sigue este plan estrictamente en orden. No saltes tareas ni agregues funcionalidades. Ante un obstaculo, detente e informa. Este documento prepara la delegacion: su creacion no autoriza ejecutar codigo, migraciones, modelos reales ni commits. La implementacion necesita aprobacion explicita del propietario.

## Lectura rapida para aprobar

**Objetivo:** un proceso anfitrion mantiene un workflow activo aunque un cliente
se desconecte. Otro cliente consulta el mismo trabajo sin reiniciarlo.

1. Separar la composicion de recursos sin cambiar CLI/TUI.
2. Crear un propietario de ejecucion con inicio repetible y cancelacion explicita.
3. Recuperar estado y eventos por consultas, sin callbacks de clientes en el motor.
4. Verificar el recorrido con dos clientes simulados, SQLite y un agente falso.

**No incluye:** web, HTTP, autenticacion, WebSockets, instalacion como servicio,
Git, ejecucion por fases del TODO, nuevos workflows ni recuperacion automatica
tras caida del proceso. Esos temas pertenecen a los hitos posteriores.

**Estado:** ejecucion autorizada por el propietario en esta sesion; Tarea 2.4 completada. Tarea 3.1 disponible.

## Contexto y limites

- Vision: `docs/web-workflow-vision.md`. Flujo futuro: `docs/binaflow_web_flow.drawio`.
- Copia integra del TODO anterior: `docs/tui-validation-pending.md`. Contiene
  verificaciones pendientes de TUI; no se considera trabajo cerrado ni scope de
  este hito. No editarla, borrarla o ejecutar sus tareas por inferencia.
- Destino inicial: un usuario, un workspace configurado y un anfitrion. La primera
  entrada hospedada admite solo `plan-build`; sus versiones y schemas existentes
  no se modifican. CLI/TUI conservan los demas workflows.
- La implementacion vive en aplicacion. `src/core`, drivers, transporte JSONL,
  CLI y TUI no se modifican. Se conservan protocolos y semantica adjunta actuales.
- No dependencias, migraciones, tablas, timers de polling internos, colas de
  trabajos, plugins ni nuevos tipos de eventos. El futuro cliente decidira
  cuando consultar; el anfitrion no programa un bucle de red.

## Contrato cerrado para este hito

### A. Superficie y propiedad de recursos

Crear `src/application/execution-host.ts`, con tipos y fabrica
`createExecutionHost`. La fabrica recibe una aplicacion ya compuesta, una consulta
interna `findRun(runId)` y el cierre del contexto que le pertenece. No recibe ni
importa SqliteRunStore, PiDriver, Ink o filesystem.

La fabrica devuelve `{ client, close }`. El propietario del proceso retiene
`close`; un cliente solo recibe `client`. No exponer la aplicacion cruda, el
AbortController ni la promesa de operacion a los clientes.

| Operacion del cliente | Contrato |
| --- | --- |
| `start({ requestId, workflowId, objective })` | Devuelve `{ runId }` despues de persistir el run y su input; no espera la terminacion del workflow. `workflowId` debe ser `plan-build`. |
| `listRuns(query?)` | Delega en la consulta paginada existente; permite reencontrar trabajo sin conservar el runId en el navegador. |
| `getRunView(runId)` | Delega en la proyeccion existente; observar nunca inicia ni reanuda agentes. |
| `listRunEvents(runId, query?)` | Delega en la pagina de eventos existente; usa IDs persistidos y `afterId`, no indices del cliente. |
| `cancel(runId)` | Solo aborta la operacion activa que posee este anfitrion y espera su limpieza. Repetir durante cancelacion espera el mismo resultado. |

No hay `attach`, `detach` ni `subscribe`: los clientes hacen consultas
independientes. Desconectar equivale a dejar de consultar. No se acepta un
AbortSignal del cliente en `start` ni se vincula un request de lectura a la
cancelacion del agente.

Usar `Pick` de las interfaces existentes para las dependencias necesarias, no un
segundo ApplicationService completo. La consulta `findRun` es el
`getRun` existente del puerto de almacenamiento, encapsulado por la composicion;
no se publica a presentacion. No agregar metodos obligatorios a las fachadas que
ya usan CLI/TUI y sus fixtures.

### B. Inicio repetible sin una nueva tabla

- `requestId` es un UUID v4 canonico en minusculas, creado una sola vez por el
  cliente para un inicio deliberado. Validarlo; no generarlo de nuevo al reintentar.
- Derivar `runId = host-${requestId}`. El dominio actual admite IDs de texto y
  SqliteRunStore ya exige unicidad. Esta convencion solo afecta a nuevos runs
  hospedados, nunca a IDs existentes.
- Capturar los valores del request antes del primer await. Validar tipos en runtime,
  rechazar campos no previstos, objetivo vacio y workflow distinto a `plan-build`.
  Conservar el objetivo exacto; no recortarlo ni normalizar sus espacios.
- El input enviado a `runWorkflow` es exactamente `{ objective }`. Limitar su JSON
  serializado a 64.000 bytes UTF-8, compatible con la lectura acotada del artefacto.
  Este limite pertenece a esta entrada nueva; no cambiar limites de CLI/TUI.
- Antes del primer await, reservar una unica ranura local para la solicitud en
  curso. Misma solicitud y contenido reutilizan la promesa de inicio. Mismo ID
  con otro contenido falla; un ID diferente recibe error de ocupado, sin cola.
- Consultar `findRun(runId)` antes de iniciar. Si existe, comprobar workflow,
  objetivo e input persistido `run.input` mediante `readArtifact` en modo preview,
  maxBytes 64.000. Rechazar error, truncamiento, JSON invalido o contenido diferente.
  No comparar versiones/modelos actuales para regenerar una ejecucion historica.
- Un replay valido devuelve el mismo runId, incluso si el run ya termino, fallo,
  esta esperando o fue interrumpido. **Repetir start nunca equivale a resume.**
- Si no existe, llamar una sola vez a `application.runWorkflow` con ese runId y
  un AbortController propiedad del anfitrion. El callback interno `onRunStarted`
  resuelve el recibo; ya sucede despues de persistir run y artefacto de entrada.
  Nunca llamar callbacks de clientes desde ese callback.
- Si falla antes de crear el run, rechazar el inicio y liberar la ranura. Se puede
  reintentar el mismo ID: el runtime actual persiste antes de llamar al agente.
  No prometer persistencia de solicitudes rechazadas ni limpieza de artefactos
  huerfanos anteriores a createRun; no agregar un recolector en este hito.
- Si existe un run pero no su input valido, detener y reportar; nunca eliminarlo
  ni llamar otra vez al agente para reparar la deduplicacion.

La unicidad por run y los claims existentes siguen siendo la ultima proteccion.
La ranura es por instancia del anfitrion: **no es un bloqueo global del workspace**
contra otro CLI o proceso. No lanzar dos anfitriones contra el mismo workspace.
El bloqueo por repositorio se abordara con Git en el hito 3.

### C. Ciclo de vida, errores y cancelacion

- Separar promesa de inicio de promesa de operacion completa. Observar todas sus
  resoluciones/rechazos desde su creacion; no dejar promesas rechazadas sueltas.
- Mantener la ranura, controller y contexto hasta que termine la operacion, no
  solo hasta recibir `onRunStarted` ni hasta que el cliente deje de consultar.
- Un resultado normal `failed`, `cancelled` o `waiting` se consulta como tal.
  No convertirlo en exito ni reanudarlo automaticamente.
- Una excepcion inesperada posterior al inicio debe quedar observada. Usar la
  recuperacion que ya hace `runWorkflow`, sin mutar estados directamente desde
  el host. Impedir nuevos inicios si el anfitrion queda en fallo interno; lecturas
  y cierre siguen disponibles. No ocultar errores de SQLite como fallos de cliente.
- `cancel` no cancela otro run para satisfacer una solicitud: para un run ajeno,
  inexistente o activo en otro propietario, devolver error explicito. Para el
  mismo run ya terminal, no-op. Comprobar estado persistido cuando no haya ranura.
- En este hito no se agrega force-kill. AbortSignal y PiDriver mantienen su
  limpieza actual. No modificar el doble Ctrl+C de CLI/TUI.
- `close()` es idempotente: rechazar nuevas llamadas, abortar la operacion propia,
  esperar operacion y consultas ya admitidas, y cerrar el contexto exactamente una
  vez. Un error no permite cerrar SQLite mientras quedan escrituras activas.
  Propagar los errores de limpieza, sin esperar al cliente ni al retorno de HTTP.
- La finalizacion normal de un run deja el host disponible para otro. Si close
  compite con un inicio en preflight, no lanzar el agente despues de comenzar el
  cierre. Si una operacion no termina su limpieza, no forzar el cierre de SQLite.

Cerrar el navegador no cambia estados. Cerrar ordenadamente el anfitrion solicita
cancelacion conforme al comportamiento actual; **no inventar pause/resume para
runs cancelled**. Una caida abrupta se recupera explicitamente con los mecanismos
existentes tras verificar que el propietario anterior termino. No simular
continuidad del proceso ni exactamente-una-vez de herramientas externas.

### D. Observacion desacoplada y compatibilidad

El camino hospedado se compone **sin `onEvent` y sin `subscribeEvents` de cliente**.
Solo consulta eventos duraderos. Por eso un cliente lento o ausente no entra en
la cadena de callbacks que espera `createRuntimeEventSink`.

No cambiar la semantica global del sink ni ignorar sus errores: el test actual
`persists buffered text even when the observer fails` debe conservarse y pasar.
CLI/TUI mantienen su politica de errores de streams/renderizado.

- Conservar los limites de pagina existentes, sus IDs y filtros por run.
- El cliente conserva el ultimo ID recibido y vuelve a consultar `afterId`.
  No hacer `getEvents()` completo seguido de slice ni generar otro contador.
- Snapshot y pagina no son una lectura atomica conjunta. Son consultas sucesivas;
  no prometer sincronizacion perfecta. Una nueva consulta converge al estado
  persistido. El historial sirve para mostrar progreso, no para ejecutar pasos.
- El texto aun bufferizado por el sink no aparece hasta su flush existente.
  No prometer streaming caracter a caracter ni eventos no persistidos.
- Registrar consultas admitidas para que close espere su finalizacion. Una
  lectura concurrente puede fallar sin abortar al agente; se devuelve su error
  al cliente. No crear cachés ni almacenar transcripciones por cliente.

## Lista de tareas

### Fase 1: Prerrequisitos y preparacion (sin nueva funcionalidad)

- [x] **Tarea 1.1: Proteger el baseline y habilitar la ejecucion del plan**
  - **Archivo:** `TODO.md` (solo registro de autorizacion y verificaciones).
  - **Descripcion:** leer AGENTS.md, este plan y la vision. Registrar `git status --short`; hay modificaciones previas en runtime, application, storage, tests y docs. Obtener aprobacion de implementacion y una base aislada/autorizada antes de commits. No incorporar trabajo ajeno, restaurar archivos ni crear worktrees automaticamente.
  - **Politica de pruebas:** este hito requiere TDD y regresion. La copia TUI documenta una pausa anterior; no usarla para omitir pruebas y declarar este hito terminado. Si el propietario mantiene una pausa global, detenerse y pedir que autorice las verificaciones antes de implementar. No reabrir la validacion humana de la TUI.
  - **Evitar:** git add ., commits del baseline ajeno, formateo global, instalar paquetes, lanzar Binaflow contra si mismo o modelos reales.
  - **Verificacion:** `git status --short`; `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`. Registrar cada resultado real. Fallos previos bloqueantes se reportan sin repararlos por inferencia.
  - **Commit Msg:** `docs: record execution host prerequisites` (solo al aislar cambios propios y recibir autorizacion; nunca crear un commit vacio).

- [x] **Tarea 1.2: Compartir la composicion sin cambiar el contexto adjunto**
  - **Archivo:** `src/application/runtime.ts`; `test/application-runtime.test.ts` solo para una regresion observable si la existente no protege el cambio.
  - **Funciones:** `openApplicationContext`; nuevo helper privado `openApplicationResources`.
  - **Descripcion:** extraer la construccion existente a ese helper privado, conservando argumentos, carga de configuracion, recursos, coordinadores, eventSink y orden. El helper retorna application, close y findRun como clausura interna sobre store.getRun. El wrapper publico devuelve solamente application y close como hoy. Esto permite un segundo consumidor sin duplicar todo runtime ni exponer el store.
  - **Evitar:** cambiar ApplicationService, OpenApplicationOptions, openApplicationStorage, createRuntimeEventSink, tratamiento de errores de observers o semantica de cierre del contexto adjunto. No agregar hooks para inyectar drivers de pruebas en la API de produccion.
  - **Verificacion:** `pnpm exec vitest run test/application-runtime.test.ts test/architecture-boundaries.test.ts`; `pnpm run typecheck`. Deben pasar antes y despues, con el comportamiento de observer fallido intacto.
  - **Commit Msg:** `refactor: share application runtime composition privately`

### Fase 2: Implementacion funcional

- [x] **Tarea 2.1: Crear el propietario y su cierre seguro**
  - **Archivo:** nuevo `src/application/execution-host.ts`; nuevo `test/execution-host.test.ts`.
  - **Funciones:** tipos ExecutionHost/ExecutionHostClient; createExecutionHost; start, cancel, close y helpers privados de seguimiento de operacion necesarios para el contrato C.
  - **Descripcion:** implementar el propietario por composicion; usar clase solo para errores con codigo estable si se necesita. Comenzar con servicio falso controlable. El recibo de start espera onRunStarted, la operacion completa permanece observada y el cierre espera todo el trabajo admitido. Controlar carreras antes/despues de persistir y errores posteriores a devolver recibo. Los detalles de replay persistido se completan en 2.2 antes de conectar la fabrica a produccion.
  - **Evitar:** polling interno, gestores de procesos nuevos, un owner por cliente, duplicar el lifecycle TUI, exponer controller/promesa, silenciar errores o usar setTimeout para ordenar pruebas.
  - **Verificacion / TDD:** en `test/execution-host.test.ts`, usar promesas diferidas liberadas explicitamente. Probar recibo vs finalizacion, inicio que falla, cancelacion repetida y cierre en medio de arranque/operacion. Comprobar que close del contexto ocurre despues de resolver limpieza y exactamente una vez. RED -> GREEN con `pnpm exec vitest run test/execution-host.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: own workflow execution independently of clients`

- [x] **Tarea 2.2: Deduplicar inicios contra el estado persistido**
  - **Archivo:** `src/application/execution-host.ts`; `test/execution-host.test.ts`.
  - **Funciones:** start; helpers privados de validacion de request y comprobacion de run.input.
  - **Descripcion:** aplicar todo el contrato B. Usar el ID estable y lectura del run/input existentes, sin nuevo store, tabla o hash persistido. Reservar la ranura antes de awaits; comparar copias del request, no objetos que el consumidor pueda mutar. Respetar la distincion entre replay, busy, conflicto e input corrupto. La promesa devuelta a un cliente no libera la operacion.
  - **Evitar:** consultar y luego iniciar sin ranura, deduplicar por objetivo solamente, confiar solo en memoria, transformar un start repetido en resume, comparar con previews truncados o aceptar el mismo ID con otro workflow/objetivo.
  - **Verificacion / TDD:** pruebas simultaneas del mismo request con una sola llamada runWorkflow; mismo ID/distinto contenido y distinto ID ocupado sin efectos; replay tras recrear host con el mismo almacenamiento, sin nuevas llamadas al agente; input ausente/corrupto no ejecuta. `pnpm exec vitest run test/execution-host.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: deduplicate hosted starts using persisted run identity`

- [x] **Tarea 2.3: Consultar progreso sin suscripciones de clientes**
  - **Archivo:** `src/application/execution-host.ts`; `test/execution-host.test.ts`.
  - **Funciones:** client.listRuns, client.getRunView, client.listRunEvents; seguimiento privado de consultas admitidas.
  - **Descripcion:** delegar en ApplicationService y conservar DTOs/paginacion. Seguir contrato D: ninguna lectura ejecuta agentes ni registra observers. close impide consultas nuevas y espera las que ya comenzo; el fallo de una consulta se devuelve sin abortar el workflow.
  - **Evitar:** callbacks desde el motor a clientes, event bus, colas, APIs attach/detach decorativas, duplicar paginas en memoria, sincronizar snapshot y eventos por timestamps o aumentar limites existentes.
  - **Verificacion / TDD:** una consulta del cliente A queda pendiente mientras la operacion avanza; el cliente B consulta independientemente. Rechazar una lectura no aborta el controller. close espera la lectura admitida y rechaza lecturas nuevas. `pnpm exec vitest run test/execution-host.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: expose persisted execution progress through client queries`

- [x] **Tarea 2.4: Componer el anfitrion sin alterar CLI ni TUI**
  - **Archivo:** `src/application/runtime.ts`; `test/application-runtime.test.ts`.
  - **Funciones:** nuevo `openExecutionHost`; helper privado openApplicationResources de 1.2.
  - **Descripcion:** openExecutionHost acepta cwd/configPath y compone recursos sin onEvent. Entrega application, findRun y close privados a createExecutionHost y devuelve su resultado. No expone contexto adicional. Si crear el host falla despues de abrir recursos, cerrarlos antes de propagar error. Mantener los dos entry points existentes sin cambios publicos.
  - **Evitar:** servidor HTTP, comando CLI nuevo, proceso residente instalado, callbacks de red, modos globales de aislamiento de observers, nueva opcion de driver publico para tests o una ruta de cierre paralela al host.
  - **Verificacion / TDD:** con config valida en directorio temporal, abrir/cerrar un host sin iniciar Pi; comprobar que client no expone close, application ni subscribeEvents. Conservar pruebas del contexto adjunto y sink. `pnpm exec vitest run test/application-runtime.test.ts test/execution-host.test.ts test/architecture-boundaries.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: compose a client-independent execution host`

### Fase 3: Verificacion integrada y cierre documental

- [ ] **Tarea 3.1: Probar cambio de cliente con persistencia real**
  - **Archivo:** nuevo `test/execution-host-integration.test.ts`; ajustes solo en `src/application/execution-host.ts` y `src/application/runtime.ts` si las pruebas descubren incumplimientos de los contratos definidos aqui.
  - **Funciones:** fixtures locales de servicio real, driver falso controlable y clientes que llaman al objeto client; no utilidades compartidas de pruebas ni cambios a fixtures TUI.
  - **Descripcion:** componer SqliteRunStore, FileArtifactStore, WorkflowEngine, ApplicationService y createRuntimeEventSink existentes con un AgentDriver falso, usando plan-build y sus schemas reales. Consultar test/engine.test.ts como referencia sin exportar/reutilizar sus internals. No ejecutar Pi real. Reusar un fixture local por test y cerrar recursos en finally/afterEach.
  - **Escenario principal:** A inicia un request; se persiste y termina plan; builder queda pausado en una promesa de test. A deja de consultar; B usa listRuns/getRunView y pagina eventos por afterId. Liberar builder; B observa completed con artefactos persistidos. Cada paso se ejecuto una sola vez.
  - **Escenarios de seguridad:** repetir ese start tras cerrar y recrear el host devuelve el mismo ID sin driver; otro objetivo con ese ID falla sin mutar. Cancelar durante builder conserva plan completado y espera cleanup. Fallar persistencia del sink se propaga y no se disfraza de cliente desconectado. Usar barreras/promesas, no pausas de milisegundos arbitrarias.
  - **Recuperacion:** observar un run interrupted no inicia agentes. Reusar el camino existente para una prueba de resume explicito que conserva el plan completado; no agregar resume al cliente de este hito. No marcar interrupted un run que tiene owner vivo para facilitar el fixture.
  - **Verificacion / TDD:** `pnpm exec vitest run test/execution-host-integration.test.ts test/execution-host.test.ts test/application-runtime.test.ts test/application-claims.test.ts test/engine.test.ts`. Escribir primero cada caso que falle y corregir solo el incumplimiento previsto. No duplicar permutaciones equivalentes.
  - **Commit Msg:** `test: verify hosted execution reconnection and recovery boundaries`

- [ ] **Tarea 3.2: Verificar compatibilidad y registrar el resultado real**
  - **Archivo:** `docs/web-workflow-vision.md` (solo estado del hito 1 y limites comprobados); `TODO.md` (checks, comandos, resultados y pendientes).
  - **Descripcion:** ejecutar las cinco verificaciones obligatorias. Registrar diferencias frente al baseline de 1.1; no modificar archivos ajenos para hacerlas pasar. Explicar que se ha probado el backend con clientes simulados, no navegadores reales, autenticacion ni despliegue remoto. Conservar la copia TUI intacta.
  - **Verificacion:** `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`; `git diff --check`; revisar `git status --short` y diff de cada commit propio. Formatear solo archivos propios, no `pnpm run format` global. Ningun bundle, release, instalacion ni prueba Pi pagada.
  - **Aceptacion:** desconexion no cancela ni bloquea; queries recuperan estado y eventos; replay no duplica; cierre/cancelacion esperan limpieza; interfaces adjuntas y protocolo v1 conservados. Si falta evidencia o hay fallos bloqueantes, no marcar completado ni retirar TODO.
  - **Commit Msg:** `docs: document verified execution host behavior`

## Reglas de operacion para el sub-modelo

1. **Un check a la vez:** solo marcar [x] con verificacion exitosa y evidencia. No
   avanzar si queda una desviacion o requisito de la tarea pendiente. Actualizar
   el registro de abajo; no sustituir el resultado real por "deberia pasar".
2. **Commits aislados:** tras autorizacion de implementacion, commit por tarea con
   su mensaje y staging explicito. No mezclar refactor con feature ni incluir
   baseline ajeno. Si no es separable, detener y pedir aislamiento; nunca reset,
   clean, stash, revert ni git add . para obtener un arbol limpio.
3. **No improvisar:** se permiten solo los helpers privados nombrados por proposito
   en estas tareas. Otra funcion compartida, archivo, firma publica, dependencia
   o cambio de contrato requiere actualizar y aprobar el plan antes de continuar.
4. **No expandir scope:** no corregir la TUI pendiente, generar nuevos workflows,
   habilitar busqueda web, hacer commits de codigo del workspace del usuario ni
   introducir infraestructura para los hitos 2-6.
5. **Retiro del TODO:** solo despues de checks completos, regresion verificada y
   commits terminados. El skill exige arbol limpio antes de retirarlo: si siguen
   cambios previos ajenos, informar y pedir decision; nunca borrarlos para cumplir.
   Antes de la eliminacion destructiva, solicitar confirmacion de cierre. Tras
   confirmacion, retirar solo este TODO con `git rm -- TODO.md` y commit
   `docs: retire completed execution host plan`. Mantener vision y copia TUI.

## Protocolo de desviacion

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos y verificaciones>
Propuesta: <cambio minimo solicitado>
```

Detener la tarea sin check. El orquestador debe corregir el plan antes de autorizar
continuacion. Un fallo previo de formato/test no es permiso para limpiar el repo.

## Registro de ejecucion

- Autorizacion de implementacion: concedida por el propietario mediante la solicitud `ejecuta TODO`.
- Baseline: registrado con `git status --short`; el worktree contiene cambios
  anteriores y no esta limpio.
- Verificaciones iniciales: `pnpm run format:check` fallo en 52 archivos y
  `pnpm run test` fallo en 25 de 319 tests; `lint`, `typecheck`, `build` y el
  primer `git diff --check` pasaron.
- Correcciones de baseline: se repararon los recorridos TUI que no alcanzaban
  `Configuration readiness`, el diagnóstico de migraciones y la vista viva de
  una ejecución adjunta. Se formatearon los 47 archivos reportados por Prettier
  con autorización explícita, incluida la copia TUI sin ejecutar sus tareas, y
  se normalizaron los finales de línea de `pnpm-lock.yaml`.
- Verificación focalizada: `pnpm exec vitest run test/tui-reduce.test.ts
  test/tui-ink-shell.test.ts test/tui-setup-safety.test.ts test/migrations.test.ts`
  pasó (61 tests).
- Verificaciones finales de Tarea 1.1: `pnpm run format:check`, `pnpm run lint`,
  `pnpm run typecheck`, `pnpm run test` (318 pasaron, 1 omitido de 319),
  `pnpm run build` y `git diff --check` pasaron.
- Tarea 1.2: se extrajo la composición a `openApplicationResources` en
  `src/application/runtime.ts`, conservando el wrapper público y el sink. La
  regresión requerida pasó: `test/application-runtime.test.ts` y
  `test/architecture-boundaries.test.ts` (9 tests), además de `typecheck`.
- Tarea 1.2 quedó aislada en el commit `6bc391b` con mensaje
  `refactor: share application runtime composition privately`.
- Tarea 2.1: se creó `src/application/execution-host.ts` con propiedad única de
  la operación, recibo separado de finalización, cancelación idempotente y
  cierre seguro del contexto. Las pruebas usan promesas diferidas y servicio
  falso controlable.
- Tarea 2.2: se añadieron validación de solicitudes, ranura de inicio,
  deduplicación en vuelo y replay validado mediante `run.input` acotado, sin
  nuevas tablas ni llamadas duplicadas al agente.
- Tarea 2.3: las consultas del cliente delegan en la aplicación y quedan
  admitidas en seguimiento privado; `close()` espera las consultas pendientes
  y rechaza las nuevas sin cancelar la operación.
- Verificación Tarea 2.3: `pnpm exec vitest run test/execution-host.test.ts`
  (14 tests), `pnpm run typecheck`, `pnpm run lint`,
  `pnpm run format:check` y `git diff --check` pasaron.
- Tarea 2.4: se añadió `openExecutionHost` sobre la composición privada
  existente; crea un cliente sin recursos internos ni observers y limpia los
  recursos si la creación falla.
- Verificación Tarea 2.4: `pnpm exec vitest run test/application-runtime.test.ts
  test/execution-host.test.ts test/architecture-boundaries.test.ts` (24 tests),
  `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` y
  `git diff --check` pasaron.
- Los cambios previos y de baseline quedaron registrados en el commit `09e9978`
  con mensaje `docs: record execution host prerequisites`.
- Copia del plan anterior: SHA-256
  `f9d24ba21be8c638cdd63c5f9405a0243338140460957f17c4368c08fe8b338e`.
- Proxima tarea autorizada: 3.1.
