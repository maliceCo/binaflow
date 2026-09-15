# Binaflow web: objetivo e hitos

Estado: los Hitos 1, 2 y 3 estan implementados y verificados localmente. El
Hito 2 cubre el contrato persistido de tareas guiadas; el Hito 3 agrega handoff
autorizado, ejecucion secuencial, checkpoints Git, leases y recovery explicito.
El siguiente paso es el Hito 3.5: portabilidad con un solo equipo activo.
La web queda despues, inicialmente en red interna y sin VPN. Autenticacion y
mecanismo de despliegue siguen pendientes de definir.
La verificacion cubre el backend con SQLite, artifacts y agentes simulados; no
cubre navegadores reales, autenticacion ni despliegue remoto. Documento de
continuidad para recuperar el proposito cuando falte contexto de la conversacion.

## Objetivo

Una web personal para explorar un problema con un LLM, aprobar un plan, delegar
su ejecucion y revisar codigo y QA con control humano. La web complementa al CLI
y la TUI; no los sustituye ni los utiliza como intermediarios.

## Decisiones acordadas

- Un solo usuario inicialmente, con acceso desde distintos equipos.
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

### Completados localmente

- [x] **1. Ejecucion independiente de la interfaz:** cambiar de cliente sin
      detener ni duplicar trabajo, consultar estado y cancelar explicitamente.
      Verificado con agente simulado, no con navegadores reales.
- [x] **2. Contrato del nuevo flujo:** planes, tareas, bloqueos y aprobaciones
      versionados y persistidos; TODO derivado del contrato. Este hito por si solo
      no incluye chat, handoff ni ejecucion.
- [x] **3. Ejecucion por fases y Git:** progreso verificable, commits controlados
      y recuperacion explicita. Ver [ejecucion guiada](guided-execution.md).

### Pendientes, en orden

- [ ] **3.5. Portabilidad entre equipos:** exportar/importar datos de forma
      consistente y volver del viaje sin perder historial ni pisar cambios.
      Un solo equipo activo, sin sincronizacion bidireccional.
- [ ] **4. Web personal y preparacion:** acceso en red interna, autenticacion,
      chat de exploracion, consulta de fuentes, plan con feedback/aprobacion e
      inicio y seguimiento de la ejecucion. Sin VPN como requisito inicial.
- [ ] **5. Revision de codigo:** diffs por archivo, comentarios, edicion manual
      y revision del parche sobre versiones concretas.
- [ ] **6. QA y cierre:** tickets conversables, decisiones selectivas, QA_TODO
      autorizado, verificacion, revision adicional opcional y resumen final.

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

Aceptacion objetivo: equipo A -> equipo B -> trabajo en B -> retorno a A,
conservando IDs, documentos e historial; un cambio independiente en A debe
impedir una importacion destructiva. Falta definir y probar la reautorizacion y
recuperacion de runs trasladados; importar historial no autoriza ejecutarlo.

Estado: decision de alcance aprobada; implementacion no iniciada.

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
- Definir autenticacion, acceso seguro y alcance del workspace antes de exponer
  la web. Aun no se ha elegido framework ni mecanismo de despliegue.

## Punto de partida

La base actual ofrece preparacion conversacional, pasos persistidos, revisiones
interactivas y un anfitrion de ejecucion independiente de sus clientes. El Hito 1
verifica cambio de cliente, consultas persistidas, replay, cancelacion explicita
y resume explicito con un agente simulado. El Hito 3 agrega control por fase e
integracion Git. Siguen pendientes la portabilidad, la web, la revision de codigo
y las decisiones selectivas de QA; no hay recuperacion automatica tras una caida
abrupta.

Siguiente paso: preparar el plan de implementacion del **hito 3.5**, antes del
Hito 4. No asumir que los Hitos 1-3 cubren traslado de datos o despliegue remoto.

Diagramas: [arquitectura actual](binaflow_arch.drawio) y
[flujo web propuesto](binaflow_web_flow.drawio).
