# PLAN DE EJECUCION: Hito 4 - Web personal y preparacion guiada

> **ATENCION SUB-AGENTE:** Seguir las tareas en orden, solo tras autorizacion de
> implementacion. Cada tarea exige verificacion y commit propio. Ante una
> desviacion, detenerse y pedir un ajuste del plan. La orden actual es redactar
> este TODO: NO implementar, instalar paquetes/navegadores, arrancar servidores,
> invocar modelos ni modificar datos, configuracion o certificados del usuario.

## Lectura rapida para aprobar

**Estado:** Hitos 1, 2, 3 y 3.5 completados segun el propietario y la documentacion.
Este hito esta pendiente. El TODO anterior de portabilidad permanece en Git;
no se reabren sus tareas por sustituir este archivo.

**Objetivo:** entrar desde un navegador de la red interna, explorar una tarea,
aprobar un plan y un TODO concreto, iniciar su ejecucion y recuperar el progreso
al cerrar la pestana o abrir otro navegador.

### Decisiones ya acordadas

- Un usuario y un workspace configurado por proceso. Acceso inicial en LAN,
  sin VPN ni publicacion en internet.
- La web llama a aplicacion; no envuelve CLI/TUI ni abre SQLite por peticion.
- El servidor posee el trabajo, no la conexion HTTP. Cerrar una pestana o hacer
  logout no cancela un agente.
- Los hitos 5 y 6 conservan diffs editables, comentarios por linea, QA y cierre.
  Aqui la implementacion acaba en `waiting/changes-review`.

### Propuestas tecnicas que se aprueban junto con este TODO

- **Interfaz:** React existente + react-dom; build pequeno con esbuild. Sin
  Next.js, SSR, router externo, framework CSS, WebSockets ni service worker.
- **Servidor:** HTTP/HTTPS nativo de Node y rutas explicitas; Ajv existente para
  validar. `binaflow serve` permanece en primer plano, sin daemon ni servicio OS.
- **Acceso:** codigo aleatorio de acceso generado al arrancar, introducido en un
  formulario y canjeado por cookie de sesion. Para LAN se exige HTTPS con
  certificado/clave aportados por el operador; HTTP solo en loopback.
- **Internet:** lectura de URLs publicas HTTPS y busqueda opcional mediante Brave
  Search API, con clave externa del operador. Sin clave, la UI muestra busqueda
  deshabilitada; la lectura por URL sigue disponible. Cada consulta/URL la envia
  explicitamente el usuario; no enviar automaticamente el chat a un buscador.
- **Verificacion:** tests normales con agentes/red simulados y un recorrido real
  de navegador con Playwright/Chromium local. La instalacion de las dependencias
  enumeradas y Chromium requiere aprobar la Tarea 1.1; no ocurre al redactar.

No es necesario decidir un modelo concreto: `planner` y `builder` siguen siendo
perfiles externos. Aprobar estas propuestas no convierte comentarios o respuestas
LLM en autorizaciones de ejecucion.

## Fuentes y baseline que debe conocer el ejecutor

- `AGENTS.md`, `docs/web-workflow-vision.md`, `docs/task-contract.md`,
  `docs/guided-execution.md`, `docs/data-portability.md`.
- `src/application/service.ts`, `runtime.ts`, `execution-host.ts`, `ports.ts`,
  `task-contract.ts`, `task-contract-operations.ts`, `guided-execution-operations.ts`.
- `src/application/preparation.ts` y `preparation-operations.ts`: el chat legacy
  tiene otra semantica y solo prepara workflows anteriores. Reusar contratos
  utiles, no modificar su handoff ni convertirlo en guided-task por un cast.
- `src/storage/migrations/014-portability.ts`, `sqlite-portability.ts`,
  `data-directory-lock.ts`, `sqlite-run-store.ts`; schema vigente 14.
- `src/core/agent.ts`, `src/drivers/pi-rpc.ts`, `src/pi-tools.ts`,
  `test/architecture-boundaries.test.ts` y los tests existentes de host/portabilidad.

El host actual expone ejecucion guiada, no chat ni contratos. El dataDir admite
un solo contexto propietario. Abrir ApplicationContext y ExecutionHost por
separado para la web no es una solucion: chocaria con el lease o duplicaria owners.

## Contrato funcional

### A. Recorrido visible

1. **Tareas:** listado paginado del workspace y boton Nueva tarea. Crear el brief
   inicial desde un objetivo no ejecuta agente, Git ni comandos.
2. **Exploracion:** mensajes persistidos, fuentes y un resumen editable de objetivo,
   conclusiones, restricciones y fuera de alcance. El planner propone; la persona
   confirma el resumen antes de generar el plan.
3. **Plan y TODO:** generar plan, comentar y regenerar, aprobar su version exacta;
   generar TODO solo desde ese plan aprobado. Mostrar tareas, archivos, criterios,
   comandos y condiciones de parada. No escribir `TODO.md` en el repo.
4. **Autorizar e iniciar:** mostrar preview del Hito 3, perfil, Git, archivos,
   verificaciones y permiso de commit. El boton Iniciar envia requestId y digest;
   `ready` no basta. Un preview obsoleto exige volver a revisar.
5. **Seguimiento:** fases/tareas completadas, accion actual, verificaciones,
   commits, errores y bloqueos. Ofrecer cancelacion o recuperacion permitida por
   el backend. `changes-review` muestra Pendiente de revision, no Todo terminado.

La UI usa un panel de contenido principal y resumen de estado visible. Como
maximo cinco acciones principales simultaneas; las tareas largas se agrupan por
fase y se muestran progresivamente. Teclado, foco, labels y contraste importan.
No usar solo color para estados. Mantener el texto que el usuario esta escribiendo
si falla un envio; no guardarlo ni guardar credenciales en localStorage.

### B. Preparacion guiada, sin alterar la preparacion legacy

Crear `src/application/guided-preparation.ts`,
`guided-preparation-operations.ts` y `src/workflows/guided-preparation.ts`.
El ultimo contiene prompts/schemas, no una nueva entrada ejecutable del catalogo.

Una preparacion se vincula a un TaskContract por su ID. El workspace siempre se
obtiene del runtime y de ese contrato. No aceptar workspace, perfil, herramientas,
modelo, path de artefacto o comandos de shell como overrides del navegador.

**Estado y versiones:**

- Revision CAS de preparacion independiente de revision del TaskContract.
  Conservar secuencias de mensajes/fuentes y `briefConfirmedThroughSequence`.
  Cada solicitud selecciona hasta cinco sourceIds del mismo contrato; capturar
  IDs/hashes en el request. confirmBrief fija tambien los IDs que respaldan el
  resumen, usados al generar el plan. No elegir fuentes nuevas silenciosamente.
- El brief inicial creado por la persona esta confirmado hasta secuencia 0.
  Un nuevo mensaje o fuente vuelve a dejar informacion sin confirmar. Si ya
  hay aprobacion del plan, invalidarla mediante las reglas del contrato; no
  permitir ejecutar el TODO anterior mientras haya contexto pendiente.
- `confirmBrief` acepta el resumen revisado explicitamente, llama a la logica de
  reviseBrief y registra la secuencia cubierta. Invalida plan/TODO anteriores.
  Una respuesta del agente nunca confirma el brief por si sola.
- Generar plan exige brief confirmado hasta el ultimo mensaje/fuente. Generar
  TODO exige ademas aprobacion exacta del plan vigente. Comentar un plan invalida
  su aprobacion incluso si el comentario es una pregunta, como en el Hito 2.
- Un contrato consumido por ejecucion conserva la preparacion legible pero no
  admite mensajes, fuentes, nuevos planes ni edicion del brief.

Guardar mensajes, fuentes breves y respuestas estructuradas acotadas en SQLite,
como ya ocurre con la preparacion legacy y los documentos de TaskContract. No
persistir HTML completo, streams de tokens ni transcripts ilimitados. Los
artefactos grandes de ejecucion siguen usando FileArtifactStore sin cambios.

**Planner:** perfil externo `planner`, read-only, herramientas permitidas de
lectura, projectTrust `never`, skills `none`, retryLimit 0. Validar esas condiciones
antes de admitir una llamada; no sobrescribir silenciosamente el perfil. El
operador lo configura. No ampliar READ_ONLY_PI_TOOLS con bash/curl ni usar una
extension Pi para consultas web.

Una llamada por operacion, sin bucle autonomo ni reintento automatico. Para reply,
la salida JSON contiene mensaje, preguntas, sugerencia opcional de brief y IDs de
fuentes citadas. Plan y TODO usan los schemas actuales de TaskContract. Validar
versiones, limites, source IDs y alcance antes de publicar. Una sugerencia que no
cabe o un JSON invalido deja error persistido, no contenido aprobado.

El prompt usa brief confirmado, mensajes recientes no cubiertos y fuentes
seleccionadas, todos con IDs. Limite total 96 KiB UTF-8. Si no caben mensajes sin
confirmar, pedir consolidar el resumen; no omitirlos silenciosamente. Generar TODO
usa brief y plan aprobado, no todo el chat. El builder sigue recibiendo el handoff
congelado del Hito 3, nunca el transcript de exploracion.

### C. Persistencia e idempotencia

Migracion **015-guided-preparation.ts**, aditiva, sin editar 001-014:

| Tabla | Contrato |
| --- | --- |
| `guided_preparations` | contract_id PK/FK task_contracts; revision positiva; last_sequence; brief_confirmed_through_sequence; confirmed_source_ids_json; active_request_id nullable; timestamps. Sin nuevo workspace duplicado. |
| `guided_preparation_messages` | id; contract_id; sequence unica por contrato; role user/assistant; content acotado; request_id; timestamps. No mensajes de sistema editables por el navegador. |
| `guided_preparation_sources` | id; contract_id; sequence; request_id; kind search-result/page; URL validada, titulo, extracto, query opcional, retrieved_at, content hash y bandera truncated. No raw HTML ni rutas locales. |
| `guided_preparation_requests` | contract_id + request_id PK; operation_id UUID unico; kind; request canonico/hash; revision de preparacion y contrato de entrada; estado; owner token; perfil snapshot cuando aplica; resultado acotado/error; documento publicado; timestamps. |

Tipos de request cerrados: reply, search, fetch-source, generate-plan,
generate-todo, confirm-brief, comment-plan, approve-plan y recover-operation.
No tabla generica de jobs ni scheduler. Los requests cortos tambien necesitan
idempotencia: dos clicks en Aprobar no deben insertar dos acciones e invalidar
el TODO por un replay tardio.

1. Capturar/validar request antes de awaits. UUID canonico y CAS obligatorios para
   mutaciones. El mismo ID/cuerpo devuelve el recibo anterior antes de evaluar
   revisiones nuevas; mismo ID con otro cuerpo falla sin efectos.
2. Inicio transaccional: comprobar workspace, contrato no consumido, versiones,
   ausencia de otra operacion de preparacion y politicas; insertar request,
   mensaje si corresponde, invalidar aprobacion vigente si procede y reservar
   revision/owner. No red/driver dentro de SQLite.
3. La operacion larga se ejecuta bajo el host. Su resultado se valida y publica
   junto con el cierre del request y nuevas referencias en una transaccion.
   Revalidar revision/owner/fuentes. Si un cliente legacy cambio el contrato,
   registrar conflicto; nunca publicar el resultado como documento vigente.
4. Abort, timeout o fallo dejan cancelled/failed. Tras caida abrupta, una operacion
   pendiente/running se muestra como recuperacion necesaria; no se reenvia al LLM
   automaticamente. `recover-operation` explicito marca interrupted solo cuando
   no existe owner activo y se ha resuelto la propiedad del dataDir.
5. Retry es otra solicitud autorizada; conservar el intento anterior. Un recibo
   completed nunca vuelve a llamar al modelo o a la red por replay.

Reutilizar la logica de TaskContract, no duplicar sus validaciones/aprobaciones.
Extraer helpers privados transaccionales solo cuando sean necesarios para crear
preparacion+contrato y publicar resultado+documento juntos; no callbacks SQL
publicos ni transacciones anidadas. Tests del Hito 2 deben seguir pasando.

Agregar un guard opcional de preparacion al preflight guiado y a
`createGuidedExecution`: si el contrato tiene preparacion, exige resumen confirmado
sin solicitud activa y fuentes/documentos vigentes. Tambien aplica fuera de HTTP;
no basta ocultar el boton en React. Contratos del Hito 2 sin preparacion conservan
su comportamiento.

### D. Internet con autorizacion y limites

Puerto consumidor `PublicSourceReader` con `search(query, signal)` y
`readUrl(url, signal)`. Adapter `src/research/public-sources.ts`, compuesto en
runtime, no importado por el core, workflows o presentacion.

- Buscar envia SOLO la query explicitamente confirmada por el usuario al endpoint
  HTTPS fijo de Brave Search. Maximo cinco resultados. No proveedor seleccionable
  por URL, descubrimiento MCP ni acceso a las cookies del navegador.
- La clave se lee de un archivo privado configurado por el operador, fuera del
  workspace y dataDir; no se mete en prompts, respuestas, logs, snapshots ni env
  de procesos Pi. No exportar ese archivo/config con portabilidad.
- `readUrl` acepta HTTPS puerto 443 sin userinfo. Rechaza file/data/javascript,
  localhost, .local, IPs privadas/especiales, loopback, link-local, CGNAT,
  multicast y equivalentes IPv6/mapped. Usar ipaddr.js, no regex caseras de IP.
- Resolver DNS y comprobar todas las direcciones; fijar la IP publica validada
  al conectar, conservando SNI y validacion TLS del hostname. No hacer una segunda
  resolucion implicita ni usar proxies del entorno. Comprobar remoteAddress.
  No seguir redirecciones automaticamente: informar URL destino y exigir nueva
  accion, que repite todas las comprobaciones.
- GET solamente, sin cookies ni credenciales del usuario. Timeout 15 s, maximo
  1 MiB de respuesta. Solicitar identity encoding y rechazar codificaciones no
  soportadas. Aceptar texto/HTML; extraer texto con parse5 descartando scripts,
  styles y contenido activo. Guardar hasta 16 KiB de extracto por fuente, con
  truncated=true si corresponde; no fingir haber guardado la pagina completa.

Una fuente es evidencia NO confiable, no instrucciones. El modelo recibe bloques
marcados con URL/fecha/ID. Solo puede citar IDs existentes. La UI distingue un
extracto de buscador de una pagina leida. No presentar las citas como garantia de
veracidad. El usuario ve cuando saldra informacion a un servicio externo.

No hay navegador headless para investigar, ejecucion de JavaScript remoto,
lectura de intranet, descargas, adjuntos ni busqueda automatica en background.
Sin clave Brave: `search-unavailable`, no resultados inventados. Leer URLs y chat
siguen funcionando. Las pruebas nunca consultan Brave ni sitios reales.

### E. Un host y un dataDir durante toda la sesion del servidor

Extender el host existente con capacidades explicitas de preparacion/contratos;
no crear un segundo owner o contexto SQL. Separar primero el refactor de su
ranura activa del agregado de funcionalidad.

- Una ranura discriminada legacy/guided/preparation. Preparacion incluye llamadas
  LLM y consultas de fuentes; sin paralelismo ni cola. Consultas y comandos
  cortos admitidos se siguen esperando al cerrar.
- `ApplicationService.guidedPreparation` compone casos de uso. La capacidad del
  cliente host oculta AbortSignal, callbacks y recursos. El recibo se entrega al
  persistir la admision; la promesa completa queda en el owner.
- El servidor HTTP usa solo capacidades del cliente: preparacion, consultas de
  contratos, ejecucion guiada y progreso. No acceso irrestricto a la fachada
  completa, puertos, context.close o SQLite desde handlers.
- Finalizar respuesta HTTP, perder conexion, expirar sesion o hacer logout no
  aborta una operacion. El boton Cancelar si llama al owner. Cada respuesta perdida
  se resuelve consultando/reintentando el mismo requestId, no inventando otro.
- SIGINT/SIGTERM, error fatal del listener y cierre explicito dejan de admitir,
  abortan el trabajo, esperan driver/red/persistencia, cierran HTTP, luego host/DB
  y lease. Segundo signal no salta cleanup ni hace process.exit inmediato.

EPIPE/aborted de una respuesta a un navegador no es error fatal del servidor.
Errores de persistencia/cleanup si impiden nuevos inicios y requieren diagnostico.
No prometer continuidad tras apagar el proceso; persistir y mostrar la necesidad
de recuperacion. No robar leases huerfanos.

Mientras `serve` posee el dataDir, otro CLI/TUI o export/import puede devolver busy
por el Hito 3.5. Para transferir datos se cierra el servidor primero. No debilitar
el lease para permitir una segunda conexion al dataset ni crear endpoints web de
portabilidad en este hito.

### F. Acceso LAN y seguridad HTTP

Crear `src/web/config.ts`, `auth.ts` y `server.ts`. Config web separada, por ejemplo
`--web-config <archivo>`; no alterar profiles/config general por peticiones HTTP.
Campos cerrados: host, port, origin, TLS cert/key y sources.searchKeyFile opcional.
Resolver paths respecto al archivo web-config. La configuracion de fuentes pasa
solo a opciones privadas de composicion, nunca al browser ni al perfil Pi.
Rechazar campos desconocidos y origen ambiguo.

**Arranque y autenticacion:**

1. Default `127.0.0.1`, puerto 4317, origen exacto mostrado por consola. Fuera de
   loopback exige origin HTTPS y cert/key validos. No fallback silencioso a HTTP,
   certificado autofirmado automatico, apertura de firewall ni anuncio en internet.
2. Generar 32 bytes aleatorios de codigo de acceso por arranque. Mostrarlo solo
   en stderr al operador, nunca en URL, argumentos, HTML, log HTTP, SQLite o
   variables heredadas por Pi. Conservar hash para comparacion timing-safe.
3. POST login canjea codigo por sesion aleatoria de 32 bytes. Cookie HttpOnly,
   SameSite=Strict, Path=/, Secure en HTTPS; TTL absoluto 8 h. Sesiones en memoria,
   maximo ocho; reinicio invalida sesiones/codigo, no elimina historial.
4. Rate limit de login: cinco fallos/minuto por IP y treinta globales; mapa
   acotado y expiracion. No confiar en X-Forwarded-For. Respuestas genericas;
   no log de token, cookies, cuerpo, query de busqueda o contenido del chat.
5. Logout revoca solo esa sesion. El token de sesion no sale de la cookie ni se
   guarda en localStorage. Para otra computadora se usa el codigo del servidor.

**Proteccion por peticion:**

- Validar Host contra authority configurada y Origin en acciones, incluido login.
  Sin CORS abierto ni confianza en forwarded headers. CSRF token de sesion para
  mutaciones autenticadas, ademas de Origin + JSON content type. GET nunca muta.
- Sin sesion: solo pagina de login, assets estaticos y POST login. No exponer
  tareas, configuracion, rutas locales, progreso ni errores internos.
- Limite de body 128 KiB, headers 16 KiB, tiempo de recepcion 15 s y conexiones
  keep-alive acotadas. Rechazar compresion de request y JSON/UTF-8 invalidos.
  Ajv sin coerccion, remocion de campos extra ni defaults mutantes.
- API: Cache-Control no-store. CSP restrictiva sin inline/eval, frame-ancestors
  none, nosniff y Referrer-Policy no-referrer. Texto LLM/Markdown como texto/React
  seguro: nunca dangerouslySetInnerHTML ni HTML de marked sin sanitizar.
- Servir solo index.html, app.js y app.css generados. No fallback de filesystem,
  directory listing, source maps, lectura por path, subida de archivos, terminal
  remoto, export/config/update ni acciones arbitrarias de la facade.

TLS protege el codigo/cookie en LAN; no es una VPN ni publicacion externa. El
operador aporta/confia el certificado en sus equipos. HTTP loopback es solo para
uso local y tests. Esta herramienta puede ejecutar codigo con la cuenta del host:
no presentarla como segura para redes/equipos no confiables ni como sandbox OS.

### G. API de presentacion y acciones admitidas

Definir DTOs seguros en `src/web/contracts.ts`, mapeos en `dto.ts` y handlers en
`routes.ts`. API `/api/v1` independiente del CLI v1; sobre estable con version,
data o error.code/message. No enviar stacks, paths absolutos de artefactos,
configuracion, secretos o estructuras internas enteras por serializacion directa.

| Ruta | Operacion |
| --- | --- |
| POST /login, GET /session, POST /logout | Login, estado/CSRF, revocacion. Sin descubrimiento publico de configuracion. |
| GET /tasks, POST /tasks | Listado paginado y creacion idempotente; contractId proporcionado como UUID para replay. |
| GET /tasks/:id | Estado, versiones, resumen, fuentes seleccionadas y acciones permitidas. |
| GET /tasks/:id/messages, /sources, /documents, /operations | Paginas acotadas; documentos por ID/version, operaciones por requestId. |
| POST /tasks/:id/operations | Solo reply/search/fetch-source/generate-plan/generate-todo. Recibo 202 al admitir. |
| POST /tasks/:id/brief, /plan-comments, /plan-approval | Confirmacion/feedback/aprobacion corta con requestId y revisiones exactas. |
| POST /tasks/:id/operations/:operationId/cancel, /recover | Cancelar activo o recuperar intento abandonado explicitamente. |
| GET /tasks/:id/execution/preview | Preview del TODO actual, sin efectos; mostrar digest y contenido autorizado. |
| POST /tasks/:id/execution | Inicio via host con GuidedStartRequest exacto. |
| GET /tasks/:id/execution, /execution/events | Progreso y eventos persistidos, con cursores. |
| GET /tasks/:id/execution/resume-preview | Solo decisiones realmente permitidas para el estado actual. |
| POST /tasks/:id/execution/resume, /execution/cancel | Resume con revision/digest/decision; cancel activo via host. Cancel waiting tambien requiere preview/revision exactos. |

En rutas anidadas comprobar que todo ID pertenece al contrato del workspace y que
el run es precisamente su execution.runId. No llamar getRunView/listRunEvents con
un runId arbitrario aportado por el browser. El acceso autenticado no elimina la
comprobacion de pertenencia.

`changes-review` solo ofrece lectura y cancelacion explicita: no continue,
retry-task ni cierre/QA ficticios. Ajustar el guard de previewResume/resume si hoy
la enumeracion generica de waiting ofrece mas acciones; probar backend, no solo UI.

Errores esperados: 400 invalid-input, 401 session-required, 403 forbidden,
404 unknown-target, 409 stale/busy/consumed, 413 too-large, 429 rate-limit,
503 capability-unavailable; 500 generico para fallo interno. No convertir un fallo
model/Git en HTTP 200 con status completed. Las operaciones ya admitidas muestran
su estado failed/cancelled en sus consultas, aunque la admision fuera 202.

Paginacion por defecto 20, maximo 50; sin cargar todos los logs/chats. Poll cada
2 s mientras hay operacion, 10 s en reposo; una solicitud pendiente por recurso,
backoff hasta 30 s en fallo. Al reconectar, refetch por IDs/cursores/revisiones y
no duplicar mensajes. No porcentajes estimados ni claims de progreso por tokens.

## Portabilidad y compatibilidad que NO pueden romperse

- Schema 15 preserva 001-014 y todos los datos anteriores. Nuevas tablas se
  relacionan por contractId y no agregan paths/workspace operativos duplicados.
- Export bloquea requests de preparacion pending/running. Historial terminado,
  fuentes breves y preparaciones sin operacion activa viajan en el backup SQL.
- La portabilidad actual acepta schema 14 de forma estricta. Ampliar soporte
  explicitamente a 14 y 15, manteniendo package version 1 y comprobando que
  manifest.schemaVersion coincide con DB real. Un paquete 14 antiguo se valida
  e importa como 14; el runtime activo migra despues. No migrar dentro de inspect.
- Export nuevo emite schema real 15. La version anterior del programa no tiene
  que leer schema 15; debe rechazarlo, no degradarlo. Nunca afirmar compatibilidad
  hacia adelante ni desactivar validacion de schemas desconocidos.
- Normalizacion/rebase de campos existentes, linaje, hashes, ownership y backups
  mantienen sus garantias. Probar retorno A -> B -> A con la conversacion nueva.
- No borrar ni hacer purge de conversaciones/fuentes en este hito. No indexacion
  semantica, RAG ni memoria entre tareas. Fuentes y resumen son de esta tarea.

## Lista de tareas

### Fase 1: Preparacion y contratos

- [x] **Tarea 1.1: Aprobar decisiones y verificar baseline**
  - **Archivo:** `TODO.md`, `docs/web-workflow-vision.md` para registro, sin codigo.
  - **Funciones:** ninguna.
  - **Descripcion:** revisar Lectura rapida: token por arranque, TLS LAN, Brave opcional, dependencias y Chromium. Confirmar schema 14/015 libre. Registrar baseline y aprobacion de implementacion. El anterior TODO de portabilidad sigue en HEAD; su cabecera obsoleta no cambia el cierre acreditado en docs.
  - **Evitar:** instalar, iniciar listener, usar datos/HOME/credenciales reales o incluir cambios ajenos. Si el owner no aprueba una propuesta, ajustar el TODO antes de seguir.
  - **Verificacion:** `git status --short`; `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`. Reportar fallos previos sin arreglos laterales.
  - **Commit Msg:** `docs: approve personal web implementation scope`

- [x] **Tarea 1.2: Preparar build web y dependencias minimas**
  - **Archivo:** `package.json`, `pnpm-lock.yaml`, `tsconfig.build.json`, `.gitignore`; nuevos `scripts/build-web.mjs`, `src/web/client/index.html`, `src/web/client/main.tsx`, `src/web/client/styles.css`, `src/web/client/assets.d.ts`.
  - **Funciones:** buildWeb, entrada React minima y scripts build:web/build:server/test:web.
  - **Descripcion:** runtime: react-dom en version compatible exacta con React actual, ipaddr.js y parse5. Dev: esbuild, @types/react-dom y @playwright/test. Verificar engines/peers Node >=22 antes de fijar versiones; no actualizar otros paquetes. Build cliente con esbuild browser/ESM, CSS separado, sin source maps publicos. build ejecuta tsc server y build:web; excluir cliente del emit Node, mantenerlo en typecheck. Assets en dist/web, no dist/src; incluirlos en package.files. No bundle Linux/Windows.
  - **Evitar:** Vite/Next/SSR, CDN, gestor de estado, CSS framework, dev server LAN, dependencias implicitas o un esbuild transitorio de tsx como dependencia no declarada. Ignorar solo reportes propios de Playwright.
  - **Verificacion:** `pnpm run typecheck`; `pnpm run build`; comprobar assets propios generados y que el bundle no incluye Node, Pi, SQLite ni config. No npm pack ni instalacion de release.
  - **Commit Msg:** `build: add a minimal React browser bundle`

- [x] **Tarea 1.3: Definir preparacion guiada y contrato HTTP**
  - **Archivo:** nuevos `src/application/guided-preparation.ts`, `src/workflows/guided-preparation.ts`, `src/web/contracts.ts`; `src/application/ports.ts`; nuevo `test/guided-preparation-contracts.test.ts`.
  - **Funciones:** parsers/schemas de requests, respuestas planner y DTOs; operaciones permitidas; puertos GuidedPreparationStore/PublicSourceReader.
  - **Descripcion:** contratos B/C/G, refs de fuentes, CAS, recibos y prompts acotados. Reusar TaskContractBrief/Plan/Todo y sus parsers. Limites: usuario 4 KiB, respuesta conversacional 16 KiB, fuentes 16 KiB cada una, maximo 50 fuentes por tarea; candidatos plan/TODO usan limites Hito 2. No transformar keywords del chat en acciones aprobadas.
  - **Evitar:** schemas de futuros tickets/diffs, framework de jobs, codigo LLM ejecutable o exponer tipos de puertos/ArtifactReference completos al navegador.
  - **Verificacion / TDD:** JSON invalido, campo extra, source ID inventado, perfil no read-only, prompt demasiado grande y version obsoleta; validacion de plan/TODO existentes. `pnpm exec vitest run test/guided-preparation-contracts.test.ts test/task-contract.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: define guided preparation and web contracts`

### Fase 2: Datos y fuentes

- [x] **Tarea 2.1: Persistir conversacion y publicaciones atomicas**
  - **Archivo:** nuevo `src/storage/migrations/015-guided-preparation.ts`; `src/storage/migrations/index.ts`, `src/storage/sqlite-run-store.ts`, `src/application/ports.ts`, `test/migrations.test.ts`; nuevo `test/guided-preparation-persistence.test.ts`.
  - **Funciones:** createGuidedPreparation, begin/finishGuidedPreparationRequest, confirmGuidedBrief, decisiones cortas idempotentes, paginas de mensajes/fuentes y recuperacion CAS.
  - **Descripcion:** tablas C y transacciones de creacion, admision, cierre/publicacion. Reutilizar helpers de TaskContract sin transacciones anidadas. Guardar revisions/owner/profile. Cambio externo de contrato durante generacion registra conflicto sin publicar. No tener datos de preparacion sin contrato ni duplicar mensaje/aprobacion por replay.
  - **Evitar:** editar migraciones previas, llamadas de red/driver dentro de SQL, fallback a documento vigente al fallar JSON, eliminar historia o compartir tablas legacy con tipos no soportados por sus CHECK.
  - **Verificacion / TDD:** v14 -> v15 conserva datos; FK; CAS; doble solicitud; rollback de publicacion; comentario invalida aprobacion; brief cubre secuencia; contrato consumido inmutable; recuperacion sin owner vivo. `pnpm exec vitest run test/guided-preparation-persistence.test.ts test/task-contract-persistence.test.ts test/migrations.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: persist versioned guided conversations`

- [x] **Tarea 2.2: Mantener portabilidad de schema 14 y 15**
  - **Archivo:** `src/application/portability.ts`, `src/application/portability-operations.ts`, `src/storage/sqlite-portability.ts`, `src/storage/sqlite-run-store.ts`; `src/portability/directory-package.ts` solo validacion manifest/schema; `test/portability-contracts.test.ts`, `test/portability-persistence.test.ts`, `test/sqlite-portability.test.ts`, `test/portability-integration.test.ts`.
  - **Funciones:** schema de manifest, assertSchema soportado, normalize/inspect/activatePortableBackup, inspectPortabilityBlockers y conteos/estado del backup real.
  - **Descripcion:** compatibilidad definida arriba. Import 14 sin migracion implicita; export 15 con schema real. Incluir nuevas tablas por backup SQL, bloquear operacion de preparacion pendiente y preservar IDs/fuentes/mensajes. Mantener retorno y rebasing de workspace existente.
  - **Evitar:** cambiar package version 1, aceptar cualquier version numerica, modificar hashes de paquetes antiguos, perder conversaciones o reactivar un dataset exported para consultar desde la web.
  - **Verificacion / TDD:** paquete fixture 14 importable; manifest/DB mismatch rechazado; paquete 15 viaja A -> B -> A con chat/fuentes; pending bloquea; futura version rechazada. `pnpm exec vitest run test/portability-contracts.test.ts test/portability-persistence.test.ts test/sqlite-portability.test.ts test/portability-integration.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: preserve transfer compatibility for guided conversations`

- [ ] **Tarea 2.3: Consultar fuentes publicas con proteccion SSRF**
  - **Archivo:** nuevo `src/research/public-sources.ts`; nuevo `test/public-sources.test.ts`.
  - **Funciones:** createPublicSourceReader, search, readUrl, validacion URL/DNS/IP y extraccion de texto acotado.
  - **Descripcion:** implementar D usando https nativo, ipaddr.js y parse5. Endpoint Brave fijo, IP fijada al conectar, certificado normal, sin redirects/proxies/cookies. Clave solo en header al endpoint autorizado. Transporte/resolucion inyectables estrechamente para tests sin red real.
  - **Evitar:** fetch que vuelva a resolver DNS despues del check, permitir IP privada via IPv6/redirect, abrir LAN, parser HTML por regex, headers secretos en errores o curl/Pi para conseguir red.
  - **Verificacion / TDD:** DNS mixto publico/privado, rebinding, mapped IPv6, link-local, userinfo, puerto/esquema, redirect, limite/timeout/abort, script HTML y busqueda sin clave. Ningun test abre red publica. `pnpm exec vitest run test/public-sources.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: add bounded public source research`

### Fase 3: Aplicacion y owner

- [x] **Tarea 3.1: Coordinar chat, plan y TODO con el planner read-only**
  - **Archivo:** nuevo `src/application/guided-preparation-operations.ts`; `src/workflows/guided-preparation.ts`, `src/application/guided-execution-operations.ts`, `src/storage/sqlite-run-store.ts`; nuevo `test/guided-preparation-operations.test.ts`; `test/guided-execution-operations.test.ts`.
  - **Funciones:** createGuidedPreparationService, ejecucion de request, confirmacion de brief, publicacion de plan/TODO y guard de handoff con preparacion.
  - **Descripcion:** usar AgentDriver y puertos sin importar adapters. Una llamada por operacion, perfil validado/snapshot y contexto acotado. Fuentes y chat no aprueban. Hand-off exige preparacion confirmada tambien por servicio y transaccion, sin afectar contratos legacy sin chat. Filtrar/enforzar resume permitido de changes-review.
  - **Evitar:** cambiar core, ampliar allowlist Pi, reusar approveAndExecutePreparation legacy, pasar transcript al builder, tratar texto de fuente como autoridad o marcar completed cuando falla persistencia.
  - **Verificacion / TDD:** falso driver/source reader; chat -> confirmar -> plan -> aprobar -> TODO; nuevo mensaje o comentario invalida gate; stale/consumed; cancel/failure; replay; no escritura del workspace ni builder antes de inicio; changes-review no reanuda implementacion. `pnpm exec vitest run test/guided-preparation-operations.test.ts test/guided-execution-operations.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: coordinate guided preparation with explicit approvals`

- [x] **Tarea 3.2: Unificar la ranura del host sin cambiar comportamiento**
  - **Archivo:** `src/application/execution-host.ts`; `test/execution-host.test.ts`, `test/execution-host-integration.test.ts`.
  - **Funciones:** estado ActiveExecution/ActiveGuidedExecution, admision y finishClose.
  - **Descripcion:** refactor aislado a una ranura discriminada, conservando recibos, cancelacion, replays, consultas admitidas y closure de legacy/guided. Sin agregar aun preparacion ni API HTTP.
  - **Evitar:** cola, scheduler, herencia, segundo contexto o corregir APIs no relacionadas en el mismo commit.
  - **Verificacion:** ejecutar antes/despues `pnpm exec vitest run test/execution-host.test.ts test/execution-host-integration.test.ts`; `pnpm run typecheck`. No modificar expectativas para ocultar regresiones.
  - **Commit Msg:** `refactor: centralize hosted operation ownership`

- [x] **Tarea 3.3: Exponer preparacion y consultas bajo el mismo host**
  - **Archivo:** `src/application/service.ts`, `src/application/runtime.ts`, `src/application/execution-host.ts`; `src/application/context.ts` solo dependencias necesarias; `test/application-runtime.test.ts`, `test/execution-host.test.ts`, `test/execution-host-integration.test.ts`; nuevo `test/guided-preparation-host.test.ts`.
  - **Funciones:** composition root y capacidad guidedPreparation; admission/receipts/cancel/recover; getters seguros de contratos/documentos vinculados.
  - **Descripcion:** una apertura de recursos y dataDir lease. Componer fuentes privadamente y proteger solicitudes breves con admitQuery. Extender la ranura con preparation; capturar requests antes de awaits. Recibo persistido temprano, operacion y cleanup retenidos hasta fin. Getters comprueban contrato/workspace y run vinculado.
  - **Evitar:** entregar facade completa/resources al servidor, abrir SQLite por peticion, ejecutar dos modelos a la vez, hacer close sincronico sin esperar operaciones o relajar lock para CLI concurrente.
  - **Verificacion / TDD:** A envia y se desconecta; B consulta; chat/guided/legacy comparten busy; cancelar/close durante red o driver espera limpieza; replay una sola llamada; exported/busy no abre. `pnpm exec vitest run test/guided-preparation-host.test.ts test/application-runtime.test.ts test/execution-host.test.ts test/execution-host-integration.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: host guided preparation independently of browser requests`

### Fase 4: Servidor e interfaz

- [x] **Tarea 4.1: Crear listener y sesiones seguras de un usuario**
  - **Archivo:** nuevos `src/web/config.ts`, `src/web/auth.ts`, `src/web/server.ts`; nuevo `test/web-server.test.ts`.
  - **Funciones:** parseWebConfig, createWebAuth, createWebServer/start/close y despacho explicito de assets/login/session/logout.
  - **Descripcion:** implementar F, limites de HTTP, sesiones, rate limit, Origin/Host/CSRF, TLS LAN y headers de seguridad. Inyectar reloj/token factory solo en tests. El server recibe cliente de host, no lo abre. El owner externo coordina cierre del listener y host.
  - **Evitar:** token en URL/env/DB, sesiones permanentes, HTTP LAN sin TLS, cookies JS, auto certificados, CORS comodin, filesystem routing, log de peticiones o confianza en proxy headers.
  - **Verificacion / TDD:** login/logout/TTL/rate-limit; Host/Origin/CSRF, cuerpo/headers invalido o grande, path traversal y sin sesion no hay datos; bind LAN sin TLS rechaza antes de escuchar. Listener de tests solo loopback puerto efimero. `pnpm exec vitest run test/web-server.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: add authenticated personal HTTP server`

- [x] **Tarea 4.2: Conectar rutas versionadas con operaciones admitidas**
  - **Archivo:** nuevos `src/web/routes.ts`, `src/web/dto.ts`; `src/web/server.ts`, `src/web/contracts.ts`; nuevo `test/web-api.test.ts`.
  - **Funciones:** matchRoute, handleTaskRequest, DTOs de documentos/recibos/progreso y error mapping.
  - **Descripcion:** tabla G mediante llamadas explicitas. Validar body/query/path, IDs y pertenencia. 202 al admitir; no abort por response close. Aprobar e iniciar ligan revisiones/digest. Cancel waiting usa resume decision cancel con preview del usuario, no recomputado silenciosamente. Progreso/artifacts se proyectan sin rutas internas.
  - **Evitar:** application[method], endpoint generico ejecutar comando, GET mutante, mapear toda excepcion a 200, serializar ArtifactReference entero o permitir IDs de otro contrato/workspace.
  - **Verificacion / TDD:** doble click; revision obsoleta; ID de otro contrato; auth antes de consultar; schema estricto; cancellation no se confunde con desconexion; no secretos/paths en DTO; recuperar lost response por requestId. `pnpm exec vitest run test/web-api.test.ts test/cli-protocol.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: expose guarded guided-task web endpoints`

- [x] **Tarea 4.3: Construir pantallas de tarea y seguimiento**
  - **Archivo:** nuevos `src/web/client/App.tsx`, `api.ts`, `Login.tsx`, `TaskList.tsx`, `Preparation.tsx`, `Execution.tsx`; `main.tsx`, `styles.css` y `assets.d.ts` de la Tarea 1.2; nuevo `test/web-client.test.tsx`.
  - **Funciones:** cliente fetch tipado, polling/cancel del fetch de vista, navegacion por hash/taskId, formularios y vistas A/G.
  - **Descripcion:** login, tareas, chat/fuentes/resumen, plan/TODO/preview y progreso. Hash sirve para recuperar tarea, no credenciales. Mostrar versiones y bloqueos; conservar requestId mientras se reconcilia un envio ambiguo. Poll acotado y accesible; pause/recarga de pagina no cancela backend. Contenido como texto o elementos React construidos, no HTML crudo.
  - **Evitar:** editor de codigo/diffs/QA, datos o tokens en localStorage, submit doble con nuevo ID, polling superpuesto, renderer HTML inseguro, porcentajes inventados o borrar borrador al fallar red.
  - **Verificacion / TDD:** `pnpm exec vitest run test/web-client.test.tsx`: cliente fetch conserva requestId ante respuesta perdida y render de texto malicioso queda escapado (react-dom/server solo en test). `pnpm run typecheck`; `pnpm run build`. Scripts/estilos externos compatibles con CSP, sin imports backend. La aceptacion interactiva completa se verifica en Tarea 5.1, no se declara probada por este test.
  - **Commit Msg:** `feat: add personal guided-task browser interface`

- [x] **Tarea 4.4: Agregar serve y shutdown ordenado**
  - **Archivo:** nuevo `src/application/web-runtime.ts` como composicion HTTP si necesario, nuevo `src/cli/commands/serve.ts`; `src/cli/index.ts`, `src/application/runtime.ts`; nuevo `test/web-lifecycle.test.ts`; `test/cli-protocol.test.ts`.
  - **Funciones:** openPersonalWebServer, registerServeCommand y lifecycle comun de arranque/fallo/senales.
  - **Descripcion:** serve usa root --config/--cwd y --web-config, abre una vez host/resources, imprime URL/codigo en stderr y espera cierre. Sin --json/--jsonl: rechazo antes de abrir/leer credenciales. Validar web config antes de dataDir; si falla listen, cerrar host. web-runtime es solo composition root, nunca use case; mantener la excepcion de boundaries limitada a este archivo si se crea.
  - **Evitar:** daemonize, proceso en background automatico, navegador autoabierto, process.exit durante cleanup, cerrar SQLite antes de requests/promesas, servir dataset exporting/exported o dejar sockets vivos tras error.
  - **Verificacion / TDD:** signal durante chat/builder/request breve; segundo signal espera; EADDRINUSE libera recursos; cliente desconectado no para; export concurrente busy y tras close permitido. `pnpm exec vitest run test/web-lifecycle.test.ts test/cli-protocol.test.ts test/portability-process.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: run the personal web server with ordered shutdown`

### Fase 5: Validacion y cierre

- [ ] **Tarea 5.1: Probar el recorrido con navegador y limites de arquitectura**
  - **Archivo:** nuevos `playwright.config.ts`, `test/web/browser.e2e.ts`, `test/web/fixture-server.ts`, `test/web/fixtures/localhost-cert.pem`, `test/web/fixtures/localhost-key.pem`; `test/architecture-boundaries.test.ts`; `package.json` script test:web definitivo.
  - **Funciones:** fixtures de host/driver/red falsos con SQLite/Git/artefactos reales temporales; tests en dos contextos de Chromium.
  - **Descripcion:** login -> chat con fuente -> confirmar -> plan -> comentar/regenerar -> aprobar -> TODO -> iniciar -> cerrar A -> consultar B -> waiting/changes-review. Testear reenvio y obsolescencia, texto malicioso, logout y error HTTP. Certificados son fixtures publicos exclusivos de tests, no los del usuario. Usar browser.e2e.ts fuera de test/e2e para que no se recoja por Vitest normal ni Pi e2e.
  - **Evitar:** credenciales reales, red publica, bind LAN de pruebas, screenshots como unica asercion, deps OS con privilegios, live Pi o nuevos helpers de produccion para facilitar tests.
  - **Verificacion:** tras instalacion aprobada, `pnpm run test:web`; `pnpm exec vitest run test/architecture-boundaries.test.ts test/web-server.test.ts test/web-api.test.ts test/web-lifecycle.test.ts`. Boundaries: browser no importa Node/aplicacion/adapters; HTTP no SQLite/Pi/artifacts; use cases no web; exceptions solo composition roots nombrados. Si no hay Chromium, reportar bloqueo, no declarar UI verificada.
  - **Commit Msg:** `test: verify the personal web journey across browser sessions`

- [x] **Tarea 5.2: Documentar configuracion LAN y limites comprobados**
  - **Archivo:** nuevo `docs/personal-web.md`; `README.md` solo inicio/enlace; `docs/web-workflow-vision.md`, `docs/task-contract.md`, `docs/data-portability.md` solo contratos nuevos/compatibilidad; `AGENTS.md` solo reflejar el alcance aprobado de web y dependencias de presentacion.
  - **Funciones:** ninguna.
  - **Descripcion:** documentar token por arranque, cert/key y confianza TLS, red interna/firewall manual, perfil planner, clave Brave externa, caps, sesion, versiones, reintento y cierre antes de export. Actualizar Hito 4 solo con evidencia; aclarar chat nuevo vs legacy y paquete schemas14/15. Dar guia manual de otro equipo LAN sin abrirlo durante tests.
  - **Evitar:** afirmar sandbox, busqueda disponible sin clave, autenticacion estable tras reinicio, compatibilidad hacia adelante de backups, ejecucion que sobrevive apagar host o hitos 5/6 hechos.
  - **Verificacion:** `pnpm exec prettier --check docs/personal-web.md docs/web-workflow-vision.md docs/task-contract.md docs/data-portability.md README.md AGENTS.md`; revisar comandos contra help/test:web. Registrar prueba real LAN como pendiente si solo se probaron dos contextos locales; no presentar eso como prueba desde otro equipo.
  - **Commit Msg:** `docs: describe personal web access and preparation guarantees`

- [ ] **Tarea 5.3: Pasar regresion y entregar evidencia de cierre**
  - **Archivo:** `TODO.md` y `docs/web-workflow-vision.md` para resultados; correcciones solo en archivos previamente autorizados, con commit funcional separado si hiciera falta.
  - **Funciones:** ninguna nueva.
  - **Descripcion:** checks finales, inspeccion del diff y recorrido LAN por el operador antes de declarar acceso LAN comprobado. Mantener visible cualquier limite de plataforma/red/modelo. No ejecutar builds de distribucion.
  - **Evitar:** arreglos ajenos, silenciar tests, incrementar timeouts sin causa, marcar el hito entero hecho si falta la aceptacion requerida o esconder regresion de portabilidad/CLI/TUI.
  - **Verificacion:** `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`; `pnpm run test:web`; `git diff --check`; `git status --short`. Probar old CLI JSON/JSONL y roundtrip 14/15 mediante tests existentes/extendidos, no datos reales. Registrar resultados exactos.
  - **Commit Msg:** `docs: record verified personal web milestone results`

## Criterios de aceptacion global

### Preparacion y ejecucion

- [ ] Chat/fuentes/brief sobreviven cambio de navegador; fuentes no autorizan acciones.
- [ ] Plan y TODO salen del planner read-only, con versiones y confirmacion humana.
- [ ] Doble envio no duplica mensajes, agentes, aprobaciones ni runs.
- [ ] Desconexion no cancela; boton Cancelar y shutdown si limpian ordenadamente.
- [ ] Implementacion termina esperando revision, sin ejecutar QA/cierre fuera de scope.

### Seguridad y compatibilidad

- [ ] Sesion/Origin/Host/CSRF, SSRF y rendering seguro probados con casos negativos.
- [ ] LAN usa TLS/codigo, un workspace fijo y ninguna API de terminal/config/FS.
- [ ] CLI/TUI y claims/leases siguen protegidos; no segundo contexto durante serve.
- [ ] Paquetes schema14 siguen importables y schema15 conserva conversaciones/fuentes.
- [ ] Suite completa y navegador pasan; aceptacion LAN/modelos/plataformas se describe
      segun evidencia real, sin confundir tests simulados con integracion live.

## Reglas de operacion

1. Un check a la vez; no ejecutar N+1 hasta cerrar N con evidencia. Commit atomico
   con archivos explicitos. No git add ., cambios ajenos, commits vacios o RED.
2. No instalar nada ni usar modelos, red publica, certificados, datos o HOME reales
   por inferencia. La aprobacion de implementacion cubre solo dependencias y
   Chromium indicados; no apt, bundles, releases, nuevos drivers ni infraestructura.
3. Tests con tmpdirs propios y listeners loopback. No cambiar firewall, DNS, Git
   config, perfiles o credenciales del operador para hacer pasar pruebas.
4. No nueva abstraccion o archivo fuera de tareas sin desviacion aprobada. No DAG,
   scheduler, cola, plugin, memoria, daemon ni implementacion paralela de workflows.
5. Al terminar, conservar documentacion/evidencia; solicitar confirmacion antes
   de retirar este TODO con `git rm -- TODO.md` y commit
   `docs: retire completed personal web plan`. No borrar TODOs o artefactos de runs.

## Protocolo de desviacion

```text
ALERTA DE DESVIACION DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <contratos, archivos y verificaciones>
Propuesta: <ajuste minimo solicitado>
```

Detenerse sin check si schema015 esta ocupado, falta una decision de seguridad,
una dependencia no soporta Node declarado, el modelo exige herramientas de
escritura, la migracion rompe paquetes14 o un fallo existente impide lifecycle
seguro. No corregirlo silenciosamente ni reducir la garantia para seguir.

## Registro de planificacion

- Orden actual: ejecutar la implementacion autorizada del Hito 4, una tarea cada vez.
- Baseline observado: worktree con los cambios previstos en `TODO.md` y
  `docs/web-workflow-vision.md`, sobre `945322c fix: harden portability process boundaries`.
- El TODO anterior de Hito 3.5 era tracked y conserva su contenido en ese commit;
  blob `92165c2269bb7a02b7d4f0fe2101050ec75f9220`. Su estado real de completado esta
  documentado en `docs/data-portability.md` y el roadmap.
- Tarea 1.1 aprobada: decisiones de acceso, TLS, Brave opcional, dependencias y
  Chromium autorizadas para la implementacion. Schema vigente 14; schema 15 libre.
- Verificacion Tarea 1.1: `format:check`, `lint`, `typecheck`, `test` (64 archivos,
  407 tests, 1 omitido) y `build` pasan. No se hicieron arreglos laterales.
- Tarea 1.2 completada: React/react-dom, ipaddr.js, parse5, esbuild, Playwright y
  tipos declarados; build web separado en `dist/web` sin source maps ni imports de
  Node, Pi o SQLite.
- Tarea 1.3 completada: contratos estrictos de requests/respuestas, límites, perfil
  planner read-only, prompt acotado, puertos y DTOs web; 10 tests enfocados pasan.
- Tarea 2.1 completada: migración aditiva 015, persistencia de preparaciones,
  mensajes, fuentes y requests idempotentes con CAS; 7 tests enfocados pasan.
- Tarea 2.2 completada: manifiestos y copias SQLite aceptan schema 14 y 15, las
  exportaciones nuevas emiten 15 y se comprueba que el manifiesto coincide con DB;
  13 tests de portabilidad pasan.
- Tarea 2.3 completada: lector HTTPS de fuentes con DNS/IP fijados, protección SSRF,
  sin redirecciones, límites de tamaño, identidad de codificación y extracción HTML
  con parse5; 6 tests sin red real pasan.
- Tarea 3.1 completada: servicio guiado coordina chat, fuentes, confirmación, plan,
  aprobación y TODO con perfil planner read-only; el preflight de ejecución bloquea
  preparaciones sin brief confirmado.
- Tarea 3.2 completada: el host usa una ranura discriminada única para ejecuciones
  legacy y guided, conservando replays, cancelación, consultas y cierre ordenado;
  22 tests enfocados pasan.
- Tarea 3.3 completada: runtime y fachada componen la preparación guiada, el lector
  de fuentes y el mismo store/lease; el host admite preparación y espera su cleanup;
  30 tests enfocados pasan.
- Tarea 4.1 completada: configuración web estricta, TLS obligatorio fuera de loopback,
  código de arranque, sesiones HttpOnly con TTL, rate limit, CSRF, headers y assets
  explícitos; 3 tests enfocados pasan.
- Tarea 4.2 completada: rutas `/api/v1` autenticadas para tareas, detalle, mensajes,
  fuentes y operaciones; DTOs sin estado interno y errores tipados; 5 tests enfocados
  pasan.
- Tarea 4.3 completada: cliente React con login, lista/hash de tareas, formulario de
  preparación, refresco acotado y manejo de errores como texto; typecheck y build web
  pasan.
- Tarea 4.4 completada: comando `web` compone runtime, host y listener, y ante SIGINT/
  SIGTERM cierra primero el listener y después el host/SQLite; build completo pasa.
- Tarea 5.1 en progreso: se añadieron fixture Playwright, prueba de navegador y
  boundaries; la aceptación Chromium queda bloqueada porque no está instalado el
  ejecutable local (`pnpm exec playwright install` requiere aprobación explícita).
- Tarea 5.2 completada: `docs/personal-web.md`, README y visión web documentan
  configuración loopback/LAN, TLS, código efímero, límites, contratos y evidencias
  sin afirmar validación remota.
- Siguiente accion: instalar Chromium con aprobación y ejecutar `pnpm run test:web`;
  después registrar la regresión final como Tarea 5.3.
