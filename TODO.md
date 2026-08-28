# PLAN DE EJECUCION: Correcciones de flujos interactivos, QA y vistas de ejecucion
> **ATENCION SUB-AGENTE:** Sigue este plan de forma estrictamente secuencial. No saltes tareas. No agregues codigo que no este explicitamente detallado. Si encuentras un obstaculo o comportamiento inesperado, DETEN LA EJECUCION e informa al Orquestador inmediatamente.
>
> **Alcance:** Este plan corrige los hallazgos de la auditoria. No reformatees los archivos bajo `.agents/skills/`: ya fallaban `format:check` antes de este trabajo y uno contiene una modificacion ajena preexistente.

## Lista de Tareas

### Fase 1: Contratos y pruebas de regresion

- [x] **Tarea 1.1: Definir las decisiones que pueden avanzar cada checkpoint**
  - **Archivo:** `src/core/interactive-review.ts`, `src/workflows/plan-build-qa-interactive.ts`, `README.md`, `test/interactive-review-workflow.test.ts`
  - **Descripcion:** Antes de cambiar el coordinador, convertir las decisiones interactivas en un contrato no ambiguo. Documentar y probar que decisiones permiten avanzar scope, changes y QA; que decisiones deben mantener el checkpoint esperando; y que decision requiere correccion. La semantica debe impedir que `reject` o `postpone` lleguen silenciosamente a plan/build/finalizacion. Si la semantica de producto para `withdraw` y `accept-risk` no esta confirmada por el propietario, detenerse y solicitarla antes de implementar esta tarea.
  - **Evitar:** No crear un motor generico de aprobaciones ni cambiar `research-plan-build`; este contrato es exclusivo de `plan-build-qa-interactive`.
  - **Verificacion / TDD:** Agregar casos RED que cubran cada decision admitida y ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts`.
  - **Commit Msg:** `fix: definir transiciones de decisiones interactivas`

- [x] **Tarea 1.2: Cubrir explicaciones repetidas y su cancelacion adjunta**
  - **Archivo:** `test/interactive-review-workflow.test.ts`, `test/cli-review.test.ts`, `test/tui-ink-shell.test.ts`
  - **Descripcion:** Agregar pruebas de comportamiento para solicitar dos explicaciones consecutivas del mismo hilo y comprobar que ambas quedan persistidas, el run vuelve a `waiting` y no se marca `interrupted`. Agregar una prueba de CLI y otra de TUI que demuestren que una explicacion en curso recibe la misma cancelacion ordenada que una ejecucion adjunta y que el contexto no se cierra antes de terminar la operacion.
  - **Evitar:** No probar funciones privadas, IDs aleatorios concretos ni detalles de `better-sqlite3`; usar el servicio publico, SQLite real y un driver controlado.
  - **Verificacion / TDD:** Las nuevas pruebas deben fallar contra el estado actual; ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts test/cli-review.test.ts test/tui-ink-shell.test.ts`.
  - **Commit Msg:** `test: cubrir explicaciones interactivas repetidas y cancelables`

### Fase 2: Correcciones de ejecucion interactiva

- [ ] **Tarea 2.1: Hacer que cada explicacion sea una ejecucion persistible independiente**
  - **Archivo:** `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/review-operations.ts`, `src/core/workflow-runtime.ts` si fuera estrictamente necesario
  - **Descripcion:** Corregir la identidad y la reutilizacion de los pasos de explicacion para que una explicacion completada nunca intente transicionar de `completed` a `pending`. Cada nueva solicitud debe conservar su pregunta y respuesta como mensajes ordenados, ejecutar una nueva explicacion o reutilizar solo un trabajo incompleto recuperable, y devolver el run a `waiting` tras liberar correctamente la ejecucion.
  - **Evitar:** No permitir que un paso `completed` se rerunnee, no borrar explicaciones previas y no debilitar las transiciones del state machine para ocultar el error.
  - **Verificacion / TDD:** Ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts test/interactive-review-persistence.test.ts` y confirmar que el caso de dos explicaciones pasa con SQLite real.
  - **Commit Msg:** `fix: permitir explicaciones repetidas en revisiones`

- [ ] **Tarea 2.2: Integrar `review explain` en el ciclo de vida adjunto**
  - **Archivo:** `src/cli/commands/review.ts`, `src/tui/shell-controller.tsx`, `src/tui/lifecycle.ts` solo si la interfaz existente no puede representar la operacion, `test/cli-review.test.ts`, `test/tui-ink-shell.test.ts`
  - **Descripcion:** Ejecutar `review explain` mediante el mismo propietario composicional que run, resume y decide: controlador de abort, espera de limpieza, suscripciones y cierre del contexto. Propagar su `AbortSignal` a `explainReview`; el primer Ctrl-C debe solicitar parada ordenada y el segundo debe esperar la limpieza antes de forzar la salida.
  - **Evitar:** No abrir un segundo contexto para la explicacion, no ignorar la promesa como tarea en segundo plano y no cambiar el protocolo JSON/JSONL v1.
  - **Verificacion / TDD:** Ejecutar `pnpm vitest run test/cli-review.test.ts test/cli-subprocess.test.ts test/tui-ink-shell.test.ts test/tui-lifecycle.test.ts`.
  - **Commit Msg:** `fix: incluir explicaciones en el ciclo de vida adjunto`

- [ ] **Tarea 2.3: Persistir fallo de agente interactivo como fallo recuperable del run**
  - **Archivo:** `src/application/interactive-plan-build-qa-coordinator.ts`, `test/interactive-review-workflow.test.ts`
  - **Descripcion:** Capturar `StepExecutionFailure` en el limite del coordinador interactivo, finalizar el run como `failed` o `cancelled` segun el estado del paso, y producir el informe final cuando corresponda. Reservar `interrupted` para fallos de infraestructura, cierre abrupto o perdida de propiedad de ejecucion.
  - **Evitar:** No transformar errores de almacenamiento, artefactos corruptos ni conflictos de propiedad en fallos normales del agente; esos deben seguir recorriendo la recuperacion de infraestructura existente.
  - **Verificacion / TDD:** Agregar un driver que falle durante scope, plan/build y QA; ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts test/application-infrastructure.test.ts`.
  - **Commit Msg:** `fix: clasificar fallos de fases interactivas`

- [ ] **Tarea 2.4: Aplicar el contrato de decisiones a la continuacion**
  - **Archivo:** `src/application/review-operations.ts`, `src/application/interactive-plan-build-qa-coordinator.ts`, `test/interactive-review-workflow.test.ts`
  - **Descripcion:** Usar la semantica aprobada en Tarea 1.1 para validar la decision antes de reclamar el run y para que `advance()` solo ejecute fases autorizadas. Mantener los hilos abiertos cuando la decision no autoriza continuar; ejecutar `fix` solo para una correccion QA autorizada; y reflejar el resultado en el informe final sin inferir aprobacion de un estado distinto de `waiting`.
  - **Evitar:** No usar `thread.state !== 'waiting'` como sustituto de una decision de negocio y no sobrescribir decisiones ni revisiones existentes.
  - **Verificacion / TDD:** Ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts test/interactive-review-contracts.test.ts`.
  - **Commit Msg:** `fix: respetar decisiones en checkpoints interactivos`

### Fase 3: Alinear contrato, persistencia y presentacion

- [ ] **Tarea 3.1: Resolver la promesa de targets task y change**
  - **Archivo:** `src/workflows/plan-build-qa-interactive.ts`, `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/review-operations.ts`, `README.md`, `test/interactive-review-workflow.test.ts`, `test/interactive-review-contracts.test.ts`
  - **Descripcion:** Hacer coincidir el contrato con los hilos realmente persistidos. Crear hilos con IDs estables para cada `task` declarado en scope y para cada cambio si el contrato de build aporta cambios estables; o, si el producto no revisara esos elementos individualmente, eliminar esos target kinds y el ejemplo CLI imposible de la documentacion. La opcion elegida debe garantizar que un target anunciado siempre corresponde a un hilo consultable y explicable.
  - **Evitar:** No inventar cambios a partir de texto libre ni introducir una segunda fuente de verdad para IDs. No dejar el comando documentado para un target que el coordinador nunca crea.
  - **Verificacion / TDD:** Ejecutar `pnpm vitest run test/interactive-review-workflow.test.ts test/interactive-review-contracts.test.ts test/cli-review.test.ts`.
  - **Commit Msg:** `fix: alinear targets interactivos con hilos persistidos`

- [ ] **Tarea 3.2: Representar correctamente fases QA dinamicas en la vista**
  - **Archivo:** `src/application/plan-build-qa-coordinator.ts`, `src/application/run-view.ts`, `test/plan-build-qa-workflow.test.ts`, `test/application-run-view.test.ts`
  - **Descripcion:** Mantener los IDs de iteracion persistidos (`qa-2`, `fix-1`, etc.) y ajustar la proyeccion de `RunView` para que no muestre el `fix` base inexistente como pendiente ni clasifique las fases dinamicas conocidas como `unknown`. La vista debe conservar perfiles, orden, estado y metricas de cada iteracion.
  - **Evitar:** No falsificar filas `fix` en SQLite y no convertir el workflow serializable en una abstraccion DAG o dinamica generica.
  - **Verificacion / TDD:** Agregar expectativas para una ejecucion con una y con varias iteraciones; ejecutar `pnpm vitest run test/plan-build-qa-workflow.test.ts test/application-run-view.test.ts`.
  - **Commit Msg:** `fix: mostrar fases QA iterativas correctamente`

- [ ] **Tarea 3.3: Actualizar el estado materializado de defectos QA**
  - **Archivo:** `src/application/ports.ts`, `src/storage/run-store.ts`, `src/storage/sqlite-run-store.ts`, `src/application/plan-build-qa-coordinator.ts`, `src/application/interactive-plan-build-qa-coordinator.ts`, `src/application/qa-history-operations.ts`, `test/qa-history.test.ts`, `test/plan-build-qa-workflow.test.ts`
  - **Descripcion:** Añadir la operacion minima de persistencia necesaria para que, al registrar eventos `fixed`, `verified`, o una futura reapertura, el estado actual de `QaDefect` se actualice transaccionalmente con su evento. Asegurar que `bugs --stats`, `byStatus` y la metrica de regresiones leen el estado actual correcto, mientras las ocurrencias y el historial de eventos conservan su trazabilidad.
  - **Evitar:** No recalcular estados destructivamente desde texto, no cambiar historiales de otros workspaces y no introducir un sistema generico de tickets.
  - **Verificacion / TDD:** Ejecutar `pnpm vitest run test/qa-history.test.ts test/plan-build-qa-workflow.test.ts test/cli-bugs.test.ts`.
  - **Commit Msg:** `fix: sincronizar estado actual del historial QA`

### Fase 4: Verificacion final

- [ ] **Tarea 4.1: Ejecutar regresion completa y comprobar limites de cambio**
  - **Archivo:** Solo archivos tocados por las tareas anteriores; no modificar `.agents/skills/`.
  - **Descripcion:** Ejecutar todas las comprobaciones del proyecto. Documentar separadamente que el unico fallo de formato conocido pertenece a los cuatro skills preexistentes, si sigue presente. Confirmar que no se modificaron artefactos de build ni archivos ajenos.
  - **Evitar:** No ejecutar `format --write`, no construir ni probar el bundle Linux y no limpiar la modificacion preexistente de `.agents/skills/todo-agent-skill/SKILL.md`.
  - **Verificacion:** `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run format:check`; despues, `git status --short` y revisar que cualquier archivo restante ajeno sea el preexistente.
  - **Commit Msg:** `test: verificar regresion de flujos interactivos`

## Reglas de Operacion para el Sub-Modelo
1. **Un solo check a la vez:** No comiences la tarea N+1 hasta que la tarea N tenga su check (`[x]`) y su verificacion sea exitosa.
2. **Politica de commits:** Haz un commit de Git inmediatamente al marcar un check. Usa el mensaje de commit especificado en la tarea. No acumules cambios de multiples tareas.
3. **Limite de faros:** No adivines el futuro. Si falta informacion en una tarea, no asumas; deten el trabajo y pregunta.
4. **Protocolo de desviacion:** Si aparece un bug preexistente bloqueante, una firma debe cambiar fuera de lo planificado, o se necesita una funcion de soporte no descrita, no marques la tarea. Responde con:

```markdown
ALERTA DE DESVIACION DE PLAN
- Tarea en curso: [ID]
- Bloqueo detectado: [descripcion tecnica]
- Impacto: [archivos/tests afectados]
- Propuesta: [nueva tarea o ajuste]
```

5. **Autodestruccion:** Cuando todas las tareas tengan un check (`[x]`), la regresion final pase y el arbol de trabajo este limpio tras los commits, elimina fisicamente `TODO.md`.
