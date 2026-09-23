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
- **Añadir bloque:** crea un rectángulo y lo selecciona.
- **Seleccionar:** haz clic en un bloque para abrir sus propiedades.
- **Mover y redimensionar:** arrastra el bloque o usa los campos de posición y tamaño del inspector. Los cambios se ajustan a la grilla.
- **Duplicar:** crea una copia con un ID nuevo.
- **Eliminar:** quita el bloque seleccionado.
- **Importar JSON:** abre un archivo `.json` válido.
- **Exportar JSON:** descarga el diseño actual.

El borrador se guarda automáticamente en `localStorage` del navegador. El archivo JSON exportado es la copia portable y la fuente que puede leer una persona o un agente para implementar posteriormente la UI descrita.

## Formato JSON v1

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
      "id": "runs",
      "title": "Lista de ejecuciones",
      "description": "Mostrar estado y fecha. Al seleccionar, actualizar el panel de detalle.",
      "x": 0,
      "y": 0,
      "width": 3,
      "height": 5
    }
  ]
}
```

Las posiciones y tamaños usan unidades lógicas de grilla, no píxeles:

- La grilla tiene 12 columnas.
- `x` y `y` empiezan en cero.
- `width` y `height` son como mínimo `1`.
- `x + width` no puede superar 12.
- `rowHeight` debe ser exactamente 40.
- Los bloques pueden solaparse; el editor no compacta ni mueve otros bloques automáticamente.

Límites del formato v1:

- Nombre: 100 caracteres.
- Título: 120 caracteres.
- Descripción: 4000 caracteres.
- Máximo: 200 bloques.
- Archivo importado: 1 MiB.
- Los campos desconocidos, las versiones no soportadas y la geometría inválida se rechazan.

Un JSON inválido no reemplaza el diseño que está abierto. Los títulos y descripciones se muestran como texto seguro, no como HTML.

## Alcance del MVP

El editor representa la intención visual de una sola pantalla para facilitar una conversación de diseño. No implementa todavía:

- generación automática de código o integración con IA;
- backend, cuentas, colaboración o sincronización;
- múltiples pantallas dentro de un documento;
- componentes anidados, conexiones o una biblioteca de componentes;
- undo/redo;
- exportación PNG/SVG;
- breakpoints responsive específicos.

Estas pueden evaluarse como extensiones independientes si aparece una necesidad concreta.
