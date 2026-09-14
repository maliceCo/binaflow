# PLAN DE EJECUCION: Hito 2 - Contrato persistido del flujo guiado

> **ATENCION SUB-AGENTE:** Sigue este plan estrictamente en orden. No saltes tareas ni agregues funcionalidades. Ante un obstaculo, detente e informa. El propietario solicito SOLO crear este TODO: no ejecutar sus tareas, implementar codigo, lanzar pruebas de producto, aplicar migraciones ni hacer commits hasta recibir autorizacion de implementacion.

## Lectura rapida para aprobar

**Estado:** Hito 1 cerrado; Hito 2 planificado, no implementado.

**Resultado de este hito:** guardar una tarea, revisar versiones de su plan,
aprobar exactamente una version y publicar un TODO detallado ligado a ella.
Reabrir la aplicacion conserva documentos, comentarios, decisiones y bloqueos.
Ninguna de estas acciones inicia un agente ni modifica el repositorio de trabajo.

1. Definir los documentos y reglas del flujo guiado.
2. Persistir versiones y decisiones sin alterar los runs existentes.
3. Exponer operaciones de aplicacion y un TODO Markdown derivado del contrato.
4. Verificar reapertura, aprobaciones obsoletas y conflictos entre clientes.

**No incluye:** chat/LLM, internet, UI web, HTTP, Git, builder, progreso de ejecucion
por tarea, tickets QA ni handoff a un run. Esos comportamientos siguen en los
hitos 3-6. Aqui se reciben documentos estructurados mediante operaciones de
aplicacion y fixtures, no se generan con modelos.

## Referencias y decisiones de alcance

- Leer `AGENTS.md`, `docs/web-workflow-vision.md` y este documento completos.
  El flujo visual esta en `docs/binaflow_web_flow.drawio`.
- `src/application/execution-host.ts` ya mantiene ejecuciones independientes de
  clientes y admite solo plan-build. No ampliarlo ni cambiar su inicio en este
  hito: recibir un contractId no debe convertirse en permiso para ejecutar.
- `preparation.ts` y `preparation-operations.ts` ya gestionan conversaciones,
  propuestas y handoff de workflows actuales. Sus aprobaciones estan vinculadas
  a consumir una preparacion y crear un run. No reutilizar
  `approveAndExecutePreparation` para una aprobacion que NO debe ejecutar.
- Agregar un agregado especifico `TaskContract` para el nuevo flujo guiado,
  separado de WorkflowRun y de las preparaciones legacy. Solo contiene el contrato
  de trabajo, no otra implementacion de chat, memoria o revision automatica.
  No copiar borradores ni transcripciones existentes. Su futura integracion con
  preparacion se decidira en el hito 4; no agregar ahora puentes o IDs opcionales
  de origen sin consumidor.
- Reutilizar Ajv, SQLite, el patron de puertos de aplicacion y ApplicationService.
  No crear otra conexion SQLite ni un framework de maquinas de estados.
  Las reglas de este agregado son de producto, no primitivas de `src/core`.

## Contrato normativo del hito

### 1. Identidad, fases y datos de entrada

Crear `src/application/task-contract.ts` con los tipos, schemas y validaciones
puras del contrato. Usar `TASK_CONTRACT_VERSION = 1` y discriminante fijo
`kind: 'guided-task'`. No registrarlo como WorkflowDefinition ejecutable ni
agregarlo a `src/workflows/catalog.ts`.

- Cada contrato tiene UUID, workspace canonico, contractVersion, revision CAS
  positiva y fechas. La revision CAS cambia en cada mutacion efectiva.
- Fases implementadas: `exploration`, `planning`, `todo`. El contrato listo sigue
  en `todo`; no fingir `running` ni `completed`. Las fases futuras de ejecucion,
  revision y QA estan documentadas en la vision, no implementadas ni expuestas
  como transiciones disponibles aqui.
- El workspace proviene del contexto compuesto por runtime, no de una ruta
  enviada libremente por un cliente. Se fija al crear el contrato.
- Brief, plan y TODO son documentos de contenido inmutable con version propia
  creciente por `(contractId, kind)`. No confundir estas versiones con la revision
  CAS del agregado. La numeracion la asigna storage dentro de la transaccion.
- Cada publicacion conserva las anteriores. Los punteros vigentes indican cual
  se muestra y cual puede aprobarse. Un documento historico no se reactiva por
  su numero ni por volver a abrirlo.

Documentos admitidos; objetos JSON estrictos, sin additionalProperties:

| Documento | Contenido obligatorio |
| --- | --- |
| `brief` | objective; conclusions[]; constraints[]; outOfScope[]. Es una sintesis acordada, no un historial de chat. |
| `plan` | briefVersion; summary; items[] con id, title, description, files[] de {path, reason}, acceptanceCriteria[]; verification[]. |
| `todo` | planVersion; phases[] con id, title y tasks[]; cada tarea lleva id, planItemId, instructions[], files[], acceptanceCriteria[], verification[] y stopConditions[]; scopeChanges[]. |

**Reglas de validacion:**

- Objetivo, titulos, descripcion, motivos y entradas de listas no pueden estar
  vacios ni contener solo espacios. Conservar texto original; trim solo para
  comprobar vacio. No inferir defaults que cambien el significado.
- Plan con al menos un item; TODO con al menos una fase y una tarea por fase.
  Cada item/tarea requiere criterios de aceptacion y verificacion. Las tareas
  requieren instrucciones y condiciones de parada. `scopeChanges` siempre existe,
  aunque sea una lista vacia.
- IDs de items/fases/tareas: cadenas ASCII no vacias de hasta 80 caracteres,
  patron `[A-Za-z0-9][A-Za-z0-9_-]*`. Unicos por su categoria en el documento;
  IDs de tareas unicos entre todas las fases. No deducir identidad de titulos.
- El orden de phases/tasks es el orden secuencial. No dependsOn, scripts de
  orquestacion, DAGs ni handlers generados por el modelo. Los comandos de
  verification son texto declarativo y nunca se ejecutan en este hito.
- Las rutas son relativas al workspace, con `/`. Rechazar absolutas, drives de
  Windows, backslashes, NUL, segmentos vacios, `.` y `..`. No aceptar globs como
  lista de archivos. No comprobar existencia: puede haber archivos nuevos.
  Esta validacion lexica NO prueba seguridad frente a symlinks ni permisos de
  escritura; esas comprobaciones corresponden a ejecutar/editar en otros hitos.

**Limites concretos del nuevo contrato:** brief <= 16 KiB UTF-8 serializado;
plan y TODO <= 64 KiB cada uno; hasta 50 items de plan, 20 fases y 100 tareas en
total. Comentario o motivo de bloqueo <= 4 KiB. Rechazar exceso, no truncarlo.
Limites de esta capacidad nueva, sin alterar los de CLI/TUI/preparacion.

Los JSON son contratos pequenos y acotados, persistidos en SQLite como las
propuestas estructuradas actuales. El Markdown se deriva bajo demanda; no se
persisten transcripciones ni outputs grandes en estas tablas. No crear runs
ficticios para reutilizar la tabla artifacts ni alterar ArtifactReference.

### 2. Aprobacion, feedback y alcance

Aprobar un plan es una decision humana explicita vinculada a contractId,
planVersion y revision CAS. Guardar la decision como registro inmutable. No
aceptar un campo `approved: true` dentro del documento publicado.

| Accion | Resultado permitido |
| --- | --- |
| Crear | Brief v1, fase exploration, sin plan, TODO, aprobacion ni bloqueo. |
| Revisar brief | Nueva version; exploration; invalidar punteros de plan, TODO y aprobacion. Conservar historial. |
| Publicar plan | Nueva version basada en el brief vigente; planning; invalidar TODO y aprobacion anteriores. |
| Comentar plan | Guardar feedback del plan vigente; planning; invalidar aprobacion y TODO vigentes. No generar otra version de contenido ni ejecutar nada. |
| Aprobar plan | Solo el plan vigente del brief vigente y sin bloqueo activo; guardar aprobacion; pasar a todo. |
| Publicar TODO compatible | Referir al plan vigente aprobado; guardar version; fase todo con contrato listo para un futuro handoff, no ejecutar. |
| Publicar TODO con diferencias de alcance | Guardar candidato y bloqueo de alcance; planning; invalidar aprobacion. No presentar el candidato como listo. |
| Registrar/resolver bloqueo manual | Guardar motivo/decision; resolver no aprueba ni ejecuta. Requiere IDs y revision vigente. |

**Feedback:** en este hito los comentarios son sobre el plan vigente completo,
no sobre lineas ni tareas individuales. Comentar una version historica devuelve
conflicto y pide refrescar; no altera la actual. Como politica conservadora,
todo nuevo comentario invalida la aprobacion vigente, incluso si era una pregunta.
La nueva aprobacion puede corresponder al mismo contenido si el usuario considera
resuelto el feedback. El comentario no se transforma en una instruccion ejecutable.

**Validacion estructural del alcance del TODO:**

1. Cada planItemId debe existir en el plan aprobado y cada item debe estar cubierto
   por al menos una tarea. No omitir silenciosamente partes del plan.
2. Cada files[] de tarea debe ser subconjunto de los paths del item al que refiere.
   No se puede autorizar otro archivo apuntando a un item diferente.
3. `scopeChanges` no vacio, referencias desconocidas, items sin cobertura o archivos
   adicionales producen bloqueo `scope-review-required`. Conservar el candidato
   para revision; no desecharlo silenciosamente ni marcarlo listo.
4. Un TODO basado en una version antigua, un JSON mal formado, IDs duplicados o
   rutas invalidas se rechaza SIN mutacion. Eso es distinto de un candidato bien
   formado que declara trabajo fuera de alcance.
5. Para resolver `scope-review-required`, el usuario debe publicar un nuevo plan
   o brief y aprobar despues el nuevo plan. No permitir resolver ese bloqueo con
   un boton generico ni volver a aprobar el plan viejo. El TODO viejo no se
   reutiliza: se debe publicar otro ligado al plan recien aprobado.

**Limite honesto:** coincidencia de IDs y archivos no demuestra equivalencia
semantica del texto. El modelo puede proponer instrucciones fuera de alcance
usando el mismo archivo. Estos checks no sustituyen revision humana/LLM y no
constituyen un sandbox. `ready` significa consistencia estructural y aprobacion
vigente del plan, NO permiso independiente para ejecutar. El hito 3 debe definir
la autorizacion del handoff; no conectar automaticamente este flag al host.

### 3. Bloqueos y proyeccion de estado

- Un bloqueo activo por contrato en esta etapa. Dos clases: `manual` y
  `scope-review-required`. Persistir id, motivo, documento/version objetivo y
  fecha; las diferencias detectadas son evidencia del bloqueo de alcance.
- Registrar bloqueo manual invalida aprobacion y TODO vigentes; conserva documentos.
  La fase queda en planning si hay plan vigente, o exploration si no lo hay.
  No reemplazar un bloqueo activo silenciosamente: primero resolverlo.
- Resolver manual exige el blockId activo y razon no vacia. Se registra una
  decision nueva, no se borra el bloqueo historico ni se avanza de fase. Reanudar
  requiere aprobar nuevamente el plan vigente o publicar uno nuevo.
- Publicar un nuevo plan o brief resuelve el bloqueo anterior como `superseded`
  en la misma transaccion, conservando evidencia. No implica aceptar/corregir el
  motivo ni autoriza ejecutar. Comentarios no resuelven bloqueos.
- Exponer `readiness` calculada, no un segundo estado mutable independiente:
  `blocked`, `needs-plan`, `needs-approval`, `needs-todo` o `ready`, en ese orden
  de prioridad. Derivarla de punteros/versiones/bloqueo vigentes. Sin brief valido,
  tratar el registro como corrupto, no fabricar una vista ejecutable.

No persistir estados de ejecucion por tarea ni commits vacios para el futuro.
Las casillas del Markdown se muestran pendientes; no son evidencia de avance.

### 4. Persistencia y concurrencia

Crear una migracion aditiva `012-task-contracts.ts`; confirmar que 012 sigue libre
antes de implementar. No editar migraciones 001-011 ni reconstruir sus tablas.
Si otra entrega ocupa 012, detener y ajustar el plan antes de renumerar.

Tres tablas especificas, no un almacen de eventos generico:

| Tabla | Datos y restricciones |
| --- | --- |
| `task_contracts` | id; workspace; contract_version; revision; phase; current_brief_id, current_plan_id, approved_plan_id, current_todo_id, current_block_id; created_at, updated_at. |
| `task_contract_documents` | id; contract_id; kind (brief/plan/todo); version; source_document_id (brief del plan o plan del TODO); body_json; resumen acotado para listados; created_at. UNIQUE(contract_id, kind, version) y UNIQUE(contract_id, id). |
| `task_contract_actions` | id; contract_id; sequence; kind (comment/approve-plan/block/resolve-block); target_document_id; related_action_id para resolver un bloqueo; details_json acotado; created_at. UNIQUE(contract_id, sequence) y UNIQUE(contract_id, id). |

- Foreign keys de documentos/acciones al contrato. Punteros y relaciones deben
  comprobar pertenencia al mismo contrato; usar FK compuestas cuando corresponda.
  Validar ademas el kind del documento/accion, no solo la existencia del ID.
  No usar FK hacia runs o preparation_approvals.
- `body_json`/`details_json` validos; los CHECK admiten solo versiones/fases/kinds
  definidos. Restricciones de numeros positivos. Indices para listar contratos
  por workspace y paginas de documentos/acciones por contrato.
- Crear contrato y brief v1 en una sola transaccion. Se permiten punteros NULL
  temporalmente dentro de ella, nunca devolver un contrato sin brief confirmado.
- Toda mutacion posterior recibe expectedRevision. Leer punteros, validar
  pertenencia/vigencia y aplicar cambios dentro de una transaccion de escritura
  inmediata. Un UPDATE CAS debe afectar exactamente una fila; fallo revierte
  documentos, acciones y punteros juntos.
- Las validaciones que deciden autorizacion se repiten bajo la transaccion: no
  confiar en un preflight de aplicacion anterior a otra escritura concurrente.
- Asignar versiones/secuencias dentro de esa transaccion, no contar elementos de
  una pagina ni usar timestamps como revision. No llamadas a filesystem, drivers
  o red dentro de la transaccion.

**Reintentos:** crear usa contractId UUID suministrado una vez por el consumidor.
Mismo ID, workspace y brief inicial exacto retorna el contrato existente sin
reinicializarlo; mismo ID con contenido distinto falla. Comparar con brief v1,
no con el brief vigente si fue revisado despues.

Las demas mutaciones usan CAS: un reenvio con revision antigua devuelve conflicto
sin repetir la accion. El cliente refresca estado/historial para comprobar si
la primera peticion se aplico. No prometer replay idempotente completo ni crear
una tabla de solicitudes en este hito.

**Consultas acotadas:** lista de contratos por workspace, default 20/max 50, orden
estable por id y cursor `afterId`. Historial de documentos por kind y afterVersion;
historial de acciones por afterSequence, default 20/max 50. No SELECT del JSON
completo para recortar listados. Una lectura explicita de documento devuelve
solo esa version, ya limitada por el contrato. Rechazar cursores invalidos y
contratos de otro workspace antes de devolver datos.

### 5. Operaciones y composicion

Crear `src/application/task-contract-operations.ts`. Las operaciones son breves,
no async de larga duracion ni llamadas al LLM. Crear el puerto consumidor
`ApplicationTaskContractStore` en `src/application/ports.ts`; implementarlo en
SqliteRunStore sin agregar otra clase/conexion con ciclo de vida propio.

La API de aplicacion agrupada como `taskContracts` contiene:

| Consultas | Comandos |
| --- | --- |
| `get(contractId)` | `create({ contractId, brief })` |
| `list(query?)` | `reviseBrief({ contractId, expectedRevision, brief })` |
| `getDocument({ contractId, kind, version })` | `publishPlan({ contractId, expectedRevision, plan })` |
| `listDocuments({ contractId, kind, afterVersion?, limit? })` | `commentPlan({ contractId, expectedRevision, planVersion, content })` |
| `listActions({ contractId, afterSequence?, limit? })` | `approvePlan({ contractId, expectedRevision, planVersion })` |
| `getTodoMarkdown({ contractId, todoVersion })` | `publishTodo({ contractId, expectedRevision, todo })` |
| | `block({ contractId, expectedRevision, documentKind, documentVersion, reason })` |
| | `resolveBlock({ contractId, expectedRevision, blockId, reason })` |

No incluir setter libre de phase/status/aprobacion ni comando advance generico.
El block manual debe apuntar a un documento vigente y existente del contrato.

- `get` devuelve identidad, fase, readiness, encabezados de documentos vigentes,
  aprobacion vigente y bloqueo activo; no todo el historial. Mutaciones devuelven
  esa vista, suficiente para continuar con la revision CAS nueva.
- `getDocument` devuelve el cuerpo de esa version concreta y su procedencia.
  Documentos/acciones historicos se consultan, no se modifican.
- La capacidad se agrega como propiedad estatica opcional `taskContracts` a
  ApplicationQueries/ApplicationService, con TaskContractQueries y
  TaskContractService respectivamente. La fachada de solo consultas NO contiene
  comandos. Los mocks/consumidores viejos no quedan obligados a implementarla.
  No convertirlo en un registro de plugins o namespaces dinamicos.
- CreateApplicationQueriesOptions y CreateApplicationServiceOptions reciben
  `taskContractStore?` y `taskContractWorkspace?`. Ambos presentes o ambos ausentes;
  configuracion parcial falla en composicion. Si faltan ambos, omitir la capacidad,
  no devolver operaciones vacias ni construir storage alternativo.
- `runtime.ts` pasa el store existente y `realpathSync(cwd)` a la composicion
  completa y de consultas. Workspace siempre capturado en servidor. No aceptar
  override desde los comandos. No cambiar ApplicationInternals si no es necesario:
  estas operaciones reciben su contexto estrecho propio.
- Mantener ExecutionHostClient intacto: en este hito los tests llaman la fachada
  directamente. No pasar operaciones de contrato por `host.start`, no agregar
  prompts, senales o permisos de agente a estos documentos.

Funciones permitidas por proposito dentro de los modulos nuevos:

- Parsers Ajv de brief/plan/todo, validacion de tamano/IDs/rutas y evaluacion de
  diferencias estructurales del TODO frente al plan.
- Proyeccion de readiness y reglas puras de transicion de este contrato. Storage
  puede invocarlas con el estado leido bajo lock; no duplicar reglas diferentes
  en fachada y SQL. Estas funciones no acceden a adapters.
- Captura/validacion de solicitudes, mapeo de DTOs y fabricas de la capacidad
  `createTaskContractQueries` / `createTaskContractService`.
- Helpers SQL privados de filas/JSON, paginacion, CAS y escritura atomica;
  metodos del puerto con las operaciones concretas anteriores. No crear un
  repositorio universal, reducer generico ni protocolo de eventos nuevo.

### 6. Representacion TODO, sin escribir el workspace

Crear `src/application/task-contract-render.ts` con `renderTaskContractTodo`.
Entrada: brief, plan aprobado de referencia y version TODO seleccionada,
previamente validados. Salida determinista, Markdown con saltos reales de linea.

Mostrar identidad/versiones, objetivo y conclusiones, restricciones, fases y
casillas por tarea, IDs y planItemId, instrucciones, archivos y sus motivos del
plan, aceptacion, verificaciones y condiciones de parada. No resumir perdiendo
instrucciones ni agregar recomendaciones inventadas.

`getTodoMarkdown` retorna `{ contractId, planVersion, todoVersion, current,
readiness, fileName: 'TODO.md', content }`. `current` requiere que esa version sea
la vigente y que su plan siga aprobado; un candidato bloqueado o historico
lleva advertencia visible de NO EJECUTAR. No afirmar que un TODO es ejecutable
solo porque su plan fue aprobado alguna vez.

Escapar el texto interpolado para que IDs, rutas o titulos no puedan crear
casillas/fases falsas en Markdown; conservar el contenido de instrucciones y
comandos como texto citado/bloques, con delimitadores seguros para backticks.
No evaluar HTML ni generar enlaces activos a rutas suministradas. Limitar salida
renderizada a 256 KiB; exceso es error, nunca truncamiento silencioso.

No escribir `TODO.md` en la raiz del repositorio ni sobrescribir este plan de
implementacion. Tampoco modificar FileArtifactStore, crear archivos de artefacto
huerfanos ni introducir exportacion a disco en este hito. La exportacion material
para el builder pertenece al handoff del hito 3.

## Lista de tareas

### Fase 1: Prerrequisitos y contrato (sin refactor preventivo)

- [x] **Tarea 1.1: Confirmar baseline y alcance antes de implementar**
  - **Archivo:** `TODO.md` (registro de aprobacion y baseline); no tocar codigo.
  - **Descripcion:** obtener autorizacion de implementacion. Leer referencias y consumidores indicados. Registrar git status y checks; confirmar que 012 esta disponible. El worktree estaba limpio al redactar el plan, pero el ejecutor debe comprobarlo otra vez. No dar por aprobadas decisiones adicionales fuera de este documento.
  - **Evitar:** commits sin autorizacion, git add ., reset/clean/stash automaticos, reconstruir pendientes de la TUI, instalar paquetes o lanzar Binaflow contra si mismo.
  - **Verificacion:** `git status --short`; `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`. Si una pausa global de pruebas sigue vigente, pedir autorizacion antes de implementar; no omitir TDD para declarar exito.
  - **Commit Msg:** `docs: record guided task contract prerequisites` (solo registro propio; no commit vacio).

- [x] **Tarea 1.2: Definir y probar documentos y reglas puras**
  - **Archivo:** nuevo `src/application/task-contract.ts`; nuevo `test/task-contract.test.ts`.
  - **Funciones:** tipos TaskContract, TaskContractView, TaskContractBrief, TaskContractPlan, TaskContractTodo, TaskContractAction; parsers y helpers de validacion/readiness/transicion descritos en el contrato.
  - **Descripcion:** implementar exactamente schemas y limites, diferencia entre revision CAS y versiones de documentos, validacion de pertenencia de tareas al plan, y matriz de invalidacion. Solo funciones puras y tipos; sin engine, store, prompts ni enums futuros sin consumidor. Errores de contrato con codigos estables para invalid-input, stale-revision, invalid-target, blocked y incompatible-version, en este modulo si se requieren subclases Error.
  - **Evitar:** cambiar schemas de workflows existentes, ejecutar comandos, validar alcance semantico con comparaciones de texto, aceptar rutas fuera del workspace o introducir un sistema generico de transiciones.
  - **Verificacion / TDD:** tests de un contrato minimo valido; IDs/rutas/limites invalidos; plan/brief obsoleto; cobertura/archivos extra del TODO; comentario invalida aprobacion; resolver bloqueo no autoriza. No probar cada getter ni duplicar permutaciones. RED -> GREEN con `pnpm exec vitest run test/task-contract.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: define versioned guided task contracts`

### Fase 2: Persistencia y operaciones funcionales

- [x] **Tarea 2.1: Persistir contratos con migracion aditiva y CAS**
  - **Archivo:** nuevo `src/storage/migrations/012-task-contracts.ts`; `src/storage/migrations/index.ts`; `src/application/ports.ts`; `src/storage/sqlite-run-store.ts`; nuevo `test/task-contract-persistence.test.ts`; `test/migrations.test.ts` solo si necesita actualizar la expectativa de version final o un fixture explicito.
  - **Funciones:** taskContractsMigration; applyMigrations; ApplicationTaskContractStore; metodos SqliteRunStore de creacion, lectura, publicacion, comentario, aprobacion y bloqueos descritos en la API. Helpers SQL privados especificos.
  - **Descripcion:** crear las tres tablas/indices y subir currentSchemaVersion a 12. Ejecutar reglas de autorizacion bajo transaccion inmediata y CAS, preservar versiones/acciones inmutables y asegurar rollback completo. API del puerto recibe workspace del contexto y IDs; no SQL desde aplicacion. Mantener RunStore y los puertos core sin cambios. No duplicar modelos de tablas en otro modulo si no hay consumidor.
  - **Evitar:** editar 001-011, FK desactivadas, tablas de ejecucion falsas, IDs/secuencias por longitud de una pagina, guardar una aprobacion antes de verificar vigencia, o aplicar migraciones a datos personales para probar.
  - **Verificacion / TDD:** base temporal nueva y actualizacion de una base v11 con datos de runs/preparacion; foreign_key_check sin errores y registros legacy intactos. Dos conexiones compiten por misma revision: solo una muta; otra falla sin documentos/acciones parciales. Target de otro contrato/workspace rechazado. Repetir create preserva estado y no duplica. `pnpm exec vitest run test/task-contract-persistence.test.ts test/migrations.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: persist guided task documents and approval decisions`

- [x] **Tarea 2.2: Proveer operaciones de aplicacion sin ejecutar agentes**
  - **Archivo:** nuevo `src/application/task-contract-operations.ts`; nuevo `test/task-contract-application.test.ts`; `src/application/task-contract.ts` solo para los DTOs de solicitud/respuesta previstos.
  - **Funciones:** createTaskContractQueries, createTaskContractService; operaciones de la tabla del contrato salvo getTodoMarkdown, que se incorpora en 2.3 sin stubs.
  - **Descripcion:** capturar y validar solicitudes antes de awaits; usar contexto {store, workspace} estrecho. La decision humana entra por approvePlan separado de publicar/comentar. Delegar escrituras atomicas al puerto, no simular transacciones desde JS con varias llamadas independientes. Proyectar vistas acotadas y devolver errores claros de conflicto o bloqueo para que el consumidor refresque.
  - **Evitar:** aceptar workspace/revision aprobada desde un documento LLM, llamar approveAndExecutePreparation, importar drivers, crear run, orquestar generacion de planes, comprobar estados solo en una futura UI o agregar acciones de QA/review de codigo.
  - **Verificacion / TDD:** recorrido create -> plan -> comment -> approve -> TODO valido; candidato con scopeChanges devuelve bloqueo y conserva evidencia; no se puede aprobar viejo plan para eludirlo; nuevo plan invalida TODO viejo. Servicios espia de agente/engine deben permanecer sin llamadas si el fixture los compone; no agregar dependencias de esos servicios solo para espiarlos. `pnpm exec vitest run test/task-contract-application.test.ts test/task-contract.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: add explicit guided planning and approval operations`

- [ ] **Tarea 2.3: Derivar un TODO legible y fiel a su version**
  - **Archivo:** nuevo `src/application/task-contract-render.ts`; `src/application/task-contract-operations.ts`; `test/task-contract.test.ts`; `test/task-contract-application.test.ts`.
  - **Funciones:** renderTaskContractTodo; query getTodoMarkdown.
  - **Descripcion:** generar la representacion Markdown del contrato sin filesystem. Resolver brief/plan de procedencia del TODO seleccionado, no mezclarlo con el plan mas reciente. Etiquetar version historica, bloqueo y readiness. Mostrar instrucciones/archivos/criterios completos con casillas pendientes y datos no ejecutables. No reutilizar renderTodo legacy si obliga a perder fases, procedencia o stopConditions; dejarlo intacto.
  - **Evitar:** escribir en TODO.md de la raiz, usar literal backslash-n como salto, interpretar HTML, omitir restricciones para abreviar, agregar scripts o producir evidencia de tareas completadas inexistente.
  - **Verificacion / TDD:** assert de IDs/versiones y cada instruccion importante, saltos reales, markdown seguro ante titulos multilinea/backticks y advertencia de documento obsoleto; render determinista; no contenido que exceda limite ni truncamiento. Preferir assertions de contenido sobre snapshot gigante. `pnpm exec vitest run test/task-contract.test.ts test/task-contract-application.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: render version-bound guided execution todos`

- [ ] **Tarea 2.4: Componer la capacidad en ApplicationService**
  - **Archivo:** `src/application/service.ts`; `src/application/runtime.ts`; `test/task-contract-application.test.ts`; `test/application-runtime.test.ts`.
  - **Funciones:** ApplicationQueries/ApplicationService y sus opciones; createApplicationQueries/createApplicationService; openApplicationResources/openApplicationStorage.
  - **Descripcion:** agregar la propiedad estatica opcional taskContracts con el tipo correspondiente de queries o servicio completo. Componer con store existente y workspace canonico. Capturar el workspace en la capacidad y omitirla en composiciones sin sus dependencias; error si solo se aporta una. La version de solo queries no publica comandos. Conservar todos los metodos de las fachadas legacy y la configuracion existente.
  - **Evitar:** modificar ExecutionHostClient, catalogo, CLI/TUI, core, config o package.json. No introducir openTaskServer, endpoints ni framework de capacidades; no construir un segundo SqliteRunStore. No cambiar ownership del Hito 1.
  - **Verificacion / TDD:** capacidad presente en contexto real y de queries; el segundo no tiene approve/create. Composicion legacy sin opciones sigue funcionando; configuracion parcial rechazada. Consultas de contratos sin drivers; cierre del contexto sigue en propietario. `pnpm exec vitest run test/task-contract-application.test.ts test/application-runtime.test.ts test/execution-host.test.ts test/execution-host-integration.test.ts test/architecture-boundaries.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: expose guided task contracts through application services`

### Fase 3: Regresion, reapertura y cierre documental

- [ ] **Tarea 3.1: Verificar el contrato de extremo a extremo sin builder**
  - **Archivo:** `test/task-contract-application.test.ts`; `test/task-contract-persistence.test.ts`. Corregir solo incumplimientos del contrato en los archivos ya autorizados por 1.2-2.4; si requiere otro contrato/archivo, detener.
  - **Descripcion:** fixture local con SQLite real temporal y fachada, sin red ni Pi. Crear y publicar plan v1, comentar/aprobar, publicar TODO, cerrar contexto y reabrir. Comprobar que el estado, las versiones, feedback y aprobacion se recuperan. Publicar plan v2 y comprobar que el TODO/approval de v1 no autorizan nada aunque puedan consultarse como historial. Reaprobar y publicar un TODO nuevo para volver a ready.
  - **Casos criticos adicionales:** dos clientes con expectedRevision antigua no pueden aprobar version sustituida; JSON invalido no muta; scope-review-required exige nuevo plan/brief; bloqueo manual resuelto no recupera aprobacion vieja; documento de otro workspace no es visible. No generar un workflow run en ningun paso y comprobar listRuns sin cambios.
  - **Verificacion / TDD:** `pnpm exec vitest run test/task-contract.test.ts test/task-contract-persistence.test.ts test/task-contract-application.test.ts test/preparation.test.ts test/preparation-persistence.test.ts test/interactive-review-workflow.test.ts test/cli-protocol.test.ts`. Casos funcionales con assertions de comportamiento, no contadores de tests ni cobertura objetivo. Tests temporales, sin migrar bases del usuario.
  - **Commit Msg:** `test: verify guided contract persistence and stale approvals`

- [ ] **Tarea 3.2: Registrar evidencia y limites del hito**
  - **Archivo:** `docs/web-workflow-vision.md` (estado real del Hito 2 y siguiente hito); nuevo `docs/task-contract.md` (contrato publico implementado y limitaciones); `TODO.md` (registro/checks).
  - **Descripcion:** documentar fases realmente soportadas, API agrupada, versionado/CAS, invalidacion conservadora del feedback y limites de la evaluacion estructural de alcance. Dejar claro que ready no ejecuta, no existe todavia puente desde chat/preparacion y el Markdown solo se obtiene como contenido. Registrar comandos/resultados reales; no declarar terminado por compilar.
  - **Evitar:** marcar web o builder implementados, afirmar validacion semantica automatica, ocultar verificaciones pendientes, cambiar el diagrama de arquitectura por inferencia o eliminar el historico TUI.
  - **Verificacion:** `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`; `git diff --check`; revisar `git status --short`. Formatear solo archivos propios. No bundles, releases, instalacion, pruebas live ni test:e2e por inferencia.
  - **Commit Msg:** `docs: document guided task contract guarantees and limits`

## Reglas de operacion para el sub-modelo

1. **Un solo check:** no iniciar N+1 sin aceptacion y verificacion exitosa de N.
   El registro distingue implementado, probado y pendiente. No marcar checks
   porque el archivo existe o compila. La creacion de este documento no completa
   ninguna tarea.
2. **Commits atomicos:** solo tras autorizacion de implementacion, commit al
   cerrar cada tarea con mensaje indicado y staging explicito de archivos/hunks
   propios. Nunca git add . ni incluir baseline ajeno. Refactor/format incidental
   no se mezcla con funcionalidad. No commits vacios ni commits que queden RED.
3. **Sin improvisacion:** helpers privados estan permitidos solo para los
   propositos enumerados. Otra dependencia, modulo, contrato, firma publica o
   modificacion a areas excluidas exige desviacion y aprobacion antes de seguir.
4. **Compatibilidad:** conservar runs, preparaciones, protocolos v1, host Hito 1
   y permisos existentes. No migraciones manuales sobre datos del usuario ni
   cambios destructivos para obtener una prueba verde.
5. **Retiro controlado:** completar tareas, regresion y commits antes de retirar
   este plan. Requiere arbol limpio; cambios ajenos pendientes se informan, no se
   descartan. Conservar el contrato duradero en docs/task-contract.md. Solicitar
   confirmacion antes del retiro destructivo; despues usar `git rm -- TODO.md`
   y commit `docs: retire completed guided task contract plan`. No borrar otros
   TODO ni documentos de tareas anteriores.

## Protocolo de desviacion

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos y verificaciones afectados>
Propuesta: <ajuste minimo solicitado>
```

Un bug previo que bloquea, un caso no especificado o una ruptura de consumidores
se informa con este formato. No reparar, generalizar ni omitir controles por
cuenta propia. El orquestador actualiza el plan antes de autorizar continuacion.

## Registro de ejecucion

- Autorizacion de implementacion: recibida del propietario el 2026-09-14; alcance del Hito 2 aprobado sin desviaciones.
- Baseline verificado el 2026-09-14: `git status --short` muestra solo `?? TODO.md` (este plan); schema actual v11 y migracion 012 disponible.
- Referencias leidas: `AGENTS.md`, `docs/web-workflow-vision.md`, `docs/binaflow_web_flow.drawio` y consumidores indicados.
- Checks baseline: `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (43 archivos, 340 pasados, 1 omitido) y `pnpm run build` correctos; `git diff --check` correcto.
- Implementacion: tareas 1.3 en adelante pendientes; Tarea 1.2 completada con parsers Ajv, validacion de limites/IDs/rutas, readiness, transiciones e incompatibilidad estructural del TODO.
- Tarea 1.2 verificada: `pnpm exec vitest run test/task-contract.test.ts` (6 pasados) y `pnpm run typecheck` correctos.
- Tarea 2.1 verificada: `pnpm exec vitest run test/task-contract-persistence.test.ts test/migrations.test.ts` (5 pasados) y `pnpm run typecheck` correctos; migracion 012, FK y CAS comprobados.
- Tarea 2.2 verificada: `pnpm exec vitest run test/task-contract-application.test.ts test/task-contract.test.ts test/task-contract-persistence.test.ts test/migrations.test.ts` (13 pasados), lint focalizado y typecheck correctos; el workspace se captura en servidor y no hay driver/engine en las operaciones.
