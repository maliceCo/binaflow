# Binaflow web: objetivo e hitos

Estado: el Hito 1 esta implementado y verificado localmente; los hitos restantes
siguen siendo una ruta propuesta, no una especificacion de implementacion. La
verificacion cubre el backend con SQLite, artifacts y un agente simulado; no
cubre navegadores reales, autenticacion ni despliegue remoto. Documento de
continuidad para recuperar el proposito cuando falte contexto de la conversacion.

## Objetivo

Una web personal para explorar un problema con un LLM, aprobar un plan, delegar
su ejecucion y revisar codigo y QA con control humano. La web complementa al CLI
y la TUI; no los sustituye ni los utiliza como intermediarios.

## Decisiones acordadas

- Un solo usuario inicialmente, con acceso desde distintos equipos.
- Repositorio, Pi y Binaflow en una maquina anfitriona fija; mas adelante puede
  alojarse en un servidor.
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

## Hitos propuestos

| Hito                                      | Resultado esperado                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ejecucion independiente de la interfaz | Cambiar de navegador sin detener ni duplicar trabajo; recuperar estado y cancelar explicitamente. Probar primero con un flujo existente y agente simulado. |
| 2. Contrato del nuevo flujo               | Fases, planes, tareas, bloqueos y aprobaciones versionados y persistidos; TODO como representacion del contrato, no como unica fuente de verdad.           |
| 3. Ejecucion por fases y Git              | Progreso verificable, commits controlados y recuperacion sin repetir trabajo completado ni incluir cambios ajenos.                                         |
| 4. Web personal y preparacion             | Acceso remoto autenticado, chat de exploracion, consulta de fuentes y plan con feedback y aprobacion.                                                      |
| 5. Revision de codigo                     | Diffs por archivo, comentarios, edicion manual y revision del parche sobre versiones concretas.                                                            |
| 6. QA y cierre                            | Tickets conversables, decisiones selectivas, QA_TODO autorizado, verificacion, revision adicional opcional y resumen final.                                |

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
y resume explicito con un agente simulado. Siguen fuera de alcance el ciclo de
vida tras una caida abrupta, control por fase, integracion Git, revision de codigo
y las decisiones selectivas de QA.

Siguiente paso: definir y autorizar el contrato del **hito 2**, sin asumir que el
hito 1 cubre web, autenticacion o despliegue remoto.

Diagramas: [arquitectura actual](binaflow_arch.drawio) y
[flujo web propuesto](binaflow_web_flow.drawio).
