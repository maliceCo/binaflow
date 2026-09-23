# Binaflow Wireframe

Editor web local y reutilizable para diseñar una pantalla con bloques sobre una grilla. Es un proyecto independiente: no inicia Binaflow, no accede a sus datos y no genera código automáticamente.

## Requisitos

- Node.js 22 o superior
- pnpm 11
- Chromium instalado para ejecutar la prueba E2E

## Instalación y desarrollo

Desde esta carpeta:

```bash
pnpm install
pnpm dev
```

Vite mostrará una dirección local. El editor funciona completamente en el navegador.

Comandos de calidad:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Uso

- **Nuevo:** crea una pantalla vacía. Si hay bloques, pide confirmación.
- **Añadir bloque:** crea un bloque raíz y lo selecciona.
- **Añadir dentro:** desde cualquier bloque raíz, crea otro hijo dentro de él cuando quede espacio.
- **Seleccionar padre:** desde un hijo, selecciona su contenedor. El inspector identifica raíces e hijos y permite devolver un hijo al lienzo o elegir otro contenedor cuando quepa.
- **Mover y redimensionar:** arrastra el bloque o usa los campos de posición y tamaño del inspector. Los cambios se ajustan a la grilla; la geometría de un hijo es relativa al padre.
- **Duplicar:** crea una copia con un ID nuevo; duplicar un padre copia también sus hijos.
- **Eliminar:** elimina el bloque seleccionado. Eliminar un padre pide confirmación y elimina también sus hijos.
- **+6 filas:** amplía manualmente el lienzo hasta 500 filas. La altura se conserva y no se reduce automáticamente.
- **Importar JSON:** abre un archivo `.json` válido.
- **Exportar JSON:** descarga el diseño actual.

El borrador se guarda automáticamente en `localStorage` del navegador. El archivo JSON exportado es la copia portable y la fuente que puede leer una persona o un agente para implementar posteriormente la UI descrita.

## Formato JSON v2 y compatibilidad v1

El editor importa wireframes v1 como v2: todos los bloques antiguos pasan a ser raíces y la altura inicial se calcula para que quepan. El original no se modifica; autosave y exportación usan v2. Los archivos existentes de `designs/` pueden permanecer en v1 hasta que se importen.

```json
{
  "version": 2,
  "name": "Modal de configuración",
  "grid": { "columns": 12, "rowHeight": 40 },
  "canvas": { "rows": 24 },
  "blocks": [
    {
      "id": "modal",
      "parentId": null,
      "title": "Contenedor modal",
      "description": "Ventana superpuesta; el disparador está en otro wireframe.",
      "x": 2,
      "y": 2,
      "width": 8,
      "height": 12
    },
    {
      "id": "formulario",
      "parentId": "modal",
      "title": "Formulario",
      "description": "Contenido del modal.",
      "x": 1,
      "y": 2,
      "width": 6,
      "height": 5
    }
  ]
}
```

Las posiciones y tamaños usan unidades lógicas de grilla, no píxeles:

- La grilla tiene 12 columnas y cada fila equivale a 40 px.
- `canvas.rows` es un entero entre 18 y 500. Las raíces deben caber dentro del lienzo.
- `x` y `y` empiezan en cero; `width` y `height` son como mínimo `1`.
- `parentId: null` indica raíz. Un ID indica hijo y sus cuatro valores geométricos son relativos al padre.
- Solo se permite un nivel de hijos. Un hijo debe caber por completo en su padre; una raíz debe caber en el lienzo.
- Los bloques pueden solaparse; la superposición no crea parentesco y el editor no mueve otros bloques automáticamente.

Límites del formato:

- Nombre: 100 caracteres.
- Título: 120 caracteres.
- Descripción: 4000 caracteres.
- Máximo: 200 bloques.
- Archivo importado: 1 MiB.
- Los campos desconocidos, las versiones no soportadas y la geometría inválida se rechazan.

Un JSON inválido no reemplaza el diseño que está abierto. Los títulos y descripciones se muestran como texto seguro, no como HTML.

### Convención para pantallas y modales

Cada archivo describe una sola superficie visible. Un modal se representa en un archivo separado, con `OVERLAY MODAL` en el nombre del documento y un bloque raíz para el contenedor; sus controles internos pueden ser hijos de ese contenedor. En el wireframe de la pantalla que lo abre se conserva solo el disparador y una referencia al archivo del modal; su contenido no se mezcla con el layout base. Las secciones expandibles que no son modales se etiquetan explícitamente como tales.

## Alcance del MVP

El editor representa la intención visual de una sola pantalla para facilitar una conversación de diseño. No implementa todavía:

- generación automática de código o integración con IA;
- backend, cuentas, colaboración o sincronización;
- múltiples pantallas dentro de un documento;
- más de un nivel de anidación, conexiones o una biblioteca de componentes;
- undo/redo;
- exportación PNG/SVG;
- breakpoints responsive específicos.

Estas pueden evaluarse como extensiones independientes si aparece una necesidad concreta.
