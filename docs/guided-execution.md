# Ejecucion guiada por fases

Estado: Hito 3 implementado localmente y verificado con SQLite, artefactos,
Git y un driver falso. No implica soporte web, sandbox, ejecucion distribuida ni
exactamente-una-vez para los efectos de las herramientas.

## Handoff autorizado

El handoff solo se puede iniciar desde un `TaskContract` listo. El runtime fija
el workspace canonico; el usuario autoriza una revision concreta del contrato,
la version del TODO, el perfil `builder`, los comandos de verificacion y los
archivos permitidos.

`previewStart` no muta SQLite, Git ni el filesystem. Devuelve la autorizacion,
el snapshot de documentos, el TODO derivado, el fingerprint Git y un digest
SHA-256 canonico. `start` vuelve a validar la revision y la version bajo el
lease del workspace, escribe los artifacts del handoff y crea un run `pending`.
El mismo `requestId` y digest reproducen el run existente; una solicitud con
contenido distinto se rechaza y no inicia otro agente.

El perfil guiado exige driver Pi, workspace de lectura-escritura y
`retryLimit: 0`. Esto selecciona el perfil, pero no afirma que Pi, credenciales
o un modelo concreto esten disponibles hasta la ejecucion real.

## Ejecucion y checkpoints

El `ExecutionHost` posee una unica ranura local y un `AbortController`. El
cliente recibe una capacidad tipada `taskExecutions` para previews, inicio,
resume, consultas y cancelacion; no recibe senales, callbacks, SQLite ni
artefactos locales. El coordinador ejecuta una tarea cada vez:

1. valida el fingerprint y la transicion de la tarea;
2. ejecuta el paso con el perfil snapshot y persiste su resultado/artifact;
3. comprueba el resultado estructurado y las verificaciones locales;
4. valida que los cambios Git estan dentro del alcance declarado;
5. persiste el checkpoint de la tarea;
6. hace stage explicito y crea un commit por fase con trailer
   `Binaflow-Checkpoint: run/phase/token`;
7. inspecciona el commit y persiste el checkpoint de fase.

El run termina en `waiting/changes-review` cuando todas las fases quedan
verificadas. El template `guided-task-build` existe en el catalogo para validar
e inspeccionar runs persistidos, pero no es un workflow de lanzamiento libre y
no aparece como un paso pendiente en `run-view`.

Los workflows legacy que tienen algun perfil de escritura comparten el mismo
lease de workspace. Los workflows de solo lectura no exigen Git ni lease. Un
workspace no Git sigue siendo valido para workflows legacy, pero el preflight
rechaza la ejecucion guiada.

## Resume, bloqueos y cancelacion

`previewResume` expone la revision, el bloqueo y las decisiones permitidas. La
recuperacion exige digest y revision actuales; solo se puede decidir sobre un
run en espera. `retry-task` incrementa el intento y nunca vuelve a ejecutar una
tarea completada. `continue`, `retry-verification` y
`reconcile-commit` conservan los artifacts y checkpoints ya persistidos.

Una cancelacion aborta el paso activo y conserva los cambios parciales. El
primer cancelado es graceful; el host espera la limpieza del agente, comandos,
claims y lease antes de cerrar SQLite. Un lease huerfano se trata como busy si
su owner sigue vivo; no se elimina por inferencia. La reconciliacion exige que
parent, tree, branch y trailer coincidan; de lo contrario queda incertidumbre y
se bloquea la recuperacion.

No hay recuperacion automatica tras una caida abrupta, no se hace reset/clean,
no se sube ni se hace push, y no se garantiza que una herramienta externa no
produzca efectos duplicados. Los comandos y rutas son limites de autorizacion,
no un sandbox del sistema operativo.

## Persistencia y verificaciones

La migracion aditiva `013-guided-execution` persiste el snapshot, digest,
artifacts, fases, tareas, claims, decisiones, checkpoints e intents de commit.
Las actualizaciones de progreso usan CAS y la asociacion del contrato se valida
con claves foraneas. Los tests de integracion usan repositorios y bases
temporales, un driver que modifica solo archivos fixture y comandos Node locales.
La suite real verifica dos fases, dos commits, parent y trailers. No se lanzan
agentes Pi reales en estos tests; Windows, navegadores, red, credenciales y
caidas del proceso no estan cubiertos por esta evidencia.
