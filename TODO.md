# PLAN DE EJECUCION: Hito 3.5 - Portabilidad entre equipos

> **ATENCION SUB-AGENTE:** Ejecuta este plan estrictamente en orden y solo despues
> de autorizacion explicita. No saltes tareas, no amplies el alcance y no hagas
> supuestos para resolver desviaciones. Si aparece un obstaculo, deten la ejecucion
> y usa el protocolo del final. La orden actual es redactar este TODO: NO implementar,
> migrar datos reales, exportar repositorios, instalar dependencias ni hacer commits.

## Lectura rapida para aprobar

**Estado:** Hitos 1-3 completados. Hito 3.5 planificado, no implementado.

**Objetivo:** trasladar el estado de Binaflow y el repositorio desde el equipo A
al equipo B, trabajar solo en B y devolverlo a A sin perder historial ni pisar
una copia que haya avanzado independientemente.

1. Exportar una instantanea consistente de SQLite y todos los artefactos
   referenciados, junto con la rama Git activa.
2. Importarla en un `dataDir` nuevo, sin sobrescribir el anterior.
3. Bloquear escrituras normales en la copia exportada hasta recibir su retorno.
4. Validar linaje, integridad, workspace y Git antes de activar la copia importada.

**Decisiones fijadas:**

- Solo un equipo activo. Esto es traslado controlado, no sincronizacion
  bidireccional, replicacion, nube ni merge de bases SQLite.
- El paquete v1 es un directorio copiable, no un ZIP: `manifest.json`, `runs.db`,
  `artifacts/` y `repository.bundle`. No agregar dependencia de compresion.
- Exportar exige Git limpio y sin ejecuciones reanudables. El paquete no transporta
  cambios sin commit ni una ejecucion bloqueada a mitad de tarea.
- La importacion crea un directorio nuevo mediante staging + rename atomico. Nunca
  sustituye ni borra el `dataDir` configurado. La persona cambia `dataDir` en su
  configuracion externa despues de revisar el resultado.
- La configuracion, tokens, credenciales, HOME, locks y caches no se exportan.
  Conversaciones y artefactos pueden contener secretos introducidos por el usuario;
  el paquete es sensible, no esta cifrado y debe transportarse de forma segura.
- Binaflow crea/verifica el Git bundle, pero no hace clone, fetch, checkout, merge,
  reset, push ni edita la configuracion para activar una importacion.
- Las aprobaciones de ejecucion ya consumidas se preservan como historia. No se
  transportan runs que puedan reanudarse. Briefs, planes y TODO aun no ejecutados
  se conservan; cualquier ejecucion futura obtiene un preview nuevo en el workspace
  importado.

## Flujo humano esperado

### Salida A -> B

1. Finalizar/cancelar cualquier run reanudable y dejar Git limpio con los commits
   deseados. Detener TUI, web/host futuro y otros procesos Binaflow del `dataDir`.
2. Ejecutar preview de exportacion y revisar blockers, rama, HEAD, destino,
   advertencia de datos sensibles y digest.
3. Confirmar exportacion con requestId + digest. Desde ese momento la copia A
   queda `exported` y rechaza usos mutantes normales.
4. Copiar el directorio resultante. En B, clonar o actualizar el repositorio
   manualmente desde `repository.bundle` hasta el HEAD indicado.
5. Ejecutar preview/import hacia un `dataDir` nuevo y luego cambiar manualmente la
   configuracion local de B para apuntarlo. Las credenciales se configuran en B.

### Retorno B -> A

1. Repetir export en B. Su paquete declara como padre la transferencia A -> B.
2. En A, actualizar Git manualmente desde el bundle hasta el HEAD exacto. Si Git
   no puede avanzar limpiamente, detenerse: la regla de un solo equipo se rompio.
3. Importar hacia otro `dataDir` nuevo. La copia configurada en A debe seguir
   congelada en la transferencia padre; de lo contrario se rechaza.
4. Cambiar manualmente `dataDir` al nuevo directorio. Conservar los anteriores
   hasta verificar el retorno; su limpieza queda fuera de este hito.

## Formato portable v1

```text
<directorio-elegido>/
  manifest.json
  runs.db
  artifacts/
    <runId>/<stepId>/<artifactId>.json|txt
  repository.bundle
```

`manifest.json` usa `protocol: "binaflow-transfer"`, `version: 1`, JSON canonico
y limites estrictos. Incluye: transferId, parentTransferId, datasetId, requestId,
fecha, version de Binaflow/schema, conteos, hashes SHA-256 y tamanos de DB, bundle
y cada artefacto; rama/ref y HEAD; estado fuente; advertencias. No incluye claves,
configuracion ni paths absolutos como campos operativos.

El digest de confirmacion cubre el manifest previsto, destino canonico, estado de
portabilidad, blockers aceptables y fingerprint Git. El manifest final se escribe
ultimo y el directorio se publica mediante rename desde un hermano temporal. Un
paquete sin manifest valido/completo siempre se rechaza.

La copia SQLite incluida es un backup consistente generado por la API de
`better-sqlite3`, no una copia del archivo vivo. En esa copia:

- `artifacts.path` usa paths POSIX relativos al paquete;
- `preparation_drafts.workspace`, `task_contracts.workspace`,
  `guided_executions.workspace` y `guided_executions.progress_json.workspace`
  usan un marcador portable;
- snapshots/autorizaciones historicas no se reescriben ni se presentan como
  autorizacion vigente;
- al importar, solo los campos tecnicos anteriores se ajustan al workspace/dataDir
  canonicos de destino y se vuelven a validar sus contratos.

No prometer anonimizar paths o secretos que aparezcan dentro de conversaciones,
resultados, logs o artefactos historicos.

## Invariantes de seguridad y recuperacion

### Linaje de un solo escritor

Agregar schema 14 con un singleton `portability_state` y ledger inmutable
`portability_transfers`:

- `dataset_id`: identidad estable de la historia, generada una vez.
- estado `active | exporting | exported`.
- `last_transfer_id`; intent pendiente con requestId, digest y destino.
- cada transferencia registra ID, padre, fingerprint Git, estado y timestamps.

Un runtime normal solo abre un dataset `active`. Export cambia `active -> exporting`,
construye/revalida el paquete y finaliza `exporting -> exported`. Repetir el mismo
requestId/digest recupera la operacion; otro request falla. Si existe paquete final
pero falta el acuse SQLite, el replay lo valida y finaliza sin crear otro.

No agregar `force activate`. Un export atascado puede reanudarse con su request;
una cancelacion solo se permite para un intent `exporting` cuyo directorio final
no existe y requiere confirmacion/digest especificos. Nunca cancelar un estado
`exported`, porque el paquete puede haberse copiado a otro equipo.

Importar en destino vacio acepta cualquier paquete valido. Importar cuando hay una
copia previa exige mismo dataset y que esa copia este `exported` exactamente en
`parentTransferId`. Una copia `active`, otro dataset o padre distinto bloquea.
El directorio anterior no se modifica: la nueva copia queda `active` y conserva
el ledger completo. Esto detecta divergencia producida mediante Binaflow; no es
proteccion contra edicion manual o corrupcion externa del archivo SQLite.

### Exclusividad del directorio de datos

Agregar un lease de proceso para el `dataDir`, fuera del propio directorio y
compartido por todos los procesos Binaflow del usuario. Cualquier contexto normal,
incluidas consultas storage-only, lo mantiene desde antes de abrir SQLite hasta
despues de cerrarlo. Export/import usa el mismo lease.

Por tanto, export/import requiere detener el servidor/TUI/CLI que tenga abierta
la base. El lease complementa claims de runs y lease del workspace; no los sustituye.
Un lock con metadata ilegible o owner no demostrablemente muerto falla cerrado.
No borrar locks ajenos automaticamente ni implementar force-unlock en este hito.

Inspeccionar `portability_state` en modo read-only antes de aplicar migraciones.
Un dataset `exporting/exported` no debe abrirse mediante `SqliteRunStore`, porque
una migracion o cleanup ya seria una mutacion. Los comandos de portabilidad usan
su adapter dedicado. Bases schema <=13 activas pueden migrar aditivamente a 14.

### Elegibilidad de exportacion

Con el lease adquirido, el preflight rechaza:

- `run_execution_owners`, `preparation_owners`, requests/mensajes de generacion
  pendientes o mensajes de review pendientes;
- runs `pending`, `running`, `failed`, `interrupted` o `waiting` reanudables;
- ejecuciones guiadas en `execution`, fases/tareas no completadas o commit intents
  sin reconciliar;
- Git sucio, detached, sin HEAD, con operaciones en progreso, sparse checkout,
  submodules o archivos con filtro Git LFS;
- artefactos referenciados ausentes, fuera del root, symlinks, no regulares, con
  tamano distinto o paths duplicados;
- output existente, dentro del workspace/dataDir o sin posibilidad de rename
  atomico en el mismo filesystem.

Se permiten runs `completed`/`cancelled` y un run guiado `waiting` solo si su stage
es `changes-review`, todas sus fases/tareas estan completed y no hay intent activo.
La revision de cambios de hitos futuros no debe convertirlo en reanudable sin
revisar esta regla. Preparaciones activas y TaskContracts aun no ejecutados si se
permiten, porque una ejecucion futura tendra autorizacion nueva en destino.

### Integridad y limites

- Hash SHA-256 en streaming; no cargar artefactos, DB o bundle completos en RAM.
- Rechazar symlinks, hard links inesperados, dispositivos, paths absolutos,
  `..`, separadores ambiguos, case-fold collisions y duplicados de manifest.
- Limites v1: 100.000 artefactos, 16 MiB para manifest, 16 GiB por archivo y
  128 GiB totales. Los limites son constantes probadas; exceder bloquea, no trunca.
- Permisos privados cuando la plataforma los soporte: directorios 0700, archivos
  0600. Documentar que no equivalen a cifrado ni son portables a todos los FS.
- En export: `PRAGMA integrity_check`, `foreign_key_check`, correspondencia exacta
  de referencias y hash despues de producir el backup normalizado.
- En import: verificar manifest/hashes/bundle primero; copiar al staging con
  creacion exclusiva; reescribir solo campos tecnicos permitidos; volver a ejecutar
  integridad/FK/contratos; fsync archivos/directorios y rename final.
- No copiar archivos SQLite `-wal`/`-shm`, temporales, locks, configs ni artefactos
  no referenciados. Reportar cantidad de orfanos omitidos sin incluir su contenido.

### Git bundle

Crear `repository.bundle` solo con la ref de la rama activa y objetos alcanzables,
no `--all`. Verificarlo con `git bundle verify`; registrar ref/HEAD/hash/tamano.
No incluir working tree, index, remotes, hooks, config Git, credenciales ni objetos
LFS. El preflight rechaza gitlinks/submodules y tracked files con `filter=lfs`.

Import no toca Git: exige repositorio limpio, misma rama y HEAD exacto que el
manifest. Para el primer viaje, la persona puede clonar el bundle; para el retorno,
hace fetch/fast-forward manual. Un merge commit diferente al HEAD exportado no se
acepta, aunque contenga cambios equivalentes, porque rompe la identidad autorizada.

## Lista de tareas

### Fase 1: Contratos y exclusividad

- [ ] **Tarea 1.1: Confirmar baseline y decisiones de traslado**
  - **Archivo:** `TODO.md`, `docs/web-workflow-vision.md`; no codigo.
  - **Funciones:** ninguna.
  - **Descripcion:** obtener autorizacion explicita de este TODO. Confirmar que el schema vigente es 13 y 14 esta libre; que `TODO.md` anterior fue retirado en `d6a2940`; que los unicos cambios previstos de plan son estos dos documentos. Ejecutar baseline completo antes de implementar. El owner decide/realiza el commit del plan para que la ejecucion guiada empiece con Git limpio.
  - **Evitar:** incorporar cambios ajenos, usar `git add .`, ejecutar export/import sobre datos reales, probar con HOME real, cambiar configuracion o instalar paquetes.
  - **Verificacion:** `git status --short`; `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`. Registrar cualquier fallo preexistente y detenerse; no repararlo dentro de esta tarea.
  - **Commit Msg:** `docs: plan single-writer data portability`

- [x] **Tarea 1.2: Definir contrato portable v1 y puertos estrechos**
  - **Archivo:** nuevo `src/application/portability.ts`; `src/application/ports.ts`; nuevo `test/portability-contracts.test.ts`.
  - **Funciones:** parseTransferManifest, canonicalTransferJson, hash/digest inputs, validadores de IDs/paths/limites; interfaces PortabilityService, ApplicationPortabilityStore, PortabilityPackageStore, PortabilityGit y DataDirectoryLock.
  - **Descripcion:** modelar previews, requests, resultados, blockers, state/ledger y manifest descritos arriba. Arrays mantienen orden; objetos canonicos ordenan claves. RequestId UUID v4 canonico. Errores de dominio usan codigos estables, sin paths sensibles en mensajes de maquina. Los puertos expresan backup/estado, package y Git necesarios; no crear APIs generales de filesystem/SQLite/Git.
  - **Evitar:** mezclar DTO web, compresion, cifrado ficticio, sync/merge, callbacks del cliente o modelos de futuros diffs/QA.
  - **Verificacion / TDD:** manifest valido/invalido, path traversal Windows/POSIX, duplicados/case collision, limites, JSON canonico y digest estable/sensible a DB, artefactos, Git, padre y destino. `pnpm exec vitest run test/portability-contracts.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: define portable dataset package contracts`

- [x] **Tarea 1.3: Persistir identidad, estado e intents de transferencia**
  - **Archivo:** nuevo `src/storage/migrations/014-portability.ts`; `src/storage/migrations/index.ts`; `src/application/ports.ts`; `src/storage/sqlite-run-store.ts`; `test/migrations.test.ts`; nuevo `test/portability-persistence.test.ts`.
  - **Funciones:** portabilityMigration/currentSchemaVersion exportado; getPortabilityState, inspectPortabilityBlockers, begin/finalize/cancel export intent de ApplicationPortabilityStore; backupDatabaseTo; ledger de transferencias.
  - **Descripcion:** migracion aditiva 14 sin editar 001-013. Crear datasetId una vez y estado active. Mutaciones con `BEGIN IMMEDIATE`, CAS de estado/request/digest y ledger inmutable. `inspectPortabilityBlockers` implementa la matriz de elegibilidad mediante consultas acotadas; no carga transcripts/resultados. `backupDatabaseTo` usa la API backup de better-sqlite3 sobre la conexion poseida.
  - **Evitar:** borrar owners stale, convertir estados de run para hacerlos exportables, tocar filesystem dentro de transacciones salvo que la API backup requiera el paso separado explicitado, o esconder un commit intent incompleto.
  - **Verificacion / TDD:** v13 -> v14 preserva todas las tablas; datasetId estable al reabrir; CAS/replay/conflicto de request; matriz de runs/owners/pending/review/guided; integrity/FK; backup concurrentemente consistente. `pnpm exec vitest run test/migrations.test.ts test/portability-persistence.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: persist portable dataset lineage and export intents`

- [x] **Tarea 1.4: Bloquear el dataDir durante todo contexto de proceso**
  - **Archivo:** nuevo `src/storage/data-directory-lock.ts`; `src/application/runtime.ts`; `src/application/context.ts` si su lifecycle requiere tipo nuevo; `test/application-runtime.test.ts`; nuevo `test/data-directory-lock.test.ts`.
  - **Funciones:** FileDataDirectoryLock.acquire/release; inspectPortableDatabaseState read-only; openApplicationResources, openApplicationStorage y sus cierres.
  - **Descripcion:** lock canonico en `~/.binaflow/data-locks` por hash del dataDir, inyectable en tests. Adquirir antes de abrir SQLite y liberar despues de `store.close`, incluido error de apertura. Normal runtime rechaza exporting/exported antes de migrar. Mantener cierre ordenado del host; si se vuelve async, actualizar todos los consumidores para await real, sin liberar durante una operacion.
  - **Evitar:** usar el lock dentro del dataDir, confundirlo con workspace lock, permitir dos contextos storage-only, borrar metadata ilegible/ajena o romper el cleanup de ExecutionHost/CLI/TUI.
  - **Verificacion / TDD:** dos procesos/adapters no abren mismo dataDir; distintos dataDir si; token incorrecto no libera; error de SQLite libera solo lock propio; exported no migra; close espera DB y lease. `pnpm exec vitest run test/data-directory-lock.test.ts test/application-runtime.test.ts test/execution-host-integration.test.ts test/cli-subprocess.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: own each data directory for the process lifecycle`

### Fase 2: Paquete y adaptadores

- [ ] **Tarea 2.1: Construir y validar directorios de transferencia**
  - **Archivo:** nuevo `src/portability/directory-package.ts`; nuevo `test/directory-package.test.ts`.
  - **Funciones:** createStagingPackage, copyAndHashArtifact, writeManifestLast, finalizePackage, inspectPackage, materializeImportStaging y cleanupOwnedStaging.
  - **Descripcion:** implementar formato v1, permisos, streaming, limites, fsync y rename. Staging lleva metadata con token/request para que un replay solo limpie/reuse su propio directorio. Manifest se parsea con contratos de 1.2 antes de confiar en rutas. Copiar solo artefactos listados por SQLite; contar orfanos por recorrido seguro sin copiarlos.
  - **Evitar:** seguir symlinks, `cp -r`, aceptar extras como referencias, confiar en extensiones, cargar archivos completos, borrar output existente/staging desconocido o publicar manifest antes de completar contenido.
  - **Verificacion / TDD:** paquete valido; artefacto faltante/cambiado/symlink/hard-link/case collision; manifest tampered; limite; crash simulado antes/despues de manifest/rename; output existente intacto. Fixtures siempre temporales. `pnpm exec vitest run test/directory-package.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: create integrity-checked transfer directories`

- [ ] **Tarea 2.2: Crear y verificar el Git bundle sin modificar repositorios**
  - **Archivo:** nuevo `src/portability/git-transfer.ts`; `src/application/ports.ts`; nuevo `test/git-transfer.test.ts`.
  - **Funciones:** previewRepositoryTransfer, createRepositoryBundle, inspectRepositoryBundle y assertImportWorkspace.
  - **Descripcion:** reutilizar WorkspaceProcess para argv Git con `shell:false`. Preflight limpio compatible con LocalGitWorkspace, detectar gitlinks y `filter=lfs` mediante entrada NUL acotada. Crear bundle de la ref completa de rama actual, verificar ref/HEAD y hash. En import solo comparar; no ejecutar acciones mutantes sobre el repo.
  - **Evitar:** `--all`, Git shell interpolation, config/hooks/remotes, clone/fetch/checkout/reset/push automaticos, external diff/textconv o ignorar LFS.
  - **Verificacion / TDD:** bundle clonable de rama normal y `git bundle verify`; repo sucio/detached/submodule/LFS rechazado; otra rama/HEAD en import rechazado; paths con espacios seguros. `pnpm exec vitest run test/git-transfer.test.ts test/git-workspace.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: package the active Git branch for manual transfer`

- [ ] **Tarea 2.3: Normalizar y restaurar la copia SQLite portable**
  - **Archivo:** nuevo `src/storage/sqlite-portability.ts`; `src/application/ports.ts`; nuevo `test/sqlite-portability.test.ts`.
  - **Funciones:** normalizePortableBackup, inspectPortableBackup, activateImportedBackup; validacion de artifacts/workspace/progress y portability ledger.
  - **Descripcion:** operar solo sobre copias cerradas/staging. Normalizar paths tecnicos y workspaces conocidos, marcar la copia empaquetada exported y luego, al importar, rebasar al workspace/dataDir canonicos y marcarla active con el transferId actual. Verificar schema exacto soportado, integrity_check, foreign_key_check, JSON valido, IDs/refs y correspondencia manifest antes y despues. Preservar snapshots/autorizaciones historicas sin reinterpretarlos.
  - **Evitar:** abrir el DB del usuario por path sin lease, migrar paquetes durante import, SQL dinamico desde manifest, reescribir texto libre, editar runs para volverlos reanudables o dejar paths hacia el equipo origen en `artifacts.path`.
  - **Verificacion / TDD:** roundtrip con paths A/B diferentes; todos los queries por workspace funcionan en B; artefactos se leen desde B; snapshot historico permanece; progress tecnico usa B; corrupcion/FK/schema 13/15/path desconocido rechaza. `pnpm exec vitest run test/sqlite-portability.test.ts test/task-contract-persistence.test.ts test/guided-execution-persistence.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: rebase validated SQLite snapshots across workspaces`

### Fase 3: Casos de uso y CLI

- [ ] **Tarea 3.1: Coordinar preview, export y recuperacion de export**
  - **Archivo:** nuevo `src/application/portability-operations.ts`; `src/application/service.ts` solo tipos/capacidad si se expone por facade; nuevo `test/portability-export.test.ts`.
  - **Funciones:** createPortabilityService; previewExport, exportPackage, cancelExportIntent e inspectTransfer.
  - **Descripcion:** con dataDir lease, validar active + blockers + Git + output; generar digest. Export revalida todo antes de begin intent, crea backup/bundle/artefactos en staging, normaliza/verifica, publica paquete y finaliza source exported. Replays distinguen intent, paquete final y acuse faltante. Cancel solo bajo regla estricta. `inspectTransfer` no abre/muta DB configurada ni muestra contenido sensible.
  - **Evitar:** mantener transaccion SQLite durante copias/Git, marcar exported antes de un paquete verificable, dejar runtime normal activo, borrar un paquete final o considerar exitoso un rename sin hash final.
  - **Verificacion / TDD:** preview no muta; stale digest; doble request mismo resultado; request conflictivo; fallo en backup/copia/bundle/rename/finalize y replay de cada borde; cancel permitido/prohibido; fuente exported rechaza runtime normal. `pnpm exec vitest run test/portability-export.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: export resumable single-writer transfer packages`

- [ ] **Tarea 3.2: Coordinar import no destructivo y deteccion de divergencia**
  - **Archivo:** `src/application/portability-operations.ts`; nuevo `test/portability-import.test.ts`.
  - **Funciones:** previewImport e importPackage.
  - **Descripcion:** inspeccionar package completo antes del baseline. Aceptar baseline vacio o exported con dataset/padre exactos; exigir Git actual exacto; digest liga package, baseline, workspace y output nuevo. Materializar staging, verificar hashes, activar DB importada, volver a verificar y rename. Devolver ruta nueva y pasos manuales para config, sin editarla. Replay solo devuelve mismo output si su identidad/hashes coinciden.
  - **Evitar:** importar sobre active, reemplazar/renombrar/borrar dataDir previo, aceptar mismo dataset con padre distinto, activar antes de validar artefactos, mutar Git o copiar credenciales.
  - **Verificacion / TDD:** destino vacio; retorno con padre exacto; dataset/padre/active divergentes; output existente ajeno; tamper tras preview; fallo antes de rename deja baseline intacto; replay exacto; config fixture sigue byte-identica. `pnpm exec vitest run test/portability-import.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: import portable datasets without replacing local data`

- [ ] **Tarea 3.3: Exponer comandos CLI humanos y JSON v1**
  - **Archivo:** nuevo `src/cli/commands/portability.ts`; `src/cli/index.ts`; `src/cli/protocol.ts`; `src/application/runtime.ts` para composition root dedicado; `test/cli-protocol.test.ts`; nuevo `test/cli-portability.test.ts`.
  - **Funciones:** registerPortabilityCommands; openPortabilityContext; DTOs/sanitizacion para preview-export, export, cancel-export, inspect, preview-import e import.
  - **Descripcion:** comandos con `--request-id`, `--digest`, `--output`/`--output-data-dir` explicitos. Soportar salida humana y `--json` en envelope CLI v1; rechazar `--jsonl`. Imprimir blockers, hashes cortos, sensibilidad y pasos Git/config sin volcar conversaciones, artifact paths internos o tokens. `inspect` funciona sin abrir dataDir; los demas respetan root `--config/--cwd`.
  - **Evitar:** prompts ambiguos en modo maquina, defaults destructivos, mostrar secretos, cambiar envelopes/codigos/streams existentes o registrar portabilidad como workflow.
  - **Verificacion / TDD:** argumentos faltantes/incompatibles; output humano sanitizado; JSON versionado y estable; errores por busy/divergence/tamper con exit code; jsonl rechazado; comandos legacy sin cambios. `pnpm exec vitest run test/cli-portability.test.ts test/cli-protocol.test.ts test/cli-output.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: expose explicit dataset transfer commands`

### Fase 4: Viaje completo y documentacion

- [ ] **Tarea 4.1: Probar A -> B -> A con SQLite, artefactos y Git reales**
  - **Archivo:** nuevo `test/portability-integration.test.ts`; correcciones minimas solo en archivos de Fases 1-3 si una prueba demuestra incumplimiento.
  - **Funciones:** fixture de dos HOME/config/dataDir/workspace temporales y driver/store existentes; no helper de produccion adicional salvo desviacion aprobada.
  - **Descripcion:** A contiene runs terminados, preparacion activa, TaskContract listo, ejecucion guiada changes-review y artefactos. Exportar T1; clonar bundle en B; importar a dataDir B nuevo; apuntar config fixture manualmente; consultar mismos IDs/documentos/artefactos; crear trabajo nuevo y commit en B; exportar T2; fetch/fast-forward manual en A; importar a dataDir A nuevo; verificar historia union y linaje. La prueba simula el cambio manual de config/Git, no lo atribuye a Binaflow.
  - **Casos negativos:** A no puede mutar tras T1; run reanudable bloquea export; copia A activa/divergente bloquea T2; artefacto o bundle alterado no crea output; paquete/config no contiene una credencial sentinela salvo si el propio contenido historico la incluyo deliberadamente.
  - **Evitar:** usar HOME/repos/data reales, red, Pi live, sleeps fragiles o acciones Git destructivas fuera de fixtures propios; no rebajar checks para completar el roundtrip.
  - **Verificacion / TDD:** `pnpm exec vitest run test/portability-integration.test.ts test/portability-export.test.ts test/portability-import.test.ts`; demostrar IDs, hashes, parent T1, HEAD y lectura de artifacts, no solo existencia de archivos. `pnpm run typecheck`.
  - **Commit Msg:** `test: verify round-trip transfer between two computers`

- [ ] **Tarea 4.2: Documentar operacion, limites y recuperacion**
  - **Archivo:** nuevo `docs/data-portability.md`; `docs/web-workflow-vision.md`; `README.md` solo enlace/comandos esenciales; `TODO.md` para evidencia final.
  - **Funciones:** ninguna.
  - **Descripcion:** guia concreta A -> B -> A, preflight, clone/fetch manual, cambio manual de dataDir, comprobacion posterior y conservacion de directorios anteriores. Explicar exporting atascado/replay, locks, datos sensibles, ausencia de cifrado, no LFS/submodules, no runs reanudables, no sync/merge y que el FS/OS puede no conservar permisos. Marcar Hito 3.5 hecho solo tras checks reales.
  - **Evitar:** recomendar borrar backups, afirmar seguridad criptografica, portabilidad Windows no probada, recuperacion de procesos abruptos, merge de copias o web implementada.
  - **Verificacion:** `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`; `git diff --check`; `git status --short`. No bundles de release, instalaciones ni Pi live. Documentar plataformas realmente probadas.
  - **Commit Msg:** `docs: document verified single-writer data transfers`

## Criterios de aceptacion global

- [ ] Paquete consistente y verificable creado solo con fuente elegible.
- [ ] Configuracion/credenciales no incluidas; advertencia de contenido sensible visible.
- [ ] Repositorio regular trasladable por bundle y HEAD exacto comprobado.
- [ ] Import siempre crea dataDir nuevo y deja intacto el anterior.
- [ ] A -> B -> A conserva IDs, documentos, decisiones, artifacts y trabajo nuevo.
- [ ] Copia activa, padre incorrecto, tamper o Git divergente detiene sin sobrescribir.
- [ ] Fuente exported no admite runtime normal; replay recupera export incompleto.
- [ ] CLI/TUI/workflows/protocolo v1 existentes conservan comportamiento.

## Reglas de operacion para el sub-modelo

1. **Una tarea cada vez:** RED -> GREEN por comportamiento. No empezar N+1 hasta
   verificar y marcar N. Un test de mocks no sustituye el roundtrip real temporal.
2. **Commits atomicos:** staging explicito de archivos propios; nunca `git add .`.
   No commit vacio, con tests RED, cambios ajenos ni formateo global.
3. **Datos seguros:** toda prueba usa HOME, config, repos, DB, output y locks bajo
   temporales. Nunca abrir/migrar/exportar `.binaflow` o HOME reales del usuario.
4. **Sin acciones destructivas:** no reset, clean, checkout, force, push, borrado
   de dataDir/paquetes/configs ni autoactivacion. Cleanup solo fixtures propios.
5. **Sin alcance futuro:** no web, VPN, servidor, sync cloud, watchers, daemon,
   multiusuario, merge SQLite, cifrado, compresion ni revision/QA.
6. **Evidencia honesta:** no marcar Windows, NFS, FAT, LFS, submodules, crash real
   o secretos eliminados como probados si solo se simularon o rechazaron.
7. **Retiro del plan:** con todas las tareas y checks globales hechos, arbol limpio
   y confirmacion del owner, retirar `TODO.md` mediante `git rm -- TODO.md` y commit
   `docs: retire completed portability plan`. Si hay pendientes, conservarlo.

## Protocolo de desviacion

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos, datos y verificaciones afectados>
Propuesta: <ajuste minimo solicitado>
```

Detenerse sin check. Ejemplos: schema 14 ocupado, better-sqlite3 no permite el
backup consistente esperado, tabla nueva con paths/workspace no contemplados,
filesystem sin rename atomico, un flujo mutante abre SQLite sin dataDir lease,
o una regresion exige cambiar protocolo/compatibilidad persistida.

## Registro de ejecucion

- Orden actual: crear este TODO; implementacion no autorizada ni iniciada.
- Baseline observado: `d6a2940 docs: retire completed phased execution plan`.
- Antes de crear este archivo, `docs/web-workflow-vision.md` tenia cambios de la
  decision aprobada del Hito 3.5 y no existia `TODO.md`. Ambos deben revisarse;
  no presentarlos como implementacion.
- Pruebas, migracion 14, export/import, Git bundle y commits: no ejecutados.
- Tarea 1.1 completada: baseline completo y autorizacion documentada en commit
  `200e548`.
- Tarea 1.2 completada: contratos, validadores y puertos en
  `src/application/portability.ts`, `src/application/ports.ts`; 5 tests especificos
  pasan y typecheck pasa.
- Tarea 1.3 completada: migracion aditiva 14, estado/linaje CAS, blockers y backup
  consistente en `src/storage/migrations/014-portability.ts` y
  `src/storage/sqlite-run-store.ts`; 5 tests especificos pasan y typecheck pasa.
- Tarea 1.4 completada: lease exclusivo fuera del dataDir, inspeccion read-only y
  lifecycle de runtime/storage en `src/storage/data-directory-lock.ts` y
  `src/application/runtime.ts`; 13 tests especificos pasan y typecheck pasa.
- Siguiente accion: construir el directorio de transferencia con staging, hashes,
  limites, fsync y publicacion atomica.
