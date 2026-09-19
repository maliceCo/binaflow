# Capacidades De Las Interfaces

Estado: contrato documental v1, fijado despues de la Tarea 5.17 y antes de la
convergencia tecnica 5.19-5.25.

## Flujo Canonico De Tareas Nuevas

La experiencia canonica para una tarea nueva es una sola cadena:

```text
TaskContract
  -> guided-preparation
  -> guided-task-build
  -> guided-execution
  -> waiting/changes-review
```

`TaskContract` conserva el brief, el plan aprobado, el TODO y sus revisiones.
`guided-preparation` coordina la preparacion y la aprobacion explicita del plan.
`guided-task-build` es el workflow interno y versionado que materializa la
ejecucion aprobada. `guided-execution` posee el inicio unico, el progreso, la
cancelacion y la recuperacion de esa ejecucion. Alcanzar
`waiting/changes-review` indica que las fases de build terminaron y que la tarea
espera revision. Cuando hubo cambios, el run conserva un `ChangeSet` de aplicacion
versionado con archivos y hunks estructurados; no significa que los cambios o QA
esten aprobados.

`guided-task-build` no es un workflow de lanzamiento libre y no se agrega a
`binaflow run`. Una interfaz no debe reconstruir esta cadena mediante comandos
legacy ni fabricar contratos JSON para saltar su coordinador, CAS o lifecycle.

## Operaciones Semanticas Y Matriz

La matriz describe capacidades de producto, no permisos de seguridad ni una
negociacion con el workflow engine.

- **Actual:** disponible en el baseline cerrado por la Tarea 5.17.
- **5D lectura:** destino comprometido para TUI/CLI en las Tareas 5.19-5.25;
  todavia no autoriza mutaciones guiadas.
- **Pendiente:** reservado para los hitos indicados; no debe presentarse como
  implementado.

| Operacion        | Significado canonico                                                                | Web                                                | TUI                              | CLI                              |
| ---------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- | -------------------------------- |
| `create`         | Crear un `TaskContract` nuevo para el proyecto activo.                              | Actual                                             | No soportada                     | No soportada                     |
| `prepare`        | Confirmar brief, conversar, generar/comentar plan y producir TODO.                  | Actual                                             | No soportada                     | No soportada                     |
| `approve-plan`   | Aprobar explicitamente una version exacta del plan; no inicia por si sola el build. | Actual                                             | No soportada                     | No soportada                     |
| `execute`        | Previsualizar y arrancar una vez `guided-task-build` mediante `guided-execution`.   | Actual                                             | No soportada                     | No soportada                     |
| `observe`        | Listar tareas y leer estado, documentos, progreso y artefactos proyectados.         | Actual                                             | 5D lectura                       | 5D lectura                       |
| `resume/cancel`  | Recuperar una ejecucion admitida o solicitar su cancelacion por el lifecycle comun. | Actual para los estados admitidos                  | No soportada para tareas guiadas | No soportada para tareas guiadas |
| `review-changes` | Inspeccionar el `ChangeSet` real y registrar decisiones sobre cambios.              | ChangeSet disponible; decisiones ricas posteriores | Lectura estructurada             | Lectura estructurada             |
| `review-qa`      | Revisar hallazgos QA y autorizar su tratamiento o cierre.                           | Pendiente, Hito 6                                  | No soportada                     | No soportada                     |

La Web es la superficie rica para el flujo canonico. El baseline cubre creacion,
preparacion, aprobacion, ejecucion y observacion hasta que el run queda en
`waiting/changes-review`; la revision recibe el mismo `ChangeSet` estructurado que
CLI y TUI. Comentarios por linea, editor de codigo, aprobacion de cambios y el flujo
QA de Hito 6 siguen fuera del contrato implementado.

Durante 5D, TUI y CLI reciben una proyeccion comun para listar e inspeccionar
tareas guiadas. Esa lectura no permite crear, preparar, aprobar, ejecutar,
reanudar, cancelar ni revisar una tarea guiada desde esas superficies.

La matriz ejecutable se publica como un manifiesto versionado en
`src/application/workflow-surface.ts`. `guided-task-build` aparece como
`operate` en Web y `observe` en TUI/CLI; los workflows directos/legacy aparecen
como `operate` en CLI/TUI y `unsupported` en Web. El manifiesto solo anuncia
capacidades implementadas y no convierte una etiqueta de superficie en una
autorizacion de aplicacion.

## Capacidad No Disponible

Cuando una interfaz no soporta una operacion debe:

1. conservar el estado sin mutarlo;
2. indicar que la capacidad no esta disponible en esa superficie;
3. identificar la Web como superficie requerida para las mutaciones canonicas;
4. mantener disponibles las consultas de solo lectura que esa interfaz si
   soporte.

No debe simular exito, traducir la accion a un workflow directo, generar un
payload de negocio alternativo ni inferir autorizacion desde la matriz. La
aplicacion sigue validando estado, revision, ownership, permisos y transiciones
en cada operacion.

## Workflows Directos Compatibles

`plan-build*`, `todo-build-qa` y `research-plan-build` siguen ejecutables por sus
rutas existentes de CLI/TUI. En documentacion de superficies se denominan
**directos/legacy** para distinguir su experiencia de lanzamiento de la cadena
guiada canonica; no significa que sus datos esten deprecated ni sean invalidos.

Esta decision no migra runs, no borra preparaciones historicas, no altera la
recuperacion y no cambia CLI protocol-v1. Esas rutas conservan sus capacidades
actuales, pero no evolucionan en paralelo como una segunda implementacion de los
Hitos 5/6.

## Fronteras Compartidas Y Propias

Son fuente comun de verdad:

- `TaskContract` y los schemas versionados de agente;
- las operaciones semanticas y vistas seguras de la capa de aplicacion;
- el estado persistido, los documentos y las reglas de lifecycle.

Permanecen propios de cada adapter:

- los envelopes, parsers y errores de HTTP v1;
- los envelopes, orden y codigos de salida de CLI protocol-v1;
- los renderizadores React, Ink y texto humano.

Compartir estado, schemas y vistas no obliga a paridad visual. Tampoco autoriza
al navegador, TUI o CLI a leer SQLite, artefactos del filesystem o contratos
privados de otro adapter.
