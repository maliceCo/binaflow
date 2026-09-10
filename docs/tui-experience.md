# Experiencia TUI Centrada En Tareas

## Estado Y Fuente De Verdad

Especificacion y handover para ejecutar mediante `TODO.md`. Las decisiones de producto y los contratos tecnicos siguen siendo la fuente de verdad; las notas de entrega distinguen implementacion inspeccionada de comportamiento probado. Las recomendaciones del cuestionario original fueron aprobadas por el propietario. La revision tecnica posterior detecto decisiones adicionales P1-P6, tambien aprobadas: el propietario acepto P2-P6 en bloque y P1 despues de aclarar el alcance del lanzamiento directo. Sus decisiones definitivas se registran al final del documento; no volver a solicitarlas.

Los contratos tecnicos de 1.1 quedan cerrados por el anexo normativo de este documento. La evaluacion de componentes esta documentada en `docs/tui-components.md`; el propietario aprobo `string-width@8.2.2` y `marked@18.0.11`, y ambas dependencias estan declaradas directamente en `package.json` y `pnpm-lock.yaml`. Las tareas de implementacion 2.1-2.6, 3.0-3.4, 4.1-4.3 y 5.1-5.3 estan implementadas. Esto no equivale a compatibilidad empirica de terminal ni a suite de tests verde.

## Estado De Entrega Y Validacion

Implementado e inspeccionado: preparacion persistida y recuperable, seleccion de modelos con capacidad de razonamiento desconocida, sintesis y propuesta con aprobacion humana, handoff a workflows, lectura paginada, editor multilinea, viewport y Markdown seguro, ownership adjunto, resultados acotados y pantalla QA de solo lectura por ronda. La pantalla QA muestra conteos por severidad, filtro, evidencia y correccion sugerida; conserva ronda, hallazgo y ancla al volver y no llama a `qaHistory` ni ejecuta fixes.

Checks no aplazados ejecutados sobre el cambio: Prettier de archivos propios, `pnpm run lint`, `pnpm run typecheck` y `pnpm run build`. La suite, E2E, integracion live Pi y validacion de terminal siguen aplazadas por instruccion del propietario. No se afirma que Linux/Windows, terminal estrecha, `NO_COLOR`, IME/CJK, pegado sin bracketed paste, resize, documentos parciales, navegacion larga, fallos de stream/render o cancelacion real hayan sido probados.

Para ejecutar la TUI desde el checkout sin bundle: `pnpm install`, `pnpm run build` y `pnpm run cli -- tui`. Esto compila y arranca el proceso adjunto; no instala Pi, no autentica proveedores y no inicia daemon.

## Vision E Invariantes Aprobados

Binaflow es un espacio para preparar y completar tareas. La conversacion permite pensar; la sintesis conserva acuerdos; la propuesta contiene los outputs ejecutables; una accion humana explicita autoriza; los resultados explican lo sucedido con evidencia y limitaciones.

- Proyecto: workspace local que delimita configuracion, borradores e historial.
- Tarea: borrador y eventual run enlazados, no una nueva entidad generica del motor.
- Documento: sintesis, alcance, plan, TODO, resultado o informe, con origen y posicion de lectura.
- QA: informes existentes por ronda, separados de la revision de la propuesta.
- Preparacion, propuesta, ejecucion, revision y resultado son etapas de presentacion, no estados nuevos de `WorkflowRun`.
- Selector de nuevas tareas: `plan-build`, `plan-build-qa`, `todo-build-qa`.
- `plan-build-qa-interactive` y `research-plan-build` siguen resolubles para CLI, historial, aprobaciones y recuperacion; solo se ocultan del selector principal.
- Los workflows de planificacion ofrecen preparacion conversacional y lanzamiento directo visible. El alcance aprobado de la revision obligatoria sobre lanzamiento directo esta definido en P1.
- TODO conserva seleccion y validacion de documento, sin conversacion ni replanning. `prepare` se rotula Preparacion tecnica.
- El modelo elegido conversa y produce el plan; `plan-build-qa` produce alcance y plan separados, usando sus propios schemas, no el scope interactivo.
- Cambiar modelo no amplia herramientas ni permisos y no modifica perfiles globales.
- Ningun texto ni informe aprueba o ejecuta. La aprobacion humana siempre es explicita.
- CLI/protocolo-v1, SQLite persistida, lifecycle adjunto y driver Pi conservan compatibilidad.
- No daemon, paralelo, detached, reconexion, nuevos drivers, plugins ni aprobaciones/loops genericos.

## Navegacion, Foco Y Editor

Entrada principal: Nueva tarea, Continuar, Configuracion. Cabecera: proyecto, tarea y etapa. Contenido prioritario y acciones visibles aun sin foco. En terminal estrecho se muestra una vista principal, no paneles comprimidos. Sin mouse obligatorio; etiquetas y foco comprensibles con `NO_COLOR`.

Contrato de teclado para la nueva preparacion:

| Foco                             | Entrada                            | Efecto                                                      |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Editor                           | Enter                              | Insertar nueva linea, nunca enviar.                         |
| Editor                           | Tab o Esc                          | Pasar a acciones sin borrar el texto.                       |
| Acciones                         | Tab                                | Pasar al historial/documento visible.                       |
| Historial/documento              | Tab                                | Volver al editor, si existe; si no, a acciones.             |
| Acciones                         | Flechas arriba/abajo               | Seleccionar accion. Enter activa solo esa accion visible.   |
| Historial/documento              | Flechas, PageUp/PageDown, Home/End | Linea, pagina, inicio/final del contenido cargado.          |
| Acciones                         | Enviar                             | Enviar la version exacta del texto capturado.               |
| Acciones                         | Buscar                             | Abrir campo de busqueda con foco exclusivo.                 |
| Busqueda                         | Enter / Esc                        | Buscar localmente / cerrar y restaurar foco lector.         |
| Documento ampliado               | Esc                                | Volver a origen con seleccion, foco y ancla previos.        |
| Vista de tarea, fuera del editor | Esc                                | Volver a proyecto; mantener indicador de operacion adjunta. |

Enviar, Buscar, Anterior, Siguiente, Inicio, Final y Volver tienen alternativas visibles; no depender de teclas modificadas reconocidas de forma desigual. `Shift+Enter` no es necesario. La aprobacion no se selecciona por defecto al aparecer una propuesta o al recibir un pegado.

Un solo propietario enruta cada evento a su destino. `useFocus` no desactiva automaticamente otros `useInput`. Los atajos `qjkpn`, texto de aprobacion y controles pegados nunca atraviesan el editor para activar acciones. La evaluacion 1.2 debe comprobar pegado con Tab, Esc y saltos, no solo texto imprimible.

Texto no enviado permanece al navegar durante el mismo proceso. P5 confirma que el texto sin enviar no es durable entre cierres; avisar antes de salir si se perdera texto. No persistir foco/scroll en SQLite.

Se puede redactar mientras llega una respuesta sin iniciar otra operacion. Capturar identificador local y version del editor al enviar; limpiar solo esa version cuando el mensaje quede persistido, no cuando termine el modelo. Un fallo posterior no convierte el mensaje enviado en texto sin enviar. Reintentar usa su ID, no duplica contenido. Ediciones posteriores no se borran.

## Lectura Acotada

Aprobado: 50 elementos por pagina de conversaciones/historial; documentos con hasta 200 lineas o 64 KiB por pagina (65.536 bytes). Mantener `listRuns` legacy intacta; nueva proyeccion `listTaskRunsPage` acota metadatos para TUI porque la consulta existente selecciona objective completo. Paginar preparaciones con las nuevas queries. La UI no concatena paginas indefinidamente. Busqueda solo sobre contenido cargado, con etiqueta `Busqueda limitada al contenido cargado`. No informar coincidencias inexistentes en paginas no leidas.

P6 fija el limite agregado de memoria y de metadatos. Un limite por pagina no autoriza guardar todas las paginas ni incluir mensajes completos ilimitados dentro de una lista de 50 elementos.

Contrato tecnico de lectura:

- Cursores opacos ligados a identidad y version del documento, no offsets de pantalla ni rutas elegidas por la TUI.
- UTF-8 valido: no cortar un caracter multibyte ni perder/duplicar bytes entre paginas.
- Una linea mayor que el limite se continua en la pagina siguiente; mostrar que es un fragmento. No descartarla.
- Ancla estable `(documentId, version, sourceOffset)` o `(messageId, sourceOffset)`. El wrapping por anchura no cambia identidad.
- Resize conserva ancla. Contenido nuevo sigue al final solo si el lector ya estaba alli; en otro caso mostrar Contenido nuevo.
- Anterior usa cursores anteriores; volver recarga paginas desalojadas si hace falta, sin cargar todo el documento.
- Markdown que cruza un corte debe mantener contexto de bloque si el componente aprobado lo soporta; si no, mostrar el fragmento como fuente con aviso y conservar codigo/espacios. Nunca parsear media pagina JSON como documento corrupto completo.
- La vista estructurada de alcance/plan usa datos validados y renderers de presentacion, no un bloque de JSON pasado al renderer Markdown por defecto. Para datos demasiado grandes, mostrar la limitacion y permitir fuente paginada.
- HTML, OSC, ANSI y controles del contenido no ejecutan acciones, abren enlaces, cambian titulos ni escriben clipboard. Sanitizar antes de estilos propios.

## Sintesis Y Contexto

Aprobado: cinco secciones editables (objetivo, acuerdos, restricciones, supuestos, preguntas pendientes), maximo 8.000 caracteres, sin truncado silencioso. Prompt de preparacion maximo 32.000 caracteres, sintesis vigente completa, schemas reales y hasta 12 mensajes recientes. Son presupuestos de texto, no estimaciones de tokens ni garantia sobre toda la ventana del harness.

Reglas tecnicas:

- Para estos limites, medir unidades UTF-16 con `String.length` sobre el texto final serializado. No confundir con bytes UTF-8 de lectura. La UI declara la unidad; no cortar pares sustitutos.
- Validar el prompt final, incluyendo instrucciones, delimitadores y schemas. Reservar primero sintesis y mensaje actual completos. Elegir mensajes anteriores completos, nunca fragmentos ocultos, conservando orden cronologico.
- Si instrucciones, schemas, sintesis y mensaje actual no caben, error recuperable antes de invocar driver. No omitir la solicitud actual para cumplir presupuesto.
- Nunca incluir placeholders `pending`, mensajes fallidos como respuestas validas ni logs completos.
- El mensaje del usuario y documentos del repositorio son datos no confiables. Una delimitacion textual no sustituye los permisos de solo lectura del driver.
- Reapertura no llama al modelo. P4 define como una sugerencia del modelo pasa a sintesis confirmada y evita perder acuerdos fuera de la ventana reciente.

## Versiones Y Elegibilidad

Separar concurrencia de contenido, sin estados genericos nuevos:

| Campo                     | Significado                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `draft.revision`          | CAS de mutaciones del borrador, incluidos ajustes.                                         |
| `draft.contentVersion`    | Version semantica de objetivo, acuerdos y conversacion enviada.                            |
| `proposal.id`             | Identidad inmutable de outputs publicados.                                                 |
| `proposal.contentVersion` | Contenido exacto del que procede la propuesta.                                             |
| `draft.validProposalId`   | Propuesta vigente, o ausente si requiere actualizarse.                                     |
| `review.id`               | Informe inmutable, vinculado a propuesta, contenido, politica efectiva y snapshot revisor. |

Mantener campos `revision` antiguos en propuestas/aprobaciones para compatibilidad y procedencia. No reescribir una propuesta historica para hacerla coincidir con un CAS nuevo. Migrar `contentVersion` desde las revisiones existentes; enlazar una propuesta vigente antigua solo si cumplia la igualdad anterior. Una seleccion productora desconocida permanece desconocida, no se atribuye retrospectivamente al planner actual.

| Cambio                                                 | CAS borrador | Contenido                       | Propuesta                             | Revision automatica                                   |
| ------------------------------------------------------ | ------------ | ------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| Modelo productor para turnos futuros                   | Incrementar  | Igual                           | Conservar ID y outputs                | Conservar evidencia de la propuesta existente         |
| Mensaje nuevo, sintesis humana o pedir ajustes         | Incrementar  | Incrementar                     | Invalidar puntero, conservar historia | Obsoleta                                              |
| Publicar respuesta/propuesta de la operacion reclamada | Incrementar  | Vincular al contenido reclamado | Publicar solo bajo claim/CAS validos  | No heredar informe de otra propuesta                  |
| Cambiar modelo revisor                                 | Incrementar  | Igual                           | Conservar                             | Exigir nueva evidencia; no borrar bloqueo previo (P3) |
| Politica efectiva cambia                               | Incrementar  | Igual                           | Invalidar puntero, conservar historia | Invalidar evidencia; conservar bloqueo P3             |
| Scroll, foco, abrir documento                          | Sin cambio   | Igual                           | Conservar                             | Conservar                                             |

Un reintento sin mensaje nuevo conserva la identidad del turno; cada intento registra estado/perfil real. La incorporacion de sintesis sugerida se rige por P4, no por una actualizacion automatica oculta.

No introducir cambio de workflow dentro del borrador: elegir otro crea un borrador nuevo y conserva el anterior. La mencion anterior de invalidacion ante cambio de workflow no autoriza una nueva operacion de conversion de borradores.

## Politicas De Revision

Aprobado: politica predeterminada `human`; por borrador `human`, `optional-auto`, `required-auto`. Informe automatico nunca autoriza. `required-auto` global no puede rebajarse desde un borrador. Revisor elegido explicitamente; permisos de solo lectura. Fallo, timeout o cancelacion no cuenta como informe valido. Hallazgos `critical/high` bloquean; `medium/low` exigen confirmacion de lectura.

La evidencia incluye `proposalId`, `contentVersion`, politica efectiva usada, snapshot revisor real y fecha. Confirmacion de lectura referencia `reviewId`, no un booleano global. Lectura, revision y aprobacion son acciones distintas.

P1-P3 fijan las excepciones y los cambios globales aprobados. Implementar el gate conforme a esas decisiones, sin añadir excepciones. Ante una operacion activa, rechazar edicion de ajustes, sintesis, revision y aprobacion incompatibles tanto en fachada como en storage, no solo deshabilitar botones.

## Modelos Y Permisos

- Derivar productor del perfil logico `planner` autorizado, sustituyendo solo proveedor/modelo/razonamiento seleccionado; validar herramientas, timeout, retries y confianza existentes.
- Seleccion persistida del borrador afecta llamadas futuras. Cada mensaje/propuesta conserva el snapshot que realmente lo produjo.
- No probar credenciales mediante una llamada pagada, ni hacer fallback silencioso.
- Catalogo actual `AgentModel` no informa razonamiento. Agregar una consulta TUI separada `discoverPreparationModels`, preservando la forma/semantica de `discoverModels` y salidas CLI existentes.
- `PreparationModel` extiende los campos de `AgentModel` con `thinkingLevels?: readonly string[]`. La evaluacion 1.2 no encontro una fuente verificada de niveles en el adapter actual: en esta entrega el campo se omite y la capacidad es desconocida para todos los modelos descubiertos. La nueva query mapea `discoverModels` existente; no ampliar el port ni el driver para una fuente hipotetica. Un futuro origen verificable requiere tarea propia, no deduccion por nombre.
- Cuando capacidad es desconocida, mostrar Desconocida, no una lista de todos los niveles de Pi. P6 fija la opcion Default al cambiar a un modelo de capacidad desconocida. Mantener visible el ajuste heredado de borradores antiguos como no verificado, sin afirmar compatibilidad.
- Protocolo Pi y lectura de sus fuentes permanecen en el adapter. No agregar SDK de proveedor ni consultar archivos Pi desde componentes.

## Contratos De Aplicacion Para Luna

Firmas de la fachada, no codigo para copiar a ciegas. Los tipos de preparacion se definen en `src/application/preparation.ts`; request/result de use cases en `preparation-operations.ts`; informe validado en `preparation-review.ts`. Extensiones de fachada/ports se agregan de forma compatible (opcionales donde los consumidores antiguos inyectan interfaces parciales), con error de capacidad ausente antes de mutar; nunca fallback a lectura ilimitada o ejecucion sin gate.

### Tipos De Datos

- `PreparationOverview`: `draft`, sintesis confirmada y eventual sugerencia pendiente, metadata de propuesta vigente/historica seleccionada, estado de generacion/revision, politica efectiva y motivos estructurados de inelegibilidad. No transcripcion completa ni outputs ilimitados.
- `PreparationSelection`: `{ provider?: string; model: string; thinking?: string }`; proveedor es explicito al seleccionar del catalogo, puede faltar solo al heredar un perfil legacy que delega proveedor al harness. Mostrar ese caso sin inventar proveedor. Snapshot efectivo se resuelve en aplicacion, nunca se acepta del cliente.
- `PreparationSettingsPatch`: solo `producer`, `reviewer`, `reviewMode`. No herramientas, permisos, workflow o credenciales. `reviewer` no elegido se expresa como `null`; no usar `undefined` ambiguo para borrar un ajuste.
- `PreparationSynthesis`: `{ objective: string; agreements: string[]; constraints: string[]; assumptions: string[]; questions: string[] }`. Guardar/revisar toda la sintesis con CAS, no hacer merges silenciosos.
- `PreparationPage`: items con ID/orden/procedencia/estado, preview acotado y referencia para abrir texto; cursores `previousCursor?`, `nextCursor?`. Orden estable por secuencia en mensajes, por version en propuestas y por fecha/ID en borradores.
- `DocumentPage`: `{ documentId, version, content, startOffset, endOffset, previousCursor?, nextCursor?, startsMidLine, endsMidLine, format, limitations }`. Offsets de fuente en bytes UTF-8; cursor ata identidad/version. Paginas previas se pueden volver a pedir por su cursor original. Limites siempre aplicados en aplicacion y adapter.

### Operaciones Nuevas O Ampliadas

```text
getPreparationOverview(draftId: string): Promise<PreparationOverview>
listTaskRunsPage({ cursor? }): Promise<TaskRunPage>
listPreparationDraftsPage({ workspace, cursor? }): Promise<PreparationDraftPage>
listPreparationMessagesPage({ draftId, cursor? }): Promise<PreparationMessagePage>
listPreparationProposalsPage({ draftId, cursor? }): Promise<PreparationProposalPage>
readPreparationDocumentPage({ draftId, kind, documentId, view?, cursor? }): Promise<DocumentPage>
updatePreparationSettings({ draftId, expectedRevision, patch }): Promise<PreparationOverview>
updatePreparationSynthesis({ draftId, expectedRevision, synthesis, coveredThroughSequence?, suggestionId? }): Promise<PreparationOverview>
replyPreparationTurn({ draftId, expectedRevision, requestId, content, signal?, onPersisted? }): Promise<PreparationTurnResult>
retryPreparationReply({ draftId, expectedRevision, userMessageId, requestId, signal?, onPersisted? }): Promise<PreparationTurnResult>
generatePreparationProposal({ draftId, expectedRevision, requestId, signal?, onPersisted? }): Promise<PreparationTurnResult>
reviewPreparationProposal({ draftId, expectedRevision, proposalId, requestId, signal?, onPersisted? }): Promise<PreparationOverview>
acknowledgePreparationReview({ draftId, expectedRevision, reviewId }): Promise<PreparationOverview>
approveAndExecutePreparation({ draftId, revision, proposalId, signal?, onRunStarted? }): Promise<WorkflowRun>
discoverPreparationModels(): Promise<PreparationModel[]>
readArtifactPage(runId, artifactKey, { cursor? }): Promise<DocumentPage>
getTaskOutcome(runId: string): Promise<TaskOutcome>
getTaskQaRound({ runId, roundId }): Promise<TaskQaRound>
recoverPreparation({ draftId, expectedRevision }): Promise<PreparationOverview>
```

`kind` de documento de preparacion: `message`, `synthesis`, `scope`, `plan`, `review`; `documentId` identifica mensaje, version de sintesis, propuesta o informe segun el caso. Resolver pertenencia al borrador en aplicacion; no aceptar rutas filesystem. Listar propuestas no carga todos sus outputs.

Mantener operaciones antiguas consultables; los consumidores nuevos usan overview/paginas. `PreparationTurnResult` contiene `{ overview: PreparationOverview; operation: PreparationOperationView; userMessageId?: string; assistantMessageId?: string; proposalId?: string }`, nunca la conversacion completa. La nueva TUI llama `replyPreparationTurn` con CAS y requestId. `replyPreparation` legacy conserva su request/result como wrapper del mismo comportamiento, no una segunda implementacion de turnos; solo el wrapper legacy puede materializar la conversacion antigua. Validar tambien el claim; no confiar en que la TUI sea el unico cliente.

`generatePreparationProposal` es una solicitud explicita sin mensaje de usuario artificial: exige sintesis confirmada, sin sugerencia pendiente, y usa el modelo productor seleccionado. Su respuesta debe validar los outputs del workflow; no agrega acuerdos automaticamente. Una conversacion puede ofrecer propuesta solo si cumple esas mismas condiciones. Guardar un nuevo ID de propuesta siempre deja el anterior historico; no sobreescribir `outputs` por ID ni heredar informes de una propuesta anterior.

`requestId` deduplica el mismo envio/solicitud bajo el borrador; no compara texto, pues repetir texto deliberadamente es valido. Ante ID repetido con payload distinto, rechazar. Devolver estado persistido si la solicitud ya existe, sin invocar el driver otra vez. Ante fallo del modelo, retry explicito por `userMessageId`; no insertar otro mensaje de usuario. Preparacion recibida durante trabajo ajeno no roba foco ni muta otro proyecto.

La nueva TUI no depende de que la promesa del modelo sea su unica notificacion. Callback opcional `onPersisted: (overview: PreparationOverview) => void | Promise<void>` actualiza mensaje/estado pendiente tras commit y antes del driver; tras fallo/cancelacion consultar ese overview por fachada. El callback no persiste, no autoriza y sus fallos siguen cleanup del owner. No polling de transcripcion ni eventos falsos de run.

Configuracion global se modifica mediante `generateUpdatedPreparationConfiguration({ configPath, cwd, reviewMode }): Promise<GeneratedConfiguration>` en `config-operations.ts`: releer documento actual y cambiar solo `preparation.reviewMode`, validar y presentar confirmacion antes de `replaceConfigurationAtomically`. No reutilizar una rama que regenere perfiles. Comprobar si el archivo cambio desde el preview y pedir nueva confirmacion si se detecta; el rename atomico no es CAS entre procesos ni garantiza excluir un editor externo simultaneo. No introducir un sistema generico de locks de configuracion. P2 explicita este limite y la recarga del contexto antes de la siguiente operacion.

### Storage Y Atomicidad

Las operaciones CAS verifican borrador activo, revision esperada, pertenencia y ausencia de owner incompatible dentro de una transaccion. Una validacion fallida de aprobacion/resume no muta ni consume: si cambio la politica, devolver inelegibilidad y requerir actualizacion explicita del borrador, no invalidarlo silenciosamente dentro de una llamada que termina en error. Claims exclusivos incluso para dos solicitudes de la misma instancia de SQLite: no reemplazar un token vivo porque coincida `ownerId`.

El store asigna secuencias mediante el maximo persistido; jamas `messages.length + 1` sobre una pagina. Puede leer solo los ultimos mensajes necesarios para el contexto; no usar `getPreparation` ilimitado para cada pantalla o turno.

Operaciones del port a implementar en 2.1, con los mismos DTOs de queries anteriores:

- `getPreparationOverview`, `listPreparationDraftsPage`, `listPreparationMessagesPage`, `listPreparationProposalsPage` y lectura acotada del documento por ID.
- `updatePreparationSettings` y `updatePreparationSynthesis` con CAS; solo el use case resuelve permisos/modelo/politica.
- `beginPreparationTurn`: bajo claim valida CAS/requestId, asigna secuencia, guarda mensaje/intent y estado pendiente, invalida contenido anterior una sola vez y devuelve el estado/version reclamados.
- `finishPreparationTurn`: con claim y versiones reclamadas persiste respuesta, sugerencia y propuesta validada juntas o estado de fallo/interrupcion; no publica outputs parciales. La respuesta solo gana vigencia si coincide el contenido reclamado.
- `beginPreparationReview` / `finishPreparationReview`: identidad/idempotencia y evidencia exacta; fallo conserva solicitud pero no informe valido.
- `acknowledgePreparationReview`: CAS y `reviewId` vigente. No registrar lectura por abrir un panel.
- `claimPreparation`, `releasePreparation`, `recoverPreparation`: conservar ownership y recuperar owner muerto sin reejecutar. Claims vivos nunca se recuperan por leer una pagina.
- `createRunFromPreparation`: dentro del commit volver a comprobar CAS, propuesta vigente, politica efectiva capturada, informe/lectura exigidos y consumo unico; persistir run, pasos completados, artifacts, aprobacion y ownership juntos.

DTOs de begin/finish en `preparation.ts`, cerrados por estas firmas y el anexo normativo:

- `beginPreparationTurn({ draftId, expectedRevision, claimToken, requestId, input, provenance })`: `input` es union discriminada `{ kind: 'reply', content }`, `{ kind: 'retry', userMessageId }` o `{ kind: 'proposal' }`. Devuelve `{ turnId, userMessageId?, attempt, draftRevision, contentVersion, duplicate }`. Un duplicado devuelve referencia a estado persistido, no un permiso de ejecutar.
- `finishPreparationTurn({ draftId, turnId, claimToken, expectedRevision, contentVersion, outcome })`: `outcome` es respuesta validada con eventual sugerencia/propuesta o fallo/interrupcion con mensaje seguro. Devuelve overview; el store obtiene request/perfil del turno reclamado, no permite cambiarlos al terminar.
- `beginPreparationReview({ draftId, expectedRevision, claimToken, proposalId, requestId, effectivePolicy, provenance })`: devuelve `{ reviewRequestId, draftRevision, contentVersion, duplicate }`.
- `finishPreparationReview({ draftId, reviewRequestId, claimToken, expectedRevision, contentVersion, outcome })`: informe validado o fallo/interrupcion, devuelve overview. El informe toma la propuesta y politica de la solicitud persistida.
- `acknowledgePreparationReview({ draftId, expectedRevision, reviewId })`: devuelve overview despues de validar evidencia y guardar lectura humana de ese informe.

No permitir que esos metodos reciban instrucciones ejecutables del modelo. Todo estado de operacion es de preparacion, no `RunStatus` nuevo.

Llamadas a driver/filesystem quedan fuera de transacciones SQLite. Todo fallo desde despues del claim, incluida persistencia anterior al driver, debe tener cleanup. No silenciar fallos de persistencia y declarar el turno completado. Artifacts publicados por handoff confirmado no se borran en un error posterior.

### Migracion 011

La 010 contiene CHECK de workflow en `preparation_drafts` y `preparation_proposals` que excluye `plan-build-qa`. 011 debe ampliar ambos preservando los cinco conjuntos: drafts, messages, proposals, approvals y owners. No cambiar IDs, outputs, snapshots ni enlaces de runs existentes.

El runner actual usa `BEGIN IMMEDIATE` y tiene foreign keys activas. No copiar el patron de intentar `PRAGMA foreign_keys = OFF` dentro de la transaccion: SQLite no lo aplica ahi.

Estrategia concreta para 011: dentro de la transaccion existente, copiar las cinco tablas a tablas temporales de respaldo, eliminar primero las tablas hijas y luego padres, recrear las tablas finales con CHECK ampliados y campos nuevos, copiar padres antes que hijos, recrear indices y verificar `foreign_key_check` antes de registrar version 11. Cualquier fallo revierte todo. No eliminar padres mientras permanezcan hijos originales con `ON DELETE CASCADE`. Comprobar antes que no haya referencias externas nuevas a estas tablas; si las hay, detener y revisar estrategia. El esquema nuevo completo pertenece a 011, no a 010.

Preservar proposals historicas y aprobaciones, owners y secuencias. Guardar/restaurar tambien el maximo de `sqlite_sequence` de `preparation_approvals`, no solo `MAX(id)`: 010 usa AUTOINCREMENT y puede haber IDs eliminados. No crear una FK circular para `validProposalId`; validar pertenencia al publicar/consumir bajo la transaccion. Añadir tablas/columnas para sintesis versionada, solicitudes idempotentes, informes/lecturas y revision/politica efectiva segun el anexo cerrado. No usar defaults que inventen productor/revisor. La migracion debe funcionar tanto desde v10 como al crear una base nueva pasando por 010.

### Resultado Y QA

Decision tecnica cerrada: nueva consulta TUI `getTaskOutcome` en `src/application/task-outcome.ts`. No ampliar `RunView` ni envelopes CLI para acomodar la nueva presentacion.

`TaskOutcome`: identidad/estado/objetivo del run, resumen disponible, cambios reportados, verificaciones declaradas, referencias de evidencia, pendientes, documentos disponibles y rondas QA con sus IDs de artifacts. Cargas detalladas acotadas por facade; no LLM para resumir.

Rondas reales: `qa` corresponde a primera ronda; `qa-N` se interpreta conforme al coordinador existente, no segun numero de reintento del step. No modificar coordinadores para crear nuevas rondas desde la consulta. Referencias de hallazgos usan `(runId, roundId, findingId)`; un ID no implica identidad entre rondas. Sin matching por similitud ni marcado fixed por mera declaracion del builder.

Si el schema no contiene ubicacion estructurada, indicar No disponible; conservar la evidencia textual sin inventar archivo/linea. `completed` no implica correccion tecnica. `plan-build` tiene resultado de texto libre: mostrarlo como declaracion, no como verificaciones estructuradas inventadas. Reporte viejo/corrupto/grande: limitacion visible y fuente paginada. QA por run no activa `qaHistory` global opt-in.

## Recorridos Y Lifecycle

- Idea incompleta: Nueva tarea -> workflow de planificacion -> borrador local sin llamada pagada -> modelo -> mensaje -> sintesis (P4) -> propuesta validada -> revision conforme politica -> aprobacion humana -> build sin replanning -> resultado/QA.
- Directo: workflow -> Lanzamiento directo visible -> preflight de politica P1, inputs y permisos -> confirmacion -> pasos normales. No simular preparacion completada para saltar pasos.
- TODO: documento/ruta -> lectura y validacion local disponible -> permisos/confirmacion -> validacion por workflow -> Preparacion tecnica si corresponde -> build/QA. No presentar validacion local como opinion ya emitida por el agente.
- Reapertura: Continuar -> borrador/run por identidad -> datos persistidos e historicos -> ninguna llamada automatica; estados interrumpidos recuperables. P5 rige texto sin enviar entre sesiones.
- Fallo: mensaje persistido -> error recuperable -> retry por ID sin duplicacion. Fallo de handoff despues del commit conserva run consumido y se recupera el run, no se vuelve a aprobar el borrador.

Navegar documentos dentro del proyecto no cancela: indicador persistente identifica tarea/operacion y ofrece Volver a operacion y Cancelar. Un unico owner conserva controller, promesa, suscripcion y contexto desde el inicio, no se introduce al final del desarrollo visual.

Solo una operacion adjunta mutante a la vez. Mientras este activa: consultas/navegacion y redaccion local permitidas; nuevo turno/review/build, modificacion de borrador, cambio de proyecto o reemplazo de configuracion/contexto bloqueados con motivo visible. Al terminar, respuestas se enrutan al borrador de origen sin robar foco.

Salir mediante UI solicita confirmacion. Confirmar inicia cancelacion graceful y espera cleanup. `Ctrl+C` durante operacion solicita cancelacion; la segunda solicita fuerza siguiendo el shutdown existente. Signals y fallos de stream/render no esperan un dialogo humano: usan shutdown ordenado. No cerrar SQLite con persistencia activa. No cancelar por resize/unmount de una pantalla; solo el owner de la aplicacion cierra recursos.

## Decisiones Adicionales Aprobadas Por El Propietario

P2-P6 fueron aprobadas en bloque; P1 fue aprobada despues de explicar que deshabilitar el lanzamiento directo evita saltarse la revision obligatoria en nuevas tareas TUI de planificacion. Estas decisiones cierran las preguntas de producto P1-P6, no sustituyen el cierre tecnico de 1.1 ni la evaluacion/aprobacion de componentes en 1.2.

### P1. Alcance De Revision Obligatoria

Decision aprobada: `required-auto` global es un minimo para nuevas tareas TUI de planificacion. Con esa politica, Lanzamiento directo permanece visible pero deshabilitado con explicacion y enlace a Preparar conversando. No añadir gate al motor ni alterar CLI, TODO o recuperacion legacy; documentar expresamente ese alcance, no venderlo como control de seguridad universal.

### P2. Cambios De Politica Global Y Por Borrador

Decision aprobada: configuracion `preparation.reviewMode` con default `human`; el borrador hereda el default al crearse, y `required-auto` vigente es un minimo en el preflight de cada operacion. El owner usa configuracion recargada antes de comenzar y captura la politica efectiva para esa operacion; cambios externos posteriores aplican a la siguiente operacion, no interrumpen la actual.

Todo cambio relevante del modo efectivo invalida propuesta e informe, como se recomendo inicialmente. No permitir rebajar un modo de borrador mientras exista un bloqueo automatico vigente P3. Cambiar configuracion global solo fuera de operacion activa, con confirmacion y relectura del archivo para detectar cambios desde el preview; mantener config de perfiles intacta. La escritura atomica actual evita archivos parciales, no ofrece CAS frente a un editor externo simultaneo. Documentar esa limitacion en lugar de prometer exclusion entre procesos. No prometer atomicidad entre archivo config y SQLite: la transaccion valida contra el snapshot efectivo capturado en preflight.

### P3. Bloqueos De Revision Y Perfil Revisor

Decision aprobada: derivar revisor del perfil `planner` de solo lectura, con seleccion de modelo revisor independiente y explicita; no depender de que exista perfil QA para `plan-build`. Informe `critical/high` crea bloqueo vinculado a esa version de contenido aun en modo optional. Cambiar revisor, fallar o cancelar otro informe no borra ese bloqueo. Se elimina solo con contenido corregido, nueva propuesta y nueva revision valida no bloqueante. Hallazgos `medium/low` exigen confirmacion de lectura del informe exacto. No borrado de evidencia ni reroll para evadir bloqueos.

### P4. Actualizacion De Sintesis Y Mensajes Grandes

Decision aprobada: el modelo puede devolver sugerencia de sintesis estructurada con version base; no sustituye acuerdos humanos. La persona acepta/edita con accion explicita. Una sugerencia pendiente bloquea generar una propuesta ejecutable hasta resolverla. Antes de sacar mensajes de la ventana de contexto, requerir confirmacion humana de que la sintesis cubre esos mensajes (guardar `coveredThroughSequence`); no considerar un mensaje resumido solo por antiguedad. No añadir llamadas automaticas de resumen.

Mensaje de usuario maximo 16.000 unidades UTF-16, rechazo visible antes de persistir si excede; aun por debajo del limite, validar presupuesto completo antes de invocar driver. Si el prompt no cabe, conservar datos ya enviados y pedir reducir/corregir con accion explicita; no reenviar ni truncar. Un fallo posterior a guardar mensaje no lo duplica.

### P5. Durabilidad Del Editor

Decision aprobada: texto sin enviar se conserva por proyecto/borrador durante el proceso, no entre cierres. Al salir con texto pendiente, avisar que se perdera y permitir volver. Mensajes enviados, sintesis, propuestas e informes si son durables. No implementar persistencia de texto sin enviar en este scope; requeriria una ampliacion aprobada del plan.

### P6. Limites Agregados Y Capacidad Desconocida

Decision aprobada: cache de lectura total de hasta tres paginas por lector activo, cada payload textual limitado a 64 KiB; listas hasta 50 metadatos y 64 KiB serializados, lo que ocurra primero. Texto grande se abre por documento paginado; no se carga en la lista. Al cambiar de documento descartar payload del anterior y conservar solo ancla/cursor; limitar tambien historial de retorno a 20 entradas. No render ilimitado ni cache de todas las tareas.

Para modelo nuevo con razonamiento desconocido, ofrecer solo Default, explicitando que no se envia override; cualquier cambio que borre razonamiento anterior requiere confirmacion visible. Para modelos conocidos, ofrecer solo niveles respaldados por la fuente documentada en 1.2. Si esa fuente no existe, no fabricar niveles: registrar capacidad desconocida. No afectar la configuracion legacy del resto de perfiles.

## Anexo Normativo: Cierre Tecnico De 1.1

Este anexo concreta los tipos descritos antes; no deja decisiones de producto a Luna. Los nombres de campos siguientes son los definitivos. Las estructuras de negocio son serializables; `AbortSignal` y callbacks pertenecen solo a requests de aplicacion.

### A. Datos Persistidos Y DTOs Acotados

Tipos existentes `PreparationDraft`, `PreparationProposal`, `PreparationApproval`, `PreparationExecutionSeed` conservan sus campos legacy. Los datos nuevos se normalizan al leer en un tipo `PreparationDraftView`; no añadir campos obligatorios a objetos antiguos inyectados solo para hacer compilar tests. No propagar `undefined` como modo de revision ni como version valida.

```ts
type PreparationReviewMode = 'human' | 'optional-auto' | 'required-auto';
type PreparationOperationStatus = 'pending' | 'sent' | 'failed' | 'interrupted';
type PreparationDocumentKind = 'message' | 'synthesis' | 'scope' | 'plan' | 'review';

interface PreparationDraftView extends PreparationDraft {
  contentVersion: number;
  producer: PreparationSelection | null;
  reviewer: PreparationSelection | null;
  reviewMode: PreparationReviewMode;
  appliedReviewMode: PreparationReviewMode;
  synthesisVersion: number;
  validProposalId: string | null;
  validReviewId: string | null;
  blockingReviewId: string | null;
}

interface PreparationSynthesisVersion {
  id: string;
  version: number;
  value: PreparationSynthesis;
  coveredThroughSequence: number;
  origin: 'initial' | 'human' | 'legacy';
  confirmed: boolean;
  createdAt: string;
}

interface PreparationSynthesisSuggestion {
  id: string;
  baseVersion: number;
  synthesis: PreparationSynthesis;
  coveredThroughSequence: number;
  sourceMessageId: string;
}

interface PreparationProposalSummary {
  id: string;
  revision: number;
  contentVersion: number;
  createdAt: string;
  outputNames: Array<'scope' | 'plan'>;
  experienceOrigin: 'legacy' | 'current';
  provenance: PreparationProvenance;
  source: 'current' | 'historical';
}

interface PreparationOperationView {
  requestId: string;
  kind: 'reply' | 'retry' | 'proposal' | 'review';
  status: PreparationOperationStatus;
  userMessageId?: string;
  assistantMessageId?: string;
  proposalId?: string;
  reviewId?: string;
  attempt: number;
  recoverable: boolean;
  error?: { code: string; message: string };
}

interface PreparationStoredView {
  draft: PreparationDraftView;
  synthesis: PreparationSynthesisVersion;
  suggestion: PreparationSynthesisSuggestion | null;
  proposal: PreparationProposalSummary | null;
  operation: PreparationOperationView | null;
  review: PreparationReviewSummary | null;
}

interface PreparationOverview extends PreparationStoredView {
  effectiveReviewMode: PreparationReviewMode;
  canGenerateProposal: boolean;
  canApprove: boolean;
  blockedReasons: PreparationBlockReason[];
}
```

`PreparationBlockReason` es union literal de `consumed`, `busy`, `policy-changed`, `synthesis-unconfirmed`, `context-uncovered`, `proposal-missing`, `proposal-stale`, `review-required`, `review-stale`, `review-blocking`, `review-unread`, `profile-invalid`, `workspace-invalid`. Incluir todos los motivos aplicables en este orden, sin deducir autorizacion desde un mensaje traducido. `canGenerateProposal` omite motivos propios de revision/aprobacion pero requiere permisos/contexto/sintesis correctos. `canApprove` exige que no exista ningun motivo.

El store devuelve `PreparationStoredView`, no calcula permisos ni lee configuracion global. La fachada produce `PreparationOverview` resolviendo politica y perfiles. La propuesta historica seleccionada se obtiene por `listPreparationProposalsPage`; no cambia el puntero vigente del borrador.

`PreparationPage` se concreta en tres DTOs, sin un framework generico: `PreparationDraftPage`, `PreparationMessagePage`, `PreparationProposalPage`, cada uno con `items`, `previousCursor?: string`, `nextCursor?: string`. Draft item: `{ id, workflowId, status, objectivePreview, revision, createdAt, updatedAt }`. Message item: `{ id, sequence, role, generationStatus, contentRevision, preview, previewTruncated, profileSnapshot?, createdAt }`. Proposal item: `PreparationProposalSummary`. Preview maximo 256 unidades UTF-16 con `previewTruncated`; texto completo accesible por documento. Los campos de texto que no quepan en el payload de pagina se abrevian solo para preview y se indica; las identidades nunca se abrevian en datos.

`TaskRunPage`: mismo envelope de pagina, items `{ id, workflowId, status, objectivePreview, previewTruncated, createdAt, updatedAt }`, orden createdAt DESC/id DESC, 50 items/64 KiB. `listTaskRunsPage` en run-operations/service usa nueva proyeccion opcional del port ApplicationRunStore y SQL que selecciona substr de objective, no listRuns completo seguido de slice. El contexto delimita workspace, sin filtrar workflows WIP. Preservar listRuns/CLI existentes.

### B. Inicializacion Y SQL De 011

Nueva preparacion: `revision=1`, `contentVersion=1`, `synthesisVersion=1`, politica de borrador heredada, `appliedReviewMode` efectivo actual, reviewer/punteros nulos. Sintesis inicial con objetivo proporcionado y listas vacias, origin initial y confirmed false; confirmar sintesis humana antes de generar primera propuesta (guardado humano cambia origin a human y confirmed a true). No llamada al modelo al crear. El productor predeterminado se muestra/resuelve desde planner y se persiste al primer uso; no atribuir ese modelo a mensajes historicos.

Borrador antiguo: `contentVersion=revision` anterior, politica `human`, `appliedReviewMode=human`, productor/revisor nulos salvo seleccion explicitamente persistida (no extraerla del perfil global actual). Sintesis legacy con objetivo anterior, coverage 0 y confirmed false. Propuesta antigua vigente se enlaza solo si revision coincidia antes de migrar; conservar su procedencia y permitir handoff legacy bajo human sin exigir retroactivamente una confirmacion de sintesis que nunca existio. La excepcion se identifica por propuesta de experienceOrigin legacy, contentVersion aun coincidente y modo efectivo human. Primer mensaje/edicion de contenido invalida esa propuesta; nunca aplicar la excepcion a una propuesta nueva ni saltar required-auto vigente.

011 agrega columnas a drafts para campos de `PreparationDraftView`; a proposals, `content_version` y `experience_origin` (`legacy` al migrar, `current` en nuevas publicaciones); a messages, `content_revision` inicial 1. Guardar seleccion/sintesis/informe como JSON validado, no credenciales. Tablas nuevas concretas:

- `preparation_syntheses`: `(draft_id, version)` unico, `id`, JSON value, coverage, origin, confirmed y created_at. Filas inmutables; version vigente en draft.
- `preparation_suggestions`: `id`, draft_id, base_version, source_message_id, JSON value, coverage y estado `pending/accepted/discarded`. Solo una pendiente por borrador; la sugerencia no sustituye sintesis.
- `preparation_requests`: `(draft_id, request_id)` unico, kind, input_json canonico, status, turn_id, attempt, referencias de mensaje/propuesta/review, revision/content_version reclamados, snapshot/politica usados, error y fechas. No TTL automatico que permita duplicar solicitudes viejas.
- `preparation_reviews`: `id`, draft_id, proposal_id, content_version, mode, reviewer_snapshot_json, report_json, created_at. Informes inmutables; request fallido no crea un informe ficticio.
- `preparation_review_reads`: `(draft_id, review_id)` unico, acknowledged_at. Lectura humana del informe exacto.

No FK hacia `validProposalId`, `validReviewId` o `blockingReviewId` desde drafts que impida copiar padres primero; referencias inversas de las tablas hijas e invariantes de pertenencia se mantienen. Incluir indices por draft/sequence/version/requestId usados por consultas. Campos `proposal.revision` antiguos siguen siendo revision de publicacion, no `contentVersion`; la UNIQUE `(draft_id, revision)` sigue funcionando porque cada publicacion incrementa CAS. Tablas originales se copian/restauran antes de crear las nuevas hijas. Comparar conteos de las cinco tablas originales y `foreign_key_check` antes de registrar 11.

### C. CAS, Idempotencia Y Finalizacion

- `expectedRevision` siempre es CAS actual del borrador; `approveAndExecutePreparation.revision` mantiene ese significado. Mutacion efectiva incrementa una vez CAS por transaccion; request duplicado y no-op no incrementan. Begin y finish son dos transacciones distintas y cada una devuelve la nueva revision.
- Nuevo mensaje o cambio real de sintesis incrementa `contentVersion`, invalida propuesta/review y conserva bloqueo P3. Cambio de modelo/politica/coverage sin cambio textual no incrementa contenido. Cambio de politica o version de sintesis invalida propuesta/review igualmente. Reintento no incrementa contenido ni inserta otro usuario.
- Begin `reply` guarda usuario y placeholder assistant juntos, asignados por SQL; begin `retry` reutiliza usuario y placeholder fallido/interrumpido. Retry solo del ultimo turno de usuario aun no respondido; si hubo mensaje posterior, rechazar como stale en vez de reescribir historia. Begin `proposal` no inventa usuario; nueva publicacion usa ID nuevo y deja historia anterior.
- Input canonico de idempotencia contiene kind y contenido normalizado/ID objetivo. No incluye signal, callback, revision esperada ni perfil global del momento. Comprobar duplicado antes de rechazar CAS viejo; payload distinto bajo mismo ID es error. Bajo claim volver a comprobar para cerrar la carrera. Un duplicado devuelve estado/referencias originales sin driver ni callback duplicado.
- `onPersisted` existe en reply, retry, proposal y review, con el mismo tipo definido antes. El controller registra el requestId antes de iniciar y solo limpia el editor cuya version coincide cuando el overview confirma ese envio persistido.
- Finish exige claim, request pendiente y CAS/contentVersion reclamados; persiste respuesta, sugerencia/propuesta o error y status juntos. Todo cambio de contenido/ajustes externo mientras haya claim vivo se rechaza. `content_revision` del assistant aumenta al reemplazar placeholder; un cursor de texto viejo se rechaza, no mezcla versiones.
- `sent` significa operacion finalizada/persistida, no aprobacion. `failed/interrupted` son estados de preparacion existentes, no nuevos RunStatus. El fallo no se presenta como respuesta valida del agente.
- Toda region posterior al claim esta dentro de try/finally. Tras finish confirmado, release del token; si finish falla, no marcar exito ni liberar como si se hubiera persistido: informar fallo y seguir shutdown/recuperacion. No iniciar otra operacion sobre ese contexto dañado.
- Lectura de overview/paginas no recupera ni muta. `operation.recoverable` indica pendiente con owner ausente/muerto, comprobado sin modificar filas. Exponer `recoverPreparation({ draftId, expectedRevision }): Promise<PreparationOverview>` para accion explicita en reapertura interrumpida: comprobar owner muerto, marcar solicitudes/placeholders pendientes interrupted en transaccion y liberar claim; nunca invocar driver. Owner vivo, incluidos otros handles del mismo proceso, no se recupera.

`PreparationTurnResult.operation` contiene `PreparationOperationView` de la solicitud solicitada ademas del overview actual y referencias ya descritas; asi un request duplicado antiguo no se confunde con la ultima operacion del borrador. No devolver conversacion completa por el nuevo API.

### D. Sintesis, Presupuesto Y Schemas

`updatePreparationSynthesis` exige `synthesis` completa y `coveredThroughSequence` explicito (entero >=0, <= ultima secuencia enviada visible al confirmar). `suggestionId` opcional identifica la sugerencia aceptada/editada y exige baseVersion vigente. Guardar una sintesis manual sin ese ID descarta una sugerencia pendiente solo mediante confirmacion visible; no auto-merge. Una edicion parcial se compone en editor local y se guarda una sola vez con CAS.

La medida de 8.000 aplica a `JSON.stringify(synthesis).length` en orden fijo objective/agreements/constraints/assumptions/questions; arrays de strings, additionalProperties false. Guardado por encima del limite es no mutante. Cobertura solo avanza por confirmacion humana, no por un flag del modelo. Avanzar coverage sin modificar texto aumenta version de sintesis/CAS e invalida propuesta, pero no cuenta como contenido corregido para P3.

Seleccion del contexto: instrucciones + schema + sintesis completa + usuario actual (en reply/retry), despues hasta completar 12 mensajes enviados totales, tomando un sufijo cronologico de mensajes completos. Todo mensaje anterior omitido debe estar cubierto por `coveredThroughSequence`; si no, `context-uncovered` antes del driver. No omitir un mensaje intermedio grande y conservar otros posteriores como si fuera un sufijo completo. Sin espacio para lo obligatorio, error de presupuesto recuperable; no cadena automatica de resumen. En proposal/review no hay usuario artificial: la sintesis y propuesta exacta son el input.

Schemas nuevos se versionan con `schemaVersion: 1`, separados de `PREPARATION_CONTRACT_VERSION` legacy y de versiones de workflows. No cambiar schemas antiguos. Usar JSON Schema/Ajv con additionalProperties false en todo objeto y validar condiciones semanticas despues:

- Respuesta de conversacion: `{ schemaVersion: 1, kind: 'message', content: string, synthesisSuggestion?: { baseVersion: number, synthesis: PreparationSynthesis, coveredThroughSequence: number } }`.
- Respuesta de propuesta: `{ schemaVersion: 1, kind: 'proposal', content: string, objective: string, outputs: PreparationOutput[] }`; no incluir sugerencia simultanea. Objetivo debe coincidir con sintesis confirmada; si el agente propone cambiarlo, devolver sugerencia en conversacion, no reescribir objetivo al publicar. Validar schemas/IDs reales de workflow y ausencia de preguntas que impiden construir.
- `PreparationReviewReport`: `{ schemaVersion: 1, summary: string, findings: Array<{ id: string, severity: 'critical'|'high'|'medium'|'low', title: string, explanation: string, impact: string, evidence: string[], suggestedCorrection: string, verifications: string[] }> }`. IDs no vacios/unicos dentro del informe. Textos obligatorios no vacios, arrays de evidencia pueden estar vacios y se muestran como Sin evidencia. Bloqueo se calcula por severidad, no se acepta un booleano `approved` ni decision de ejecutar del revisor.

Nuevos requests usan parsers estrictos; respuesta libre o schema invalido produce fallo recuperable. El parser legacy puede seguir aceptando texto como conversacion sin proposal para recuperacion antigua. No tratar texto libre como propuesta/review validos.

`PreparationReviewSummary`: `{ id, proposalId, contentVersion, mode, provenance, createdAt, counts: { critical, high, medium, low }, acknowledged: boolean, source: 'current'|'historical' }`. `summary/findings` completos se consultan por documento, no se incluyen ilimitados en overview. DTO y schema del informe se crean en 2.1 para que storage compile; 2.4 implementa solicitudes al revisor y elegibilidad.

### E. Politica E Informe: Tabla De Autorizacion

`effectiveReviewMode = globalMode === 'required-auto' ? 'required-auto' : draft.reviewMode`. El default global solo inicializa borradores nuevos; rebajar el global no rebaja un borrador cuyo modo propio sigue required. `draft.appliedReviewMode` es el modo explicitamente adoptado al crear/actualizar ajustes. Si difiere del efectivo, mostrar `policy-changed`, no aprobar ni generar hasta aplicar ajustes con CAS. La accion Aplicar politica actual llama `updatePreparationSettings` con el modo propio actual; el cambio efectivo invalida punteros aunque el valor del patch sea igual.

Produccion obtiene politica fresca por callback consumidor `readPreparationReviewMode(): Promise<PreparationReviewMode>` compuesto en runtime desde config; queries muestran modo actual y cada mutacion lo captura una vez al comenzar. Contextos inyectados sin callback usan su config suministrada, no leen filesystem. Profile/driver siguen en el contexto autorizado; si su preflight requiere refrescar contexto, hacerlo antes de usarlo, nunca en mitad de una operacion. Una aprobacion fallida no adopta politica silenciosamente.

| Condicion                                                                             | Aprobacion                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Sin propuesta vigente o contenido diferente                                           | Rechazar.                                                            |
| Politica human/optional, sin informe y sin bloqueo previo                             | Permitir solo accion humana explicita.                               |
| Required y sin informe vigente no fallido                                             | Rechazar.                                                            |
| Informe vigente critical/high                                                         | Rechazar en cualquier modo.                                          |
| Bloqueo previo P3, aunque cambie modelo o modo                                        | Rechazar hasta contenido posterior y revision no bloqueante.         |
| Informe vigente medium/low sin lectura de ese ID                                      | Rechazar hasta confirmar lectura.                                    |
| Informe vigente sin hallazgos                                                         | No exige lectura adicional; si cumple resto, permitir accion humana. |
| Sugerencia pendiente, operacion activa, perfil/workspace invalido, borrador consumido | Rechazar.                                                            |

Cambiar revisor convierte informe vigente en historico y exige nueva revision si el modo es required o existia informe pendiente de lectura/bloqueo; no evade esos requisitos descartando un ID. `blockingReviewId` sobrevive mensaje, sintesis, cambio de politica/modelo y generacion nueva. Solo se limpia al finalizar informe sin critical/high de una propuesta cuyo `contentVersion` sea mayor que el de ese bloqueo. Reroll del mismo contenido no lo limpia. No afirmar que esta regla demuestra que la correccion sea verdadera: es una revision declarada, no verificacion independiente.

Al guardar handoff, `PreparationExecutionSeed` lleva `expectedDraftRevision`, `contentVersion`, `effectiveReviewMode`, `reviewId?` como datos adicionales de experiencia. `proposalRevision` conserva la revision historica de publicacion; no se usa como CAS del borrador. Store valida proposalId contra puntero/contentVersion, informe/lectura/bloqueo desde filas persistidas y consumo unico, no acepta un `canApprove` enviado por cliente. Seeds legacy sin campos nuevos solo son admisibles para el caso legacy human descrito en B; nunca eluden gates de un borrador nuevo.

### F. Cursores Y Documentos

Cursores v1 son base64url de datos JSON validados por aplicacion: tipo de consulta, ownerId (workspace/draft/run segun fuente), documentId/version si aplica y posicion. No contienen rutas, SQL, credenciales ni autorizacion; validarlos no sustituye comprobar pertenencia. Rechazar cursor malformado, negativo/no entero, de otra fuente o version caducada. No guardar todos los cursores de todas las paginas en memoria.

Mensajes: primera pagina muestra los ultimos hasta 50 en orden sequence ascendente; cursor anterior/siguiente contiene limites de secuencia y high-water de esa consulta. Nueva respuesta se obtiene con nueva consulta inicial, no reordena paginas antiguas. Propuestas: revision DESC, id como desempate. Borradores: createdAt DESC, id DESC (no updatedAt mutable). Listas hacen keyset pagination, no offsets sobre conjuntos cambiantes; al exceder 64 KiB emitir menos items y cursor al ultimo emitido. `previousCursor` se obtiene invirtiendo comparacion/orden en SQL, no reteniendo todas las paginas.

Documento: `version` es string opaca; para message usa content_revision, synthesis su version, proposal/review su ID inmutable. Artifact usa referencia inmutable y valida tamaño/mtime al abrir; cambio externo detectado devuelve stale, no junta bytes incompatibles. `format` es `text|markdown|json`; `content` conserva fuente UTF-8, no ANSI generado. Primer offset 0, siguiente offset exclusivo `endOffset`; maximo 200 saltos LF o 65.536 bytes, con hasta 4 bytes adicionales de lookahead para UTF-8/EOF que no se retornan. CRLF permanece intacto; si el corte cae entre CR y LF, retroceder CR. Lineas gigantes se fragmentan con flags visibles. No reparsear desde byte 0 hasta N para obtener pagina N.

Adapter filesystem expone `readPage(artifact, { offset, maxBytes, maxLines }): Promise<{ content, endOffset, hasMore, startsMidLine, endsMidLine, version }>` por el port de artifacts, independiente de pantalla. Leer/validar la ruta actual dentro de root usando las protecciones existentes. SQLite devuelve substr de fuente BLOB UTF-8 y metadata, no transcripcion entera en JavaScript. Para scope/plan, JSON extraction en SQLite puede procesar el JSON internamente: el limite garantiza payload/cache TUI, no un limite duro de memoria del motor SQLite. No prometer memoria total del proceso <= 192 KiB.

Anterior en documentos calcula una pagina inversa acotada desde `startOffset` usando los mismos limites y límites UTF-8/CRLF; agregar `previousCursor?` al DTO `DocumentPage` y opcion `direction?: 'next'|'previous'` en lectura de adapter. La TUI usa los cursores retornados, nunca calcula offsets UTF-8 desde texto ya sanitizado. No usar un cache ilimitado de cursores para suplir esta capacidad.

### G. Outcome Y QA Acotados

Para alcance/plan, `readPreparationDocumentPage` acepta `view: 'readable'|'source'` (default readable). La fachada carga hasta 64 KiB del output seleccionado; si cabe y valida su schema, `formatPreparationOutput` en `src/presentation/format.ts` produce Markdown determinista con objetivo, alcance, tareas, archivos y verificaciones. No LLM ni logica de negocio en la TUI. Si no cabe/no valida, devolver fuente paginada con `limitations: string[]`, sin parsear JSON parcial. Cursor y documentId ligan tambien la variante readable/source; offsets corresponden al texto de esa variante, no se intercambian con el JSON original. La proyeccion readable se acota al mismo limite; si lo excede, fallback fuente. Otros documentos conservan su fuente; normalizacion de presentacion no modifica bytes persistidos. `DocumentPage` incluye `limitations` (array vacio si no aplica).

`TaskOutcome` concreto: `{ run: { id, workflowId, objective, status }, summary?: string, changedFiles: string[], verifications: Array<{ command, status, provenance: 'builder-declared', evidenceArtifactIds: string[] }>, pendingItems: Array<{ id, title, reason }>, documents: Array<{ artifactId, stepId, name, format }>, qaRounds: Array<{ roundId, iteration, artifactId }>, limitations: string[] }`. No poblar evidenceArtifactIds por similitud de texto. Capar la proyeccion completa a 64 KiB de payload textual; si una seccion no cabe, dejar referencia a documento y motivo, no omitir pendientes silenciosamente. Lectura de JSON estructurado limitada a 64 KiB; si es mayor, no parsear un fragmento como reporte completo.

Consulta detallada adicional en `task-outcome.ts`: `getTaskQaRound({ runId, roundId }): Promise<{ roundId, iteration, report?: PlanBuildQaReport, artifactId, limitations: string[] }>` con igual limite. Resuelve solo `qa` (iteracion 1) y `qa-N` con N>=2 de artifacts reales; attempts no son rondas. No hacer que la TUI parsee negocio desde JSON raw. Si informe grande/corrupto, devuelve referencia/limitacion para fuente paginada. Las ubicaciones no estructuradas se muestran como ausentes. No inventar matching ni estado resuelto entre rondas.

### H. Errores Y Cierre

Errores recuperables de preparacion usan `Error` con `code` de aplicacion (no protocolo CLI nuevo): `PREPARATION_STALE`, `PREPARATION_BUSY`, `PREPARATION_INVALID_INPUT`, `PREPARATION_CONTEXT_LIMIT`, `PREPARATION_REVIEW_REQUIRED`, `PREPARATION_REVIEW_BLOCKED`, `PREPARATION_CAPABILITY_UNAVAILABLE`, `PREPARATION_PERSISTENCE_FAILED`. La UI traduce por codigo, no por regex del mensaje. Config/driver/workspace pueden conservar errores actuales y se proyectan como motivos seguros, sin credenciales.

Ninguna nueva operacion ignora un AbortSignal ya cancelado antes de claim/driver. Una vez confirmado handoff, cancelar corresponde al run adjunto creado; no desconsumir borrador ni borrar outputs aprobados. Rutas nuevas mantienen facade/ports; las referencias a tipos core no autorizan acceso desde core a aplicacion/TUI/adapters. Los componentes exactos y sus limitaciones empiricas se fijan en `docs/tui-components.md`.
