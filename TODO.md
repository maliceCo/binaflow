# PLAN DE EJECUCION: Convergencia Web, TUI y CLI antes de revision de codigo

> **ATENCION SUB-AGENTE:** Seguir las tareas en orden, solo tras autorizacion de
> implementacion. Cada tarea exige verificacion y commit propio. Ante una
> desviacion, detenerse y pedir un ajuste del plan. El Hito 4 local esta cerrado;
> la orden vigente prioriza la convergencia de contratos y alcances de Web, TUI y
> CLI antes de iniciar los Hitos 5/6. El handoff sigue siendo obligatorio, pero su
> aceptacion A/B queda retenida despues de esta fase. No invocar modelos ni
> modificar datos, configuracion o certificados reales del usuario.

## Lectura rapida para aprobar

**Estado:** Hitos 1, 2, 3, 3.5 y el Hito 4 web local estan implementados. El E2E
web legacy y `test/cli-protocol.test.ts`, registrados antes como fallos, pasaron
aisladamente durante esta planificacion; la regresion completa se repite en la
Tarea 5.25 y no se declara verde por inferencia.

**Objetivo base completado:** entrar desde un navegador, explorar una tarea,
aprobar plan/TODO, iniciar ejecucion y recuperar progreso entre navegadores.

**Objetivo inmediato:** establecer `TaskContract` + `guided-preparation` +
`guided-task-build` como flujo canonico de tareas nuevas, compartir una proyeccion
de aplicacion entre interfaces, eliminar los DTO duplicados del API web y publicar
que operaciones soporta realmente cada superficie sin fingir paridad visual.

**Objetivo retenido:** transferir despues el ownership de un proyecto entre dos
servidores personales mediante handoff A -> B, nunca sincronizacion bidireccional.
El codigo de transporte ya implementado no se elimina ni se convierte en sync;
su happy path y hardening quedan trazados en la Fase 5E.

### Decisiones ya acordadas

- Un usuario y un solo proyecto activo por proceso. El launcher puede catalogar
  varios proyectos, pero solo abre un ApplicationContext/dataDir a la vez.
- El modo actual por proyecto se conserva como compatibilidad; el launcher es la
  entrada normal sin JSON manual y nunca escanea libremente el filesystem.
- La web llama a aplicacion; no envuelve CLI/TUI ni abre SQLite por peticion.
- El servidor posee el trabajo, no la conexion HTTP. Cerrar una pestana o hacer
  logout no cancela un agente.
- El flujo guiado de contratos es la ruta canonica para tareas nuevas. Los
  workflows `plan-build*`, `todo-build-qa` y `research-plan-build` permanecen
  compatibles como ejecuciones directas/legacy, sin migracion destructiva ni una
  segunda evolucion paralela para los Hitos 5/6.
- Compartir contrato significa compartir estado, schemas de negocio, comandos y
  vistas de aplicacion. HTTP v1 y CLI protocol-v1 conservan envelopes distintos;
  React, Ink y texto conservan renderizadores distintos.
- Web sera la superficie rica para diff estructurado, comentarios por linea y
  edicion manual. TUI y CLI tendran alcances explicitos y no incorporaran un
  editor embebido para simular capacidades HTML.
- Git sincroniza codigo. El estado Binaflow cambia de propietario mediante handoff
  A -> B o B -> A; no hay merge de SQLite ni dos owners activos. Este bullet se
  conserva como requisito importante aunque su validacion quede en la fase 5E.
- Los hitos 5 y 6 conservan diffs editables, comentarios por linea, QA y cierre.
  La ejecucion guiada sigue acabando en `waiting/changes-review`.

### Propuestas tecnicas que se aprueban junto con este TODO

- **Interfaz:** React existente + react-dom; build pequeno con esbuild. Sin
  Next.js, SSR, router externo, framework CSS, WebSockets ni service worker.
- **Servidor:** HTTP/HTTPS nativo de Node y rutas explicitas; Ajv existente para
  validar. `binaflow web` permanece en primer plano, sin daemon ni servicio OS.
- **Acceso web:** codigo aleatorio de acceso generado al arrancar, introducido en
  un formulario y canjeado por cookie de sesion. La UI HTTP sigue limitada a
  loopback; exponer el navegador en LAN/VPN exige HTTPS con certificado/clave del
  operador.
- **Handoff LAN experimental:** el transporte peer puede usar HTTP en una LAN
  privada solo mediante opt-in explicito, para peers emparejados y con advertencia
  persistente de que no ofrece confidencialidad. Conserva firmas Ed25519, nonce,
  timestamp, proteccion replay, revocacion, hashes y limites. No habilita la UI web
  por HTTP en LAN ni se presenta como seguro para redes no confiables. TLS queda
  como modo recomendado y requisito para eliminar la etiqueta experimental.
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

- [x] **Tarea 2.3: Consultar fuentes publicas con proteccion SSRF**
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

### Fase 5A: Aceptacion del Hito 4 base

- [x] **Tarea 5.1: Probar el recorrido con navegador y limites de arquitectura**
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

- [x] **Tarea 5.3: Registrar el hallazgo manual como extension separada**
  - **Archivo:** `TODO.md`.
  - **Funciones:** ninguna nueva.
  - **Descripcion:** conservar 5.1/5.2 como cierre verificable del Hito 4 y convertir la friccion observada al crear `binaweb.json` durante la prueba manual en una extension funcional posterior. El archivo local de prueba no es parte del producto, no se versiona y desaparece de la operacion normal al completar 5.5/5.6. Ejecutar la regresion global local en 5.17 antes de retomar la validacion A/B.
  - **Evitar:** presentar el launcher/handoff como bug del Hito 4, mezclar el JSON local en un commit, reabrir tareas terminadas o empezar implementacion durante esta reorganizacion.
  - **Verificacion:** `pnpm exec prettier --check TODO.md`; `git diff --check`.
  - **Commit Msg:** `docs: promote manual web feedback into the launcher plan`

### Fase 5B: Extension surgida de la prueba manual

La extension empieza en 5.4. Hasta completar 5.5 sigue siendo valido arrancar el
modo existente con `--web-config`; no importar, borrar ni depender del
`binaweb.json` local usado durante la aceptacion. Las pruebas deben crear sus
settings en tmpdirs. La regresion global de la app local se ejecuta en 5.17; las
pruebas de handoff se ejecutan despues de la convergencia, en la fase 5E.

- [x] **Tarea 5.4: Fijar contratos del launcher, catalogo y transferencia**
  - **Archivo:** nuevo `src/web/launcher-contracts.ts`; `src/web/contracts.ts`; nuevo `test/web-launcher-contracts.test.ts`.
  - **Funciones:** parseLauncherSettings, parseProjectCatalog, parseDeviceRecord, parsePeerTransferRequest y DTOs publicos de proyecto/dispositivo/transferencia.
  - **Descripcion:** definir schemas version 1 cerrados para configuracion global, raices autorizadas, proyectos locales, identidad estable de proyecto, dispositivos emparejados, ownership `active/exporting/exported/importing` y recibos de transferencia. Las rutas locales, dataDir, claves, certificados y paths de paquetes permanecen en records privados y nunca entran en DTOs del browser o del peer. Fijar limites de nombres, entradas, tamanos y estados antes de implementar I/O. Un projectId viaja con la transferencia; cada equipo conserva workspace/configPath/dataDir propios.
  - **Evitar:** migrar SQLite, reutilizar IDs de TaskContract como projectId, exponer paths absolutos, crear un protocolo generico de sincronizacion, permitir dos owners activos o aceptar campos futuros desconocidos.
  - **Verificacion / TDD:** casos validos y rechazo de campos extra, IDs invalidos, ownership imposible, limites excedidos y DTOs con secretos/paths. `pnpm exec vitest run test/web-launcher-contracts.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: define personal launcher and handoff contracts`

- [x] **Tarea 5.5: Arrancar la web sin JSON preparado por el usuario**
  - **Archivo:** `src/web/config.ts`, nuevo `src/web/settings-store.ts`, `src/web/server.ts`, `src/cli/commands/web.ts`, `src/cli/index.ts`; nuevos `test/web-settings-store.test.ts`, `test/web-bootstrap.test.ts`; `test/cli-protocol.test.ts`.
  - **Funciones:** resolveDefaultWebSettingsPath, loadOrBootstrapWebSettings, saveWebSettingsAtomically y modo launcher de registerWebCommand.
  - **Descripcion:** `binaflow web` sin `--cwd`, `--config` ni `--web-config` arranca en `127.0.0.1:4317` con settings `setupRequired`, codigo efimero y sin abrir ningun proyecto/dataDir. Resolver la ruta global por plataforma (`XDG_CONFIG_HOME`/HOME en Linux y APPDATA en Windows) con dependencias inyectables en tests. Conservar `--web-config` como override avanzado y aceptar `--cwd`/`--config` solo como proyecto inicial explicito del mismo launcher. Persistir JSON estricto mediante temp+rename, permisos privados cuando sean soportados y last-known-good; un fallo de escritura no altera la configuracion activa. Rechazar `--json/--jsonl` antes de leer settings o abrir recursos.
  - **Evitar:** crear configuracion dentro del cwd por defecto, abrir SQLite durante bootstrap, autoabrir navegador, bind LAN inicial, inferir certificados, guardar codigo/sesion en disco o leer HOME real en tests.
  - **Verificacion / TDD:** primer arranque sin archivos, segundo arranque reutilizable, override explicito, config corrupta, write/CAS fallido, permisos y compatibilidad del modo de proyecto existente. `pnpm exec vitest run test/web-settings-store.test.ts test/web-bootstrap.test.ts test/cli-protocol.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: bootstrap the personal web launcher without manual JSON`

- [x] **Tarea 5.6: Crear el asistente web de configuracion local y LAN**
  - **Archivo:** `src/web/routes.ts`, `src/web/server.ts`, `src/web/config.ts`, `src/web/client/api.ts`; nuevos `src/web/client/Setup.tsx`, `src/web/client/Settings.tsx`; `src/web/client/App.tsx`, `styles.css`; nuevos `test/web-settings-api.test.ts`, `test/web-settings-client.test.tsx`.
  - **Funciones:** endpoints GET/PUT `/api/v1/settings`, validateWebSettingsPreview, importTlsMaterial y pantallas Setup/Settings.
  - **Descripcion:** tras login, `setupRequired` muestra un wizard para nombre del equipo, local/LAN, host, puerto, origin, raices de proyecto y TLS. Las operaciones que amplian roots o importan PEM solo se admiten desde socket loopback; el PEM se envia con limite estricto, se valida como cert/key coincidentes, se guarda fuera del JSON con 0600 y nunca se devuelve. HTTP solo loopback; LAN exige HTTPS. Mostrar preview, errores y `restartRequired`; guardar no reinicia el proceso ni derriba el listener actual. Tras reinicio cargar la nueva configuracion o volver a last-known-good si no es valida.
  - **Evitar:** HTTP LAN, certificado autofirmado automatico, clave privada en DTO/log/localStorage, CORS, editar perfiles/agentes desde esta pantalla, aplicar cambios de red parcialmente o permitir configuracion sensible desde un cliente LAN.
  - **Verificacion / TDD:** wizard local, CSRF/Origin, request remoto rechazado para roots/TLS, PEM invalido o demasiado grande, cert/key no coincidentes, settings desconocidos, rollback y render accesible sin HTML crudo. `pnpm exec vitest run test/web-settings-api.test.ts test/web-settings-client.test.tsx test/web-server.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: configure personal web access through a guarded wizard`

- [x] **Tarea 5.7: Persistir proyectos locales y navegar raices autorizadas**
  - **Archivo:** nuevos `src/web/project-catalog.ts`, `src/web/project-browser.ts`; `src/web/settings-store.ts`, `src/web/routes.ts`, `src/web/dto.ts`; nuevos `test/project-catalog.test.ts`, `test/project-browser.test.ts`, `test/web-project-routes.test.ts`.
  - **Funciones:** FileProjectCatalog list/add/remove, listProjectDirectory y registerProjectFromDirectory.
  - **Descripcion:** catalogo global version 1 con escritura atomica y projectId estable. El explorador lista un nivel por request mediante rootId+segmentos relativos, solo directorios y marca si existe `.binaflow/config.json`; paginar y ordenar de forma determinista. En setup local puede elegir nuevas raices desde roots del sistema detectadas por plataforma; tras setup solo navega dentro de roots guardadas. Cada hop usa realpath y comprueba containment. Registrar valida config/workspace sin abrir SQLite, evita duplicados por path canonico/projectId y conserva rutas solo server-side. Eliminar del catalogo no borra repo, config, dataDir ni historial.
  - **Evitar:** selector HTML de carpeta del equipo cliente, path absoluto aportado por HTTP, `..`, symlink escape, recorrido recursivo, lectura de archivos, scan de todo el disco, abrir dataDir al listar o devolver rutas locales al browser.
  - **Verificacion / TDD:** roots Linux/Windows simuladas, paginacion, path traversal y encoding, symlink fuera de root, config ausente/invalida, duplicado, remove no destructivo y ninguna apertura SQLite. `pnpm exec vitest run test/project-catalog.test.ts test/project-browser.test.ts test/web-project-routes.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: add guarded host project discovery and catalog`

- [x] **Tarea 5.8: Poseer un unico proyecto activo en el launcher**
  - **Archivo:** nuevo `src/application/web-runtime.ts`; `src/application/runtime.ts`, `src/application/execution-host.ts`; `src/web/project-catalog.ts`; nuevos `test/web-project-lifecycle.test.ts`, `test/execution-host.test.ts`.
  - **Funciones:** createPersonalWebRuntime, selectProject, closeActiveProject y ExecutionHost.getLifecycleState.
  - **Descripcion:** el listener/auth/settings/catalogo viven sin ApplicationContext. Seleccionar un proyecto abre exactamente un ApplicationContext+ExecutionHost y adquiere su dataDir lease; publicar el proyecto activo solo tras apertura completa. Como maximo un proyecto activo por proceso y una operacion mutante global. Cambiar/cerrar exige host idle; busy devuelve estado tipado sin cancelar. Cierre ordenado: dejar de admitir HTTP, esperar queries, cerrar operacion/host, SQLite y lease. Dos sesiones observan el mismo proyecto activo. Fallar al abrir el destino deja el launcher utilizable y sin owner parcial; no reabre silenciosamente el anterior.
  - **Evitar:** cache de hosts por proyecto, agentes paralelos entre proyectos, SQLite por request, cerrar un proyecto con operacion activa, exponer ActiveOperation, robar leases o convertir el launcher en daemon.
  - **Verificacion / TDD:** seleccionar A, consultar desde dos clientes, cambiar idle a B, rechazo busy, config invalida, dataDir ocupado, fallo de apertura y shutdown durante query/operacion. `pnpm exec vitest run test/web-project-lifecycle.test.ts test/execution-host.test.ts test/application-runtime.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: own one active project in the personal launcher`

- [x] **Tarea 5.9: Construir selector y estado de proyectos en la web**
  - **Archivo:** `src/web/routes.ts`, `src/web/dto.ts`, `src/web/server.ts`; nuevos `src/web/client/Projects.tsx`, `src/web/client/ProjectBrowser.tsx`; `src/web/client/App.tsx`, `api.ts`, `styles.css`; nuevos `test/web-project-api.test.ts`, `test/web-project-client.test.tsx`.
  - **Funciones:** GET `/api/v1/projects`, GET `/projects/current`, POST `/projects/:id/select`, POST `/projects/current/close` y flujo visual agregar/abrir/cambiar.
  - **Descripcion:** despues de login/setup mostrar proyectos registrados, owner local/remoto, disponibilidad, version Git resumida y proyecto activo sin revelar paths. Agregar usa navegacion manual de 5.7. Seleccionar/cambiar requiere CSRF, projectId catalogado y confirmacion visible; 409 busy conserva la vista y explica la operacion activa. La cabecera muestra siempre equipo y proyecto activos. Si otra sesion cambia el proyecto, polling no solapado detecta activeProjectRevision y reconcilia la navegacion. Sin proyecto activo, las rutas de tareas devuelven estado tipado, no 500.
  - **Evitar:** workspace/configPath en hash o localStorage, selector de archivos del cliente, IDs arbitrarios, cambio automatico por abrir una URL, ocultar busy, mezclar tareas de dos proyectos o mantener formularios del proyecto anterior tras un switch.
  - **Verificacion / TDD:** agregar, seleccionar, dos navegadores, switch remoto, busy, proyecto invalido/eliminado, logout y render de nombres maliciosos como texto. `pnpm exec vitest run test/web-project-api.test.ts test/web-project-client.test.tsx test/web-project-routes.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: add the browser project launcher experience`

- [x] **Tarea 5.10: Emparejar servidores con identidad y revocacion explicitas**
  - **Archivo:** nuevos `src/web/device-identity.ts`, `src/web/peer-auth.ts`; `src/web/settings-store.ts`, `src/web/server.ts`, `src/web/routes.ts`, `src/web/dto.ts`; nuevos `src/web/client/Devices.tsx`; `src/web/client/api.ts`, `Settings.tsx`; nuevos `test/device-identity.test.ts`, `test/peer-auth.test.ts`, `test/web-device-api.test.ts`.
  - **Funciones:** loadOrCreateDeviceIdentity, beginPairing, answerPairingChallenge, confirmPeerFingerprint y revokePeer.
  - **Descripcion:** generar una identidad Ed25519 por instalacion, guardar private key separada con 0600 y derivar deviceId de la public key. El modo confiable empareja manualmente por URL HTTPS, codigo aleatorio de un uso con TTL/intentos acotados y confirmacion de fingerprint/nombre en ambos equipos. Registrar public key, origin y certificado/fingerprint fijado; peticiones peer usan challenge, nonce, timestamp y firma, no cookie web. Revocar invalida nuevas solicitudes pero conserva historial. Solo LAN/VPN alcanzable; sin mDNS, relay, cuenta cloud ni sesiones compartidas. La excepcion HTTP experimental, su warning y la confirmacion manual de fingerprint se delimitan en 5.13.
  - **Evitar:** enviar private key, codigo en URL/log, desactivar verificacion TLS global, confiar solo en IP/nombre, HTTP entre equipos fuera del opt-in experimental de 5.13, pairing permanente, aceptar replay/clock skew ilimitado o emparejar automaticamente por descubrimiento.
  - **Verificacion / TDD:** handshake feliz entre dos servidores loopback TLS, codigo incorrecto/expirado/reusado, fingerprint cambiado, firma/replay invalido, revocacion y archivos privados. Usar reloj/crypto/rutas inyectados y certificados fixture. `pnpm exec vitest run test/device-identity.test.ts test/peer-auth.test.ts test/web-device-api.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: pair personal Binaflow servers securely`

- [x] **Tarea 5.11: Transferir ownership reutilizando portabilidad existente**
  - **Archivo:** nuevos `src/application/project-transfer.ts`, `src/web/peer-transfer.ts`, `src/web/transfer-journal.ts`; `src/application/portability-operations.ts`, `src/config.ts`, `src/application/config-operations.ts`, `src/application/web-runtime.ts`, `src/web/server.ts`; nuevos `test/project-transfer.test.ts`, `test/peer-transfer.test.ts`, `test/transfer-journal.test.ts`; ampliar `test/portability-integration.test.ts`.
  - **Funciones:** previewProjectTransfer, startProjectTransfer, resumeProjectTransfer, receiveProjectTransfer y generateUpdatedDataDirConfiguration.
  - **Descripcion:** orquestar un handoff A->B, nunca sync. Preflight exige source activo/idle, Git limpio, branch+HEAD exactos, peer/version compatibles, target workspace catalogado y espacio/limites aceptables. Reusar preview/export/package/inspect/import y lineage actuales; no duplicar formato ni hashes. El source exporta con requestId/digest estable y queda `exported`; el target verifica el paquete completo, importa a dataDir nuevo administrado y actualiza `dataDir` del config mediante sourceHash+replace atomico antes de abrirlo. Journal global por transferId conserva etapa, digests, bytes y recibos para replay/reanudacion; nunca contiene private keys ni contenido de artefactos. Un fallo tras export deja recovery/resend explicito, no reactiva A ni activa B parcialmente. Git se inspecciona pero no ejecuta fetch/pull/push/checkout/reset. Esta tarea cierra la orquestacion y el adapter local; el transporte entre procesos/equipos se completa en 5.13.
  - **Evitar:** merge SQLite, dos owners activos, cargar paquete en memoria, confiar en Content-Length, endpoints de path arbitrario, modificar Git, importar sobre dataDir existente, reusar otro projectId, auto rollback de `exported` o crear schema 016 sin desviacion aprobada.
  - **Verificacion / TDD:** A->B real con SQLite/Git/artifacts temporales, rangos y reconexion, lost response/replay, hash corrupto, HEAD distinto, target dirty, corte antes/despues de export, config CAS cambiada y lineage B->A. `pnpm exec vitest run test/project-transfer.test.ts test/peer-transfer.test.ts test/transfer-journal.test.ts test/portability-integration.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: hand off active projects between paired servers`

- [x] **Tarea 5.12: Guiar transferencia, progreso y recuperacion desde la web**
  - **Archivo:** `src/web/routes.ts`, `src/web/dto.ts`; nuevos `src/web/client/TransferWizard.tsx`, `src/web/client/Transfers.tsx`; `src/web/client/Projects.tsx`, `App.tsx`, `api.ts`, `styles.css`; nuevos `test/web-transfer-api.test.ts`, `test/web-transfer-client.test.tsx`.
  - **Funciones:** rutas preview/start/status/resume de transfer y wizard seleccionar equipo -> vincular clone target -> preflight -> confirmar -> progreso/recuperar.
  - **Descripcion:** desde el proyecto activo elegir peer emparejado. En destino, notificacion pide seleccionar el clon local mediante el catalogo; nunca permite path remoto. Mostrar checks de version, Git, ejecuciones, tamano, destino y modo de transporte (`TLS` o `LAN experimental sin cifrado`). La confirmacion presenta que A quedara inutilizable y usa transferId/requestId/digest congelados. Progreso usa polling acotado y bytes reales, no porcentajes inventados sin total. Doble click/reload conserva IDs y no duplica export/import. Tras exito, A muestra `Transferido a <equipo>` solo lectura y B abre el proyecto activo. Estados recuperables ofrecen Reanudar o Descargar paquete offline existente; no ofrecen forzar activo.
  - **Evitar:** empezar por seleccionar un peer, esconder blockers, generar IDs nuevos al reintentar, cancelar por cerrar pestana, exponer rutas/manifest sensible, activar target antes del recibo verificado, borrar paquete temporal antes de recovery o ofrecer sync simultaneo.
  - **Verificacion / TDD:** flujo feliz, rechazo humano, doble submit, reload/segunda sesion, peer desconectado, mismatch Git, corte y resume, source exported/target pendiente, retorno B->A y contenido malicioso escapado. `pnpm exec vitest run test/web-transfer-api.test.ts test/web-transfer-client.test.tsx test/project-transfer.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: add guided project handoff to the web launcher`

- [x] **Tarea 5.13: Implementar transporte peer LAN experimental y autenticado**
  - **Archivo:** nuevo `src/web/peer-transport.ts`; `src/web/peer-auth.ts`, `src/web/config.ts`, `src/web/settings-store.ts`, `src/web/server.ts`, `src/application/project-transfer.ts`, `src/web/client/TransferWizard.tsx`; nuevos `test/peer-transport.test.ts`, `test/web-peer-transport.test.ts`; ampliar `test/peer-transfer.test.ts`.
  - **Funciones:** createPeerTransport, validatePeerEndpoint, serveTransferRange, downloadTransferWithResume y closePeerTransport.
  - **Descripcion:** crear un listener peer separado de la UI web. El modo por defecto sigue siendo loopback/off; `lan-experimental` requiere opt-in desde loopback, restart y confirmacion visible de que HTTP no cifra paquetes, nombres ni metadatos. Solo acepta peers ya emparejados, fingerprint Ed25519 confirmado manualmente y destinos resueltos a loopback/RFC1918/ULA; rechaza IP publica, unspecified, multicast, proxy y redirects. Cada request firma metodo, target, transferId, requestId, Range, timestamp, nonce y hash del body; conserva replay/clock-skew/revocacion. Exponer solo preflight, recibos y bytes de un paquete asociado al transferId, con Range/reanudacion, temp privado, limites y digest final. No relajar el servidor del navegador: UI HTTP continua solo loopback y UI LAN/VPN continua exigiendo HTTPS. El modo TLS peer recomendado queda como hardening posterior y no bloquea este MVP experimental.
  - **Evitar:** llamar seguro/cifrado al modo experimental, enviar cookie web/codigo/private key, endpoint de path arbitrario, aceptar peer no emparejado, confiar solo en IP/Content-Length, DNS publico, CORS, auto-discovery, relay, fallback silencioso de HTTPS a HTTP o habilitar LAN por defecto.
  - **Verificacion / TDD:** opt-in/restart, warning, peer firmado feliz sobre listeners loopback HTTP, request sin firma o alterada, nonce repetido, clock-skew, revocado, IP publica, redirect/proxy, Range valido/invalido, corte+resume, digest corrupto, limites y ausencia de paths/secrets en errores. Los tests no abren LAN real. `pnpm exec vitest run test/peer-auth.test.ts test/peer-transfer.test.ts test/peer-transport.test.ts test/web-peer-transport.test.ts test/project-transfer.test.ts`; `pnpm run typecheck`. Evidencia actual: 19 tests enfocados, typecheck, lint dirigido y build:web pasan; TLS peer y LAN real siguen pendientes.
  - **Commit Msg:** `feat: add opt-in authenticated LAN project transport`

### Fase 5C: Prioridad actual - app completa en una computadora

- [x] **Tarea 5.14: Completar onboarding local, roots y apertura de proyecto**
  - **Archivo:** `src/web/routes.ts`, `src/web/settings-store.ts`, `src/web/project-catalog.ts`; `src/web/client/Setup.tsx`, `Settings.tsx`, `ProjectBrowser.tsx`, `Projects.tsx`, `api.ts`, `styles.css`; nuevos `test/web-local-setup-api.test.ts`, `test/web-local-setup-client.test.tsx`; ampliar `test/web-settings-store.test.ts`, `test/project-browser.test.ts`.
  - **Funciones:** listSetupRoots, listSetupDirectory, addAuthorizedProjectRoot y recorrido visual setup -> root -> proyecto -> abrir.
  - **Descripcion:** hacer utilizable el primer arranque sin JSON ni CLI auxiliar. Desde una conexion loopback, el setup lista puntos de partida detectados por el servidor mediante IDs opacos, permite navegar por segmentos, autorizar una carpeta como root, registrar un proyecto que contenga `.binaflow/config.json` y abrirlo. El browser nunca envia ni recibe paths absolutos. `setupRequired` solo pasa a false cuando nombre, configuracion web y al menos un root valido quedan persistidos; despues el usuario puede agregar/quitar roots y proyectos sin borrar archivos. Mostrar claramente proyecto activo, errores de config/dataDir/lease y necesidad de restart.
  - **Evitar:** pedir editar `web.json`, aceptar paths HTTP, usar selector de carpetas del cliente, autorizar `/` implicitamente, escanear recursivamente, abrir SQLite durante browse, ocultar fallo de apertura o mezclar setup con pairing/handoff.
  - **Verificacion / TDD:** primer arranque vacio, seleccionar root por referencias server-side, registrar/abrir proyecto, reload, config ausente/invalida, symlink escape, root duplicado/eliminado, lease ocupado y ninguna ruta absoluta en DTO/HTML/localStorage. Al tocar `test/web-settings-store.test.ts`, retirar su import `chmod` actualmente sin uso para restaurar lint sin cleanup lateral. `pnpm exec vitest run test/web-local-setup-api.test.ts test/web-local-setup-client.test.tsx test/web-settings-store.test.ts test/project-browser.test.ts test/web-project-lifecycle.test.ts`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: complete local launcher onboarding`

- [x] **Tarea 5.15: Completar preparacion guiada de tareas en la web local**
  - **Archivo:** `src/web/routes.ts`, `src/web/dto.ts`; `src/web/client/App.tsx`, `api.ts`; nuevos `src/web/client/TaskCreate.tsx`, `TaskPreparation.tsx`, `TaskSources.tsx`, `TaskPlan.tsx`; nuevos `test/web-local-task-api.test.ts`, `test/web-local-task-client.test.tsx`.
  - **Funciones:** createTask, getTaskDetail, listMessages, listSources y controles para reply/search/fetch-source/confirm-brief/generate-plan/comment-plan/approve-plan/generate-todo/recover-operation.
  - **Descripcion:** reemplazar el panel minimo actual por el recorrido local completo: crear tarea con objetivo, conversar, buscar o leer fuentes opcionales, revisar/confirmar brief, generar y comentar/regenerar plan, aprobar una version y generar TODO. Renderizar mensajes, fuentes, versiones, readiness, blockers y errores estructurados. Cada submit conserva requestId ante respuesta ambigua, deshabilita doble envio y reconcilia por polling acotado; reload/hash recupera la tarea sin repetir operaciones. No se ejecuta builder hasta confirmacion separada de la Tarea 5.16.
  - **Evitar:** textarea unica para todas las fases, inventar revisiones, aprobar automaticamente, enviar transcripts completos al builder, HTML crudo, IDs nuevos al reintentar, busqueda sin clave presentada como disponible o mezclar tareas de proyectos distintos.
  - **Verificacion / TDD:** crear/recargar tarea, reply, search/fetch opcional, confirm brief, generar/comentar/regenerar/aprobar plan, generar TODO, respuesta perdida/doble click, revision stale, contenido malicioso y cambio de proyecto. `pnpm exec vitest run test/web-local-task-api.test.ts test/web-local-task-client.test.tsx test/guided-preparation-operations.test.ts test/guided-preparation-persistence.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: complete local guided task preparation`

- [x] **Tarea 5.16: Completar ejecucion, progreso y revision local**
  - **Archivo:** `src/web/routes.ts`, `src/web/dto.ts`, `src/application/execution-host.ts`; `src/web/client/App.tsx`, `api.ts`; nuevos `src/web/client/TaskExecution.tsx`, `RunProgress.tsx`, `Artifacts.tsx`; nuevos `test/web-local-execution-api.test.ts`, `test/web-local-execution-client.test.tsx`; ampliar `test/execution-host.test.ts`, `test/web-lifecycle.test.ts`.
  - **Funciones:** startTaskExecution, getTaskExecution, resumeTaskExecution, cancelTaskExecution, listRunEvents y listRunArtifacts mediante facade/host existentes.
  - **Descripcion:** desde un TODO aprobado pedir confirmacion visible e iniciar exactamente una ejecucion. Mostrar pasos, estado, eventos acotados, errores y artefactos por IDs/DTOs seguros; nunca leer archivos desde presentation. Reload y una segunda pestana recuperan progreso sin duplicar run. Cancelar usa el shutdown ordenado existente. El recorrido local termina en `waiting/changes-review` y permite consultar resultado/artefactos; no incorpora QA/cierre fuera del scope vigente.
  - **Evitar:** ejecutar al aprobar plan, abrir segundo run, polling solapado, porcentajes inventados, terminal/browser filesystem, leer SQLite o artefactos desde routes/UI, cerrar proyecto busy, ocultar cancelled/interrupted o ampliar el engine con DAG/loops.
  - **Verificacion / TDD:** start unico, doble submit, progreso entre dos pestañas, reload, cancel, interruption/resume admitido, fallo builder, cierre del navegador no cancela, shutdown ordenado, artefacto seguro y estado final waiting/changes-review. `pnpm exec vitest run test/web-local-execution-api.test.ts test/web-local-execution-client.test.tsx test/execution-host.test.ts test/web-lifecycle.test.ts test/guided-execution-persistence.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `feat: complete local guided task execution`

- [x] **Tarea 5.17: Aceptar la app completa en una computadora y cerrar baseline local**
  - **Archivo:** `test/web/local-launcher.e2e.ts`, `test/web/local-launcher-fixture.ts`, `playwright.config.ts`, `test/architecture-boundaries.test.ts`, `package.json`; `README.md`, `docs/personal-web.md`, `docs/web-workflow-vision.md`, `TODO.md`.
  - **Funciones:** fixture de un launcher con SQLite/Git/artefactos temporales y AgentDriver falso determinista; ninguna funcion nueva de producto salvo fixes demostrados por el recorrido.
  - **Descripcion:** verificar en Chromium el viaje de una sola computadora: `binaflow web` sin JSON -> login -> setup/root -> registrar y abrir proyecto -> crear/preparar tarea -> plan/TODO -> confirmar ejecucion -> progreso -> waiting/changes-review -> artefactos -> reload/segunda sesion -> logout/shutdown. Ejecutar tambien un smoke manual sobre un proyecto desechable aprobado por el operador; si Pi/modelo real no se autoriza, registrar que el driver live sigue pendiente sin bloquear el recorrido determinista. Documentar operacion local y limites reales antes de retomar A/B.
  - **Evitar:** mocks que omitan SQLite/Git/artefactos, HOME/datos/credenciales reales, red publica, sleeps fijos, screenshots como unica asercion, declarar Pi/modelos/plataformas live probados o arreglar fallos ajenos sin desviacion.
  - **Verificacion:** `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`; `pnpm run test:web`; pruebas enfocadas de CLI protocol, lifecycle y portabilidad; `git diff --check`; `git status --short`. Registrar fallos previos por separado y no retirar TODO.
  - **Commit Msg:** `test: accept the complete single-computer web app`

### Fase 5D: Convergencia de contratos y superficies antes de los Hitos 5/6

No implementar diff, comentarios por linea, editor de codigo ni QA nuevo en esta
fase. Su objetivo es dejar una sola fuente de verdad y fronteras verificables para
que esos hitos no nazcan tres veces. `guided-task-build` no se agrega al comando
legacy `run`: su coordinador, CAS, documentos y lifecycle siguen siendo la unica
ruta valida para una tarea guiada.

- [x] **Tarea 5.18: Fijar el flujo canonico y la matriz Web/TUI/CLI**
  - **Archivo:** nuevo `docs/interface-capabilities.md`; `docs/web-workflow-vision.md`, `docs/tui-experience.md`, `README.md`, `TODO.md`.
  - **Funciones:** ninguna funcion de codigo; contrato documental version 1 de flujo y superficies.
  - **Descripcion:** declarar `TaskContract` + `guided-preparation` + `guided-task-build` + `guided-execution` como experiencia canonica de tareas nuevas. Registrar por etapa las operaciones semanticas `create`, `prepare`, `approve-plan`, `execute`, `observe`, `resume/cancel`, `review-changes` y `review-qa`. Web soporta la experiencia actual completa hasta `waiting/changes-review` y sera la superficie rica futura; TUI y CLI obtendran en esta fase listado/inspeccion de solo lectura. Los workflows directos existentes siguen ejecutables por CLI/TUI y se etiquetan legacy/directos, sin migrar runs ni borrar preparacion historica. Explicar que los schemas de agente y las vistas de aplicacion son comunes, mientras HTTP v1, CLI protocol-v1 y los renderizadores siguen separados. Fijar que un cliente sin una capacidad no puede avanzar esa etapa y debe indicar la superficie requerida.
  - **Evitar:** prometer diff/QA aun no implementados, llamar deprecated a datos persistidos compatibles, introducir plugins, negociar capacidades con el engine o convertir la matriz en autorizacion de seguridad.
  - **Verificacion:** `pnpm exec prettier --check docs/interface-capabilities.md docs/web-workflow-vision.md docs/tui-experience.md README.md TODO.md`; `git diff --check`.
  - **Commit Msg:** `docs: define canonical workflow surface capabilities`

- [x] **Tarea 5.19: Crear la proyeccion canonica y segura de tarea guiada**
  - **Archivo:** nuevo `src/application/guided-task-view.ts`; `src/application/service.ts`, `src/application/runtime.ts`, `src/application/operations.ts`; nuevo `test/guided-task-view.test.ts`; ampliar `test/application-runtime.test.ts`, `test/architecture-boundaries.test.ts`.
  - **Funciones:** `listGuidedTaskViews`, `getGuidedTaskView`, `toGuidedExecutionProgressView` y tipos `GuidedTaskSummaryView`, `GuidedTaskDetailView`, `GuidedExecutionProgressView`.
  - **Descripcion:** componer desde los puertos existentes de TaskContract, GuidedPreparation y GuidedExecution una vista de lectura independiente de HTTP/Ink/CLI. El summary contiene ID, revision, readiness, phase, headers documentales y run vinculado. El detail agrega brief/draft, plan, revisiones y secuencias de preparacion, mensajes, fuentes, operacion activa y progreso disponible. Mensajes omiten request interno; fuentes omiten contentHash; operaciones omiten requestHash/owner/profile; artefactos omiten `path`; ningun DTO devuelve workspace, configPath o dataDir. Las consultas usan paginacion/limites existentes, no leen archivos y quedan disponibles tanto en `openApplicationContext` como en `openApplicationStorage` usando el mismo `SqliteRunStore` ya abierto.
  - **Evitar:** importar Web/TUI/CLI desde aplicacion, devolver records persistidos completos, duplicar SQL, abrir otro contexto/lease, cambiar schemas SQLite o agregar mutaciones a esta vista.
  - **Verificacion / TDD:** primero crear casos para detalle completo, tarea sin preparacion/ejecucion, paginacion, artefacto sin path y contrato desconocido; luego `pnpm exec vitest run test/guided-task-view.test.ts test/application-runtime.test.ts test/architecture-boundaries.test.ts`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: expose a canonical guided task view`

- [x] **Tarea 5.20: Compartir el contrato HTTP entre servidor y navegador**
  - **Archivo:** nuevo `src/web/api-contract.ts`; `src/web/contracts.ts`, `src/web/dto.ts`, `src/web/launcher-contracts.ts`, `src/web/client/api.ts`; nuevo `test/web-api-contract.test.ts`; ampliar `test/web-launcher-contracts.test.ts`, `test/architecture-boundaries.test.ts`.
  - **Funciones:** tipos puros versionados para envelopes, sesion, settings, proyectos, devices, transferencias, tareas, preparacion y ejecucion; mantener parsers/proyectores en sus modulos actuales.
  - **Descripcion:** mover a un modulo browser-safe las interfaces publicas hoy redeclaradas entre servidor y `client/api.ts`. `TaskDetail` debe incluir explicitamente `preparationRevision`, `lastSequence` y `confirmedSourceIds`, hoy esperados por React pero ausentes de `WebTaskDetailDto`. Reexportar nombres compatibles donde reduzca cambios; `ApiClient`, `fetch`, CSRF y `ApiRequestError` permanecen en el cliente. El contrato puede referenciar las vistas de aplicacion solo mediante `import type`; su bundle no puede contener imports Node, storage, Pi ni filesystem. No cambiar nombres JSON, version 1, opcionalidad ni envelopes en esta tarea.
  - **Evitar:** generar codigo, instalar schema/codegen, mover validacion runtime al navegador, exponer records privados del launcher o aprovechar el movimiento para renombrar campos.
  - **Verificacion / TDD:** probar que servidor y cliente asignan las mismas formas, que los campos requeridos del detail no pueden divergir y que DTOs no contienen paths/secrets; `pnpm exec vitest run test/web-api-contract.test.ts test/web-launcher-contracts.test.ts test/architecture-boundaries.test.ts`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `refactor: share the versioned web api contract`

- [x] **Tarea 5.21: Hacer que la web consuma la proyeccion de aplicacion**
  - **Archivo:** `src/cli/commands/web.ts`, `src/web/routes.ts`, `src/web/dto.ts`, `src/web/server.ts`; `test/web-local-task-api.test.ts`, `test/web-local-execution-api.test.ts`, `test/web-routes.test.ts`, `test/web-bootstrap.test.ts`.
  - **Funciones:** reemplazar `getTaskDetail` y los mapeos manuales por `listGuidedTaskViews`, `getGuidedTaskView` y `toGuidedExecutionProgressView`; estrechar `WebApiCapabilities` a queries/commands necesarias.
  - **Descripcion:** eliminar de `registerWebCommand` el ensamblado manual de contrato, documentos, preparacion, mensajes y fuentes. Las rutas GET de tareas y los resultados de progreso deben proyectarse desde aplicacion; HTTP conserva envelope, status codes, auth y parsers. POST create/operations/start/resume/cancel sigue delegando a los servicios existentes y proyecta su respuesta comun, sin leer SQLite ni artefactos desde routes. Mantener el modo launcher y el modo por proyecto, incluida la compatibilidad de `browser.e2e.ts` cuando settings/proyecto no estan disponibles.
  - **Evitar:** mover auth/CSRF a aplicacion, entregar `ApplicationService` completo a React, cambiar URLs, agregar polling/eventos o tocar comportamiento del workflow.
  - **Verificacion / TDD:** afirmar igualdad exacta de payload entre facade y HTTP, compatibilidad sin launcher y ausencia de paths; `pnpm exec vitest run test/web-local-task-api.test.ts test/web-local-execution-api.test.ts test/web-routes.test.ts test/web-bootstrap.test.ts`; `pnpm exec playwright test test/web/browser.e2e.ts --workers=1`; `pnpm run typecheck`; `pnpm run build:web`.
  - **Commit Msg:** `refactor: serve guided tasks from application views`

- [x] **Tarea 5.22: Exponer inspeccion de tareas guiadas en CLI**
  - **Archivo:** nuevo `src/cli/commands/tasks.ts`; `src/cli/index.ts`, `src/cli/protocol.ts`, `src/cli/commands/common.ts`; nuevos `test/cli-tasks.test.ts`; ampliar `test/cli-protocol.test.ts`, `test/cli-output.test.ts`.
  - **Funciones:** `registerTaskCommands`, presentadores humanos `printGuidedTaskList`/`printGuidedTaskDetail`; reutilizar `openStorageContext` y `writeJsonResult`.
  - **Descripcion:** agregar `binaflow tasks` y `binaflow task <id>` como consultas de solo lectura. Modo humano muestra fase, readiness, documentos, ejecucion y proxima limitacion; `--json` envuelve la vista canonica sin recrear DTOs; `--jsonl` se rechaza antes de abrir storage. No crear, preparar, aprobar, iniciar ni editar tareas desde CLI en esta fase. El comando `workflows --json` y todos sus campos/orden permanecen sin cambios para preservar protocol-v1.
  - **Evitar:** reutilizar DTO Web, leer SQLite/artifacts directamente, incluir paths, abrir driver/modelo, inventar acciones mutantes o convertir CLI en editor.
  - **Verificacion / TDD:** lista vacia/con datos, detail desconocido, salida humana sanitizada, JSON versionado exacto, rechazo JSONL pre-storage y lease unico; `pnpm exec vitest run test/cli-tasks.test.ts test/cli-protocol.test.ts test/cli-output.test.ts`; `pnpm run typecheck`; `pnpm run build`.
  - **Commit Msg:** `feat: inspect guided tasks from the cli`

- [x] **Tarea 5.23: Exponer tareas guiadas de solo lectura en la TUI**
  - **Archivo:** nuevos `src/tui/screens/guided-tasks.tsx`, `src/tui/screens/guided-task.tsx`; `src/tui/model.ts`, `src/tui/reduce.ts`, `src/tui/shell-input.ts`, `src/tui/shell-controller.tsx`, `src/tui/shell-view.tsx`, `src/tui/layout.tsx`; nuevo `test/tui-guided-tasks.test.tsx`; ampliar `test/tui-ink-shell.test.ts`, `test/tui-reduce.test.ts`.
  - **Funciones:** eventos/estado para listar, seleccionar, abrir, refrescar y volver; pantallas `GuidedTasksScreen` y `GuidedTaskScreen` basadas solo en `GuidedTaskSummaryView`/`GuidedTaskDetailView`.
  - **Descripcion:** agregar entrada visible `Guided tasks` y tecla documentada para observar las mismas tareas de la web. Mostrar brief/plan/TODO, revision/readiness, mensajes recientes acotados, fases/tareas, bloqueos y artefactos por metadata, con viewport existente. La pantalla es explicitamente read-only y, al llegar a preparacion o revision rica, indica usar `binaflow web`; no ofrece aprobacion invisible. Las queries usan `ApplicationQueries`, `lifecycle.trackRequest` y el contexto ya montado; navegar, resize o volver no crea owner, driver ni polling. Conservar preparaciones/runs legacy para historial y ejecucion directa, pero etiquetarlos como tales en la presentacion.
  - **Evitar:** copiar `TaskPreparation.tsx`, llamar HTTP desde Ink, parsear JSON/artifacts, leer Git/filesystem, registrar otro `useInput`, mutar guided execution o eliminar pantallas legacy.
  - **Verificacion / TDD:** lista, apertura, tarea sin plan, progreso waiting, texto malicioso, terminal estrecho, retorno con seleccion y ausencia de comandos mutantes; `pnpm exec vitest run test/tui-guided-tasks.test.tsx test/tui-ink-shell.test.ts test/tui-reduce.test.ts`; `pnpm run typecheck`; `pnpm run build`.
  - **Commit Msg:** `feat: inspect canonical guided tasks in the tui`

- [x] **Tarea 5.24: Publicar soporte real por workflow y superficie**
  - **Archivo:** nuevo `src/application/workflow-surface.ts`; `src/application/workflow-operations.ts`, `src/application/operations.ts`, `src/workflows/catalog.ts`; `src/cli/index.ts`, `src/tui/screens/workflows.tsx`, `src/tui/screens/preparation.tsx`, `src/tui/screens/guided-task.tsx`; nuevo `test/workflow-surface-contract.test.ts`; ampliar `test/application-operations.test.ts`, `test/cli-protocol.test.ts`, `test/tui-guided-tasks.test.tsx`.
  - **Funciones:** `WORKFLOW_SURFACE_CONTRACT_VERSION`, `discoverWorkflowSurfaceContracts` y `supportForWorkflowSurface`; tipos cerrados de surface, mode y capabilities.
  - **Descripcion:** publicar un manifiesto separado de `WorkflowDefinition`: workflows directos actuales con CLI/TUI `operate` y Web `unsupported`; `guided-task-build` con Web `operate` hasta changes-review y CLI/TUI `observe`. Capacidades cerradas: `create-task`, `prepare-task`, `approve-plan`, `execute-task`, `observe-execution`, `resume-execution`, `cancel-execution`, `view-change-summary`, `view-structured-diff`, `comment-diff`, `edit-files`, `approve-changes`, `review-qa`, `decide-qa`. Solo anunciar las implementadas; diff/comentarios/edicion/QA siguen ausentes hasta sus hitos. Usar el manifiesto para etiquetas humanas `Guided`, `Direct/legacy`, `Observe only` y mensajes de handoff de interfaz. `discoverWorkflows` y `binaflow workflows --json` no cambian.
  - **Evitar:** persistir la superficie en runs, agregar HTML/Ink al core, filtrar seguridad por UI, convertir capacidades en plugins o afirmar que `unsupported` impide consultar datos historicos.
  - **Verificacion / TDD:** matriz exacta, ningun workflow desconocido anunciado, guided no ejecutable por `run`, etiquetas consistentes y snapshot protocol-v1 intacto; `pnpm exec vitest run test/workflow-surface-contract.test.ts test/application-operations.test.ts test/cli-protocol.test.ts test/tui-guided-tasks.test.tsx`; `pnpm run typecheck`.
  - **Commit Msg:** `feat: declare workflow support by client surface`

- [ ] **Tarea 5.25: Aceptar la convergencia antes de iniciar revision de codigo**
  - **Archivo:** `test/architecture-boundaries.test.ts`; `README.md`, `docs/interface-capabilities.md`, `docs/web-workflow-vision.md`, `docs/tui-experience.md`, `TODO.md`; fixes solo si una verificacion demuestra una desviacion y el owner aprueba ajustar esta tarea.
  - **Funciones:** ninguna nueva; cierre documental y regresion.
  - **Descripcion:** verificar el recorrido existente de Web, la inspeccion de la misma tarea por CLI/TUI y la compatibilidad de workflows directos. Registrar evidencia real y dejar escrito que Hito 5 debe introducir primero un change-set estructurado/versionado en aplicacion; HTML, ANSI y editores son proyecciones de superficie. Confirmar que no existen tipos de tarea/progreso duplicados en `client/api.ts`, que Web no ensambla negocio en `commands/web.ts` y que CLI protocol-v1/persistencia no cambiaron. No retirar codigo legacy ni TODO en este cierre.
  - **Evitar:** implementar diff/QA, corregir flakes aumentando timeouts, ejecutar Pi/modelos reales, construir bundles Linux/Windows o declarar terminal/LAN/plataformas no probadas.
  - **Verificacion:** `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test`; `pnpm run build`; `pnpm run test:web`; `git diff --check`; `git status --short`. Ejecutar tambien `pnpm exec vitest run test/guided-task-view.test.ts test/web-api-contract.test.ts test/cli-tasks.test.ts test/tui-guided-tasks.test.tsx test/workflow-surface-contract.test.ts` para evidencia enfocada.
  - **Commit Msg:** `test: accept shared workflow surface contracts`

### Fase 5E: Handoff retenido - ejecutar despues de la convergencia

- [ ] **Tarea 5.26: Verificar el happy path de handoff A -> B**
  - **Prioridad:** importante pero posterior a 5.25. No es sync y no bloquea la convergencia local.
  - **Archivo:** nuevos `test/web/launcher-transfer.e2e.ts`, `test/web/two-server-fixture.ts`; `playwright.config.ts`, `test/architecture-boundaries.test.ts`, `package.json`; fixes minimos de `src/cli/commands/web-transfer.ts`, `src/web/peer-transport.ts` o UI solo si el happy path los demuestra.
  - **Funciones:** fixture de dos launchers, dos catalogos, dos repos Git y datasets temporales con peer HTTP experimental sobre loopback.
  - **Descripcion:** probar solo el recorrido funcional principal: configurar A/B, mostrar/aceptar warning `lan-experimental`, registrar clones con el mismo projectId, emparejar y confirmar fingerprints, preparar un proyecto activo en A, transferirlo, comprobar A `exported`/solo lectura y B `active` con SQLite, historial y artefactos importados. No incluir aun retorno B -> A ni matriz de fallos.
  - **Evitar:** llamarlo sync, compartir catalogo/dataDir, mocks que omitan SQLite/Git/artefactos, bind LAN real, sleeps fijos, ocultar ausencia de cifrado, modificar Git automaticamente o declarar LAN/TLS remotos probados.
  - **Verificacion:** E2E A -> B en loopback y tests enfocados de composition root/project-transfer. Registrar LAN real y TLS peer como pendientes.
  - **Commit Msg:** `test: verify the project handoff happy path`

- [ ] **Tarea 5.27 [DIFERIDA]: Endurecer y probar recuperacion del handoff**
  - **Prioridad:** no ejecutar hasta que 5.26 este aceptada y el owner promueva esta tarea.
  - **Archivo:** ampliar `test/web/launcher-transfer.e2e.ts`, `test/peer-transport.test.ts`, `test/project-transfer.test.ts`, `docs/data-portability.md`, `docs/personal-web.md`.
  - **Funciones:** ninguna primitiva nueva; completar recovery/resume del protocolo existente.
  - **Descripcion:** cubrir corte/restart durante descarga, Range resume, respuesta perdida, replay, revocacion, peer desconectado, hash/HEAD/Git mismatch, source exported con target pendiente y retorno B -> A. Documentar paquete offline, downtime y limites. TLS peer permanece hardening separado salvo promocion explicita.
  - **Evitar:** sync bidireccional, merge SQLite, auto rollback de exported, forzar active, ampliar alcance con relay/cloud/NAT traversal, convertir estos tests en bloqueo retroactivo de la app local o afirmar seguridad/confidencialidad del HTTP experimental.
  - **Verificacion:** tests de recovery deterministas en loopback, regresion de portabilidad A -> B -> A, suite completa y documentacion segun evidencia.
  - **Commit Msg:** `test: harden project handoff recovery`

## Criterios de aceptacion global

### Preparacion y ejecucion

- [ ] Chat/fuentes/brief sobreviven cambio de navegador; fuentes no autorizan acciones.
- [ ] Plan y TODO salen del planner read-only, con versiones y confirmacion humana.
- [ ] Doble envio no duplica mensajes, agentes, aprobaciones ni runs.
- [ ] Desconexion no cancela; boton Cancelar y shutdown si limpian ordenadamente.
- [ ] Implementacion termina esperando revision, sin ejecutar QA/cierre fuera de scope.

### Seguridad y compatibilidad

- [ ] Sesion/Origin/Host/CSRF, SSRF y rendering seguro probados con casos negativos.
- [ ] La UI HTTP solo escucha loopback; exponer la UI en LAN/VPN exige TLS/codigo,
      un proyecto activo y ninguna API de terminal o FS general.
- [ ] En fase 5E, el handoff HTTP `lan-experimental` exige opt-in, red privada,
      peer emparejado, firmas/replay/revocacion y warning de ausencia de
      confidencialidad; no bloquea la aceptacion local de 5.17.
- [ ] Configuracion sensible, opt-in experimental y ampliacion de roots solo se
      admiten desde loopback.
- [ ] CLI/TUI y claims/leases siguen protegidos; no segundo contexto durante web.
- [ ] Paquetes schema14 siguen importables y schema15 conserva conversaciones/fuentes.
- [ ] Suite completa y navegador pasan para el baseline de una computadora;
      aceptacion Pi/modelos/plataformas live se describe segun evidencia real.

### Launcher local - bloquea la aceptacion 5.17

- [ ] `binaflow web` arranca en loopback sin exigir JSON, proyecto ni dataDir.
- [ ] Setup permite autorizar roots, registrar y abrir proyecto sin paths ni JSON manual.
- [ ] El catalogo guarda rutas localmente y el browser solo usa rootId/segmentos.
- [ ] Cambiar proyecto falla con 409 si existe una operacion activa.
- [ ] La web permite crear/preparar tarea, aprobar plan/TODO, ejecutar una vez y
      recuperar progreso/artefactos hasta `waiting/changes-review`.
- [ ] Reload, segunda pestana, logout y shutdown conservan lifecycle y persistencia.

### Convergencia de interfaces - bloquea el inicio del Hito 5

- [ ] Web, TUI y CLI consumen `GuidedTaskView` para observar una tarea guiada.
- [ ] `src/web/client/api.ts` no redeclara payloads ya definidos por el servidor.
- [ ] La composicion web no ensambla documentos/preparacion en `commands/web.ts`.
- [ ] CLI/TUI anuncian y ejecutan solo su alcance real; no ofrecen editor ni
      aprobacion de diff inexistentes.
- [ ] Workflows directos y runs persistidos conservan compatibilidad; guided task
      no se agrega al comando generico `run`.
- [ ] HTTP v1 y CLI protocol-v1 conservan sus envelopes y campos actuales.
- [ ] Hito 5 queda obligado a partir de change-set estructurado/versionado en
      aplicacion, nunca de HTML, ANSI o JSON creado por cada UI.

### Handoff retenido - importante, no bloquea la aceptacion local

- [ ] El happy path A -> B conserva projectId/lineage, verifica Git y deja un solo
      owner activo; nunca se presenta como sync.
- [ ] Pairing confiable usa TLS; el modo experimental exige codigo efimero,
      fingerprint confirmado manualmente y firmas sin compartir sesiones.
- [ ] Recovery, replay, revocacion, retorno B -> A y TLS peer permanecen trazados
      en 5.27 hasta promocion explicita.

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

- Estado actualizado para la convergencia: 5.4-5.24 permanecen completadas;
  5.25 es el cierre de convergencia previo a revision, 5.26 queda retenida y
  5.27 diferida. Las Tareas 5.19-5.24 conservan solo lectura, contratos
  compartidos y proyecciones, sin cambios de schema ni mutaciones nuevas.
- Evidencia enfocada de planificacion: `pnpm exec playwright test
  test/web/browser.e2e.ts --workers=1` paso (1 test) y `pnpm exec vitest run
  test/cli-protocol.test.ts` paso (16 tests). Los fallos registrados contra
  `c90077d` no se reprodujeron aislados; no se afirma regresion completa verde
  hasta ejecutar la Tarea 5.25.
- Chromium ya esta disponible. La Tarea 2.3 se marca completada conforme a su
  registro previo, el adapter presente y sus seis tests actuales pasando.
  El detalle vigente esta en docs/web-workflow-vision.md.
- Origen de la extension: una prueba manual necesito crear `binaweb.json` y pasar
  `--web-config`; el archivo de prueba fue eliminado a peticion del owner y nunca
  se versiono. El producto final debe arrancar sin ese paso.
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
- Tarea 5.1 completada: `pnpm exec playwright install chromium` y `pnpm run
  test:web` pasan; el recorrido usa dos contextos de navegador. Tambien pasan
  los boundaries y las pruebas web/CLI/portabilidad enfocadas.
- Tarea 5.2 completada: `docs/personal-web.md`, README y visión web documentan
  configuración loopback/LAN, TLS, código efímero, límites, contratos y evidencias
  sin afirmar validación remota.
- Regresion previa del Hito 4: `format:check`, `lint`, `typecheck`, `build` y
  `pnpm run test` pasaron (70 archivos, 428 tests, 1 omitido). Tras instalar
  Chromium, `pnpm run test:web` tambien pasa.
- Tarea 5.3 completada: el feedback manual queda separado como extension 5.x y la
  regresion completa local se ejecutara en 5.17, sin incluir configuracion real.
- Tarea 5.4 completada: contratos version 1 estrictos para settings, catalogo,
  devices, ownership, transferencias y DTOs sin paths/secrets; 4 tests enfocados y
  typecheck pasan.
- Tarea 5.5 completada: `binaflow web` sin override usa settings globales con
  bootstrap loopback efimero, persistencia atomica/CAS/last-good y no abre contexto
  de proyecto si no se solicita uno; 22 tests enfocados y typecheck pasan.
- Tarea 5.6 completada: API y pantallas de setup/settings, cambios sensibles solo
  desde loopback, importacion de TLS fuera del JSON y compatibilidad legacy; 12
  tests enfocados, typecheck, build:web y test:web pasan.
- Tarea 5.7 completada: catalogo atomico local, registro no destructivo, explorador
  paginado de un nivel, containment con realpath y rutas rootId/segmentos sin paths;
  8 tests enfocados, lint y typecheck pasan.
- Tarea 5.8 completada: `ExecutionHost` expone lifecycle y el runtime web selecciona
  un unico contexto, rechaza cambios busy y limpia destinos fallidos; 28 tests
  enfocados y typecheck pasan. La composicion HTTP completa se conecta al catalogo
  y la identidad del dispositivo en las tareas 5.9/5.10.
- Tarea 5.9 completada: rutas seguras de catalogo/directorios/seleccion y pantallas
  React de proyectos con referencias de servidor, busy tipado y sin paths en DTOs;
  10 tests enfocados, typecheck y build:web pasan.
- Tarea 5.10 completada: identidad Ed25519 con archivos privados, pairing efimero,
  fingerprints, firmas nonceadas, replay/clock-skew/revocacion y API/UI de devices;
  11 tests enfocados, lint, typecheck y build:web pasan.
- Tarea 5.11 completada: journal atomico, transferencia por streaming/reanudacion,
  preflight, importacion con lineage y CAS de configuracion sobre portabilidad
  existente; 5 tests enfocados y typecheck pasan.
- Tarea 5.12 completada: DTOs seguros sin rutas, endpoints preview/start/status/resume,
  wizard con IDs persistidos, confirmacion explicita, polling acotado y recovery;
  5 tests web enfocados, typecheck y build:web pasan.
- Tarea 5.13 completada: transporte peer separado de la UI con opt-in LAN
  experimental, firmas Ed25519, nonce/timestamp/replay/revocacion, endpoints de
  manifest/Range, reanudacion por archivo, limites y validacion de IP privada;
  19 tests enfocados, typecheck, lint dirigido y build:web pasan. TLS peer y LAN
  real permanecen pendientes y no se consideran cubiertos.
- Prework de handoff completado antes de reordenar prioridades: `pnpm run
  build:web`, `pnpm run test:web` (1 E2E) y 28 tests enfocados pasaron; el
  composition root conecta `PeerTransport`, `receiveProjectTransfer` y la API.
  Se conserva para 5.26/5.27 y no sustituye la aceptacion funcional local.
- Tareas 5.14-5.16 completadas: onboarding server-side sin paths, creacion y
  preparacion guiada, preview/start/cancel de ejecucion, progreso y artefactos DTO.
  Commits `1fe10df`, `4c44ef9` y `8002fab`; lint, typecheck, build:web y tests
  enfocados pasan. El polling de operaciones conserva requestId ante timeout.
- Tarea 5.17 completada: `test/web/local-launcher.e2e.ts` arranca `binaflow web`
  real con SQLite, Git, artefactos temporales y un Pi falso determinista; Chromium
  cubre setup, root, proyecto, preparacion, plan/TODO, preview, ejecucion y
  revision `waiting`. `pnpm run test:web`, typecheck, build web y tests enfocados
  pasan. Pi/modelos live, smoke manual y LAN/TLS siguen pendientes.
- La confirmacion de brief debia reconciliar la revision reservada por la admision;
  el ajuste conserva CAS, idempotencia y el flujo directo probado por los tests.
- Tarea 5.18 completada: `docs/interface-capabilities.md` fija el flujo canonico,
  la matriz Web/TUI/CLI, el comportamiento ante capacidades ausentes y la
  separacion entre schemas/vistas comunes y contratos de adapter. No cambia
  codigo, protocolos, persistencia ni workflows directos compatibles.
- Tarea 5.19 completada: `guided-task-view.ts` compone vistas seguras de
  contratos, preparacion y ejecucion para los contextos completo y storage-only;
  tests cubren detalle, ausencia de estado, paginacion, contrato desconocido y
  eliminacion de campos privados. No abre otro lease, agrega SQL ni mutaciones.
- Tarea 5.20 completada: `src/web/api-contract.ts` centraliza los tipos HTTP
  versionados para servidor y navegador; los aliases legacy conservan nombres y
  los parsers, DTO projections, fetch, CSRF y errores permanecen en sus adapters.
  Se verifican campos de detalle, browser-safety y ausencia de paths/secrets.
- Tarea 5.21 completada: Web usa `taskViews` de aplicación para listas, detalle,
  mensajes, fuentes y progreso; se eliminó el ensamblado manual de
  `registerWebCommand`, se mantuvieron envelopes/auth/CSRF/URLs y el E2E local
  pasa usando la misma proyección.
- Tarea 5.22 completada: CLI expone `tasks` y `task <id>` en modo humano y
  JSON versionado, reutiliza `openStorageContext` y las vistas canónicas, y
  rechaza JSONL antes de abrir storage sin agregar mutaciones guiadas.
- Tarea 5.23 completada: TUI incorpora la entrada `Guided tasks`, selección,
  apertura, refresco y retorno usando `GuidedTaskView` mediante el contexto
  existente; la pantalla es observación segura y remite a Web para mutaciones.
- Tarea 5.24 completada: el manifiesto versionado de superficie distingue
  workflows directos/legacy de `guided-task-build`, publica capacidades cerradas
  por Web/TUI/CLI y no anuncia diff, comentarios, edición ni QA inexistentes.
- Siguiente accion: ejecutar Tarea 5.25 como cierre de convergencia; no
  iniciar Hito 5, 5.26 ni 5.27 antes de aceptar la convergencia en 5.25.
