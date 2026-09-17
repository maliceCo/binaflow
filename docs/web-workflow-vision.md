# Binaflow web: objetivo e hitos

Estado: los Hitos 1, 2, 3, 3.5 y 4 estan implementados en su alcance local.
El recorrido completo del launcher del Hito 4 pasa en Chromium con un Pi falso,
SQLite, Git y artefactos temporales. Chromium ya esta instalado; la indicacion
anterior de que faltaba estaba desactualizada.
La revision contra `c90077d` encontro una regresion al cargar tareas en el modo
web anterior y un timeout CLI en suite. Durante la planificacion de convergencia,
`browser.e2e.ts` y `test/cli-protocol.test.ts` pasaron aislados; la suite completa
aun debe repetirse y no se declara verde por inferencia.
El handoff web entre servidores sigue con aceptacion pendiente; no confundirlo
con la portabilidad offline ya completada en 3.5. LAN/TLS entre equipos y modelos
reales siguen siendo validaciones del operador. Los hitos 5 y 6 del roadmap
(revision de codigo y QA/cierre) permanecen pendientes.

## Objetivo

Una web personal para explorar un problema con un LLM, aprobar un plan, delegar
su ejecucion y revisar codigo y QA con control humano. La web complementa al CLI
y la TUI; no los sustituye ni los utiliza como intermediarios.

## Contrato De Superficies

La experiencia canonica de tareas nuevas es `TaskContract` ->
`guided-preparation` -> `guided-task-build` -> `guided-execution`. La Web es su
superficie rica: el baseline actual cubre el recorrido hasta
`waiting/changes-review`. Llegar a ese estado no implementa todavia diff,
comentarios, editor ni QA/cierre.

La matriz versionada de operaciones `create`, `prepare`, `approve-plan`,
`execute`, `observe`, `resume/cancel`, `review-changes` y `review-qa` esta en
[capacidades de las interfaces](interface-capabilities.md). Durante la Fase 5D,
TUI y CLI solo reciben listado e inspeccion de tareas guiadas. Sus workflows
directos/legacy siguen compatibles, pero no forman una segunda implementacion
del flujo canonico.

Los schemas de agente y las vistas de aplicacion son comunes. HTTP v1, CLI
protocol-v1 y los renderizadores React, Ink y texto conservan contratos propios.
Una superficie sin una capacidad no avanza esa etapa y dirige al usuario a la
Web; la matriz no sustituye la autorizacion de aplicacion.

## Decisiones acordadas

- Un solo usuario inicialmente, con acceso desde distintos equipos. El launcher
  puede catalogar varios proyectos, pero solo uno esta activo por proceso.
- Repositorio, Pi y Binaflow en una maquina anfitriona activa; normalmente fija,
  con traslado explicito a otro equipo para viajar y retorno al regresar.
  No trabajar simultaneamente sobre ambas copias ni fusionarlas automaticamente.
- Cerrar el navegador no cancela el trabajo. Otro navegador recupera el estado.
  Esto no significa que el trabajo sobreviva sin interrupcion a una caida del
  servidor: ese caso requiere recuperacion segura.
- Modelos capaces para explorar, planificar y revisar; un modelo mas economico
  para ejecutar instrucciones precisas. La seleccion permanece en perfiles.
- Conversar o comentar nunca equivale a aprobar cambios.

## Flujo deseado

1. **Exploracion:** chat sobre el problema y sus alternativas; consulta del
   repositorio e internet, sin editar codigo.
2. **Planeacion:** plan breve con archivos afectados y motivos. El usuario puede
   comentar y refinarlo durante varias interacciones antes de aprobarlo.
3. **TODO detallado:** convertir lo aprobado en `TODO.md`, con tareas, limites y
   verificaciones suficientemente precisos para el modelo ejecutor.
4. **Ejecucion:** avance visible por tarea y fase; commit automatico por fase
   verificada. Ante un bloqueo, avisar, pausar y esperar una decision.
5. **Revision de cambios:** resumen y diff real por archivo, con explicaciones
   fuera del codigo. Permitir comentarios y ediciones manuales; el LLM revisa
   ese parche con su contexto antes de la aprobacion.
6. **QA:** buscar bugs y problemas de buenas practicas y arquitectura. Mostrar
   tickets con lineas, evidencia, explicacion y solucion. Cada ticket permite
   conversar para entenderlo, autorizar su correccion, descartarlo o aceptar el
   riesgo; no es obligatorio corregir todos.
7. **Correcciones:** generar `QA_TODO.md` solo con soluciones autorizadas. El
   modelo economico las ejecuta y se verifica el resultado.
8. **Cierre:** ofrecer otra revision completa opcional. Si se solicita, volver
   a QA; si no, aprobacion final y resumen. Retirar solo los TODO temporales de
   esta ejecucion, conservando sus versiones, decisiones y commits como historial.

## Seguimiento de hitos

### Implementados (validaciones y regresiones detalladas abajo)

- [x] **1. Ejecucion independiente de la interfaz:** cambiar de cliente sin
      detener ni duplicar trabajo, consultar estado y cancelar explicitamente.
      Verificado con agente simulado, no con navegadores reales.
- [x] **2. Contrato del nuevo flujo:** planes, tareas, bloqueos y aprobaciones
      versionados y persistidos; TODO derivado del contrato. Este hito por si solo
      no incluye chat, handoff ni ejecucion.
- [x] **3. Ejecucion por fases y Git:** progreso verificable, commits controlados
      y recuperacion explicita. Ver [ejecucion guiada](guided-execution.md).
- [x] **3.5. Portabilidad entre equipos:** exportar/importar datos de forma
      consistente y volver del viaje sin perder historial ni pisar cambios.
      Un solo equipo activo, sin sincronizacion bidireccional. Ver
      [portabilidad de datos](data-portability.md).

- [x] **4. Web personal y preparacion local:** autenticacion, API, React, fuentes,
      contratos guiados, inicio/seguimiento y launcher con setup/catalogo. El E2E
      local llega a `waiting/changes-review`. La compatibilidad legacy pasa
      aislada; no implica regresion completa verde, LAN real ni handoff aceptado.

### Validacion y extension del Hito 4 pendientes

- [ ] Repetir en la regresion completa la carga inicial del modo web sin launcher;
      `test/web/browser.e2e.ts` pasa aislado con un worker.
- [ ] Obtener suite completa verde; `test/cli-protocol.test.ts` pasa aislado sin
      cambiar su timeout, pero el timeout historico de suite no se oculta.
- [ ] Aceptar handoff web A -> B: Tarea 5.26 del TODO. Existe implementacion de
      transporte/pairing; no sustituye la prueba del recorrido entre launchers.
- [ ] Recovery/retorno B -> A del handoff web: Tarea 5.27 diferida hasta promocion
      explicita. TLS peer y LAN real siguen pendientes.
- [ ] Registrar validacion del operador en LAN/TLS y con modelos reales cuando
      se autorice; los tests locales usan loopback y agentes simulados.

Las tareas `5.x` del TODO son numeracion interna de la extension del Hito 4.
No son el **Hito 5** de revision de codigo de este roadmap.

### Hitos siguientes, aun pendientes

- [ ] **5. Revision de codigo:** diffs por archivo, comentarios, edicion manual
      y revision del parche sobre versiones concretas.
- [ ] **6. QA y cierre:** tickets conversables, decisiones selectivas, QA_TODO
      autorizado, verificacion, revision adicional opcional y resumen final.

## Evidencia de la revision de estado

Evidencia historica contra `c90077d`, sin fixes funcionales:

| Comprobacion                         | Resultado observado                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| format:check, lint, typecheck, build | Pasan.                                                                                        |
| pnpm run test                        | 482 pasan, 1 omitido, 1 falla por timeout en CLI (96 archivos).                               |
| Caso CLI aislado                     | Pasa en 13,56 s con timeout original de 15 s; no convierte la suite completa en verde.        |
| pnpm run test:web                    | 1 pasa y 1 falla; Chromium disponible.                                                        |
| local-launcher.e2e.ts                | Setup, proyecto, brief, plan/TODO, preview e implementacion hasta waiting pasan con Pi falso. |
| browser.e2e.ts                       | Falla al mostrar la tarea tras login; reproducido con un solo worker.                         |

La repeticion enfocada posterior paso: `pnpm exec playwright test
 test/web/browser.e2e.ts --workers=1` (1 test) y `pnpm exec vitest run
 test/cli-protocol.test.ts` (16 tests). `refreshWorkspace` conserva el fallback al
workspace configurado cuando settings/proyecto no estan disponibles. Esta evidencia
no sustituye `pnpm run test` ni `pnpm run test:web` de la Tarea 5.25.

La primera ejecucion historica se interrumpio por el limite externo de 300 s;
los resultados de la tabla corresponden a la repeticion que si finalizo.
El lector de fuentes existe y sus seis tests pasan; el check vacio de la Tarea
2.3 del TODO era un desfase documental, no una funcionalidad ausente.

## Hito 3.5: decision de portabilidad

**Acordado:** traslado controlado, no sincronizacion de dos equipos que avanzan
independientemente. Durante el viaje trabaja el portatil; la copia del servidor
no cambia. Al regresar se transfiere el estado de vuelta. Esto es una regla de
uso; no presupone un bloqueo distribuido entre equipos desconectados.

Alcance que debe concretarse en el plan de implementacion:

1. Exportar una instantanea consistente de SQLite y artefactos, incluidos
   conversaciones, documentos, decisiones y progreso, sin operaciones activas.
   No copiar solo el archivo de base de datos mientras se escribe.
2. Validar integridad/versiones e importar con respaldo previo. Resolver las
   rutas absolutas y la identidad del workspace sin reescribir silenciosamente
   evidencia historica ni reutilizar aprobaciones para otro entorno.
3. Trasladar el codigo mediante Git y comprobar que corresponde al estado
   exportado. Definir el tratamiento de cambios sin commit antes de implementar;
   nunca descartarlos ni hacer commits automaticos solo para exportar.
4. Detectar si el destino cambio desde la transferencia anterior y bloquear la
   sustitucion en ese caso. No merge automatico de SQLite ni sobrescritura ciega.
5. Excluir credenciales de Pi/proveedores del paquete. Los datos exportados pueden
   contener informacion sensible; no prometer una eliminacion total de secretos
   presentes en conversaciones o artefactos.

Aceptacion verificada: equipo A -> equipo B -> trabajo en B -> retorno a A,
conservando IDs, documentos, artifacts e historial; un cambio independiente en A
impide una importacion destructiva. Importar historial no autoriza ejecutarlo.

Estado: implementado y verificado localmente; no implica sincronizacion, cifrado,
portabilidad Windows ni despliegue remoto.

## Limites de arquitectura

- Reutilizar `ApplicationService`, SQLite, artefactos y `AgentDriver`.
- Mantener el motor independiente de web, Git y Pi. La coordinacion de este flujo
  pertenece a aplicacion; no crear un motor generico de DAGs o workflows dinamicos.
- El servidor posee la ejecucion; los navegadores envian acciones y observan.
- Una aprobacion debe corresponder a una version concreta. Evitar solicitudes
  duplicadas y escrituras simultaneas sobre el mismo repositorio.
- Preservar CLI/TUI, protocolo CLI v1 y compatibilidad de runs existentes.
- No introducir multiusuario, workers remotos, microservicios ni otra base de
  datos en esta primera etapa.
- La web usa React y servidor Node en primer plano. HTTP de la UI solo en
  loopback; LAN exige HTTPS. El launcher posee un proyecto activo a la vez.
  El transporte peer experimental no cambia las reglas de acceso de la UI.

## Punto de partida

La base actual ofrece preparacion conversacional, pasos persistidos, revisiones
interactivas y un anfitrion de ejecucion independiente de sus clientes. El Hito 1
verifica cambio de cliente, consultas persistidas, replay, cancelacion explicita
y resume explicito con un agente simulado. El Hito 3 agrega control por fase e
integracion Git. El Hito 4 y su extension local agregan web, setup, catalogo y
preparacion/ejecucion desde el navegador. Schema 15 ya esta implementado; los
paquetes schema14 siguen admitidos. Siguen pendientes la revision de codigo y
las decisiones selectivas de QA; no hay recuperacion automatica tras una caida
abrupta.

Siguiente paso recomendado: continuar la Fase 5D desde la Tarea 5.19 antes de
implementar revision de codigo o QA. No ejecutar automaticamente el handoff de la
Fase 5E ni promover los Hitos 5/6 sin aceptar primero esa convergencia.

Diagramas: [arquitectura actual](binaflow_arch.drawio) y
[flujo web propuesto](binaflow_web_flow.drawio).
