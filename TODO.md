# PLAN DE ACCIÓN DE CORRECCIONES: QA del editor Wireframe

> **ATENCIÓN SUB-AGENTE:** Sigue este plan de forma estrictamente secuencial. No saltes tareas, no agregues código no descrito y detente ante cualquier desviación. Este plan corrige únicamente los hallazgos QA del paquete `wireframe/`. No modificar `pending.md`.

## Estado de ejecución

- Las tareas 1.1 a 7.1 de QA están completadas; sus correcciones y el E2E real se registraron en commits separados.
- `wireframe/`: format, lint, typecheck, 57 tests unitarios, build y 5 E2E Chromium pasan.
- Binaflow raíz: typecheck, 505 tests (1 omitido) y build pasan.
- Los checks raíz siguen señalando problemas fuera del alcance: Prettier avisa de 60 archivos y ESLint reporta 68 errores en `test/style`. La exclusión de `wireframe/` redujo ESLint desde 1128 errores y eliminó del formato el reporte generado de Playwright.
- `git diff --check` aún señala líneas CRLF en archivos web modificados anteriormente; no se normalizaron como parte de QA.
- El ajuste general de listas de Binaflow Web sigue pendiente, como trabajo adicional independiente.

## Lista de tareas

### Fase 1: Base de verificación

- [x] **Tarea 1.1: Consolidar el aislamiento de tests unitarios y E2E**
  - **Archivo:** `wireframe/vitest.config.ts`.
  - **Funciones:** configuración `test.include`.
  - **Descripción:** conservar el filtro `src/**/*.{test,spec}.{ts,tsx}` para que `pnpm --dir wireframe run test` ejecute únicamente Vitest. No cambiar la configuración de Playwright.
  - **Evitar:** ejecutar E2E desde Vitest, aumentar timeouts para ocultar procesos colgados o tocar la configuración de Binaflow.
  - **Verificación:** `pnpm --dir wireframe run format:check && pnpm --dir wireframe run lint && pnpm --dir wireframe run typecheck && pnpm --dir wireframe run test`.
  - **Commit Msg:** `test: isolate wireframe unit tests from e2e`

### Fase 2: Robustez del almacenamiento

- [x] **Tarea 2.1: Manejar almacenamiento local no disponible**
  - **Archivo:** `wireframe/src/storage.ts`, `wireframe/src/storage.test.ts`, `wireframe/src/App.tsx`, `wireframe/src/App.test.tsx`.
  - **Funciones:** `loadDraft`, `saveDraft`, `clearDraft` y la inicialización de `App`.
  - **Descripción:** evitar que `getBrowserStorage()` se evalúe antes del `try`. Si acceder a `localStorage` produce `SecurityError`, no disponible o falla por cuota, la aplicación debe seguir editándose con un documento vacío o actual, devolver un mensaje controlado y no lanzar durante el render. Mantener la inyección `StorageLike` para tests. Añadir un caso donde el getter de almacenamiento falla.
  - **Descripción adicional:** cuando un autosave posterior funciona, limpiar el aviso de almacenamiento obsoleto. Mantener el aviso si el último intento sigue fallando.
  - **Evitar:** guardar selección, silenciar el error sin feedback, capturar errores fuera de la frontera de almacenamiento o introducir IndexedDB.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/storage.test.ts src/App.test.tsx` debe cubrir getter fallido, lectura corrupta, escritura fallida, recuperación de guardado y edición continua sin crash; después `pnpm --dir wireframe run typecheck`.
  - **Commit Msg:** `fix: keep wireframe usable when local storage fails`

### Fase 3: Mantener documentos y estado válidos

- [x] **Tarea 3.1: Fijar el contrato de grilla v1**
  - **Archivo:** `wireframe/src/model.ts`, `wireframe/src/model.test.ts`, `wireframe/README.md`.
  - **Funciones:** `parseGrid`, `createEmptyDocument` y límites del contrato.
  - **Descripción:** decidir y aplicar una única regla para v1: `grid.columns` debe ser 12 y `grid.rowHeight` debe ser exactamente `DEFAULT_ROW_HEIGHT` (40). Rechazar valores positivos arbitrarios que creen lienzos desproporcionados. Actualizar el ejemplo/documentación solo si el texto actual no expresa claramente esta regla.
  - **Evitar:** migrar versiones futuras, corregir silenciosamente archivos importados o agregar configuración de tamaño no solicitada.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/model.test.ts` debe cubrir 40 válido y 0, 1, 999999999 o decimales inválidos; `pnpm --dir wireframe run typecheck`.
  - **Commit Msg:** `fix: constrain wireframe grid dimensions`

- [x] **Tarea 3.2: Rechazar IDs inválidos en el reducer**
  - **Archivo:** `wireframe/src/editor-state.ts`, `wireframe/src/editor-state.test.ts`.
  - **Funciones:** `addBlock` y `duplicateBlock` dentro de `editorReducer`.
  - **Descripción:** impedir que acciones internas con ID vacío o solo espacios creen un documento que después no pueda serializarse. Mantener la regla de IDs únicos y devolver el mismo estado cuando la acción es inválida.
  - **Evitar:** validar UUIDs estrictos si el contrato solo exige IDs únicos, cambiar el formato JSON o agregar estado de error global al reducer.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/editor-state.test.ts` debe probar ID vacío, ID de espacios, duplicado y estado válido tras acciones normales.
  - **Commit Msg:** `fix: preserve valid block identifiers`

### Fase 4: Exportación segura

- [x] **Tarea 4.1: Revocar URLs temporales aunque falle la descarga**
  - **Archivo:** `wireframe/src/file-io.ts`, `wireframe/src/file-io.test.ts`.
  - **Funciones:** `createWireframeDownload`.
  - **Descripción:** envolver la operación posterior a `createObjectURL` en `try/finally` para garantizar `revokeObjectURL(url)` si fallan `createAnchor`, `appendAnchor`, `click` o `removeAnchor`. Mantener el nombre sanitizado y el comportamiento de descarga existente.
  - **Evitar:** ocultar el error de descarga, crear reintentos automáticos o conservar anchors en el DOM.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/file-io.test.ts` debe cubrir descarga exitosa y fallo de `click` verificando siempre la revocación; `pnpm --dir wireframe run lint`.
  - **Commit Msg:** `fix: revoke wireframe download URLs on failure`

### Fase 5: Interacción real del canvas

- [x] **Tarea 5.1: Probar arrastre y redimensionado reales en Chromium**
  - **Archivo:** `wireframe/e2e/editor.spec.ts`; ampliar `wireframe/src/components/Canvas.test.tsx` solo para conversiones puras si falta una aserción.
  - **Funciones:** recorrido real de `react-rnd`, handles de resize y persistencia de geometría.
  - **Descripción:** mantener los checks del inspector, pero agregar interacción con el ratón sobre un bloque real: arrastrar a otra columna/fila y usar el handle de esquina para cambiar ancho/alto. Verificar después los campos del inspector y, tras recargar, que la geometría permanece. Usar `boundingBox`, movimientos con pasos y aserciones semánticas; no usar sleeps fijos.
  - **Evitar:** reemplazar `react-rnd` por un mock en el E2E, validar solo estilos pixel-perfect, ocultar fallos con reintentos o cambiar el comportamiento de solapamiento.
  - **Verificación:** `pnpm --dir wireframe run build && pnpm --dir wireframe run test:e2e`; si el gesto real revela un bug de límites/offset, detenerse y reportar desviación antes de modificar producción.
  - **Commit Msg:** `test: cover real canvas drag and resize`

### Fase 6: Aislamiento de herramientas del paquete

- [x] **Tarea 6.1: Evitar que las herramientas raíz inspeccionen el paquete independiente**
  - **Archivo:** `eslint.config.js`, `.prettierignore`; únicamente si la verificación confirma que siguen inspeccionando `wireframe/` o sus artefactos generados.
  - **Funciones:** patrones de exclusión de ESLint/Prettier.
  - **Descripción:** hacer explícito que `wireframe/` tiene sus propios comandos de calidad y que Binaflow raíz no debe inspeccionar sus fuentes, `dist`, reportes o dependencias. Mantener `pnpm --dir wireframe run format:check` y `lint` como validación obligatoria del paquete. No intentar resolver los fallos históricos de `test/style` ni reformatear archivos ajenos.
  - **Evitar:** ocultar errores de `src/` o `test/` de Binaflow, cambiar `package.json` raíz, borrar artefactos para falsear una verificación o incluir `pending.md`.
  - **Verificación:** comprobar `pnpm run lint`/`format:check` antes y después, registrar por separado los fallos históricos restantes y ejecutar los checks propios de `wireframe`.
  - **Commit Msg:** `chore: isolate wireframe quality checks`

### Fase 7: Regresión y cierre

- [x] **Tarea 7.1: Aceptar las correcciones QA**
  - **Archivo:** `TODO.md`; no modificar `pending.md`.
  - **Funciones:** ninguna nueva.
  - **Descripción:** ejecutar toda la suite del paquete, E2E y las verificaciones raíz. Marcar como resueltos solo los hallazgos con evidencia. La regresión raíz debe conservar un registro explícito de los fallos preexistentes; no declararla verde si persisten.
  - **Evitar:** construir bundles Linux/Windows, corregir problemas no relacionados, modificar datos reales o borrar `pending.md`.
  - **Verificación:** `pnpm --dir wireframe run format:check && pnpm --dir wireframe run lint && pnpm --dir wireframe run typecheck && pnpm --dir wireframe run test && pnpm --dir wireframe run build && pnpm --dir wireframe run test:e2e && pnpm run typecheck && pnpm run test && pnpm run build && git diff --check`.
  - **Resultado:** los checks propios de `wireframe/` y los checks raíz typecheck/test/build pasan. `format:check` raíz conserva 60 archivos históricos y `lint` raíz 68 errores en `test/style`; `git diff --check` reporta CRLF en cambios web preexistentes. Ninguno se corrigió aquí.
  - **Commit Msg:** `test: accept wireframe QA corrections`

## Criterios de aceptación

- [x] El editor sigue funcionando aunque el almacenamiento local no esté disponible.
- [x] Los avisos de almacenamiento reflejan el último estado real del autosave.
- [x] Los documentos v1 solo aceptan una grilla de 12 columnas y filas de 40 px.
- [x] Ninguna acción del reducer crea IDs vacíos o documentos no serializables.
- [x] Las URLs de descarga se revocan también ante errores.
- [x] Chromium prueba arrastre y redimensionado reales, no solo campos del inspector.
- [x] Los checks propios de `wireframe/` pasan sin que sus artefactos contaminen Binaflow.
- [x] Los fallos históricos de Binaflow quedan documentados y no se presentan como corregidos.

## Reglas de operación

1. Un solo check a la vez. No comenzar la tarea siguiente hasta verificar y committear la anterior.
2. Cada commit debe contener únicamente los archivos de su tarea y usar el mensaje indicado.
3. No modificar `pending.md`, datos reales ni código no relacionado.
4. Si aparece un bug distinto, una API incompatible o una tarea necesita más archivos de los indicados, detenerse con el protocolo de desviación.
5. No borrar este `TODO.md` hasta completar la Tarea 7.1, el trabajo adicional autorizado y sus verificaciones.

## Protocolo de desviación

```text
ALERTA DE DESVIACIÓN DE PLAN

Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos, contratos y verificaciones>
Propuesta: <ajuste mínimo solicitado>
```

## Trabajo adicional autorizado: listas de Binaflow Web

> Este bloque es independiente de las correcciones QA de `wireframe/` anteriores. Ejecutarlo por separado, sin ampliar su alcance ni cambiar el editor de wireframes. El modal Project locations ya tiene el patrón de referencia; conservarlo.

- [ ] **Ajustar la presentación de elementos de listas en Binaflow Web**
  - **Archivos a revisar:** `src/web/client/styles.css` y las vistas que usan `.project-list` (`Projects.tsx`), `.task-list` y `.recent-tasks` (`App.tsx`), `.folder-list` (`ProjectBrowser.tsx`) y `.local-folder-list` (`LocalProjectPicker.tsx`). Cambiar componentes solo si la estructura actual impide el resultado; no tocar API ni lógica de negocio.
  - **Objetivo:** que cada elemento se lea como una unidad clara, con espaciado, borde completo y estados distinguibles por texto y estructura, no solo por color. Evitar filas que parecen cortadas (especialmente la primera), dobles bordes, solapamientos y botones que invaden nombres largos. Mantener acciones, selección, estados vacíos y foco accesible. En ancho móvil, permitir que el contenido y las acciones se apilen sin desbordar ni ocultarse.
  - **Enfoque:** auditar los selectores compartidos (`.task-list li`, `.project-list li`, `.settings-section li` y `li:first-child`) antes de cambiar CSS; preferir reglas acotadas por lista frente a un estilo global para todos los `li`. Reutilizar el criterio visual del modal de ubicaciones, no aplicar verde ni tarjetas idénticas indiscriminadamente.
  - **Aceptación:** revisar visualmente cada lista con un elemento y con varios, nombres largos y viewport estrecho. Extender solo los E2E web existentes pertinentes para proteger el borde superior del primer elemento y la ausencia de solapamiento horizontal/vertical; verificar que selección y acciones sigan funcionando. Ejecutar typecheck, build y pruebas enfocadas, y registrar por separado los fallos globales preexistentes de formato/lint sin corregirlos aquí.
