# PLAN DE EJECUCION PARA LUNA: TUI Centrada En Tareas

> **LUNA:** Este archivo es el handover de ejecucion, no una orden de lanzar Binaflow contra si mismo. Leer `AGENTS.md` y `docs/tui-experience.md` completos. El propietario autorizo corregir este plan y aprobo P1-P6. No volver a preguntar esas decisiones ni inventar otras. 1.1 y 1.2 estan cerradas; las tareas de implementacion 2.1-2.6, 3.0-3.4, 4.1-4.3, 5.1-5.3 y 6.1 estan completadas. Quedan validaciones aplazadas, no una nueva tarea de producto autorizada. No lanzar modelos reales, construir bundles ni hacer commits durante esta revision documental.

## Vision Y Fuente De Verdad

Binaflow debe sentirse como un espacio para preparar y completar tareas, no como una consola de paneles desconectados. Conversacion para pensar, sintesis para conservar acuerdos, propuesta para revisar, accion humana para autorizar y resultado para entender evidencia y limites.

- Tareas nuevas TUI: `plan-build`, `plan-build-qa`, `todo-build-qa`.
- Mantener `plan-build-qa-interactive` WIP y `research-plan-build` resolubles en CLI, historial y recuperacion; ocultarlos solo del selector principal.
- Preparacion conversacional principal en workflows de planificacion; alternativa directa visible segun politica aprobada P1. TODO conserva documento y validacion, sin replanning.
- Modelo productor por borrador, sintesis corregible y revision humana siempre. Revision automatica opcional/obligatoria no ejecuta ni sustituye QA de implementacion.
- Una experiencia de tarea con etapas de presentacion; no nuevo motor, daemon, paralelo, detached, workflow dinamico, driver, plugin ni sistema generico de aprobaciones.
- CLI/protocolo-v1, persisted runs, permisos, ownership y handoff transaccional son fronteras obligatorias.

`docs/tui-experience.md` contiene decisiones aprobadas y contratos tecnicos. P1-P6 estan aprobadas: P2-P6 en bloque y P1 tras explicar el lanzamiento directo bajo revision obligatoria. No queda pendiente la aprobacion de esas decisiones de producto. El archivo `docs/plans/archive/conversation-approval-ux-completed.md` es historico: conservarlo sin modificaciones y no usar sus checks como evidencia de este scope.

## Estado Y Politica De Verificacion

- Revision documental y handover realizados; las Tareas 2.1 a 2.6, 3.0-3.4, 4.1-4.3, 5.1-5.3 y 6.1 estan implementadas y documentadas. Permanecen validaciones empiricas aplazadas.
- El propietario aprobo las recomendaciones iniciales de UX y P1-P6. Contratos de 1.1 cerrados en el anexo normativo de `docs/tui-experience.md`; no repetir cuestionario ni redisenar DTOs.
- `docs/tui-components.md` registra evaluacion documental de versiones/APIs instaladas y candidatos. Seleccion: Ink existente, editor controlado sin libreria nueva, viewport propio, string-width 8.2.2 y marked 18.0.11. Ambas dependencias directas fueron aprobadas por el propietario para 3.2 y 3.4 respectivamente; 1.2 cerrada, ningun paquete instalado ni spike ejecutado.
- Por instruccion del propietario, tests aplazados: no ejecutar suites, crear tests ni reconstruirlos en esta entrega. No borrar, deshabilitar ni arreglar pruebas existentes. Conservar los escenarios pendientes al final para la fase futura.
- Esto aplaza verificacion conductual; no autoriza declarar tests verdes ni producto completamente verificado. Las expectativas generales de `AGENTS.md` no se consideran satisfechas mientras los tests esten aplazados.
- Documentos y archivos propios: `pnpm exec prettier --check` ejecutado correctamente.
- Checks de codigo: `pnpm run lint`, `pnpm run typecheck` y `pnpm run build` ejecutados correctamente. `pnpm run format:check` global fallo por 138 archivos del baseline/modificaciones previas; no se formatearon masivamente. No ejecutar scripts de bundle ni `test:e2e` por inferencia.
- Si `typecheck` falla por fixtures existentes afectados, informar el contrato/archivo exacto; no editar tests, excluirlos del tsconfig o debilitar tipos sin autorizacion. Mantener extensiones opcionales de fachadas inyectadas cuando preserve compatibilidad real.
- Baseline observado antes de esta revision: formato global fallo en 151 archivos; lint/typecheck/build pasaron; suite anterior a la pausa paso con 318 tests y 1 omitido. Son resultados historicos, no validacion de futuros cambios. No repetir tests para actualizar baseline mientras siga vigente la pausa.

## Reglas Para Ejecutar Sin Inventar

1. Seguir orden de tareas. Un check acredita solo su aceptacion indicada; registrar por separado tests/validacion humana pendientes. No saltar prerequisitos ni marcar checks porque el codigo compila.
2. Antes de cambiar codigo, registrar `git status --short` y verificaciones no aplazadas. Hay mucho trabajo previo, incluidos archivos nuevos sin seguimiento. No revertirlo, formatearlo masivamente ni incluirlo en commits propios. En un archivo nuevo ajeno, staging de todo el archivo tambien incorporaria trabajo ajeno: pedir aislamiento/aprobacion si no se puede separar.
3. Tras autorizacion de implementacion, commits atomicos por tarea con staging explicito cuando los cambios sean separables; nunca `git add .`. Mensajes al pie de cada tarea no autorizan commits en la revision documental actual.
4. Archivos listados son de modificacion; se pueden leer otros para comprobar consumidores. Si hace falta modificar otro archivo/contrato no listado, detener e informar antes, sin crear helpers especulativos.
5. Todo estado de preparacion pertenece a aplicacion/storage, no al motor. TUI usa fachada/helpers, nunca SQL, archivos de artifacts o detalles Pi.
6. Claims/CAS y gates se validan en aplicacion/storage, no solo mediante botones deshabilitados. El owner de operacion existe desde la primera integracion, no se incorpora al final.
7. No usar una lectura ilimitada seguida de `slice` como paginacion. No contar elementos de una pagina para asignar secuencias persistidas.
8. No refactor preventivo ni cambios esteticos fuera de scope. Dependencias nuevas solo con version/licencia/APIs aprobadas en 1.2.
9. Registrar comando, resultado real y limitacion por tarea. No modificar baseline ajeno para lograr checks verdes. Si no se puede verificar con la politica actual, declarar pendiente/bloqueo.
10. No eliminar este plan mientras exista cierre tecnico pendiente, evaluacion de componentes o verificaciones aplazadas. Su retiro requiere cierre verificado o autorizacion expresa del propietario; no usar un skill de autodestruccion para perder pendientes.

## Fase 1: Contrato Cerrado Antes De Delegar Codigo

- [x] **Tarea 1.1: Congelar contratos conforme a las decisiones aprobadas**
  - **Modificar:** `docs/tui-experience.md`, `TODO.md`.
  - **Consultar:** `src/application/preparation.ts`, `src/application/preparation-operations.ts`, `src/application/ports.ts`, `src/application/service.ts`; `src/storage/migrations/010-preparation.ts`, `src/storage/migrations/index.ts`; `src/core/agent.ts`; `src/tui/model.ts`, `src/tui/shell-input.ts`, `src/tui/lifecycle.ts`; schemas de los tres workflows activos.
  - **Resultado:** P1-P6 aprobadas y contratos cerrados en el anexo normativo de experience: DTOs, schemas de respuesta/informe, revision/CAS, idempotencia, cobertura, permisos/politica, handoff, cursores y QA. Comprobados contra contratos y SQL actuales por inspeccion. Este check es documental, no acredita implementacion ni pruebas; sin commit en esta sesion de documentacion.
  - **Contratos que deben quedar cerrados:** revision CAS separada de contenido; idempotencia y retry por ID; callback de mensaje persistido; sugerencia/confirmacion de sintesis y generacion explicita de propuesta; informe/lectura/gate; politica efectiva capturada; cursores/payload/cache; capacidades de razonamiento; editor durable o efimero.
  - **Aceptacion:** P1-P6 sin pendientes, recorridos revisados por el propietario y ninguna firma con opciones de producto sin resolver. La fuente de verdad incluye la matriz de invalidacion y alcance exacto de revision obligatoria. `getTaskOutcome` ya elegido como proyeccion TUI separada; no dejar ese condicional a Luna.
  - **Verificacion:** aprobacion humana P1-P6 registrada; formato documental correcto. No ejecutar esta tarea de nuevo salvo desviacion concreta.
  - **Commit Msg:** `docs: specify task-centered TUI interaction contracts`

- [x] **Tarea 1.2: Elegir componentes y comprobar fuentes de capacidades**
  - **Modificar:** `docs/tui-components.md`, `TODO.md`; `docs/tui-experience.md` solo si la evidencia exige ajustar un contrato con aprobacion. El documento de componentes ya fue creado y evaluado.
  - **Consultar:** `package.json`, `pnpm-lock.yaml`, docs instaladas Ink/Ink UI, `src/tui/bootstrap.tsx`, `src/tui/viewport.ts`, `src/tui/text.ts`, `src/presentation/text.ts`, `src/core/agent.ts`, `src/drivers/pi-discovery.ts`, `src/drivers/pi-rpc.ts`.
  - **Accion:** evaluar editor multilinea, foco exclusivo, pegado con controles, resize, pantalla alternativa, Markdown y cortes de pagina. Registrar APIs exactas, version, licencia, mantenimiento, peers Ink 7/React 19, Linux/Windows, sanitizacion y dependencias. Distinguir documentado de probado.
  - **Capacidades:** catalogo actual no tiene niveles de razonamiento. Identificar fuente concreta sin llamadas pagadas y normalizacion en adapter; si no existe evidencia, usar capacidad desconocida segun P6. No inferir por nombre ni copiar la lista global de `PI_THINKING_LEVELS` a cada modelo.
  - **Aceptacion:** elegir solucion minima por componente y mapear APIs a 3.2-3.4. No asumir que `useFocus` desactiva todos los `useInput`. Un spike/dependencia exige archivos/version/tarea y autorizacion antes de crear codigo o instalar. Si no se autoriza probar terminal ahora, registrar no probado, nunca afirmar compatibilidad.
  - **Resultado tecnico:** Ink 7.1.1 / Ink UI 2.0.0 / React 19.2.8 comprobados. API usePaste separa pegado bracketed de teclas; editor controlado + Intl.Segmenter/string-width; viewport local; marked.lexer -> renderer Ink seguro. Capacidad de razonamiento desconocida, no nuevo port/driver hipotetico. Sin pruebas de terminal ni instalacion.
  - **Aprobacion registrada:** el propietario respondio afirmativamente a autorizar `string-width@8.2.2` como dependencia directa en 3.2 (ya existia transitiva) y `marked@18.0.11` en 3.4. Gate cerrado; las dependencias fueron instaladas en sus tareas correspondientes y no se solicito otra decision de producto.
  - **Verificacion:** `pnpm list ink @inkjs/ui react --depth 0` y formato de docs ejecutados; metadata/docs/fuentes versionadas en components. El check acredita seleccion y aprobacion documental, no pruebas de terminal ni implementacion.
  - **Commit Msg:** `docs: select supported TUI interaction components`

## Fase 2: Soporte De Aplicacion Y Persistencia

Implementar los DTOs definitivos del anexo de experience en `src/application/preparation.ts` y ports consumidores; no redisenarlos durante tareas posteriores. Mantener entry points legacy; consumidores nuevos usan overview/paginas. No motor de conversacion generico.

- [x] **Tarea 2.1: Migrar preparacion y persistir contratos completos**
  - **Modificar:** `src/application/preparation.ts`, `src/application/ports.ts`, nuevo `src/application/preparation-review.ts` (DTO/schema del informe, sin llamadas a modelos), `src/application/preparation-operations.ts` (solo adaptacion compatible de campos/llamadas existentes); `src/storage/sqlite-run-store.ts`, nueva `src/storage/migrations/011-preparation-experience.ts`, `src/storage/migrations/index.ts`.
  - **Funciones:** DTOs, queries overview/list/documento acotado, CAS de ajustes/sintesis, begin/finish turn/review, confirmacion de lectura, claim/recovery y `createRunFromPreparation`.
  - **Accion:** implementar estrategia de migracion descrita en experience. Confirmar 011 libre. Ampliar CHECK de workflow en drafts y proposals para `plan-build-qa`; preservar las cinco tablas actuales, IDs, FK, outputs, snapshots, owners y aprobaciones. No editar 010 ni intentar desactivar FK dentro de `BEGIN IMMEDIATE`. Registrar v11 solo tras copia y `foreign_key_check` sin errores.
  - **Persistencia:** separar `revision` CAS y `contentVersion`; conservar historial inmutable y puntero a propuesta vigente. Persistir ajustes, sintesis/sugerencias, requestIds, intentos, politica efectiva, informes y lectura por ID. Persistir coverage/confirmed de P4; P5 excluye texto no enviado. Preservar sqlite_sequence de aprobaciones al reconstruir tablas AUTOINCREMENT; nunca credenciales ni foco en SQLite.
  - **Atomicidad:** cada mutacion valida activo/CAS/claim/pertenencia. Dos llamadas de la misma instancia tampoco reemplazan claims vivos. Asignar secuencias en storage, no por longitud de mensajes cargados. El handoff transaccional comprueba evidencia vigente/lectura, guarda consumo/aprobacion/run/pasos/artifacts/owner juntos. No llamadas driver ni filesystem dentro de transaccion.
  - **Compatibilidad:** defaults de configuracion antiguos; productor desconocido no inventado. Conservar serializacion historica y propuesta legacy solo si antes era vigente. Queries nuevas no cargan transcripcion/outputs completos. DTOs de listados acotan metadatos ademas del numero de items.
  - **Aceptacion:** SQL/DTOs satisfacen casos de v10 y base nueva, rollback, FK, concurrencia, modelo sin invalidacion de contenido y evidencia de otra propuesta rechazada. Registrar estos casos como inspeccion estatica; pruebas de migracion/concurrencia siguen pendientes, no afirmar seguridad empirica.
  - **Verificacion actual:** `pnpm exec prettier --check` de archivos propios, `pnpm run lint`, `pnpm run typecheck` y `pnpm run build` ejecutados correctamente; inspeccion estatica del esquema y transacciones. Pruebas de migracion/concurrencia siguen aplazadas. No ejecutar migraciones manuales sobre datos del usuario ni introducir un script-test encubierto.
  - **Commit Msg:** `feat: persist preparation settings and review provenance`

- [x] **Tarea 2.2: Resolver modelos y configuracion sin cambiar perfiles ni CLI**
  - **Modificar:** `src/application/preparation-operations.ts`, `src/application/preparation.ts`, `src/application/service.ts`, `src/application/context.ts`, `src/application/runtime.ts`, `src/application/config-operations.ts`; `src/config.ts`. Leer, no modificar, `src/core/agent.ts` y `src/drivers/pi-discovery.ts`.
  - **Funciones:** `createPreparation`, `plannerProfile`, `snapshotProfile`, `updatePreparationSettings`; nueva query `discoverPreparationModels`; `generateUpdatedPreparationConfiguration` y escritura atomica existente segun P2.
  - **Accion:** `discoverPreparationModels` mapea `discoverModels` existente y omite thinkingLevels: 1.2 no encontro fuente verificada. No ampliar core/driver para capacidades hipoteticas ni filtrar metadata nueva a CLI. La fachada deriva productor/revisor de planner (P3), valida selecciones y preserva herramientas/trust/timeout/retry. Componer callback readPreparationReviewMode en runtime para el snapshot fresco definido en el anexo.
  - **Configuracion:** `preparation.reviewMode` y modelo revisor por borrador conforme P2/P3. Nueva operacion estrecha relee/mezcla solo la politica, preserva claves/perfiles y usa escritura atomica existente. Detectar cambios desde preview y pedir reconfirmacion; no prometer CAS contra un editor externo simultaneo. Propagar config en `ApplicationConfig`, opciones de service y runtime. No leer config desde componentes ni afirmar atomicidad archivo-SQLite.
  - **Aceptacion:** cambiar modelo solo sin operacion incompatible, persiste y no invalida contenido. Nueva llamada usa snapshot real, no fallback. Default/unknown visibles segun P6. Si capacidades o credenciales fallan, error recuperable sin prueba pagada automatica.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de flujo config -> adapter -> fachada ejecutados correctamente; contratos con driver falso y persistencia empirica siguen pendientes.
  - **Commit Msg:** `feat: support per-preparation model selection`

- [x] **Tarea 2.3: Sintesis confirmada, contexto y turnos recuperables**
  - **Modificar:** `src/application/preparation-operations.ts`, `src/application/preparation.ts`, `src/application/service.ts`; `src/storage/sqlite-run-store.ts` y `src/application/ports.ts` solo para completar contratos begin/finish/queries previstos en 2.1.
  - **Funciones:** `buildPreparationPrompt`, `parsePreparationAgentResponse`, nuevo `replyPreparationTurn`, `retryPreparationReply`, `updatePreparationSynthesis`, `generatePreparationProposal`, recuperacion explicita `recoverPreparation` y callback `onPersisted`; `replyPreparation` queda wrapper compatible, sin duplicar logica.
  - **Accion:** actualizar respuesta estructurada para sugerencia de sintesis conforme P4, sin convertirla en acuerdos humanos automaticamente. Generar propuesta es accion explicita sobre sintesis confirmada; no requiere insertar un mensaje artificial ni regenerar al navegar. Incluir schemas reales y mensaje actual completo dentro de 32.000 unidades UTF-16 del prompt final.
  - **Recuperacion:** requestId deduplica envio; retry usa userMessageId persistido y registra intento, no otro mensaje. Guardar mensaje/estado pendiente antes del driver y notificar por callback ligado al borrador. El editor distingue persistencia del envio de exito del modelo. Todo fallo posterior al claim, incluido previo al driver, sigue cleanup y conserva estado recuperable.
  - **Aceptacion:** no omitir mensaje actual ni acuerdos antiguos por recorte. Sugerencia pendiente/coverage insuficiente no produce propuesta ejecutable. Propuestas previas visibles como historicas. El result nuevo es acotado: no construir conversacion completa y descartarla despues en la TUI. CAS stale no publica respuesta incompatible. Reapertura y callbacks tardios no disparan modelos, roban foco ni duplican turnos.
  - **Verificacion actual:** formato propio, lint/typecheck/build, inspeccion de cada salida de error y presupuesto ejecutados correctamente; pruebas de historia larga, idempotencia y cancelacion siguen aplazadas.
  - **Commit Msg:** `feat: preserve preparation agreements across bounded turns`

- [x] **Tarea 2.4: Revision y autorizacion exactas**
  - **Modificar:** `src/application/preparation-review.ts` (schema/DTO ya creados en 2.1); `src/application/preparation.ts`, `src/application/preparation-operations.ts`, `src/application/service.ts`, `src/application/ports.ts`; `src/storage/sqlite-run-store.ts` solo para contratos de revision/handoff de 2.1.
  - **Funciones:** JSON Schema versionado del informe, `reviewPreparationProposal`, `acknowledgePreparationReview`, elegibilidad de `approveAndExecutePreparation`.
  - **Accion:** un informe por solicitud explicita; vincular proposalId/contentVersion/politica/snapshot. Persistir hallazgos severos y lectura por informe exacto. Aplicar P1-P3 en facade y commit, no solo en UI. Cambiar revisor/cancelar/reintentar no borra bloqueo de contenido.
  - **Aceptacion:** `required-auto` no aprueba sin informe valido; critical/high no se evaden cambiando modo/modelo; medium/low requieren lectura confirmada. Informe fallido/obsoleto no cumple gate. Solicitar ajustes no crea loop ni ejecuta. No adjudicacion ni aprobacion generica del motor.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de matriz de elegibilidad y condiciones del commit ejecutados correctamente. Pruebas de autorizacion siguen aplazadas.
  - **Commit Msg:** `feat: add explicit preparation review policies`

- [x] **Tarea 2.5: Handoff a workflows activos sin replanning**
  - **Modificar:** `src/application/preparation.ts`, `src/application/preparation-operations.ts`, `src/application/execution-operations.ts`, `src/application/plan-build-qa-coordinator.ts`; `src/storage/sqlite-run-store.ts` solo handoff previsto.
  - **Consultar:** schemas/IDs de `src/workflows/plan-build.ts`, `plan-build-qa.ts`, `plan-build-qa-interactive.ts` y coordinacion actual de resume.
  - **Accion:** validar `plan` para plan-build; `scope` y `plan` para plan-build-qa usando sus schemas. Importar pasos completos con outputs/artifact refs y snapshot real productor, no fingir analyst/planner configurados. 011 ya debe admitir el workflow; no remendar 010 aqui.
  - **Aceptacion:** preflight de versiones, revision, politica efectiva, workspace, perfiles/permisos. Aprobacion identifica propuesta exacta y consume una vez. Despues del commit no llamar analyst/planner ni borrar artifacts por fallo al iniciar build. Resume usa pasos completos y conserva limites QA/fix existentes. Legacy interactivo/research siguen recuperables.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de orden/limites transaccionales ejecutados correctamente. Pruebas de crash antes/despues de commit siguen aplazadas.
  - **Commit Msg:** `feat: hand off approved preparation to bounded QA workflows`

- [x] **Tarea 2.6: Proveer lectura paginada antes del viewport**
  - **Modificar:** `src/application/artifact-operations.ts`, `src/application/run-operations.ts`, `src/application/ports.ts`, `src/application/service.ts`, `src/application/preparation-operations.ts`, `src/application/preparation.ts`, `src/presentation/format.ts`; `src/artifacts/artifact-store.ts`, `src/artifacts/file-artifact-store.ts`; `src/storage/sqlite-run-store.ts` solo lectura acotada y proyeccion de listados.
  - **Funciones:** `readArtifactPage`, `readPreparationDocumentPage`, `formatPreparationOutput`, `listTaskRunsPage` y queries de paginas de borradores/mensajes/propuestas; lectura bidireccional por cursor en adapter.
  - **Accion:** implementar `DocumentPage` del contrato. Artifact cursor valida identidad/version, pertenencia al run y ruta segura/symlink usando seguridad actual. Lectura UTF-8 acotada y cierre de handle en fallo/cancelacion. Texto SQLite por fragmentos, no traer outputs o transcripcion completa para cortarlos en TUI.
  - **Aceptacion:** 200 lineas/64 KiB con continuidad de lineas largas y caracteres multibyte, sin perdida/duplicacion. Cursores de otro documento se rechazan. No `readArtifact(full)` para simular paginacion. Metadatos 50/payload P6; CLI `readArtifact` conserva modos/campos/comportamiento actuales.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de limites/offsets/seguridad ejecutados correctamente. Fixtures de UTF-8, pagina larga y paths maliciosos siguen aplazados.
  - **Commit Msg:** `feat: add bounded task document queries`

## Fase 3: Presentacion Y Ownership Antes De Integrar Flujos

Dependencias aprobadas en 1.2: `string-width@8.2.2` en 3.2 y `marked@18.0.11` en 3.4. Durante la implementacion, modificar `package.json` y `pnpm-lock.yaml` solo en esas tareas mediante `pnpm add --save-exact <paquete@version>`; inspeccionar diff para evitar upgrades ajenos. No otra dependencia ni framework de navegacion.

- [x] **Tarea 3.0: Asegurar ownership antes de cambiar navegacion**
  - **Modificar:** `src/tui/shell-controller.tsx`, `src/tui/shell-input.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/lifecycle.ts`, `src/tui/execution.ts`, `src/tui/shell-view.tsx`, `src/tui/layout.tsx`.
  - **Accion:** indicador global de operacion con Volver a operacion/Cancelar y confirmacion de salida, usando layout existente. Reutilizar unico lifecycle, no owner por pantalla ni refactor visual en esta tarea.
  - **Reglas:** navegacion/lectura y editor local permitidos durante operacion; bloquear cambio de proyecto/config/contexto y otra operacion mutante. Ctrl+C, signals, stream/render failure y salida confirmada siguen shutdown ordenado. No desuscribir persistencia activa por abrir documento.
  - **Aceptacion:** resize/volver no cancelan ni pierden controller/contexto. Primer cancel graceful, segundo respeta cleanup antes de force; SQLite no cierra prematuramente. Nuevos callbacks de generacion/revision usaran este owner, no un segundo sistema.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de ownership ejecutados correctamente. Terminal/cancelacion reales siguen aplazados.
  - **Commit Msg:** `feat: preserve operation ownership during task navigation`

- [x] **Tarea 3.1: Layout responsivo sin cambiar semantica**
  - **Modificar:** nuevo `src/tui/theme.ts`; `src/tui/components.tsx`, `src/tui/layout.tsx`, `src/tui/bootstrap.tsx`, `src/tui/shell.tsx`, `src/tui/shell-view.tsx`.
  - **Accion:** marco proyecto/tarea/etapa, foco y acciones visibles, NO_COLOR, terminal estrecho con una vista. Integrar visualmente indicador de 3.0 sin crear otro lifecycle.
  - **Aceptacion:** resize conserva editor/tarea y no monta otro owner. Si el terminal es demasiado pequeno, solo mostrar acciones seguras visibles; no enrutar teclas ocultas ni permitir aprobaciones invisibles. Colores complementan etiquetas y foco textual, no los sustituyen.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de layout ejecutados correctamente. Validacion de terminales/resize sigue aplazada.
  - **Commit Msg:** `feat: add responsive task-centered TUI layout`

- [x] **Tarea 3.2: Editor multilinea con entrada exclusiva**
  - **Modificar:** nuevo `src/tui/message-editor.tsx`; `src/tui/text.ts`, `src/tui/shell-input.ts`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/screens/preparation.tsx`, `src/tui/shell-controller.tsx`; `package.json` y `pnpm-lock.yaml` solo para string-width 8.2.2 aprobado.
  - **Accion:** editor controlado sin useInput propio; shell enruta useInput/usePaste, helpers usan Intl.Segmenter y string-width. No nuevo focus manager; seguir APIs/limites de components y tabla de experience. Enviar es accion explicita, Enter en editor inserta linea. Controlar pegado como texto, nunca acciones por Tab/Esc incrustados. Conservar drafts locales por proyecto/draftId segun P5.
  - **Aceptacion:** un evento tiene un destino. Acciones siempre visibles; editor no comparte teclado activo con shell/lista. requestId/version de editor distinguen envio persistido, respuesta y ediciones posteriores. Duplicados de solicitud y vacios bloqueados; repetir deliberadamente el mismo texto sigue permitido.
  - **Evitar:** depender del orden de `useInput`, timeout para foco, dos focus managers o flags de autorizacion derivados de texto.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion del enrutamiento ejecutados correctamente. Prueba terminal de pegado/controles sigue aplazada.
  - **Commit Msg:** `feat: add focus-safe multiline preparation input`

- [x] **Tarea 3.3: Viewport con ancla, cache acotada y retorno**
  - **Modificar:** `src/tui/viewport.ts`, `src/tui/text.ts`, nuevo `src/tui/document-view.tsx`; `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`, `src/tui/shell-controller.tsx`, `src/tui/shell-view.tsx`.
  - **Accion:** consumir paginas de 2.6 por fachada. Implementar ancla de fuente, movimiento/acciones visibles, busqueda local, seguimiento al final y cache/retorno P6. Guardar cursores/posiciones sin conservar payload ilimitado de documentos anteriores.
  - **Aceptacion:** llegada de contenido/resize no roba posicion; seleccionar por ID; cargar anterior no cambia seleccion; busqueda declara alcance. Fuente grande no se lee completa y contenido desalojado se recarga por cursor. Respuestas tardias se ignoran para la vista equivocada sin perder persistencia.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de limites y referencias ejecutados correctamente. Navegacion larga con terminal falso sigue aplazada.
  - **Commit Msg:** `feat: add anchored reading navigation for task content`

- [x] **Tarea 3.4: Markdown seguro y fuentes parciales legibles**
  - **Modificar:** nuevo `src/tui/markdown.tsx`; `src/tui/document-view.tsx`, `src/tui/text.ts`, `src/presentation/text.ts` solo si hace falta sanitizacion compatible; `package.json` y `pnpm-lock.yaml` solo para marked 18.0.11 aprobado.
  - **Accion:** Marked local con gfm, usar lexer (no HTML ni marked-terminal) y renderer de spans Ink segun components para encabezados, enfasis, listas, citas, enlaces y codigo; tablas adaptadas a anchura. Sanitizacion antes de estilos, conservar espacios. Cortes dentro de bloques usan contexto aprobado o fallback Fuente parcial visible, no sintaxis inventada.
  - **Aceptacion:** controles/OSC/HTML/enlaces no ejecutan ni manipulan terminal; NO_COLOR conserva jerarquia. Codigo ancho indica overflow y permite leer fuente sin perdida. No regex como parser completo ni HTML remoto/resaltado no aprobado.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de sanitizacion y fallback ejecutados correctamente. Fixtures Markdown malicioso/incompleto siguen aplazados.
  - **Commit Msg:** `feat: render safe readable Markdown in the TUI`

## Fase 4: Recorridos De Tarea Sobre Contratos Existentes

- [x] **Tarea 4.1: Selector enfocado, entrada directa y configuracion de revision**
  - **Modificar:** `src/tui/launch.ts`, `src/tui/layout.tsx`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/screens/workflows.tsx`, `src/tui/screens/launch.tsx`, `src/tui/screens/todo-select.tsx`, `src/tui/screens/setup.tsx`, `src/tui/shell-input.ts`, `src/tui/shell-controller.tsx`, `src/tui/shell-view.tsx`.
  - **Accion:** Nueva tarea/Continuar/Configuracion, selector de tres workflows, alternativa directa visible conforme P1, configuracion global de revision P2 por operacion de 2.2. TODO muestra ruta/documento/permisos y distingue validacion local de paso agente.
  - **Aceptacion:** CLI/catalogo resoluble no cambian; historial no se filtra por selector reducido. Continuar lista borradores/runs paginados; WIP recuperable. Configuracion global nunca se guarda al cambiar modelo de un borrador. Legacy config se preserva y cambios de contexto bloqueados durante operacion.
  - **Verificacion actual:** formato propio, lint/typecheck/build e inspeccion de selector vs resolucion ejecutados correctamente. Recorridos directos/TODO/legacy siguen aplazados.
  - **Commit Msg:** `feat: expose focused task creation and legacy recovery`

- [x] **Tarea 4.2: Conversacion, sintesis, propuesta y revision integradas**
  - **Modificar:** `src/tui/screens/preparation.tsx`, nuevo `src/tui/screens/proposal.tsx`; `src/tui/shell-view.tsx`, `src/tui/shell-controller.tsx`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`, `src/tui/layout.tsx`.
  - **Funciones:** abrir/reabrir, enviar/reintentar por ID, editar/confirmar sintesis, `generatePreparationProposal`, selectores productor/revisor, revision/lectura/aprobacion.
  - **Accion:** orientacion inicial local sin llamada pagada. Historial/sintesis/propuesta separados, usando editor y viewport. Propuesta muestra objetivo, alcance, tareas y verificaciones legibles, no solo contador de outputs ni JSON crudo. Mostrar modelo real productor y agentes que continuan.
  - **Aceptacion:** propuesta obsoleta visible no ejecutable; toda aprobacion identifica ID/version/permisos y exige foco. Sugerencia de sintesis no es plan ni acuerdo confirmado. Revisor no se ejecuta por navegacion. Mensaje persistido se muestra durante generacion por callback; fallo permite retry sin duplicado. Cambiar modelo no invalida propuesta por CAS ni pierde editor.
  - **Lifecycle:** cada operacion usa owner de 3.0 desde antes de abrir contexto hasta persistencia final. No sustituir el contexto mientras reply/review/build lo utiliza. Callback tardio no muta otra tarea.
   - **Verificacion actual:** formato propio de los archivos tocados, lint/typecheck/build e inspeccion de recorrido completo y gates. `format:check` global sigue bloqueado por archivos preexistentes; terminal/driver falsos pendientes.
  - **Commit Msg:** `feat: integrate conversational task preparation and plan review`

- [x] **Tarea 4.3: Actividad comprensible y cierre de integracion adjunta**
  - **Modificar:** `src/tui/screens/live.tsx`, `src/tui/layout.tsx`, `src/tui/shell-controller.tsx`, `src/tui/execution.ts`, `src/tui/lifecycle.ts` solo ajustes concretos de integracion.
  - **Accion:** estados de actividad reales para preparando respuesta, revisando, esperando decision, ejecutando y cancelando. Resumen primero, actividad detallada bajo demanda; tokens/costos solo si existen datos normalizados.
  - **Aceptacion:** no inferir estado por silencio, ni ETA/porcentajes/streaming ficticios. Revisar ownership ya integrado en 3.0/4.2; esta tarea no es permiso para haber dejado lifecycle roto antes. Sin timers/subscriptions duplicados al navegar.
   - **Verificacion actual:** formato propio de los archivos tocados, lint/typecheck/build e inspeccion de orden de shutdown. `format:check` global y validacion empirica de lifecycle siguen pendientes.
  - **Commit Msg:** `feat: explain attached execution activity without synthetic progress`

## Fase 5: Resultados Y QA Consultables

- [x] **Tarea 5.1: Proyeccion TUI de resultados y evidencia**
  - **Modificar:** nuevo `src/application/task-outcome.ts`; `src/application/artifact-operations.ts`, `src/application/service.ts`, `src/presentation/format.ts`.
  - **Consultar:** `src/application/run-view.ts`, coordinadores y renderers de `plan-build-qa`/`todo-build-qa`, CLI show/protocolo.
  - **Accion:** implementar `getTaskOutcome` y `getTaskQaRound` separados de `RunView`, con DTOs/limites del anexo. Leer resultados/reportes por limites de 2.6; devolver referencias y limitaciones cuando no se puedan interpretar. Ronda = IDs reales qa/qa-N del coordinador, no attempt. Relacion de hallazgos siempre con run/ronda/ID.
  - **Aceptacion:** separar estado del proceso, declaraciones builder, evidencia de comandos y QA de solo lectura. No inventar ubicacion ausente en schema ni resolucion por desaparicion en texto. `plan-build` conserva resultado libre como declaracion. Sin QA global opt-in, LLM de resumen ni nuevas rondas. JSON/JSONL CLI conservan envelopes/campos/orden/streams/exit codes.
   - **Verificacion actual:** formato propio de los archivos tocados, lint/typecheck/build e inspeccion de fuentes/procedencia. Tests de multiples rondas/legacy/evidencia ausente pendientes.
  - **Commit Msg:** `feat: project task outcomes and QA evidence explicitly`

- [x] **Tarea 5.2: Resultado legible y documentos navegables**
  - **Modificar:** `src/tui/screens/result.tsx`, `src/tui/screens/artifacts.tsx`, `src/tui/shell-view.tsx`, `src/tui/shell-controller.tsx`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`.
  - **Accion:** desenlace, cambios reportados, verificaciones, pendientes y acciones antes de logs. Abrir plan/resultado/informe con viewport comun y volver al origen. Ver cambios muestra referencias disponibles, no promete diff si no existe artifact.
  - **Aceptacion:** `completed` no asegura calidad; failed/cancelled/interrupted/waiting explicables. Reporte grande/faltante/corrupto permite consultar fuente y muestra limitacion, no exito inventado. TUI no lee filesystem/git ni parsea evidencia de negocio por su cuenta.
   - **Verificacion actual:** formato propio de los archivos tocados, lint/typecheck/build e inspeccion de estados/documentos. Tests de recorridos largos/errores de lectura pendientes.
  - **Commit Msg:** `feat: present readable outcomes and supporting documents`

- [x] **Tarea 5.3: QA por ronda y hallazgo sin adelantar WIP**
  - **Modificar:** nuevo `src/tui/screens/qa-report.tsx`; `src/tui/shell-view.tsx`, `src/tui/shell-controller.tsx`, `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`.
  - **Accion:** resumen por severidad, filtros, lista/detalle y selector de ronda; seleccionar por identidad compuesta, no indice mutable. Evidencia y sugerencias legibles en viewport, indicando informacion ausente.
  - **Aceptacion:** volver conserva filtro/seleccion/ancla. Contador corresponde a ronda elegida. Cero hallazgos no es garantia. No aceptar riesgos, conversar por bug, modificar disposiciones, ejecutar fixes, activar qaHistory ni generar rondas. No reemplazar pantallas interactivas legacy.
  - **Verificacion actual:** `pnpm exec prettier --check` de archivos propios, `pnpm run lint`, `pnpm run typecheck` y `pnpm run build` ejecutados correctamente; inspeccion de solo lectura, procedencia, selección por IDs, filtros y retorno ejecutada. QA largo, filtros/retorno con terminal falso y fixtures de informes ausentes/corruptos siguen aplazados por la política vigente.
  - **Commit Msg:** `feat: add navigable read-only QA reports`

## Fase 6: Handover Honesto, Sin Dar Tests Aplazados Por Hechos

- [x] **Tarea 6.1: Documentar entrega y validacion pendiente**
  - **Modificar:** `README.md`, `docs/tui-experience.md`, `docs/tui-components.md`, `TODO.md`. No modificar archivo historico ni tests.
  - **Accion:** documentar entradas, alcance de politica global/directo/CLI, modelos/unknown, sintesis/limites, aprobacion, teclado/foco/pegado, paginas/busqueda, QA y lifecycle adjunto. Explicar como arrancar compilacion local sin bundles.
  - **Verificacion actual:** `pnpm run format:check` fallo por 138 archivos del baseline/modificaciones previas; el formato propio de `README.md`, `docs/tui-experience.md`, `docs/tui-components.md`, `TODO.md` y los archivos TUI tocados paso. `pnpm run lint`, `pnpm run typecheck` y `pnpm run build` pasaron. No se ejecuto `pnpm run test`, E2E, integraciones ni live Pi conforme a la pausa vigente; no se declara el producto completamente verificado.
  - **Validacion humana:** cuando se autorice y haya terminal, Linux/Windows, estrecho/normal, NO_COLOR, pegado, Markdown ancho/parcial, historia larga, busqueda/retorno, QA por ronda y cancelacion. No afirmar compatibilidad por inspeccion ni afirmar pruebas realizadas en terminales no disponibles.
  - **Aceptacion:** inventario fiel de implementado, verificado, no probado y bloqueado; decisiones/componentes/versiones exactas; cambios propios separados de baseline ajeno. El plan permanece mientras haya pendientes, salvo indicacion expresa del propietario.
  - **Commit Msg:** `docs: document task-centered TUI delivery and validation gaps`

## Escenarios De Verificacion Aplazados (No Ejecutar Ahora)

Conservar para la futura reconstruccion minima de tests, no como tareas activas ni autorizacion para escribir otra suite:

- Migracion v10 -> v11 y base nueva: conservar IDs/outputs/aprobaciones/owners, CHECK nuevo, foreign keys, rollback y dos conexiones.
- CAS separado de contenido: cambio solo de productor conserva propuesta; mensaje/sintesis la invalida; claim concurrente incluso en misma instancia rechazado.
- Turnos: requestId repetido no ejecuta dos veces, texto deliberadamente repetido si es valido; retry por ID; fallo antes/despues de persistir y cancellation liberan recursos sin perder mensaje.
- Sintesis/contexto: cobertura de acuerdos viejos, correccion humana dominante, mensaje actual nunca omitido, limite final serializado y sugerencia pendiente no ejecutable.
- Revision: obligatorio/optional, lectura exacta, informe obsoleto, bloqueos no evadibles cambiando modelo/modo, politica efectiva y entrada directa.
- Handoff: aprobacion consciente -> build sin analyst/planner repetidos; crash antes/despues del commit conserva artifacts y consumo unico.
- Lectura: UTF-8/codigo/linea larga, pagina que corta Markdown/JSON, cache total acotada, busqueda local y retorno tras desalojar pagina; paths/symlinks maliciosos.
- Terminal/driver falsos: idea incompleta -> modelo -> sintesis -> propuesta -> revision -> ajustes -> nueva aprobacion -> build -> QA -> resultado; otro recorrido TODO/legacy.
- Foco/lifecycle: pegado con controles no ejecuta; resize/navegacion no roba foco ni cierra SQLite; cancelacion, signals y stream/render failures comparten cleanup.
- Protocol-v1: envelopes, orden, stdout/stderr y exit codes sin cambios; QA sin evidencia no inventa verificacion.

## Protocolo De Bloqueo

No convertir un bug preexistente, API faltante o decision abierta en trabajo silencioso. Mantener tarea sin check y responder:

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos/contratos/decisiones>
Propuesta: <ajuste minimo para aprobacion>
Verificacion pendiente: <si aplica>
```

## Handover Actual Para Luna

- Implementacion: Fases 2-5 y Tarea 6.1 implementadas; no queda una tarea de producto posterior autorizada. El plan permanece para conservar las validaciones aplazadas.
- Aprobadas: recomendaciones originales de interaccion, limites por pagina/sintesis/contexto, revision humana y severidades, navegacion adjunta.
- Producto aprobado: P1 directo deshabilitado bajo required-auto para nuevas tareas TUI de planificacion; P2 politica global comprobada antes de operar; P3 bloqueo grave persistente y revisor derivado de planner; P4 sintesis confirmada y mensaje maximo 16.000 unidades UTF-16; P5 editor efimero con aviso al salir; P6 cache acotada y Default para razonamiento desconocido. No quedan preguntas P1-P6 pendientes.
- Contratos 1.1: cerrados por el anexo normativo, check documental completado sin implementar codigo.
- Componentes 1.2: evaluados y aprobados, incluidos string-width 8.2.2 directo y marked 18.0.11. Fase 1 cerrada; plan listo para iniciar implementacion desde 2.1 sin nuevos cuestionarios ni repetir seleccion.
- Correcciones tecnicas incorporadas al plan: migracion CHECK/FK, CAS separado de contenido, idempotencia/retry, soporte real de paginas antes del viewport, consulta de capacidades separada de CLI, outcome TUI separado, lifecycle temprano.
- Tests: aplazados por el propietario; no borrados, no ejecutados en esta revision y no declarados verdes para este scope.
- Instalaciones: `string-width@8.2.2` y `marked@18.0.11` fueron declaradas e instaladas durante 3.2/3.4 conforme a la autorizacion. No se lanzaron modelos reales ni bundles en esta entrega; no se creo commit.
