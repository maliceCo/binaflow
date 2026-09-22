import {
  DEFAULT_ROW_HEIGHT,
  GRID_COLUMNS,
  MAX_BLOCKS,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  WireframeDocumentValidationError,
  createEmptyDocument,
  normalizeBlockGeometry,
  parseWireframeDocument,
  serializeWireframeDocument,
  type WireframeBlockV1,
  type WireframeDocumentV1,
} from './model';

function createValidDocument(): WireframeDocumentV1 {
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

describe('wireframe document model', () => {
  it('creates an empty versioned document', () => {
    expect(createEmptyDocument()).toEqual({
      version: 1,
      name: 'Nueva pantalla',
      grid: { columns: 12, rowHeight: 40 },
      blocks: [],
    });
  });

  it('round-trips a valid document with deterministic JSON', () => {
    const document = createValidDocument();
    const serialized = serializeWireframeDocument(document);

    expect(serialized).toContain('"version": 1');
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseWireframeDocument(JSON.parse(serialized))).toEqual(document);
  });

  it('returns a detached document when parsing', () => {
    const input = createValidDocument();
    const parsed = parseWireframeDocument(input);

    input.blocks[0]!.title = 'Cambió la entrada';
    input.grid.rowHeight = 80;

    expect(parsed.blocks[0]!.title).toBe('Lista de ejecuciones');
    expect(parsed.grid.rowHeight).toBe(40);
  });

  it('normalizes geometry created by the editor', () => {
    expect(normalizeBlockGeometry({ x: 3.6, y: -2.4, width: 20.2, height: 0.2 })).toEqual({
      x: 4,
      y: 0,
      width: 8,
      height: 1,
    });
    expect(normalizeBlockGeometry({ x: 20, y: 2, width: 5, height: 2 })).toEqual({
      x: 11,
      y: 2,
      width: 1,
      height: 2,
    });
  });

  it('rejects unknown top-level and nested fields', () => {
    const document = createValidDocument();

    expect(() => parseWireframeDocument({ ...document, extra: true })).toThrow(
      WireframeDocumentValidationError,
    );
    expect(() =>
      parseWireframeDocument({
        ...document,
        grid: { ...document.grid, extra: true },
      }),
    ).toThrow(WireframeDocumentValidationError);
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], extra: true }],
      }),
    ).toThrow(WireframeDocumentValidationError);
  });

  it('rejects unsupported versions, duplicate IDs and invalid geometry', () => {
    const document = createValidDocument();

    expect(() => parseWireframeDocument({ ...document, version: 2 })).toThrow(
      WireframeDocumentValidationError,
    );
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [document.blocks[0], { ...document.blocks[0] }],
      }),
    ).toThrow(/repetido/);
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], x: 10, width: 3 }],
      }),
    ).toThrow(/columnas/);
    expect(() =>
      parseWireframeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], width: 1.5 }],
      }),
    ).toThrow(/entero/);
  });

  it('rejects strings and collections over their limits', () => {
    const document = createValidDocument();

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
        blocks: Array.from({ length: MAX_BLOCKS + 1 }, (_, index) => createBlock(index)),
      }),
    ).toThrow(/200/);
  });
});
