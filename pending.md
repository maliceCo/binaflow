# Pendientes de Binaflow

Este archivo contiene únicamente los pendientes que quedaban en `TODO.md`. El plan histórico y las tareas completadas no se trasladan.

## Estado actual

- La convergencia Web/TUI/CLI y el ChangeSet estructurado están completados.
- La aplicación local en una computadora está aceptada.
- La verificación del handoff A -> B permanece retenida.
- La tarea 5.27 queda diferida hasta aceptar la 5.26 y promoverla explícitamente.

## Fase 5E: Handoff retenido

### [ ] Tarea 5.26: Verificar el happy path de handoff A -> B

- **Prioridad:** importante pero posterior a la convergencia local. No es sync y no bloquea la convergencia local.
- **Archivo:** nuevos `test/web/launcher-transfer.e2e.ts`, `test/web/two-server-fixture.ts`; `playwright.config.ts`, `test/architecture-boundaries.test.ts`, `package.json`; fixes mínimos de `src/cli/commands/web-transfer.ts`, `src/web/peer-transport.ts` o UI solo si el happy path los demuestra.
- **Funciones:** fixture de dos launchers, dos catálogos, dos repos Git y datasets temporales con peer HTTP experimental sobre loopback.
- **Descripción:** probar solo el recorrido funcional principal: configurar A/B, mostrar/aceptar warning `lan-experimental`, registrar clones con el mismo projectId, emparejar y confirmar fingerprints, preparar un proyecto activo en A, transferirlo, comprobar A `exported`/solo lectura y B `active` con SQLite, historial y artefactos importados. No incluir todavía retorno B -> A ni matriz de fallos.
- **Evitar:** llamarlo sync, compartir catálogo/dataDir, mocks que omitan SQLite/Git/artefactos, bind LAN real, sleeps fijos, ocultar ausencia de cifrado, modificar Git automáticamente o declarar LAN/TLS remotos probados.
- **Verificación:** E2E A -> B en loopback y tests enfocados de composition root/project-transfer. Registrar LAN real y TLS peer como pendientes.
- **Commit Msg:** `test: verify the project handoff happy path`

### [ ] Tarea 5.27 (DIFERIDA): Endurecer y probar recuperación del handoff

- **Prioridad:** no ejecutar hasta que 5.26 esté aceptada y el owner promueva esta tarea.
- **Archivo:** ampliar `test/web/launcher-transfer.e2e.ts`, `test/peer-transport.test.ts`, `test/project-transfer.test.ts`, `docs/data-portability.md`, `docs/personal-web.md`.
- **Funciones:** ninguna primitiva nueva; completar recovery/resume del protocolo existente.
- **Descripción:** cubrir corte/restart durante descarga, Range resume, respuesta perdida, replay, revocación, peer desconectado, hash/HEAD/Git mismatch, source exported con target pendiente y retorno B -> A. Documentar paquete offline, downtime y límites. TLS peer permanece hardening separado salvo promoción explícita.
- **Evitar:** sync bidireccional, merge SQLite, auto rollback de exported, forzar active, ampliar alcance con relay/cloud/NAT traversal, convertir estos tests en bloqueo retroactivo de la app local o afirmar seguridad/confidencialidad del HTTP experimental.
- **Verificación:** tests de recovery deterministas en loopback, regresión de portabilidad A -> B -> A, suite completa y documentación según evidencia.
- **Commit Msg:** `test: harden project handoff recovery`

## Criterios de aceptación global pendientes

### Preparación y ejecución

- [ ] Chat/fuentes/brief sobreviven cambio de navegador; fuentes no autorizan acciones.
- [ ] Plan y TODO salen del planner read-only, con versiones y confirmación humana.
- [ ] Doble envío no duplica mensajes, agentes, aprobaciones ni runs.
- [ ] Desconexión no cancela; botón Cancelar y shutdown sí limpian ordenadamente.
- [ ] Implementación termina esperando revisión, sin ejecutar QA/cierre fuera de scope.

### Seguridad y compatibilidad

- [ ] Sesión/Origin/Host/CSRF, SSRF y rendering seguro probados con casos negativos.
- [ ] La UI HTTP solo escucha loopback; exponer la UI en LAN/VPN exige TLS/código, un proyecto activo y ninguna API de terminal o FS general.
- [ ] En fase 5E, el handoff HTTP `lan-experimental` exige opt-in, red privada, peer emparejado, firmas/replay/revocación y warning de ausencia de confidencialidad; no bloquea la aceptación local de 5.17.
- [ ] Configuración sensible, opt-in experimental y ampliación de roots solo se admiten desde loopback.
- [ ] CLI/TUI y claims/leases siguen protegidos; no segundo contexto durante web.
- [ ] Paquetes schema14 siguen importables y schema15 conserva conversaciones/fuentes.
- [ ] Suite completa y navegador pasan para el baseline de una computadora; aceptación Pi/modelos/plataformas live se describe según evidencia real.

### Launcher local - bloquea la aceptación 5.17

- [ ] `binaflow web` arranca en loopback sin exigir JSON, proyecto ni dataDir.
- [ ] Setup permite autorizar roots, registrar y abrir proyecto sin paths ni JSON manual.
- [ ] El catálogo guarda rutas localmente y el browser solo usa rootId/segmentos.
- [ ] Cambiar proyecto falla con 409 si existe una operación activa.
- [ ] La web permite crear/preparar tarea, aprobar plan/TODO, ejecutar una vez y recuperar progreso/artefactos hasta `waiting/changes-review`.
- [ ] Reload, segunda pestaña, logout y shutdown conservan lifecycle y persistencia.

### Handoff retenido - importante, no bloquea la aceptación local

- [ ] El happy path A -> B conserva projectId/lineage, verifica Git y deja un solo owner activo; nunca se presenta como sync.
- [ ] Pairing confiable usa TLS; el modo experimental exige código efímero, fingerprint confirmado manualmente y firmas sin compartir sesiones.
- [ ] Recovery, replay, revocación, retorno B -> A y TLS peer permanecen trazados en 5.27 hasta promoción explícita.

## Reglas de operación para completar los pendientes

1. Un check a la vez; no ejecutar N+1 hasta cerrar N con evidencia. Commit atómico con archivos explícitos. No `git add .`, cambios ajenos, commits vacíos o RED.
2. No instalar nada ni usar modelos, red pública, certificados, datos o HOME reales por inferencia. La aprobación de implementación cubre solo dependencias y Chromium indicados; no apt, bundles, releases, nuevos drivers ni infraestructura.
3. Tests con tmpdirs propios y listeners loopback. No cambiar firewall, DNS, Git config, perfiles o credenciales del operador para hacer pasar pruebas.
4. No nueva abstracción o archivo fuera de tareas sin desviación aprobada. No DAG, scheduler, cola, plugin, memoria, daemon ni implementación paralela de workflows.
5. Al terminar, conservar documentación/evidencia.

## Protocolo de desviación

```text
ALERTA DE DESVIACIÓN DE PLAN
Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <contratos, archivos y verificaciones>
Propuesta: <ajuste mínimo solicitado>
```

Detenerse sin check si schema015 está ocupado, falta una decisión de seguridad, una dependencia no soporta Node declarado, el modelo exige herramientas de escritura, la migración rompe paquetes14 o un fallo existente impide lifecycle seguro. No corregirlo silenciosamente ni reducir la garantía para seguir.
