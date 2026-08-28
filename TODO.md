# PLAN DE EJECUCION: Workflow de desarrollo con QA automatico, historial e interaccion CLI/TUI

> ATENCION SUB-AGENTE: Sigue este plan estrictamente en orden. No saltes tareas ni
> agregues abstracciones, workflows, interfaces, drivers o integraciones fuera de
> este documento. Si aparece una desviacion, detente y emite la alerta indicada
> al final. No implementes web, HTTP, daemon, reconexion, plugins genericos, DAGs,
> loops genericos ni aprobaciones genericas.

## Alcance aprobado

- Agregar `plan-build-qa` sin cambiar el comportamiento de `plan-build` ni
  `research-plan-build`.
- Ejecutar fases limpias con perfiles configurables: `analyst`, `planner`,
  `builder` y `qa`; las correcciones reutilizan `builder`.
- El builder ejecuta y declara las verificaciones; el QA read-only revisa el
  codigo, los artefactos y dichos resultados, sin recibir permisos de shell.
- Acotar el QA automatico a tres ejecuciones. `critical` y `high` bloquean;
  `medium` y `low` aparecen en el informe sin iniciar una correccion automatica.
- Agregar tracking de bugs y FTS5 por workspace, controlado exclusivamente por
  `qaHistory.enabled` en la configuracion del workspace. No hay override por run.
- Despues, agregar el workflow interactivo y sus vistas exclusivamente en CLI y
  TUI. Un mensaje o una pregunta no puede avanzar el workflow; solo una decision
  o finalizacion explicita puede hacerlo.
- Los artefactos grandes siguen en `dataDir/artifacts`; `runs.db` persiste sus
  referencias y el estado transaccional. Las migraciones son aditivas.

## Fuera del alcance

- Web, servidor HTTP, API HTTP, daemon, reconexion, workers remotos y sesiones
  web.
- Plannotator y cualquier dependencia de anotacion externa.
- RAG, memoria general, embeddings y busqueda fuera del historial QA local.
- Nuevos harness drivers, ejecucion paralela, worktrees, DAGs, plugins genericos
  o primitivas genericas de loop/aprobacion.
- Conversaciones en `plan-build-qa` automatico.

## Lista de tareas

### Fase 1: Contratos, perfiles y skills (estructura)

- [x] **Tarea 1.1: Definir los contratos versionados del workflow con QA**
  - **Archivos:** crear `src/workflows/plan-build-qa.ts`; modificar `src/workflows/dispositions.ts`; crear `test/plan-build-qa-contracts.test.ts`.
  - **Descripcion:** Definir y validar mediante JSON Schema los resultados de alcance, plan, resultado de build/verificacion y reporte QA. El alcance debe incluir estrategia, dentro/fuera de alcance, criterios de aceptacion, riesgos y preguntas. El plan debe conservar IDs estables de tareas. Cada finding QA debe incluir ID, severidad, categoria, titulo, explicacion, impacto, evidencia, correccion sugerida y verificaciones. Definir disposiciones solo para detener por aclaracion de alcance; no introducir una disposicion generica de aprobacion o loop.
  - **Evitar:** Reutilizar el schema actual de `BuildPlan` sin campos QA, aceptar JSON incompleto, permitir IDs de tarea o finding duplicados, o pasar transcripts entre fases.
  - **Verificacion:** `pnpm test -- test/plan-build-qa-contracts.test.ts`.
  - **Commit Msg:** `feat: define structured plan build qa contracts`

- [x] **Tarea 1.2: Registrar el workflow y diagnosticar sus perfiles requeridos**
  - **Archivos:** modificar `src/workflows/catalog.ts`, `src/application/workflow-operations.ts`, `src/application/config-operations.ts`; crear o ampliar `test/config-operations.test.ts`.
  - **Descripcion:** Registrar `plan-build-qa` con las fases agent `scope`, `plan`, `build`, `qa` y `fix`, usando los perfiles `analyst`, `planner`, `builder` y `qa`. Publicar el contrato y los perfiles requeridos en `workflows`, `doctor` y la TUI existente. Mantener `plan-build` y `research-plan-build` sin cambios de contrato.
  - **Evitar:** Codificar proveedor, modelo o herramientas en la definicion de workflow; convertir `research-plan-build` en una base generica para este workflow.
  - **Verificacion:** `pnpm test -- test/config-operations.test.ts test/cli-output.test.ts`.
  - **Commit Msg:** `feat: register plan build qa workflow`

- [x] **Tarea 1.3: Configurar politicas de skills por perfil de Pi**
  - **Archivos:** modificar `src/core/agent-profile.ts`, `src/config.ts`, `src/drivers/pi-rpc.ts`, `src/application/config-operations.ts`; crear o ampliar `test/config.test.ts` y `test/drivers/contract.test.ts`.
  - **Descripcion:** Extender `AgentProfile` con una politica serializable de skills: `discover`, `none` u `only`, rutas explicitas de skills y nombres requeridos. Validar tipos, rutas no vacias y combinaciones validas; resolver rutas relativas respecto del archivo de configuracion. Hacer que `PiDriver` use `--no-skills` y `--skill` cuando corresponda, consulte `get_commands` antes de ejecutar y falle antes de la tarea si falta una skill requerida. Registrar la politica resuelta en el snapshot `profile_json` de cada intento.
  - **Evitar:** Crear un gestor de plugins, confiar en que el modelo use una skill sin validarla, o permitir que una skill amplie tools/permisos del perfil.
  - **Verificacion:** `pnpm test -- test/config.test.ts test/drivers/contract.test.ts test/config-operations.test.ts`.
  - **Commit Msg:** `feat: configure pi skills per agent profile`

- [x] **Tarea 1.4: Actualizar configuracion inicial y documentacion de perfiles QA**
  - **Archivos:** modificar `src/application/config-operations.ts`, `src/cli/commands/configuration.ts`, `src/tui/launch.ts`, `src/tui/screens/setup.tsx`, `README.md`; ampliar `test/cli.test.ts` y `test/tui-setup-safety.test.ts`.
  - **Descripcion:** Permitir que la configuracion inicial ofrezca perfiles para el workflow QA y muestre claramente sus permisos: analyst/planner/qa read-only y builder read-write. Documentar perfiles con modelos distintos, thinking y skills; documentar que QA analiza los resultados de verificacion declarados por builder y no ejecuta shell por si mismo.
  - **Evitar:** Guardar credenciales, habilitar `bash` en perfiles read-only, o hacer obligatorio el nuevo workflow para configuraciones que solo usan `plan-build`.
  - **Verificacion:** `pnpm test -- test/cli.test.ts test/tui-setup-safety.test.ts test/config-operations.test.ts`.
  - **Commit Msg:** `docs: describe qa workflow profiles and skills`

### Fase 2: Workflow automatico y recuperacion (feature)

- [x] **Tarea 2.1: Persistir artefactos de coordinadores de forma transaccional**
  - **Archivos:** modificar `src/application/ports.ts`, `src/storage/run-store.ts`, `src/storage/sqlite-run-store.ts`, `src/application/runtime.ts`; ampliar `test/persistence.test.ts` y `test/application-infrastructure.test.ts`.
  - **Descripcion:** Agregar al puerto de persistencia una operacion estrecha para registrar referencias de artefactos producidos por un coordinador, sin una ejecucion de agente ficticia. La operacion debe insertar o reemplazar las referencias dentro de una transaccion SQLite y conservar artefactos de iteraciones anteriores bajo nombres distintos. Los archivos se escriben atómicamente antes de registrar su referencia; referencias no registradas tras un fallo son artefactos huerfanos recuperables, nunca resultados completados.
  - **Evitar:** Agregar un paso `report` falso al workflow generico, sobrescribir `qa-report-1`, o cerrar SQLite mientras una escritura de artefactos esta activa.
  - **Verificacion:** `pnpm test -- test/persistence.test.ts test/application-infrastructure.test.ts`.
  - **Commit Msg:** `feat: persist coordinator artifacts atomically`

- [x] **Tarea 2.2: Implementar el coordinador acotado de plan-build-qa**
  - **Archivos:** crear `src/application/plan-build-qa-coordinator.ts`; modificar `src/application/ports.ts`, `src/application/service.ts`, `src/application/runtime.ts`, `src/application/execution-operations.ts`; crear `test/plan-build-qa-workflow.test.ts`.
  - **Descripcion:** Implementar un coordinador exclusivo para `plan-build-qa`, equivalente en alcance al coordinador experimental de research pero sin generalizar loops. Ejecutar `scope`, `plan`, `build` y `qa`; cuando QA devuelva findings bloqueantes, renderizar `QA-FIXES-N.md`, ejecutar `fix` con el perfil builder y repetir QA. Mantener un contador persistido de iteracion, con maximo de tres QA. Reutilizar pasos y artefactos completados durante `resume`; nunca repetir silenciosamente una iteracion QA ya persistida.
  - **Evitar:** Modificar `WorkflowEngine` para introducir loop, condicion o approval genericos; llamar a un agente con el transcript completo de otro agente; aplicar fixes para findings medium/low por defecto.
  - **Verificacion:** `pnpm test -- test/plan-build-qa-workflow.test.ts test/application-claims.test.ts`.
  - **Commit Msg:** `feat: add bounded plan build qa coordinator`

- [x] **Tarea 2.3: Renderizar artefactos humanos y el informe final determinista**
  - **Archivos:** crear `src/workflows/plan-build-qa-render.ts`; modificar `src/application/plan-build-qa-coordinator.ts`; ampliar `test/plan-build-qa-workflow.test.ts`.
  - **Descripcion:** Renderizar desde los JSON validados `SCOPE.md`, `TODO.md`, `QA-FIXES-N.md` y `FINAL-REPORT.md` como artefactos del run. El informe siempre debe generarse, incluso si el limite QA se agota o un paso falla, e incluir objetivo, alcance, tareas, verificaciones declaradas por builder, findings por iteracion, resueltos, pendientes, riesgos, estado final y commits declarados por builder cuando existan. Usar los IDs originales en todas las representaciones.
  - **Evitar:** Pedir a otro agente que invente el informe, escribir `TODO.md` en la raiz del workspace, ocultar findings no bloqueantes o eliminar informes de iteraciones anteriores.
  - **Verificacion:** `pnpm test -- test/plan-build-qa-workflow.test.ts`.
  - **Commit Msg:** `feat: render qa workflow reports`

- [x] **Tarea 2.4: Definir estados terminales y recuperacion del QA automatico**
  - **Archivos:** modificar `src/application/plan-build-qa-coordinator.ts`, `src/application/run-operations.ts`, `src/application/execution-operations.ts`, `src/application/run-view.ts`; ampliar `test/plan-build-qa-workflow.test.ts`, `test/application-operations.test.ts` y `test/application-run-view.test.ts`.
  - **Descripcion:** Hacer que `pass` complete el run, que una aclaracion de alcance termine sin modificar workspace, y que findings bloqueantes tras la tercera QA produzcan `failed` con informe final. Exponer en la vista del run la fase actual, numero de QA, limite, findings bloqueantes y accion de recuperacion valida. Validar que resume sea no mutante ante entradas o estados invalidos y que conserve el ownership exclusivo del run.
  - **Evitar:** Usar `waiting` en el workflow automatico, marcar como completado un run con bloqueos, o reutilizar la semantica de approval de research.
  - **Verificacion:** `pnpm test -- test/plan-build-qa-workflow.test.ts test/application-operations.test.ts test/application-run-view.test.ts test/application-claims.test.ts`.
  - **Commit Msg:** `feat: recover bounded qa workflow safely`

- [x] **Tarea 2.5: Exponer el workflow automatico por CLI y TUI existentes**
  - **Archivos:** modificar `src/cli/commands/run.ts`, `src/cli/commands/show.ts`, `src/cli/protocol.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/screens/live.tsx`, `src/tui/screens/result.tsx`, `src/tui/screens/detail.tsx`; ampliar `test/cli-protocol.test.ts`, `test/cli-output.test.ts`, `test/tui-reduce.test.ts` y `test/tui-ink-shell.test.ts`.
  - **Descripcion:** Mostrar `plan-build-qa` en lanzamiento, progreso y resultado. En CLI JSON/JSONL preservar envelopes protocol-v1, orden de stream, separacion stdout/stderr y codigos de salida. En TUI mostrar fase, iteracion QA y estado sin requerir interaccion humana. Permitir abrir los artefactos renderizados usando las pantallas y comandos actuales.
  - **Evitar:** Crear una TUI paralela, cambiar el protocolo existente, interpretar texto libre como decision, o introducir una interfaz web.
  - **Verificacion:** `pnpm test -- test/cli-protocol.test.ts test/cli-output.test.ts test/tui-reduce.test.ts test/tui-ink-shell.test.ts`.
  - **Commit Msg:** `feat: present automatic qa workflow`

### Fase 3: Historial QA y FTS5 por workspace (feature)

- [x] **Tarea 3.1: Agregar configuracion de historial QA por workspace**
  - **Archivos:** modificar `src/config.ts`, `src/application/config-operations.ts`, `src/application/runtime.ts`, `README.md`; ampliar `test/config.test.ts` y `test/application-runtime.test.ts`.
  - **Descripcion:** Agregar `qaHistory.enabled` como booleano de configuracion del workspace, con valor por defecto desactivado para configuraciones existentes. Tratar el `dataDir` configurado para ese workspace como el limite de su historial: no mezclar ni buscar datos de otra base. Exponer el estado en `doctor` y documentar que desactivarlo conserva los reportes de cada run pero no actualiza ni consulta el historial.
  - **Evitar:** Override por run, configuracion de web, o asumir que borrar un run borra el historial QA.
  - **Verificacion:** `pnpm test -- test/config.test.ts test/application-runtime.test.ts test/config-operations.test.ts`.
  - **Commit Msg:** `feat: configure workspace qa history`

- [x] **Tarea 3.2: Migrar el registro estructurado de defects y ocurrencias**
  - **Archivos:** crear `src/storage/migrations/006-qa-history.ts`; modificar `src/storage/migrations/index.ts`, `src/storage/run-store.ts`, `src/storage/sqlite-run-store.ts`, `src/application/ports.ts`; ampliar `test/migrations.test.ts` y crear `test/qa-history.test.ts`.
  - **Descripcion:** Crear tablas aditivas `qa_defects`, `qa_occurrences` y `qa_defect_events`. Persistir identidad estable, fingerprint determinista, titulo/resumen/categoria/severidad, timestamps y ciclo de vida (`detected`, `linked`, `fixed`, `verified`, `reopened`, `withdrawn`, `accepted-risk`, `archived`). Cada ocurrencia debe referenciar run, iteracion QA, finding ID y artefacto de reporte, con unicidad por `(run_id, qa_iteration, finding_id)`. Mantener eventos append-only para explicar el estado de un defect.
  - **Evitar:** Almacenar conversaciones en estas tablas, depender de numeros de linea como identidad, reescribir eventos historicos o realizar una migracion destructiva.
  - **Verificacion:** `pnpm test -- test/migrations.test.ts test/qa-history.test.ts test/persistence.test.ts`.
  - **Commit Msg:** `feat: persist workspace qa defect history`

- [x] **Tarea 3.3: Indexar y buscar candidatos con FTS5**
  - **Archivos:** modificar `src/storage/migrations/006-qa-history.ts`, `src/storage/run-store.ts`, `src/storage/sqlite-run-store.ts`; ampliar `test/qa-history.test.ts`.
  - **Descripcion:** Crear la tabla virtual FTS5 `qa_search` como indice reconstruible de titulo, explicacion, regla/categoria, ubicaciones normalizadas, simbolos y resoluciones. Al registrar un finding, primero resolver coincidencias exactas por fingerprint; despues devolver candidatos FTS5 ordenados por BM25. Una coincidencia FTS5 es solo `candidate`, nunca una identidad o regresion confirmada.
  - **Evitar:** Embeddings, RAG, busqueda entre bases de datos, usar el ranking como probabilidad, o poner FTS5 como fuente de verdad.
  - **Verificacion:** `pnpm test -- test/qa-history.test.ts test/migrations.test.ts`.
  - **Commit Msg:** `feat: search qa history with fts5`

- [x] **Tarea 3.4: Alimentar historial desde el coordinador automatico**
  - **Archivos:** modificar `src/application/plan-build-qa-coordinator.ts`, `src/application/runtime.ts`, `src/application/service.ts`; ampliar `test/plan-build-qa-workflow.test.ts` y `test/qa-history.test.ts`.
  - **Descripcion:** Cuando `qaHistory.enabled` sea true, registrar cada finding de cada iteracion y sus transiciones de correccion/verificacion. Clasificar solo con evidencia suficiente como `new`, `known-open`, `duplicate`, `reopened` o `regression`; conservar candidatos ambiguos sin confirmar. Cuando este desactivado, no crear defects, ocurrencias, eventos ni consultas FTS5.
  - **Evitar:** Cambiar la decision de correccion automatica por una coincidencia FTS, registrar dos veces una ocurrencia tras resume, o impedir que el workflow funcione con historial desactivado.
  - **Verificacion:** `pnpm test -- test/plan-build-qa-workflow.test.ts test/qa-history.test.ts`.
  - **Commit Msg:** `feat: track automatic qa findings by workspace`

- [x] **Tarea 3.5: Exponer historial, metricas y mantenimiento en CLI/TUI**
  - **Archivos:** crear `src/application/qa-history-operations.ts`, `src/cli/commands/bugs.ts`, `src/tui/screens/bugs.tsx`; modificar `src/application/service.ts`, `src/cli/index.ts`, `src/cli/protocol.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/screens.ts`, `src/tui/shell-controller.tsx`; crear `test/cli-bugs.test.ts` y ampliar `test/tui-ink-shell.test.ts`.
  - **Descripcion:** Agregar consultas de bugs, detalle, ocurrencias, estadisticas y busqueda. Agregar comandos versionados `binaflow bugs`, `binaflow bug <id>`, `binaflow bugs reindex`, `binaflow bugs archive` y `binaflow bugs purge`; `purge` requiere confirmacion humana y no elimina runs ni artefactos de run. En TUI, presentar listas legibles por SSH de bugs frecuentes, recurrencias, regresiones y candidatos. Reindexar solo reconstruye FTS5; archive conserva identidad, metricas y resolucion minima.
  - **Evitar:** Eliminar historial automaticamente, permitir `purge` en JSON/JSONL sin una confirmacion no ambigua, o acceder a SQLite desde CLI/TUI.
  - **Verificacion:** `pnpm test -- test/cli-bugs.test.ts test/cli-protocol.test.ts test/tui-ink-shell.test.ts test/qa-history.test.ts`.
  - **Commit Msg:** `feat: inspect and maintain qa history`

### Fase 4: Workflow interactivo por CLI y TUI (feature)

- [x] **Tarea 4.1: Definir estados y contratos de revision interactiva**
  - **Archivos:** crear `src/workflows/plan-build-qa-interactive.ts`; modificar `src/workflows/catalog.ts`, `src/application/workflow-operations.ts`, `src/application/run-view.ts`; crear `test/interactive-review-contracts.test.ts`.
  - **Descripcion:** Definir `plan-build-qa-interactive` como workflow especifico. El alcance contiene estrategia y tareas propuestas enumeradas; su aprobacion explicita genera el `TODO.md` artefacto sin una segunda aprobacion rutinaria. Definir targets estables para alcance/tarea, cambio y finding QA; definir operaciones separadas `message`, `decide` y `finalize`. `message`, navegacion y explicacion nunca transicionan fase.
  - **Evitar:** Generalizar approvals, permitir feedback ambiguo sin target, renumerar IDs ya publicados o convertir cerrar una pantalla en finalizar una revision.
  - **Verificacion:** `pnpm test -- test/interactive-review-contracts.test.ts test/config-operations.test.ts`.
  - **Commit Msg:** `feat: define interactive review workflow contract`

- [x] **Tarea 4.2: Migrar hilos, mensajes y decisiones recuperables**
  - **Archivos:** crear `src/storage/migrations/007-interactive-review.ts`; modificar `src/storage/migrations/index.ts`, `src/storage/run-store.ts`, `src/storage/sqlite-run-store.ts`, `src/application/ports.ts`; crear `test/interactive-review-persistence.test.ts`; ampliar `test/migrations.test.ts`.
  - **Descripcion:** Agregar `review_threads`, `review_messages` y `review_decisions`. Un hilo se identifica por run, fase, target y revision de artefacto. Persistir mensajes visibles, rol, secuencia, estado de generacion, perfil snapshot y referencias a contenido grande. Guardar la pregunta antes de invocar al explicador; guardar cada decision en la misma transaccion que actualiza su estado de revision. Permitir recuperar mensajes `pending`, `failed` o `interrupted` sin perder la pregunta.
  - **Evitar:** Guardar razonamiento privado del modelo, borradores no enviados, transcript completo de agents automaticos o decisiones inferidas desde texto libre.
  - **Verificacion:** `pnpm test -- test/migrations.test.ts test/interactive-review-persistence.test.ts test/persistence.test.ts`.
  - **Commit Msg:** `feat: persist interactive review threads`

- [ ] **Tarea 4.3: Implementar coordinador y comandos de revision interactiva**
  - **Archivos:** crear `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/review-operations.ts`, `src/cli/commands/review.ts`; modificar `src/application/service.ts`, `src/application/runtime.ts`, `src/application/execution-operations.ts`, `src/cli/index.ts`, `src/cli/protocol.ts`; crear `test/interactive-review-workflow.test.ts` y `test/cli-review.test.ts`.
  - **Descripcion:** Implementar checkpoints `waiting` propios del workflow: revision de alcance antes de plan/build, revision de cambios antes de QA y revision QA antes de correccion/informe. Un agente explicador read-only nuevo solo recibe target, evidencia, alcance y resumen relevante del hilo; no puede editar. Las decisiones explicitas incluyen corregir, retirar tras adjudicacion, aceptar riesgo, posponer y finalizar revision. Validar revision vigente, target existente, ownership del run y transicion CAS. Exponer operaciones CLI JSON versionadas para obtener revision, publicar mensaje, solicitar explicacion, decidir y finalizar.
  - **Evitar:** Reutilizar comandos `approve`/`reject` de research, mantener procesos de agente vivos mientras el usuario piensa, hacer que un mensaje inicie build/fix, o introducir un chat generico.
  - **Verificacion:** `pnpm test -- test/interactive-review-workflow.test.ts test/cli-review.test.ts test/application-claims.test.ts test/cli-protocol.test.ts`.
  - **Commit Msg:** `feat: add interactive review checkpoints`

- [ ] **Tarea 4.4: Adjudicar disputas QA sin cerrar conversaciones**
  - **Archivos:** modificar `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/review-operations.ts`, `src/workflows/plan-build-qa-interactive.ts`; ampliar `test/interactive-review-workflow.test.ts`.
  - **Descripcion:** Al disputar uno o mas findings, mantener el hilo abierto y crear una adjudicacion read-only independiente con issue, evidencia, alcance y aclaracion del usuario. Persistir uno de `withdrawn`, `confirmed`, `reclassified` o `needs-human-decision` por finding. Limitar una nueva adjudicacion sin evidencia adicional. Excluir findings disputados sin decision de los fixes; bloquear `finalize` si queda un finding bloqueante sin decision.
  - **Evitar:** Tratar disputar como ignorar, cerrar el hilo al primer mensaje, corregir antes de decision explicita o permitir loops de adjudicacion infinitos.
  - **Verificacion:** `pnpm test -- test/interactive-review-workflow.test.ts test/interactive-review-persistence.test.ts`.
  - **Commit Msg:** `feat: adjudicate disputed qa findings`

- [ ] **Tarea 4.5: Construir las pantallas TUI de revision ASCII**
  - **Archivos:** crear `src/tui/screens/review.tsx`, `src/tui/screens/review-thread.tsx`, `src/tui/screens/qa-review.tsx`; modificar `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/screens.ts`, `src/tui/shell-controller.tsx`, `src/tui/shell-input.ts`, `src/tui/shell-view.tsx`; crear `test/tui-review.test.tsx`; ampliar `test/tui-reduce.test.ts` y `test/tui-ink-shell.test.ts`.
  - **Descripcion:** Mostrar alcance, tareas, dependencias, cambios y QA con IDs estables y graficos ASCII redimensionables. Permitir seleccionar un elemento, abrir su hilo, escribir multiples mensajes, solicitar explicacion, tomar decision y volver sin decidir. Mostrar estado `waiting`, preguntas pendientes, errores recuperables y acciones de reintento. Usar color solo como complemento; la informacion debe funcionar por SSH, teclado, terminal de 80 columnas y `NO_COLOR`.
  - **Evitar:** Browser, mouse requerido, dependencias de UI externas, acceso directo a SQLite/artefactos, o avanzar al cerrar un modal/pantalla.
  - **Verificacion:** `pnpm test -- test/tui-review.test.tsx test/tui-reduce.test.ts test/tui-ink-shell.test.ts test/tui-ink-viewport.test.ts`.
  - **Commit Msg:** `feat: add terminal interactive review screens`

- [ ] **Tarea 4.6: Vincular revision interactiva con historial QA y reporte final**
  - **Archivos:** modificar `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/qa-history-operations.ts`, `src/workflows/plan-build-qa-render.ts`, `src/tui/screens/qa-review.tsx`, `src/cli/commands/review.ts`; ampliar `test/interactive-review-workflow.test.ts`, `test/qa-history.test.ts` y `test/cli-review.test.ts`.
  - **Descripcion:** Mostrar candidatos historicos de FTS5 para cada finding y permitir vincular o rechazar la relacion de forma explicita. Registrar decisiones relevantes (`accepted-risk`, `withdrawn`, `reopened`, correccion verificada) como eventos del defect cuando `qaHistory.enabled` este activo. Incorporar decisiones, justificaciones, links de bugs y pendientes al informe final. Cuando el historial este desactivado, ocultar esas consultas sin afectar la revision del run.
  - **Evitar:** Confirmar una coincidencia FTS5 sin accion del usuario, indexar conversaciones completas como bugs, o impedir el workflow interactivo por historial desactivado.
  - **Verificacion:** `pnpm test -- test/interactive-review-workflow.test.ts test/qa-history.test.ts test/cli-review.test.ts`.
  - **Commit Msg:** `feat: link interactive review to qa history`

### Fase 5: Documentacion, regresion y cierre

- [ ] **Tarea 5.1: Documentar workflows, datos persistidos y recuperacion**
  - **Archivos:** modificar `README.md`, `WISHLIST.md`; crear o modificar solo documentacion de usuario necesaria bajo `docs/` si ya existe el directorio.
  - **Descripcion:** Documentar los tres workflows, perfiles, skills, politica de QA, configuracion `qaHistory.enabled`, artefactos, comandos CLI, TUI SSH, recuperacion y backup conjunto de `runs.db` y `artifacts`. Actualizar `WISHLIST.md` para retirar unicamente los items promovidos de workflow QA, historial local y revision TUI/CLI; conservar web, daemon y demas ideas fuera de alcance.
  - **Evitar:** Prometer soporte web, persistencia remota, eliminacion automatica o que FTS5 identifica bugs de forma infalible.
  - **Verificacion:** `pnpm run format:check && pnpm run lint`.
  - **Commit Msg:** `docs: describe qa workflows and local history`

- [ ] **Tarea 5.2: Ejecutar regresion completa y cerrar el plan**
  - **Archivos:** `TODO.md`.
  - **Descripcion:** Ejecutar las verificaciones completas, revisar que los contratos protocol-v1 y workflows existentes siguen intactos, confirmar que no hay cambios fuera de alcance y que el arbol esta limpio tras los commits atomicos. Eliminar fisicamente este `TODO.md` solo despues de que todas las tareas anteriores esten marcadas completadas y verificadas.
  - **Evitar:** Eliminar el plan con tareas pendientes, empaquetar el bundle Linux, instalar una release o ocultar fallos existentes.
  - **Verificacion:** `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && git status --short`.
  - **Commit Msg:** `chore: complete qa workflow implementation`

## Reglas de operacion para el sub-modelo

1. Completa una sola tarea marcada antes de iniciar la siguiente. Marca `[x]` solo
   despues de que su verificacion pase.
2. Haz el commit atomico indicado inmediatamente despues de completar cada tarea.
   No mezcles refactors, formato o cambios de tareas distintas.
3. Usa agentes/procesos limpios por fase y pasa solo artefactos estructurados
   necesarios; no pases transcripts completos aguas abajo.
4. Toda escritura de estado debe preservar ownership, CAS de estado del run y
   recuperacion segura. Nunca cierres SQLite mientras persista trabajo activo.
5. Las CLI y TUI solo usan `ApplicationService`; no leen SQLite ni artefactos
   directamente.
6. No construyas ni empaquetes el bundle Linux ni ejecutes pruebas live de Pi
   salvo solicitud expresa del propietario.

## Protocolo de desviacion

Si durante una tarea aparece un bug preexistente bloqueante, una incompatibilidad
persistida, una necesidad de cambiar el alcance o una dependencia no prevista,
detente sin marcar la tarea y responde exactamente:

```markdown
ALERTA DE DESVIACION DE PLAN

- Tarea en curso: [ID]
- Bloqueo detectado: [descripcion tecnica]
- Impacto: [archivos, datos persistidos y pruebas afectadas]
- Propuesta: [ajuste minimo del plan]
```
