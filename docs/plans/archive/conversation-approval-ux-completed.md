# PLAN DE EJECUCION: Conversacion, Aprobacion Explicita Y UX

> ATENCION SUB-AGENTE: Sigue este plan secuencialmente. No implementes tareas futuras ni agregues abstracciones especulativas. Si un contrato existente impide una tarea, deten esa tarea y presenta el bloqueo antes de ampliar el alcance. Crear este plan no autoriza commits, publicacion ni eliminacion automatica del archivo.

## Objetivo Y Alcance

Permitir el recorrido: idea incompleta -> conversacion -> propuesta concreta -> aprobacion explicita -> ejecucion comprensible -> revision de QA -> entrega revisable.

- Preparacion conversacional para `plan-build` y `plan-build-qa-interactive`.
- Conversacion primero: no exigir un objetivo completo ni generar obligatoriamente un plan antes de preguntar.
- Conversacion sobre hallazgos en el QA interactivo existente.
- Botones seleccionables por teclado para aprobar y ejecutar; el texto del chat nunca autoriza transiciones.
- Mejoras de seguimiento y resultado final en la TUI existente, conservando su lenguaje visual.
- Mantener CLI no interactiva, protocolo-v1, runs persistidos y perfiles logicos compatibles.
- Fuera de alcance: pausa durante build, daemon, sesiones Pi permanentes, nuevos drivers, aprobaciones/loops/DAG genericos y nuevos ciclos automaticos de QA.

## Decisiones De Producto Y Arquitectura

- La TUI ofrece preparacion conversacional como entrada habitual para ambos workflows y lanzamiento directo como alternativa explicita. La CLI conserva sus valores por defecto.
- La preparacion es un borrador persistido separado de un run. No crear runs ficticios ni relajar la validacion de objetivos de los workflows.
- El agente puede preguntar o presentar una propuesta durante el dialogo. No es obligatorio un boton adicional para generar cada propuesta.
- Una propuesta ejecutable contiene objetivo definitivo y outputs validados del workflow. No puede contener preguntas pendientes de aclaracion; los riesgos declarados no son por si solos preguntas pendientes.
- `Aprobar plan y ejecutar` autoriza la version visible del objetivo, plan y permisos. No inferir consentimiento de mensajes como "si", "dale" o "ejecuta".
- Enviar otro mensaje invalida la propuesta ejecutable anterior hasta publicar una propuesta vigente. Durante generacion no se puede aprobar.
- El handoff crea el run y persiste outputs aprobados de planificacion con resultados y referencias transaccionalmente. No regenerar el plan aprobado ni simular nuevas llamadas del planner.
- Para `plan-build`, importar el resultado validado de `plan`; para el interactivo, scope y plan, junto con el registro de aprobacion correspondiente. Verificar los identificadores reales contra las definiciones existentes.
- La conversacion de QA conserva threads vinculados al run. Una respuesta explica o aclara; solo una accion humana explicita dispone hallazgos, autoriza correcciones o finaliza.
- Mantener el modelo actual de correcciones por lote. La accion que inicia fixes debe mostrar el conjunto autorizado; aceptar resultado no inicia trabajo adicional.
- Compartir componentes de presentacion solo cuando exista reutilizacion real. No unificar borradores y reviews en un framework de conversacion.
- Revalidar workspace, versiones, schemas, artifacts y perfiles antes de ejecutar. No prometer detectar cualquier cambio externo del repositorio ni introducir snapshots/worktrees.

## Lista De Tareas

### Fase 1: Prerrequisitos Y Contratos

No se requiere un refactor preparatorio. Revisar las firmas actuales antes de editar; los nombres nuevos que aparecen abajo describen contratos propuestos, no APIs existentes.

- [x] **Tarea 1.1: Definir contratos de preparacion**
  - **Archivos:** nuevos `src/application/preparation.ts` y `test/preparation.test.ts`; `src/application/ports.ts`; consultar `src/workflows/plan-build.ts` y `src/workflows/plan-build-qa-interactive.ts`.
  - **Descripcion:** definir borrador, mensaje, estado de generacion, propuesta inmutable y revision esperada. Exponer contratos estrechos de almacenamiento y artifacts consumidos por aplicacion. Reutilizar schemas de outputs existentes; versionar el contrato de preparacion independientemente de workflows sin cambios semanticos.
  - **Aceptacion:** idea vacia/incompleta valida como borrador; objetivo definitivo no vacio; propuesta ejecutable solo con outputs validos y sin aclaraciones pendientes. `needs_clarification` no es ejecutable. El schema del agente no admite campos de autorizacion o ejecucion.
  - **Evitar:** modificar validacion generica, duplicar schemas existentes o implementar operaciones antes de sus contratos.
  - **Verificacion / TDD:** `pnpm exec vitest run test/preparation.test.ts`; cubrir respuesta conversacional, propuesta valida y rechazo de propuesta no ejecutable.
  - **Commit Msg sugerido:** `feat: define conversational preparation contracts`

- [x] **Tarea 1.2: Persistir borradores y propuestas con ownership**
  - **Archivos:** `src/storage/sqlite-run-store.ts`, `src/storage/migrations/index.ts`, nueva `src/storage/migrations/010-preparation.ts`, nuevo `test/preparation-persistence.test.ts`, `test/migrations.test.ts`. Confirmar el siguiente numero disponible de migracion antes de crearla.
  - **Funciones:** implementar las operaciones de preparacion de `ApplicationPreparationStore` definido en 1.1; integrar recuperacion con los mecanismos existentes de identidad de proceso.
  - **Descripcion:** almacenar workspace canonico, workflow/version, revision, mensajes ordenados, propuestas inmutables, perfil/procedencia y eventual run vinculado. Reclamar turnos y publicar respuestas con CAS. Un usuario enviado queda persistido; la generacion pendiente pertenece a la respuesta del agente.
  - **Aceptacion:** reabrir conserva contexto; un solo propietario por borrador; revisiones obsoletas no mutan datos. Recuperar respuestas abandonadas como interrumpidas sin ejecutar agentes automaticamente. Una respuesta ya persistida no se regenera por un fallo de refresco de UI.
  - **Evitar:** transcripts ilimitados en SQLite, artifacts de borrador con referencias a runs ficticios, reemplazo destructivo de propuestas y cambios a migraciones aplicadas.
  - **Verificacion / TDD:** `pnpm exec vitest run test/preparation-persistence.test.ts test/migrations.test.ts`; verificar reapertura, exclusion entre conexiones, recuperacion y upgrade con datos anteriores.
  - **Commit Msg sugerido:** `feat: persist preparation drafts and proposal revisions`

### Fase 2: Implementacion Funcional

- [x] **Tarea 2.1: Ejecutar conversacion de preparacion en solo lectura**
  - **Archivos:** nuevo `src/application/preparation-operations.ts`; `src/application/service.ts`, `src/application/context.ts`, `src/application/runtime.ts`; `test/preparation.test.ts`, `test/preparation-persistence.test.ts`.
  - **Funciones:** agregar `createPreparation`, `listPreparations`, `getPreparation` y `replyPreparation` a la fachada y su composicion existente.
  - **Descripcion:** un turno acotado por mensaje, usando perfil logico `planner` validado como solo lectura. Construir contexto limitado con objetivo, propuesta y mensajes pertinentes. Permitir respuesta con preguntas o propuesta validada. Mantener eventos de borrador separados de eventos persistidos de runs; adaptar el driver existente sin modificar protocolo Pi.
  - **Aceptacion:** ninguna respuesta inicia build; cancelar/timeout conserva mensaje y propuesta historica, marca respuesta fallida/interrumpida y limpia recursos. No liberar ownership antes de persistir respuesta. Reintento explicito, nunca automatico tras reinicio.
  - **Evitar:** sesiones de harness permanentes, acceso al driver desde TUI y meter todo el transcript en prompts downstream.
  - **Verificacion / TDD:** `pnpm exec vitest run test/preparation.test.ts test/preparation-persistence.test.ts`; usar driver falso para preguntas, propuesta, texto de supuesto consentimiento, cancelacion y perfil con escritura rechazado antes de ejecutar.
  - **Commit Msg sugerido:** `feat: add read-only preparation conversations`

- [x] **Tarea 2.2: Transferir propuesta aprobada a ejecucion atomica**
  - **Archivos:** `src/application/preparation-operations.ts`, `src/application/execution-operations.ts`, `src/application/ports.ts`, `src/storage/sqlite-run-store.ts`; tests de preparacion y `test/interactive-review-workflow.test.ts`.
  - **Funciones:** nueva `approveAndExecutePreparation` y operacion estrecha `createRunFromPreparation`; reutilizar internamente `executeClaimedWorkflow` / `executeWorkflow` sin exponer una opcion generica para saltar pasos.
  - **Descripcion:** preflight no mutante de revision, readiness, versiones, workspace, perfiles y artifacts. Escribir archivos antes de publicar referencias. En una transaccion registrar aprobacion humana, consumir propuesta, crear run/claim y persistir pasos de planificacion completados con outputs, resultados y referencias. Limpiar archivos no publicados tras fallo. Conservar procedencia real del trabajo de preparacion.
  - **Aceptacion:** ambos workflows consumen exactamente el plan aprobado sin otra llamada al planner. En el interactivo se evita solo el checkpoint de scope ya aprobado; se conservan revisiones posteriores. Doble aprobacion no crea dos runs. Crash posterior al commit permite recuperar sin replanning; un rechazo previo no modifica run ni borrador.
  - **Evitar:** crear run y marcar borrador consumido en transacciones separadas; sobrescribir outputs completados; alterar el motor secuencial o runs existentes.
  - **Verificacion / TDD:** `pnpm exec vitest run test/preparation.test.ts test/preparation-persistence.test.ts test/interactive-review-workflow.test.ts`; incluir aprobacion concurrente y recuperacion en el limite transaccional.
  - **Commit Msg sugerido:** `feat: execute approved preparation without replanning`

- [x] **Tarea 2.3: Responder conversaciones de QA sin transiciones implicitas**
  - **Archivos:** `src/application/review-operations.ts`, `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/service.ts`, `src/core/interactive-review.ts`, `src/application/ports.ts`, `src/storage/sqlite-run-store.ts`; tests existentes de review. Si hacen falta nuevos campos persistidos, agregar la siguiente migracion aditiva y su prueba en `test/migrations.test.ts`.
  - **Funciones:** agregar operacion conversacional junto a `postReviewMessage` / `explainReview`; ajustar `continueReview`, `finalizeReview` y `advance` solo en lo necesario para autorizacion segura.
  - **Descripcion:** responder automaticamente desde la TUI con perfil logico QA de solo lectura, hallazgo actual, evidencia y mensajes pertinentes. Preservar semantica de message-only de CLI. Publicar respuesta antes de liberar claim. Vincular decisiones nuevas a revision/artifact mostrado; validar accion/estado y reclamar ejecucion atomicamente. Usar cleanup que capture tambien rechazos asincronos de continuaciones.
  - **Aceptacion:** conversar no corrige, acepta riesgos ni finaliza. Una decision obsoleta o concurrente pierde sin mutacion. El fix recibe solo hallazgos autorizados y aclaraciones acordadas, no instrucciones para corregir riesgos aceptados. Conservar semantica de runs antiguos; no permitir que una ruta legacy eluda revision obligatoria en propuestas nuevas.
  - **Evitar:** adjudicacion automatica con efectos, cambios silenciosos a envelopes CLI y nuevos ciclos de QA.
  - **Verificacion / TDD:** `pnpm exec vitest run test/interactive-review-contracts.test.ts test/interactive-review-workflow.test.ts test/interactive-review-persistence.test.ts test/application-claims.test.ts test/cli-review.test.ts test/migrations.test.ts`.
  - **Commit Msg sugerido:** `feat: add revision-safe QA conversations and decisions`

### Fase 3: Experiencia TUI

- [x] **Tarea 3.1: Incorporar preparacion y reapertura de borradores**
  - **Archivos:** nuevo `src/tui/screens/preparation.tsx`; `src/tui/launch.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-view.tsx`, `src/tui/shell-controller.tsx`; tests TUI existentes.
  - **Funciones:** rutas/eventos de `TuiState`, `TuiEvent`, `reduce`, render en shell y operaciones de `InkShellController`; reutilizar `createAttachedExecutionLifecycle`.
  - **Descripcion:** entrada conversacional para ambos workflows, alternativa directa y lista/reapertura de borradores. Mostrar conversacion, propuesta vigente, objetivo y permisos. Turnos bajo lifecycle adjunto sin emitir `run-started` hasta crear el run real. Incorporar la accion de aprobacion inicialmente protegida por foco explicito; 3.2 completa consistencia de todas las pantallas.
  - **Aceptacion:** empezar con idea incompleta, cerrar y reabrir, cancelar respuesta sin perder contexto y pasar al build aprobado. Deshabilitar aprobacion durante generacion/sin propuesta vigente; conservar borrador ante fallo. Revalidar permisos al ejecutar.
  - **Evitar:** relajar validadores de lanzamiento directo, acceso directo a SQLite/artifacts o segundo propietario de lifecycle.
  - **Verificacion / TDD:** `pnpm exec vitest run test/tui-ink-shell.test.ts test/tui-ink-execution.test.ts test/tui-lifecycle.test.ts`.
  - **Commit Msg sugerido:** `feat: add conversational preparation to the TUI`

- [x] **Tarea 3.2: Separar editor y controles de aprobacion**
  - **Archivos:** `src/tui/screens/preparation.tsx`, `src/tui/screens/review-thread.tsx`, `src/tui/screens/qa-review.tsx`, `src/tui/shell-input.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-controller.tsx`, `src/tui/shell-view.tsx`, `src/tui/layout.tsx`; reutilizar componentes de `src/tui/components.tsx`.
  - **Funciones:** `ReviewThreadScreen`, `QaReviewScreen`, `handleShellInput`, handlers de review y `footerHints`.
  - **Descripcion:** foco editor/acciones con Tab y Enter, Escape para volver y Ctrl-C por lifecycle existente. Mostrar revision y efecto de `Aprobar plan y ejecutar`, `Aprobar correcciones y ejecutar` o `Aceptar resultado` cuando correspondan. Acotar transcript y mantener acciones/editor accesibles. Enviar invoca la operacion conversacional, no solo publicar texto.
  - **Aceptacion:** escribir/pegar `qEACF`, "aprobar" o "ejecutar" no dispara acciones; Enter en editor solo envia. Bloquear vacios/duplicados antes de llamar fachada. Conservar draft ante fallo y limpiar tras exito. Ignorar respuestas tardias de otra pantalla/run/thread. Deshabilitar controles con revision obsoleta o generacion pendiente.
  - **Evitar:** atajos de letras activos mientras se escribe, necesidad de mouse y framework nuevo de UI.
  - **Verificacion / TDD:** `pnpm exec vitest run test/tui-review.test.tsx test/tui-reduce.test.ts test/tui-ink-shell.test.ts test/tui-ink-viewport.test.ts`; incluir pruebas reales de entrada Ink, no solo reducer.
  - **Commit Msg sugerido:** `feat: add focus-safe explicit execution controls`

- [x] **Tarea 3.3: Explicar estado y actividad de ejecucion**
  - **Archivos:** `src/tui/screens/live.tsx`, `src/tui/execution.ts`; `test/tui-ink-shell.test.ts`, `test/tui-ink-execution.test.ts`.
  - **Funciones:** `LiveScreen`, `StepChecklistRow`, `formatStepMeta`; extender `LiveState` solo si falta un dato ya disponible en eventos normalizados.
  - **Descripcion:** priorizar estado humano, fase/perfil actual, proposito conocido y ultima actividad reportada. Mantener checklist y log tecnico secundario con toggle existente. Distinguir espera humana y cancelacion solicitada.
  - **Aceptacion:** ausencia de eventos no se llama bloqueo; metricas desconocidas no son cero; no confundir duracion del run con tiempo activo del agente. Mantener buffers acotados, coalescing y cancelacion ordenada.
  - **Evitar:** porcentajes/ETA ficticios, inferir "editando" o "probando" sin evidencia, nuevo polling de progreso.
  - **Verificacion / TDD:** `pnpm exec vitest run test/tui-ink-shell.test.ts test/tui-ink-execution.test.ts`; fixtures de running sin actividad, waiting, cancelling, error y metricas ausentes.
  - **Commit Msg sugerido:** `feat: clarify live execution status and activity`

- [x] **Tarea 3.4: Presentar resultado y siguiente accion antes de detalles**
  - **Archivos:** `src/tui/screens/result.tsx`, `src/application/run-view.ts`, `src/tui/shell-controller.tsx`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`, `src/tui/shell-view.tsx`, `src/tui/layout.tsx`; tests TUI existentes.
  - **Funciones:** `ResultScreen`, proyeccion de `RunView`, `loadArtifact`, navegacion de resultados/artifacts.
  - **Descripcion:** objetivo, desenlace disponible, resumen existente, verificaciones reportadas, pendientes y siguiente accion; despues metricas/checklist. Reutilizar `todoResult` e informes existentes. Ofrecer abrir directamente resultado del builder/informe final mediante fachada. Hacer visibles aclaraciones pendientes tambien en runs terminados.
  - **Aceptacion:** `completed` no implica implementacion verificada. Sin resumen estructurado, mostrar limitacion y output disponible; no inventar conclusiones. Resultados largos navegables y fallos de lectura recuperables. Presentar hallazgos/verificaciones como reportados, no como garantia independiente.
  - **Evitar:** otra llamada LLM para resumir, lectura de archivos desde TUI o cambiar contratos de outputs persistidos.
  - **Verificacion / TDD:** `pnpm exec vitest run test/tui-ink-shell.test.ts test/tui-reduce.test.ts test/tui-ink-viewport.test.ts`; cubrir resumen, pendientes, aclaraciones, fallback y seleccion de informe.
  - **Commit Msg sugerido:** `feat: present workflow outcomes before execution metadata`

### Fase 4: Documentacion Y Validacion Final

- [x] **Tarea 4.1: Documentar recorrido y verificar regresion**
  - **Archivos:** `README.md`, tests anteriores; `test/cli-protocol.test.ts` solo si falta una proteccion significativa de comportamiento previo.
  - **Descripcion:** documentar preparacion, lanzamiento directo, aprobacion versionada, QA conversacional, recuperacion y limites. Ejecutar recorridos con driver falso para ambos workflows y QA. Revisar diff final para evitar cambios fuera de alcance.
  - **Aceptacion:** idea incompleta -> preguntas -> propuesta -> aprobacion humana -> build exacto sin replanning -> QA sin efectos de chat -> correcciones autorizadas -> entrega. Runs antiguos y CLI no interactiva siguen funcionando. Registrar resultados y limitaciones reales en handover.
  - **Verificacion:** ejecutar cada comando por separado desde la raiz: `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
  - **Evitar:** bundle Linux, instalacion, publicacion o live Pi sin solicitud adicional. No usar numero de tests/cobertura como objetivo.
  - **Commit Msg sugerido:** `docs: describe conversational preparation and explicit approval`

## Notas De Implementacion

- La conversación de preparación usa respuestas JSON con `kind=message|proposal`; texto no JSON se conserva como respuesta conversacional, sin autorizar ejecución.
- Los artifacts de preparación se escriben con el `runId` real antes del handoff y solo se eliminan si la transacción no llega a commit.
- El perfil `qa` se usa para conversación QA cuando está configurado; se permite `analyst` como fallback compatible con configuraciones existentes, siempre validado como solo lectura.
- El bundle Windows se distribuye como ZIP portable x64 y conserva el bundle Linux como target independiente; la instalación de dependencias Windows usa npm y no modifica el lockfile pnpm del proyecto.

## Reglas De Operacion Para El Sub-Modelo

1. Una tarea a la vez. No marcar `[x]` hasta implementar y verificar su comportamiento; conservar evidencia de comandos y resultado.
2. Mantener cambios atomicos y enfocados. Los mensajes de commit son sugerencias para cuando el usuario autorice commits, no autorizacion actual.
3. No revertir ni incluir cambios ajenos. Revisar estado y diff antes de entregar; un worktree con cambios ajenos no es un fallo de esta tarea.
4. No agregar helpers/capas sin necesidad concreta. Si una firma o frontera no permite la solucion descrita, detener la tarea y proponer ajuste antes de ampliar arquitectura.
5. Preservar versiones, envelopes CLI, ordering, separacion de streams y exit codes. Migraciones siempre aditivas.
6. Todas las operaciones adjuntas comparten shutdown ordenado: primer cancel graceful; segundo espera cleanup antes de force. No cerrar SQLite con ejecucion o persistencia activa.
7. No consumir historias completas en prompts downstream. Entregar objetivo, propuesta aprobada y decisiones relevantes.
8. No eliminar `TODO.md` automaticamente. Entregar a QA con checks, resultados de verificacion y pendientes; el propietario decide su archivo o eliminacion.

## Protocolo De Desviacion

Si una tarea queda bloqueada, no marcarla completa ni arreglar problemas ajenos silenciosamente. Informar:

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho observado>
Impacto: <archivos, contratos y tests>
Propuesta: <ajuste minimo del plan>
```

## Handover Para QA

- Tareas completadas y pendientes: todas las tareas del plan fueron implementadas.
- Comandos y resultados: `typecheck`, `lint`, `build`, formato de los archivos modificados y `npm test` pasan. La suite ejecuta 315 pruebas exitosas y deja 4 omitidas.
- Desviaciones aprobadas: ninguna.
- Riesgos/limitaciones: `format:check` global conserva archivos preexistentes fuera de este cambio; no se ejecutó bundle Linux ni Pi live; no hay pausa durante build ni nuevo ciclo automático de QA.
- Commits/publicacion: no autorizados por este plan.
- QA debe verificar idea incompleta -> pregunta -> propuesta -> aprobación explícita sin replanning.
- QA debe verificar concurrencia de dos conexiones SQLite, recuperación de respuestas pendientes y conservación de artifacts tras un fallo posterior al handoff.
- QA debe verificar que `qEACF`, `aprobar` y `ejecutar` escritos en el editor no disparen controles; solo `Tab` y `Enter` sobre acciones lo hacen.
- QA debe verificar conversación QA sin cambios de estado, aceptación de riesgos, fixes o finalización implícita.
- No se ejecutó Pi live ni bundle Linux en este entorno; la prueba de configuración POSIX fue corregida y la suite pasa en Windows.
- El bundle Windows local fue construido y extraído correctamente; `--version`, `--help` y la carga de `better-sqlite3` pasaron.
