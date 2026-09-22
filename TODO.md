# PLAN DE EJECUCIÓN: Editor web básico de wireframes

> **ATENCIÓN SUB-AGENTE:** Sigue este plan de forma estrictamente secuencial. No saltes tareas. No agregues código que no esté explícitamente detallado. Si encuentras un obstáculo o comportamiento inesperado, DETÉN LA EJECUCIÓN e informa al Orquestador inmediatamente.

## Alcance aprobado

Crear en `wireframe/` una aplicación web independiente y reutilizable para diseñar una pantalla mediante rectángulos sobre una grilla. La persona podrá crear, seleccionar, mover, redimensionar, duplicar y eliminar bloques; cada bloque tendrá título y descripción. El documento se guardará localmente y podrá importarse/exportarse como JSON versionado.

### Decisiones de partida

- `wireframe/` vive en este repositorio, pero es un paquete autónomo con `package.json`, lockfile, configuración y scripts propios.
- Binaflow no importa ni ejecuta código de `wireframe/`; el editor tampoco importa módulos de Binaflow.
- Stack mínimo: React, TypeScript y Vite. `react-rnd` resuelve drag/resize sin construir un sistema de punteros propio.
- El formato canónico es JSON. Posiciones y tamaños se expresan en unidades de grilla, nunca en píxeles.
- La grilla tiene 12 columnas y filas lógicas de 40 px. El lienzo conserva al menos 18 filas y crece según el bloque más bajo.
- Se permite solapamiento entre bloques y no hay compactación o reordenamiento automático.
- Un archivo representa una sola pantalla. No hay cuentas, backend, colaboración, IA, conexiones entre bloques ni componentes anidados.
- El borrador automático usa una única clave de `localStorage`; el archivo JSON exportado es la fuente portable.
- La aplicación trata títulos y descripciones como texto, nunca como HTML.
- No se modifica el comportamiento, los contratos ni las dependencias de Binaflow.

### Contrato JSON v1

```json
{
  "version": 1,
  "name": "Pantalla de ejecuciones",
  "grid": {
    "columns": 12,
    "rowHeight": 40
  },
  "blocks": [
    {
      "id": "UUID",
      "title": "Lista de ejecuciones",
      "description": "Mostrar estado y fecha.",
      "x": 0,
      "y": 0,
      "width": 3,
      "height": 5
    }
  ]
}
```

Restricciones v1: nombre de documento máximo 100 caracteres; título máximo 120; descripción máxima 4000; máximo 200 bloques; IDs únicos; enteros para geometría; `x >= 0`, `y >= 0`, `width >= 1`, `height >= 1` y `x + width <= 12`. La importación rechaza campos desconocidos, versiones no soportadas y documentos que incumplan límites. Un fallo de importación no reemplaza el documento abierto.

## Lista de Tareas

### Fase 1: Prerrequisitos y contrato del documento

- [x] **Tarea 1.1: Crear el paquete web independiente**
  - **Archivo:** nuevos `wireframe/package.json`, `wireframe/pnpm-workspace.yaml`, `wireframe/pnpm-lock.yaml`, `wireframe/.gitignore`, `wireframe/.prettierrc.json`, `wireframe/eslint.config.js`, `wireframe/tsconfig.json`, `wireframe/vite.config.ts`, `wireframe/vitest.config.ts`, `wireframe/index.html`, `wireframe/src/main.tsx`, `wireframe/src/App.tsx`, `wireframe/src/styles.css`, `wireframe/src/test/setup.ts`.
  - **Funciones:** entrada `main.tsx` y componente `App` mínimo; scripts `dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test` y `test:e2e`.
  - **Descripción:** crear un proyecto React/TypeScript/Vite que arranque con una pantalla vacía y un encabezado “Wireframe”. Declarar React, React DOM y `react-rnd` como dependencias; Vite, TypeScript, Vitest, jsdom, Testing Library, Playwright, ESLint y Prettier como dependencias de desarrollo. El `pnpm-workspace.yaml` anidado debe mantener instalación y lockfile dentro de `wireframe/`. Usar Node >=22 y fijar versiones en el lockfile. La instalación de paquetes requiere autorización explícita del owner antes de usar red.
  - **Evitar:** modificar el `package.json`, lockfile, scripts, configuración o código de Binaflow; agregar router, framework CSS, backend, servicio de desarrollo LAN, estado global externo o librerías adicionales.
  - **Verificación:** `pnpm --dir wireframe run format:check && pnpm --dir wireframe run lint && pnpm --dir wireframe run typecheck && pnpm --dir wireframe run build`.
  - **Commit Msg:** `build: scaffold independent wireframe editor`

- [x] **Tarea 1.2: Definir y validar el documento JSON v1**
  - **Archivo:** nuevos `wireframe/src/model.ts`, `wireframe/src/model.test.ts`.
  - **Funciones:** `createEmptyDocument`, `parseWireframeDocument`, `serializeWireframeDocument`, `normalizeBlockGeometry`, tipos `WireframeDocumentV1`, `WireframeGridV1` y `WireframeBlockV1`.
  - **Descripción:** implementar el contrato JSON y los límites descritos arriba mediante validación TypeScript explícita sobre `unknown`. `parseWireframeDocument` debe producir un documento nuevo sin conservar referencias mutables del valor recibido. `normalizeBlockGeometry` debe redondear y limitar geometría creada por la UI dentro de las 12 columnas, pero la importación debe rechazar geometría inválida en lugar de corregirla silenciosamente. La serialización debe ser determinista y legible con indentación de dos espacios.
  - **Evitar:** usar casts para aceptar JSON no validado, agregar timestamps o rutas locales, aceptar campos extra, migrar versiones futuras, incluir estilos/HTML, corregir silenciosamente archivos inválidos o introducir una biblioteca de schema para este único contrato pequeño.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/model.test.ts` debe cubrir round-trip, documento vacío, límites válidos, campos extra, versión desconocida, IDs duplicados, strings/tamaños excesivos y geometría fuera de la grilla.
  - **Commit Msg:** `feat: define versioned wireframe documents`

### Fase 2: Estado y edición visual

- [x] **Tarea 2.1: Implementar operaciones puras del editor**
  - **Archivo:** nuevos `wireframe/src/editor-state.ts`, `wireframe/src/editor-state.test.ts`.
  - **Funciones:** `createEditorState`, `editorReducer`, acciones `rename-document`, `add-block`, `select-block`, `update-block-text`, `set-block-geometry`, `duplicate-block`, `delete-block`, `replace-document` y `new-document`.
  - **Descripción:** centralizar las mutaciones del documento en un reducer inmutable. `add-block` crea un bloque 3x3 en la primera posición visible disponible o, si no hay hueco, debajo del contenido actual. Duplicar genera un ID nuevo y desplaza el bloque una celda cuando cabe; si no, lo coloca debajo. Eliminar limpia la selección. Toda geometría generada por acciones se normaliza con el helper de la Tarea 1.2. Inyectar el generador de ID en las acciones que crean bloques para que los tests sean deterministas; la UI usará `crypto.randomUUID()`.
  - **Evitar:** acceso a DOM, `localStorage`, archivos o React dentro del reducer; historial undo/redo, selección múltiple, auto-layout, colisiones o mutar objetos previos.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/editor-state.test.ts` debe probar cada acción, IDs nuevos, selección coherente, límites de 200 bloques, geometría normalizada e inmutabilidad del estado anterior.
  - **Commit Msg:** `feat: add deterministic wireframe editor state`

- [x] **Tarea 2.2: Construir la estructura del editor y el inspector**
  - **Archivo:** nuevos `wireframe/src/components/Toolbar.tsx`, `wireframe/src/components/Canvas.tsx`, `wireframe/src/components/Inspector.tsx`, `wireframe/src/App.test.tsx`; modificar `wireframe/src/App.tsx`, `wireframe/src/styles.css`.
  - **Funciones:** componentes `Toolbar`, `Canvas`, `Inspector`; composición y reducer en `App`.
  - **Descripción:** crear un layout de tres zonas: barra superior, lienzo principal y panel inspector. La barra muestra nombre editable del documento y acciones Nuevo, Importar JSON, Exportar JSON y Añadir bloque; Importar/Exportar pueden permanecer deshabilitadas hasta la Fase 3. El lienzo dibuja la grilla y los bloques con título visible, descripción truncada visualmente y estado de selección distinguible sin depender solo del color. El inspector permite editar título, descripción y campos numéricos `x`, `y`, `width`, `height`, además de Duplicar y Eliminar. Sin selección muestra instrucciones breves. Los labels, botones y foco deben ser accesibles; en pantallas estrechas el inspector pasa debajo del lienzo sin ocultar controles.
  - **Evitar:** implementar todavía drag/resize, persistencia o archivos; `dangerouslySetInnerHTML`, estilos inline extensos, iconos sin texto accesible, más de cinco acciones principales simultáneas o componentes genéricos especulativos.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/App.test.tsx` debe crear/seleccionar un bloque, editar texto y geometría desde el inspector, duplicarlo, eliminarlo, renombrar el documento y comprobar que contenido con HTML se renderiza como texto.
  - **Commit Msg:** `feat: add wireframe canvas and inspector`

- [x] **Tarea 2.3: Permitir mover y redimensionar bloques en la grilla**
  - **Archivo:** nuevos `wireframe/src/geometry.ts`, `wireframe/src/geometry.test.ts`, `wireframe/src/components/Canvas.test.tsx`; modificar `wireframe/src/components/Canvas.tsx`, `wireframe/src/styles.css`.
  - **Funciones:** `gridToPixels`, `pixelsToGrid`, `calculateCanvasRows`; handlers de `react-rnd` para fin de drag y resize.
  - **Descripción:** medir el ancho útil del lienzo con `ResizeObserver`, calcular el ancho de columna y representar cada bloque como `Rnd` controlado. Ajustar movimiento y tamaño a columnas/filas; limitar horizontalmente al lienzo, impedir tamaños menores de 1x1 y persistir el resultado en unidades de grilla al finalizar la interacción. El lienzo debe tener 18 filas mínimas y crecer hasta dos filas después del bloque más bajo. Seleccionar al enfocar o interactuar con un bloque. Los campos numéricos del inspector siguen siendo la alternativa sin ratón.
  - **Evitar:** guardar píxeles, actualizar el reducer en cada pixel de movimiento, compactar bloques, impedir solapamiento, desplazar otros bloques, implementar zoom/pan o depender de dimensiones globales de ventana.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/geometry.test.ts src/components/Canvas.test.tsx` debe cubrir conversiones con varios anchos, redondeo, límites, crecimiento vertical y publicación de geometría al terminar drag/resize.
  - **Commit Msg:** `feat: move and resize blocks on the grid`

### Fase 3: Persistencia e intercambio

- [x] **Tarea 3.1: Guardar y recuperar el borrador local**
  - **Archivo:** nuevos `wireframe/src/storage.ts`, `wireframe/src/storage.test.ts`; modificar `wireframe/src/App.tsx`, `wireframe/src/components/Toolbar.tsx`.
  - **Funciones:** `loadDraft`, `saveDraft`, `clearDraft`; inicialización y autosave en `App`.
  - **Descripción:** usar una clave estable `wireframe-editor.document.v1`. Al arrancar, validar el borrador con `parseWireframeDocument`; si es válido, restaurarlo; si es inválido, conservar un documento vacío y mostrar un aviso no técnico sin lanzar la aplicación. Guardar después de cambios del documento, no de selección. Nuevo documento solicita confirmación si existe contenido, limpia el borrador y crea estado vacío. Un error de cuota/seguridad se muestra sin bloquear la edición.
  - **Evitar:** guardar selección, tokens o rutas; varias bases de datos locales, IndexedDB, debounce complejo, sincronización entre pestañas o reemplazar el documento por datos no validados.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/storage.test.ts src/App.test.tsx` debe cubrir restauración, autosave, borrador corrupto, fallo de escritura y creación de documento nuevo confirmada/cancelada.
  - **Commit Msg:** `feat: persist the wireframe draft locally`

- [x] **Tarea 3.2: Importar y exportar archivos JSON sin pérdida accidental**
  - **Archivo:** nuevo `wireframe/src/file-io.ts`, `wireframe/src/file-io.test.ts`; modificar `wireframe/src/App.tsx`, `wireframe/src/components/Toolbar.tsx`.
  - **Funciones:** `readWireframeFile`, `createWireframeDownload`, `safeWireframeFilename`; handlers de importación/exportación en `App`.
  - **Descripción:** habilitar Importar mediante un input de archivo oculto que acepte `.json`, lea UTF-8 y limite el archivo a 1 MiB antes de parsearlo. Reemplazar el documento solo después de validación completa y seleccionar ninguno. Mostrar errores comprensibles y mantener intacto el diseño actual ante fallo. Exportar el JSON determinista de la Tarea 1.2 mediante `Blob` y URL temporal; usar el nombre sanitizado del documento y revocar la URL. El botón Exportar debe funcionar también con un documento vacío.
  - **Evitar:** File System Access API, paths del equipo, subida a servidor, base64, HTML/SVG/PNG, recuperación parcial de JSON inválido o descargar desde los tests reales sin adaptar las APIs del navegador.
  - **Verificación / TDD:** `pnpm --dir wireframe test -- src/file-io.test.ts src/App.test.tsx` debe cubrir nombre seguro, export round-trip, archivo demasiado grande, JSON inválido, schema inválido, importación válida y conservación del documento ante error.
  - **Commit Msg:** `feat: import and export wireframe JSON`

### Fase 4: Aceptación y documentación

- [x] **Tarea 4.1: Verificar el recorrido real en navegador**
  - **Archivo:** nuevos `wireframe/playwright.config.ts`, `wireframe/e2e/editor.spec.ts`.
  - **Funciones:** fixture del servidor Vite de Playwright y recorrido de usuario del editor.
  - **Descripción:** probar en Chromium el flujo: abrir app, añadir dos bloques, editar título/descripción, mover uno, redimensionarlo, recargar y comprobar autosave, exportar JSON, crear documento nuevo, importar el archivo descargado y comprobar que posiciones/textos se restauran. Usar selectores por rol/label o `data-testid` estable solo donde el drag/resize no tenga semántica accesible. No usar sleeps fijos ni screenshots como única aserción.
  - **Evitar:** navegador o red remotos, datos reales del usuario, pruebas visuales pixel-perfect, múltiples navegadores/plataformas en este MVP o helpers de producción creados solo para el test.
  - **Verificación:** `pnpm --dir wireframe run build && pnpm --dir wireframe run test:e2e`. Si Chromium no está disponible, pedir autorización antes de ejecutar `pnpm --dir wireframe exec playwright install chromium`; no declarar aceptación sin navegador.
  - **Commit Msg:** `test: verify the wireframe editor journey`

- [x] **Tarea 4.2: Documentar uso, formato y límites del MVP**
  - **Archivo:** nuevo `wireframe/README.md`.
  - **Funciones:** ninguna.
  - **Descripción:** documentar requisitos, `pnpm install`, `pnpm dev`, comandos de calidad, controles del editor, autosave, import/export, ejemplo JSON v1 y límites explícitos. Aclarar que el JSON describe intención visual para que una persona o agente implemente luego la UI, pero no genera código automáticamente. Enumerar como posibles extensiones, sin implementarlas: undo/redo, múltiples pantallas, PNG/SVG, responsive breakpoints y biblioteca de componentes.
  - **Evitar:** prometer integración con Binaflow, IA, colaboración, backend, compatibilidad con versiones futuras o características no verificadas.
  - **Verificación:** `pnpm --dir wireframe exec prettier --check README.md && pnpm --dir wireframe run build`.
  - **Commit Msg:** `docs: explain the wireframe editor MVP`

- [ ] **Tarea 4.3: Ejecutar regresión final y retirar el plan temporal**
  - **Archivo:** `TODO.md` (eliminar únicamente después de todas las verificaciones); no modificar `pending.md`.
  - **Funciones:** ninguna nueva.
  - **Descripción:** ejecutar la validación completa del paquete independiente y la regresión obligatoria de Binaflow. Confirmar que `wireframe/` no es importado por Binaflow y que ningún archivo generado (`dist`, coverage, resultados Playwright) queda tracked. Revisar el estado Git y distinguir cualquier cambio ajeno antes de borrar este plan.
  - **Evitar:** construir bundles Linux/Windows, instalar paquetes adicionales, corregir fallos preexistentes o incluir `pending.md`/cambios ajenos en el commit.
  - **Verificación:** `pnpm --dir wireframe run format:check && pnpm --dir wireframe run lint && pnpm --dir wireframe run typecheck && pnpm --dir wireframe run test && pnpm --dir wireframe run build && pnpm --dir wireframe run test:e2e && pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && git diff --check && git status --short`.
  - **Commit Msg:** `chore: complete the wireframe editor MVP`

## Criterios de aceptación

- [ ] La aplicación arranca desde `wireframe/` sin iniciar ni configurar Binaflow.
- [ ] Se pueden crear, seleccionar, mover, redimensionar, editar, duplicar y borrar bloques.
- [ ] La geometría se conserva en unidades de una grilla de 12 columnas.
- [ ] Recargar restaura el borrador válido del navegador.
- [ ] Exportar e importar conserva nombre, textos, IDs, posiciones y tamaños.
- [ ] Un JSON inválido no reemplaza el documento abierto.
- [ ] El JSON v1 es legible y suficiente para implementar posteriormente la UI descrita.
- [ ] El recorrido Chromium y las suites completas de `wireframe/` y Binaflow pasan.

## Reglas de Operación para el Sub-Modelo

1. **Un solo check a la vez:** no comiences la tarea `N+1` hasta que la tarea `N` tenga su check (`[x]`) y su verificación sea exitosa.
2. **Política de commits:** haz un commit de Git inmediatamente al marcar un check. Usa el mensaje especificado y agrega solo los archivos de esa tarea; nunca uses `git add .`.
3. **Límite de alcance:** no adivines el futuro. Si falta información, una dependencia resulta incompatible o se necesita un archivo/función no contemplado, detente y aplica el protocolo de desviación.
4. **Cambios existentes:** `pending.md` y cualquier cambio no creado por la tarea se consideran ajenos; no modificarlos, borrarlos ni incluirlos en commits.
5. **Dependencias y red:** no instalar ni actualizar paquetes sin autorización explícita. No usar red pública, credenciales, HOME real ni datos reales en pruebas.
6. **Autodestrucción:** cuando todas las tareas y criterios estén verificados, elimina físicamente `TODO.md` y realiza el commit final indicado.

## Protocolo de desviación

```text
ALERTA DE DESVIACIÓN DE PLAN

Tarea en curso: <ID>
Bloqueo detectado: <hecho y evidencia>
Impacto: <archivos, contratos y verificaciones>
Propuesta: <ajuste mínimo solicitado>
```

No marcar la tarea en curso ni corregir silenciosamente el bloqueo hasta que el Orquestador actualice este plan.
