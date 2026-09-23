import {
  DEFAULT_ROW_HEIGHT,
  GRID_COLUMNS,
  MAX_BLOCKS,
  MAX_CANVAS_ROWS,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_CANVAS_ROWS,
  WireframeDocumentValidationError,
  createEmptyDocument,
  normalizeBlockGeometry,
  parseWireframeDocument,
  serializeWireframeDocument,
  type WireframeBlockV1,
  type WireframeDocumentV1,
  type WireframeDocumentV2,
} from './model';

function createLegacyDocument(): WireframeDocumentV1 {
  return {
    version: 1,
    name: 'Pantalla de ejecuciones',
    grid: { columns: GRID_COLUMNS, rowHeight: DEFAULT_ROW_HEIGHT },
    blocks: [
      {
        id: 'runs',
        title: 'Lista de ejecuciones',
        description: 'Mostrar estado y fecha.',
        x: 0,
        y: 0,
        width: 3,
        height: 5,
      },
    ],
  };
}

function createBlock(index: number): WireframeBlockV1 {
  return {
    id: `block-${index}`,
    title: `Bloque ${index}`,
    description: '',
    x: 0,
    y: index,
    width: 1,
    height: 1,
  };
}

function createV2Document(): WireframeDocumentV2 {
  const document = createEmptyDocument('Modal de configuración');
  document.canvas.rows = 24;
  document.blocks = [
    {
      id: 'modal',
      parentId: null,
      title: 'Contenedor modal',
      description: 'Ventana superpuesta',
      x: 2,
      y: 2,
      width: 8,
      height: 12,
    },
    {
      id: 'formulario',
      parentId: 'modal',
      title: 'Formulario',
      description: 'Contenido del modal',
      x: 1,
      y: 2,
      width: 6,
      height: 5,
    },
  ];
  return document;
}

describe('wireframe document model', () => {
  it('creates an empty v2 document with a minimum canvas height', () => {
    expect(createEmptyDocument()).toEqual({
      version: 2,
      name: 'Nueva pantalla',
      grid: { columns: 12, rowHeight: 40 },
      canvas: { rows: MIN_CANVAS_ROWS },
      blocks: [],
    });
  });

  it('round-trips a v2 document with explicit parent references', () => {
    const document = createV2Document();
    const serialized = serializeWireframeDocument(document);

    expect(serialized).toContain('"version": 2');
    expect(serialized).toContain('"parentId": "modal"');
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseWireframeDocument(JSON.parse(serialized))).toEqual(document);
  });

  it('imports v1 blocks as roots without mutating the source', () => {
    const legacy = createLegacyDocument();
    const parsed = parseWireframeDocument(legacy);

    expect(parsed).toMatchObject({ version: 2, canvas: { rows: MIN_CANVAS_ROWS } });
    expect(parsed.blocks[0]?.parentId).toBeNull();
    expect(legacy.blocks[0]).not.toHaveProperty('parentId');
    expect(legacy.version).toBe(1);
  });

  it('sizes the migrated canvas to fit legacy roots and rejects overflow', () => {
    const legacy = createLegacyDocument();
    legacy.blocks[0]!.y = 20;
    expect(parseWireframeDocument(legacy).canvas.rows).toBe(27);
    legacy.blocks[0]!.y = MAX_CANVAS_ROWS;
    expect(() => parseWireframeDocument(legacy)).toThrow(/500 filas/);
  });

  it('returns detached objects when parsing v2', () => {
    const input = createV2Document();
    const parsed = parseWireframeDocument(input);

    input.blocks[0]!.title = 'Cambió la entrada';
    input.canvas.rows = 30;
    expect(parsed.blocks[0]!.title).toBe('Contenedor modal');
    expect(parsed.canvas.rows).toBe(24);
  });

  it('normalizes geometry using a parent-specific column count', () => {
    expect(normalizeBlockGeometry({ x: 3.6, y: -2.4, width: 20.2, height: 0.2 })).toEqual({
      x: 4,
      y: 0,
      width: 8,
      height: 1,
    });
    expect(normalizeBlockGeometry({ x: 20, y: 2, width: 5, height: 2 }, 6)).toEqual({
      x: 5,
      y: 2,
      width: 1,
      height: 2,
    });
  });

  it('rejects extra fields and future versions', () => {
    const document = createV2Document();
    expect(() => parseWireframeDocument({ ...document, extra: true })).toThrow(
      WireframeDocumentValidationError,
    );
    expect(() => parseWireframeDocument({ ...document, version: 3 })).toThrow(/no está soportada/);
    expect(() =>
      parseWireframeDocument({ ...document, canvas: { rows: 24, extra: true } }),
    ).toThrow(/campos no permitidos/);
  });

  it('rejects invalid parents, self references, and nested grandchildren', () => {
    const document = createV2Document();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: document.blocks.map((block) =>
          block.id === 'formulario' ? { ...block, parentId: 'missing' } : block,
        ),
      }),
    ).toThrow(/padre/);
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: document.blocks.map((block) =>
          block.id === 'formulario' ? { ...block, parentId: 'formulario' } : block,
        ),
      }),
    ).toThrow(/padre/);
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [
          ...document.blocks,
          { ...document.blocks[1]!, id: 'campo', parentId: 'formulario' },
        ],
      }),
    ).toThrow(/padre/);
  });

  it('rejects children outside their parent and roots outside the canvas', () => {
    const document = createV2Document();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: document.blocks.map((block) =>
          block.id === 'formulario' ? { ...block, x: 3, width: 6 } : block,
        ),
      }),
    ).toThrow(/fuera de su padre/);
    expect(() =>
      parseWireframeDocument({
        ...document,
        canvas: { rows: 18 },
        blocks: document.blocks.map((block) =>
          block.id === 'modal' ? { ...block, y: 10, height: 12 } : block,
        ),
      }),
    ).toThrow(/fuera de el lienzo/);
  });

  it('accepts only the fixed 12-column, 40-pixel grid when parsing v1', () => {
    const legacy = createLegacyDocument();
    expect(parseWireframeDocument(legacy).grid.rowHeight).toBe(DEFAULT_ROW_HEIGHT);

    for (const rowHeight of [0, 1, 999999999, 1.5]) {
      expect(() =>
        parseWireframeDocument({ ...legacy, grid: { ...legacy.grid, rowHeight } }),
      ).toThrow();
    }
  });

  it('rejects invalid canvas sizes and non-v1 grid dimensions', () => {
    const document = createV2Document();
    for (const rows of [0, 17, 501, 1.5]) {
      expect(() => parseWireframeDocument({ ...document, canvas: { rows } })).toThrow();
    }
    expect(MAX_CANVAS_ROWS).toBe(500);
    expect(() =>
      parseWireframeDocument({ ...document, grid: { columns: 12, rowHeight: 999 } }),
    ).toThrow(/12 columnas/);
  });

  it('rejects duplicate IDs and strings or collections over their limits', () => {
    const document = createV2Document();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [document.blocks[0], { ...document.blocks[1], id: 'modal' }],
      }),
    ).toThrow(/repetido/);
    expect(() =>
      parseWireframeDocument({ ...document, name: 'x'.repeat(MAX_DOCUMENT_NAME_LENGTH + 1) }),
    ).toThrow();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }],
      }),
    ).toThrow();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }],
      }),
    ).toThrow();
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: Array.from({ length: MAX_BLOCKS + 1 }, (_, index) => ({
          ...createBlock(index),
          parentId: null,
        })),
      }),
    ).toThrow(/200/);
  });
});
