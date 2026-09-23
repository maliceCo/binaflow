export const WIREFRAME_DOCUMENT_VERSION = 1 as const;
export const GRID_COLUMNS = 12;
export const DEFAULT_ROW_HEIGHT = 40;
export const MAX_BLOCKS = 200;
export const MAX_DOCUMENT_NAME_LENGTH = 100;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 4000;

export type WireframeDocumentVersion = typeof WIREFRAME_DOCUMENT_VERSION;

export interface WireframeGridV1 {
  columns: typeof GRID_COLUMNS;
  rowHeight: number;
}

export interface WireframeBlockV1 {
  id: string;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WireframeDocumentV1 {
  version: WireframeDocumentVersion;
  name: string;
  grid: WireframeGridV1;
  blocks: WireframeBlockV1[];
}

export type BlockGeometry = Pick<WireframeBlockV1, 'x' | 'y' | 'width' | 'height'>;

export class WireframeDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireframeDocumentValidationError';
  }
}

export function createEmptyDocument(name = 'Nueva pantalla'): WireframeDocumentV1 {
  if (name.length > MAX_DOCUMENT_NAME_LENGTH) {
    throw new WireframeDocumentValidationError('El nombre del documento es demasiado largo');
  }

  return {
    version: WIREFRAME_DOCUMENT_VERSION,
    name,
    grid: {
      columns: GRID_COLUMNS,
      rowHeight: DEFAULT_ROW_HEIGHT,
    },
    blocks: [],
  };
}

export function normalizeBlockGeometry(geometry: BlockGeometry): BlockGeometry {
  const x = clampInteger(geometry.x, 0, GRID_COLUMNS - 1);
  const y = Math.max(0, toInteger(geometry.y));
  const width = clampInteger(geometry.width, 1, GRID_COLUMNS - x);
  const height = Math.max(1, toInteger(geometry.height));

  return { x, y, width, height };
}

export function parseWireframeDocument(input: unknown): WireframeDocumentV1 {
  const document = asRecord(input, 'El documento debe ser un objeto');
  assertExactKeys(document, ['version', 'name', 'grid', 'blocks'], 'documento');

  if (document.version !== WIREFRAME_DOCUMENT_VERSION) {
    throw new WireframeDocumentValidationError('La versión del documento no está soportada');
  }

  const name = readString(document.name, 'name', MAX_DOCUMENT_NAME_LENGTH);
  const grid = parseGrid(document.grid);
  const blocks = parseBlocks(document.blocks);

  return {
    version: WIREFRAME_DOCUMENT_VERSION,
    name,
    grid,
    blocks,
  };
}

export function serializeWireframeDocument(document: WireframeDocumentV1): string {
  const validated = parseWireframeDocument(document);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

function parseGrid(input: unknown): WireframeGridV1 {
  const grid = asRecord(input, 'grid debe ser un objeto');
  assertExactKeys(grid, ['columns', 'rowHeight'], 'grid');

  if (grid.columns !== GRID_COLUMNS || grid.rowHeight !== DEFAULT_ROW_HEIGHT) {
    throw new WireframeDocumentValidationError('La grilla debe tener 12 columnas y filas de 40 px');
  }
  return {
    columns: GRID_COLUMNS,
    rowHeight: DEFAULT_ROW_HEIGHT,
  };
}

function parseBlocks(input: unknown): WireframeBlockV1[] {
  if (!Array.isArray(input)) {
    throw new WireframeDocumentValidationError('blocks debe ser un array');
  }

  if (input.length > MAX_BLOCKS) {
    throw new WireframeDocumentValidationError(`No se permiten más de ${MAX_BLOCKS} bloques`);
  }

  const ids = new Set<string>();
  return input.map((value, index) => {
    const block = asRecord(value, `blocks[${index}] debe ser un objeto`);
    assertExactKeys(
      block,
      ['id', 'title', 'description', 'x', 'y', 'width', 'height'],
      `blocks[${index}]`,
    );

    const id = readString(block.id, `blocks[${index}].id`, 100);
    if (id.length === 0) {
      throw new WireframeDocumentValidationError(`blocks[${index}].id no puede estar vacío`);
    }
    if (ids.has(id)) {
      throw new WireframeDocumentValidationError(`El ID de bloque está repetido: ${id}`);
    }
    ids.add(id);

    const title = readString(block.title, `blocks[${index}].title`, MAX_TITLE_LENGTH);
    const description = readString(
      block.description,
      `blocks[${index}].description`,
      MAX_DESCRIPTION_LENGTH,
    );
    const x = readNonNegativeInteger(block.x, `blocks[${index}].x`);
    const y = readNonNegativeInteger(block.y, `blocks[${index}].y`);
    const width = readPositiveInteger(block.width, `blocks[${index}].width`);
    const height = readPositiveInteger(block.height, `blocks[${index}].height`);

    if (x + width > GRID_COLUMNS) {
      throw new WireframeDocumentValidationError(
        `blocks[${index}] debe permanecer dentro de las ${GRID_COLUMNS} columnas`,
      );
    }

    return { id, title, description, x, y, width, height };
  });
}

function asRecord(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WireframeDocumentValidationError(message);
  }
  return input as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, keys: string[], label: string): void {
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new WireframeDocumentValidationError(`${label} contiene campos no permitidos`);
  }
}

function readString(input: unknown, field: string, maxLength: number): string {
  if (typeof input !== 'string') {
    throw new WireframeDocumentValidationError(`${field} debe ser texto`);
  }
  if (input.length > maxLength) {
    throw new WireframeDocumentValidationError(
      `${field} supera el límite de ${maxLength} caracteres`,
    );
  }
  return input;
}

function readPositiveInteger(input: unknown, field: string): number {
  const value = readInteger(input, field);
  if (value < 1) {
    throw new WireframeDocumentValidationError(`${field} debe ser mayor que cero`);
  }
  return value;
}

function readNonNegativeInteger(input: unknown, field: string): number {
  const value = readInteger(input, field);
  if (value < 0) {
    throw new WireframeDocumentValidationError(`${field} no puede ser negativo`);
  }
  return value;
}

function readInteger(input: unknown, field: string): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || !Number.isFinite(input)) {
    throw new WireframeDocumentValidationError(`${field} debe ser un entero`);
  }
  return input;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, toInteger(value)));
}

function toInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}
