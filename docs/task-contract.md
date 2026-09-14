# Contrato de tarea guiada

Estado: Hito 2 implementado localmente. Este contrato persistido no inicia
agentes, no crea runs y no escribe `TODO.md` en el workspace.

## Alcance

Un `TaskContract` representa el trabajo acordado para un workspace canonico. Su
identidad es un UUID y usa `kind: guided-task`, `contractVersion: 1` y una
revision CAS positiva. Las fases disponibles son `exploration`, `planning` y
`todo`. Las fases de ejecucion, revision y QA aun no forman parte de este
agregado.

El brief, el plan y el TODO son documentos inmutables con versiones separadas.
Un plan conserva la version de brief de la que procede y un TODO conserva la
version de plan de la que procede. Las acciones de comentario, aprobacion y
bloqueo tambien son historicas e inmutables.

## Operaciones

La capacidad opcional `application.taskContracts` se compone con el store
SQLite y el workspace capturado por el runtime:

- Consultas: `get`, `list`, `getDocument`, `listDocuments`, `listActions` y
  `getTodoMarkdown`.
- Comandos: `create`, `reviseBrief`, `publishPlan`, `commentPlan`,
  `approvePlan`, `publishTodo`, `block` y `resolveBlock`.

La fachada de solo consultas solo expone las consultas. Si falta el store o el
workspace durante la composicion, la configuracion parcial falla. Si faltan
ambos, la capacidad se omite para conservar consumidores legacy.

El workspace no se acepta en las solicitudes del cliente: el runtime lo fija
con `realpathSync(cwd)`. Todas las mutaciones posteriores exigen
`expectedRevision`. Un conflicto CAS no repite acciones ni documentos.

## Readiness e invalidacion

`readiness` se calcula desde punteros, versiones y bloqueo activo; no es un
estado mutable separado. La prioridad es:

1. `blocked`
2. `needs-plan`
3. `needs-approval`
4. `needs-todo`
5. `ready`

Revisar el brief invalida plan, aprobacion y TODO. Publicar un plan nuevo
invalida aprobacion y TODO. Cada comentario invalida la aprobacion aunque sea
una pregunta. Resolver un bloqueo no aprueba el plan ni recupera una aprobacion
anterior.

Un TODO compatible cubre todos los items del plan aprobado y solo usa los
archivos declarados por su item. IDs desconocidos, items sin cobertura,
archivos adicionales o `scopeChanges` producen un candidato persistido con
bloqueo `scope-review-required`. Ese bloqueo solo se supera publicando un
brief/plan nuevo y aprobando el plan nuevo; no existe un boton generico para
resolverlo.

`ready` significa consistencia estructural y aprobacion vigente. No es permiso
independiente para ejecutar y no se conecta a `ExecutionHost`. El handoff del
Hito 3 consume esta revision y version de TODO mediante `previewStart`; consulta
[ejecucion guiada](guided-execution.md) para los checkpoints, lease y recovery.

## Validacion y limites

Los documentos usan Ajv con `additionalProperties: false`. Se rechazan texto
vacio, IDs duplicados o invalidos, rutas absolutas, drives, backslashes, NUL,
segmentos `.`/`..`, segmentos vacios y globs. Las rutas son lexicamente
relativas al workspace; la validacion no sustituye comprobaciones de symlinks ni
permisos de futuros hitos.

- Brief: 16 KiB UTF-8 serializado.
- Plan y TODO: 64 KiB UTF-8 serializado cada uno.
- Plan: hasta 50 items.
- TODO: hasta 20 fases y 100 tareas.
- Comentarios y motivos de bloqueo: 4 KiB UTF-8.
- Markdown derivado: 256 KiB; nunca se trunca.

La comprobacion de alcance compara IDs y rutas, no demuestra equivalencia
semantica entre instrucciones y el plan. Esa revision humana o asistida queda
para hitos posteriores.

## Persistencia

La migracion aditiva `012-task-contracts` crea `task_contracts`,
`task_contract_documents` y `task_contract_actions`. Usa claves foraneas,
versiones y secuencias positivas, indices por workspace/contrato y JSON valido.
Las escrituras se ejecutan con transaccion inmediata y actualizacion CAS; una
falla revierte documento, accion y punteros juntos. Las tablas de runs y
preparaciones existentes no se reutilizan ni se alteran.

## Markdown

`getTodoMarkdown` devuelve contenido en memoria con `fileName: TODO.md`. La
representacion incluye identidad, versiones, procedencia, objetivo,
conclusiones, restricciones, fases, casillas pendientes, instrucciones,
archivos y motivos, criterios, verificaciones y condiciones de parada.

Una version historica, una version cuyo plan ya no esta aprobado o un candidato
bloqueado se etiqueta `NO EJECUTAR`. El contenido interpolado se coloca en
codigo o bloques con delimitadores seguros para backticks; no se interpreta
HTML ni se crean enlaces activos. El resultado no se exporta al filesystem en
este hito.

## Fuera de alcance

No hay chat, LLM, internet, UI web, HTTP, Git, builder, progreso por tarea,
tickets QA, handoff a runs ni autenticacion. La integracion con preparaciones queda fuera de este flujo. La autorizacion
del handoff y la ejecucion por fases estan documentadas en
[ejecucion guiada](guided-execution.md).
