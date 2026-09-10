# Componentes TUI: Evaluacion Tecnica Para Luna

## Resultado Y Gate

Evaluacion documental y de codigo distribuido, seguida de implementacion en los componentes seleccionados. La seleccion tecnica queda fijada abajo. El propietario aprobo declarar dos dependencias directas: `string-width@8.2.2` en 3.2 y `marked@18.0.11` en 3.4; ambas estan ahora en `package.json` y `pnpm-lock.yaml`. Gate 1.2 cerrado. No cambiar de paquete/version a criterio de Luna.

No se necesita un spike adicional para las APIs documentadas. Las pruebas de integracion/terminal siguen aplazadas por el propietario: no afirmar que Linux/Windows, IME, pegado o resize se probaron. Esta evaluacion y los checks estaticos no satisfacen por si solos la verificacion conductual de la entrega.

## Evidencia Reproducible

Comandos ejecutados en esta revision (solo consulta):

```sh
pnpm list ink @inkjs/ui react --depth 0
pnpm view marked@18.0.11 version license engines dependencies peerDependencies dist.unpackedSize dist.tarball --json
pnpm view markdown-it@14.1.0 version license engines dependencies peerDependencies dist.unpackedSize --json
pnpm view ink-text-input@6.0.0 version license engines dependencies peerDependencies dist.unpackedSize --json
pnpm view ink-markdown@1.0.3 version license engines dependencies peerDependencies dist.unpackedSize --json
pnpm view string-width@8.2.2 dist.unpackedSize --json
```

Instalado y fijado en package/lock: Ink 7.1.1, Ink UI 2.0.0, React 19.2.8, tipos React 19.2.2. Runtime observado Node 24.20.0, pnpm 11.18.0; producto exige Node >=22.

Se leyeron README, package.json y declaraciones/implementaciones distribuidas indicadas abajo. Para candidatos no instalados se descargaron tarballs oficiales a `/tmp`, sin importar/ejecutar su codigo, correr scripts o alterar node_modules/lockfile. La reproduccion no depende de conservar `/tmp`: usar URLs versionadas de fuentes.

El README instalado de Ink advierte que puede describir una version proxima. Por eso cada API seleccionada se contrasto contra `build/index.d.ts` y los archivos distribuidos de 7.1.1, no solo el README. Los links `docs/` de Ink UI no vienen incluidos en el paquete; se verificaron sus `.d.ts` y `.js` instalados.

## Seleccion Minima

| Necesidad                   | Solucion                                                      | Dependencia nueva                                | Motivo                                                                 |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| Marco, layout, tema         | Ink Box/Text y helpers locales actuales                       | Ninguna                                          | No ampliar framework por estilo.                                       |
| Foco y teclado              | Estado explicito del shell + useInput/usePaste de Ink         | Ninguna                                          | Un solo destino activo por evento.                                     |
| Editor multilinea           | `message-editor.tsx` controlado, operaciones locales acotadas | Ninguna libreria de editor                       | TextInput actual envia con Enter y no navega verticalmente.            |
| Segmentacion Unicode        | Intl.Segmenter de Node                                        | Ninguna                                          | Cursor/delete por grafema, no por unidad UTF-16.                       |
| Anchura de columnas         | string-width 8.2.2                                            | Declararla directa, ya instalada transitivamente | No reinventar anchuras de CJK/emoji ni importar rutas internas de Ink. |
| Scroll y retorno            | viewport propio existente + paginas de fachada                | Ninguna libreria de scroll                       | Necesita cursores/versiones propios, no scrollback del terminal.       |
| Parser Markdown             | marked 18.0.11, lexer solamente                               | Si                                               | Parser mantenido sin dependencias runtime ni peer de React/Ink.        |
| Render Markdown             | `markdown.tsx`: tokens -> spans/texto Ink propios             | Ninguna adicional                                | Control de sanitizacion, anchura, fallback y NO_COLOR.                 |
| Capacidades de razonamiento | Desconocidas a partir del adapter actual                      | Ninguna                                          | No hay fuente normalizada/verificada de niveles.                       |

No instalar `ink-text-input`, `ink-markdown`, `markdown-it`, libreria de virtualizacion, resaltado de sintaxis, editor externo ni SDK de proveedor. No usar dependencias transitivas por rutas `.pnpm`, deep import no exportado o paquetes del harness global.

## Version, Licencia, Mantenimiento Y Costo

| Paquete              | Licencia / peers / runtime                                                         | Evidencia de mantenimiento                                                                     | Tamaño observado                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ink 7.1.1            | MIT; Node >=22; React >=19.2.0; tipos React >=19.2.0 opcionales                    | Registro: 7.1.1 publicado 2026-07-16                                                           | Directorio instalado 956 KiB; dependencias ya existentes.                                             |
| @inkjs/ui 2.0.0      | MIT; Node >=18; peer Ink >=5; desarrollo original con React 18                     | Registro: version 2.0.0 de 2024-05-22; no asumir pruebas actuales con React 19 por peer amplio | Directorio instalado 500 KiB. Mantener legacy, no expandir su uso interactivo.                        |
| react 19.2.8         | MIT; satisface peer de Ink instalado                                               | Version fijada en lock y package.json                                                          | Directorio instalado 228 KiB. Sin cambios.                                                            |
| string-width 8.2.2   | MIT; ESM, Node >=20; sin peer Ink/React; runtime get-east-asian-width y strip-ansi | Registro: 8.2.2 de 2026-07-08; ya resuelta por Ink                                             | dist.unpackedSize 11.733 bytes; directorio 24 KiB. No duplicar version resuelta.                      |
| marked 18.0.11       | MIT; ESM y tipos incluidos; Node >=20; sin dependencias runtime ni peer Ink/React  | Ultima estable consultada, publicada 2026-08-24                                                | dist.unpackedSize 479.846 bytes; no es tamaño del bundle ni medida de rendimiento.                    |
| markdown-it 14.1.0   | MIT; sin peer Ink/React; 6 dependencias runtime declaradas                         | Alternativa madura, version consultada no presentada como ultima                               | dist.unpackedSize 767.399 bytes, excluye dependencias; descartado por mayor superficie para este uso. |
| ink-text-input 6.0.0 | MIT; Node >=18; peers Ink >=5/React >=18                                           | Codigo distribuido inspeccionado, no probado en este proyecto                                  | 15.004 bytes + chalk/type-fest; no resuelve multilinea.                                               |
| ink-markdown 1.0.3   | MIT; peers Ink >=2/React >=16.8; depende de marked ^9 y marked-terminal ^6         | Metadata versionada, no se ha comprobado funcionamiento en Ink 7                               | 3.017 bytes del wrapper, excluye dependencias; ruta ANSI y lexer antiguo no elegidos.                 |

Fechas son evidencia del registro consultado, no promesas de soporte futuro ni auditoria de vulnerabilidades. Tamaños de directorio y dist.unpackedSize son medidas distintas. Los paquetes candidatos descartados no se han instalado ni integrado; `string-width` y `marked` son las dependencias seleccionadas e integradas. Peer compatible no equivale a terminal probado.

## APIs Y Archivos De Implementacion

### 3.0-3.1: Marco Y Ciclo De Vida

Conservar `render(root, { stdin, stdout, stderr, interactive: true, alternateScreen: true, exitOnCtrlC: false, patchConsole: false })` de `src/tui/bootstrap.tsx`. APIs verificadas en `node_modules/ink/build/render.d.ts`, `build/ink.d.ts` y README instalado: `rerender`, `waitUntilExit`, `unmount`.

- Mantener la suscripcion de resize ya existente; no añadir tambien `useWindowSize` como segundo propietario del tamaño del shell.
- Mantener identidad del root durante rerender, sin keys que remounten lifecycle/editor por anchura.
- `Box` proporciona width/height/flexShrink/overflow; clipping no es paginacion ni virtualizacion.
- Pantalla alternativa no tiene scrollback normal. No prometer que scroll del terminal sustituye el viewport propio.
- `theme.ts` exporta valores/helpers semanticos usados por `components.tsx` y `layout.tsx`. No nuevo ThemeProvider para una segunda gestion de estado ni animaciones adicionales.
- Ink UI ofrece `ThemeProvider`, `extendTheme`, `defaultTheme`, `useComponentTheme` (README y build/index.d.ts), pero no son necesarios para el marco local seleccionado. Preservar componentes legacy sin migracion estetica masiva.
- Signals/stream/render failure llaman shutdown del owner antes de cerrar recursos; `useApp().exit()` de un widget no puede saltarse la limpieza.

### 3.2: Entrada Y Editor

APIs verificadas: `useInput(handler, { isActive })`, `usePaste(handler, { isActive })`, `useCursor().setCursorPosition`, `measureElement(ref)`; exports publicos en `node_modules/ink/build/index.d.ts`. Fuente: `build/hooks/use-input.js`, `use-paste.js`, `components/App.js`, `input-parser.js`.

Decision de foco: reducer del shell es la unica fuente, sin `useFocus`/`useFocusManager` para las nuevas vistas. El shell en `shell-controller.tsx` tiene un `useInput` y un `usePaste` para ellas, enruta a `shell-input.ts` y al estado del editor. `message-editor.tsx` no registra otro listener: recibe value/cursor/viewport y renderiza; exporta helpers puros de edicion si el controller los necesita. No un bus generico de eventos.

- `useInput` entrega input/key con home/end/pageUp/pageDown/delete y flechas. Ignorar key.eventType release; Enter normal edita, no envia. Mantener Ctrl+C del owner.
- `usePaste` habilita bracketed paste y entrega string completo en canal separado. Mantenerlo activo tambien en acciones/documento de estas vistas: pegar alli no se reenvia como teclas; mostrar aviso para enfocar editor. No mover foco automaticamente.
- No hay stopPropagation entre hooks de Ink. Desactivar/unmontar listeners de las pantallas sustituidas; no confiar en orden de registro. En pantallas legacy conservar su manejo, sin interceptar su pegado con un nuevo listener global activo por accidente.
- `@inkjs/ui` TextInput declara `isDisabled`, no `isActive`; su hook usa useInput con isActive=!isDisabled, ignora up/down y ejecuta submit en Enter. No envolverlo para fingir soporte multilinea.
- `ink-text-input` 6.0.0 es controlado pero tambien ignora up/down y envia con Enter: descartado, no fork/copiar paquete.
- Editor minimo: insertar texto/nueva linea; flechas por grafema y linea; Home/End de linea; Backspace elimina anterior y Delete siguiente; mantener columna preferida al subir/bajar. Sin undo, seleccion por mouse, autocompletado ni editor externo en este scope.
- `Intl.Segmenter(undefined, { granularity: 'grapheme' })` delimita cursor; `stringWidth(grapheme, { ambiguousIsNarrow: true })` mide celdas. No tratar `value.length` como ancho ni cortar un grafema con .slice arbitrario. `String.length` sigue midiendo los presupuestos aprobados, no las columnas.
- Editor controlado por borrador tiene `{ value, cursorOffset, preferredColumn, visualOffset, editRevision }`. cursorOffset en UTF-16 siempre sobre frontera de grafema; editRevision local, no CAS del borrador persistido.
- `measureElement` se llama despues del layout, no durante render; `useCursor` solo muestra cursor dentro del editor activo, nunca escribe escapes manuales. Ajustar alto del editor al espacio visible y conservar el texto restante con indicador de scroll.
- Pegado: normalizar CRLF/CR a LF, expandir Tab a espacios para presentacion/editor y eliminar controles de terminal con aviso cuando hubo cambios. No ejecutar OSC/CSI ni convertir Escape pegado en volver. Rechazar insercion completa si supera limite de mensaje, sin truncarla silenciosamente.

Limite importante: `usePaste` protege pegado bracketed. Si un terminal envia contenido y controles como teclas individuales sin marcadores, son indistinguibles de pulsaciones reales; no prometer deteccion por heuristica temporal. Mostrar requisito/limitacion de pegado seguro y mantener aprobacion explicita. Soporte de terminales concretos e IME no probado; el futuro recorrido de validacion debe comprobarlo antes de afirmar compatibilidad.

### 3.3: Viewport, Anchuras Y Cache

Reutilizar `scrollText`, `moveSelection`, `keepSelectionVisible` de `src/tui/viewport.ts` para limites/seleccion, ampliando solo el calculo necesario. Implementar mapeo fuente -> filas visibles en `src/tui/text.ts` con Intl.Segmenter/string-width; `document-view.tsx` representa filas, no pide archivos directamente.

`DocumentPage` se obtiene desde 2.6 por controller; ancla guarda documento/version/offset de fuente, posicion dentro de bloque y cursor de pagina. Al redimensionar, recalcular wrapping sobre paginas cacheadas y restaurar el bloque/fragmento observado, no solo conservar un indice de fila renderizada. El cache total de 3 paginas y retorno de 20 entradas son limites reales; descartar payload anterior al cambiar documento.

No usar `<Static>` para conversacion mutable: ignora actualizaciones de elementos anteriores. No renderToString por cada pulsacion para descubrir scroll ni montar una segunda instancia de Ink para medir. Render de filas visibles y metadatos acotados, no todos los nodos de todo el historial. Los errores/stale cursor quedan visibles con accion de recarga del documento correcto.

### 3.4: Markdown Sin HTML Ni ANSI Del Parser

Paquete seleccionado y aprobado: `marked@18.0.11`. API contrastada contra `lib/marked.d.ts` del tarball: `new Marked({ gfm: true, breaks: false })`, `.lexer(source): TokensList`, tokens `type/raw/text/tokens`, heading.depth, list.items, table.header/rows. Usar instancia local sin extensiones globales ni marked.use global.

- No llamar `marked.parse` para generar HTML ni pasar HTML a Ink. El README advierte que Marked no sanitiza HTML; no necesitamos DOMPurify porque no ejecutamos/renderizamos HTML.
- `markdown.tsx` transforma tokens conocidos a spans/filas propias. `heading`, `paragraph`, `strong`, `em`, `del`, `list`, `blockquote`, `code`, `codespan`, `br`, `hr`, `table`, `link` tienen representacion explicita. Tokens desconocidos usan fuente sanitizada con aviso, no se descartan.
- `html` se muestra como texto literal seguro; imagen muestra alt y referencia textual, sin descarga. Enlace muestra etiqueta y URL sanitizadas, no hipervinculo OSC8 ni apertura automatica.
- Codigo conserva espacios y tiene rotulo; sin syntax highlighter. Tablas anchas se representan como filas de pares cabecera/valor si no caben. Celdas/codigo largos usan wrapping e indicador de continuacion, no truncado silencioso.
- La fuente sin formato siempre esta disponible. En paginas parciales, usar Fuente parcial para el conjunto paginado antes que fingir un parser incremental correcto. No leer todas las paginas para cerrar una fence ni emitir estilos sobre codigo incompleto como si fuera prosa.
- Sanitizar contenido antes de lexear/estilar; conservar offsets de fuente por bloque antes de normalizar para mantener ancla. El mapeo de sanitizacion no se usa como cursor SQL/filesystem.
- Limite de entrada por pagina y cache de P6; limitar tambien expansion de texto renderizado a 64 KiB por pagina (por ejemplo, URLs de referencias repetidas). Si la expansion excede el presupuesto, usar fuente con aviso, no construir una salida ilimitada a partir de Markdown corto. Recorrer tokens solo para las paginas cargadas. Si el parser o recorrido falla por contenido patologico, fallback fuente con aviso; no ocultar errores ni congelar la UI en bucles de reparseo.
- Jerarquia con prefijos/rotulos aun sin color. Usar `SafeText`/Text con texto seguro; no aplicar el sanitizador de contenido a los escapes que Ink genera para sus propios estilos.

No cambiar comportamiento CLI de `sanitizeTerminalText` por motivos visuales. Adaptaciones TUI (tabs, rotulos de fuente parcial y anchuras) pertenecen a `src/tui/text.ts`; si se requiere fortalecer seguridad compartida, conservar contrato y documentar el cambio concreto, no reformatear logs.

## Capacidades De Modelos: Decision Cerrada

Fuente examinada: `src/drivers/pi-discovery.ts` mapea provider/id/name desde su cache local y credenciales configuradas; `src/core/agent.ts` expone solo provider/model/displayName. No devuelve niveles de razonamiento. No se leyeron credenciales del propietario ni se inicio Pi.

Para este scope `discoverPreparationModels` envuelve la consulta actual y omite thinkingLevels. Mostrar capacidad Desconocida y ofrecer Default para nuevos cambios, segun P6. Seleccion heredada visible como No verificada, sin fallback silencioso ni promesa de autenticacion. No se modifica `AgentModel`, `AgentModelDiscovery` ni `PiModelDiscovery` solo para añadir una capability hipotetica. Niveles especificos requieren evidencia y otra tarea, no un SDK ni tabla hardcoded por proveedor.

## Dependencias Autorizadas Y Archivos Exactos

1. Tarea 3.2: `pnpm add --save-exact string-width@8.2.2`, cambios limitados a `package.json`, `pnpm-lock.yaml` y componente/helpers previstos. La version ya existe en el lock como transitiva de Ink; import directo exige declararla directa, no un deep import.
2. Tarea 3.4: `pnpm add --save-exact marked@18.0.11`, mismos archivos de manifest/lock mas renderer previsto.

Estos comandos se ejecutaron durante las tareas 3.2 y 3.4 con las versiones aprobadas. Si pnpm cambia paquetes ajenos o resuelve otra version, detener y revisar diff del lock; no actualizar todo. No añadir dependencias adicionales sin una tarea y aprobacion explicitas.

## Fuentes Versionadas

- Ink instalado: `node_modules/ink/package.json`, `readme.md`, `build/index.d.ts`, `build/hooks/use-input.js`, `build/hooks/use-paste.js`, `build/components/App.js`, `build/input-parser.js`.
- Ink UI instalado: `node_modules/@inkjs/ui/package.json`, `readme.md`, `build/components/text-input/text-input.d.ts`, `use-text-input.js`, `use-text-input-state.js` bajo ese directorio.
- string-width instalado: `node_modules/.pnpm/string-width@8.2.2/node_modules/string-width/package.json`, `readme.md`, `index.d.ts`. Ruta solo para auditoria, prohibida como import del producto.
- Metadatos: `https://registry.npmjs.org/ink`, `https://registry.npmjs.org/@inkjs%2fui`, `https://registry.npmjs.org/string-width/8.2.2`, `https://registry.npmjs.org/marked/18.0.11`, `https://registry.npmjs.org/markdown-it/14.1.0`, `https://registry.npmjs.org/ink-text-input/6.0.0`, `https://registry.npmjs.org/ink-markdown/1.0.3`.
- Tarballs leidos: `https://registry.npmjs.org/marked/-/marked-18.0.11.tgz` (package.json, README.md, lib/marked.d.ts); `https://registry.npmjs.org/ink-text-input/-/ink-text-input-6.0.0.tgz` (README/build/index.js). Marked 17.0.1 se consulto inicialmente pero se descarto en favor de la estable actual; no instalar 17 por copiar comandos de investigacion.

## Pendientes Empiricos, No Decisiones Abiertas

Linux y Windows reales, terminal sin bracketed paste, IME/CJK/emoji, focus/cancel tras pegado, documentos que cruzan paginas, NO_COLOR, resize estrecho y stream/render failure no fueron probados. Los componentes elegidos ya estan implementados, pero su comportamiento de terminal no se ha probado. La suite automatizada, migraciones/concurrencia, drivers falsos, E2E y live Pi siguen pendientes hasta que el propietario reactive la validacion. La implementacion debe respetar las APIs/limites elegidos y registrar esas verificaciones sin presentarlas como realizadas.
