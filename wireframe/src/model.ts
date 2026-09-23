export const WIREFRAME_DOCUMENT_VERSION = 2 as const;
export const GRID_COLUMNS = 12;
export const DEFAULT_ROW_HEIGHT = 40;
export const MIN_CANVAS_ROWS = 18;
export const MAX_CANVAS_ROWS = 500;
export const MAX_BLOCKS = 200;
export const MAX_DOCUMENT_NAME_LENGTH = 100;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 4000;

export interface WireframeGrid {
  columns: typeof GRID_COLUMNS;
  rowHeight: typeof DEFAULT_ROW_HEIGHT;
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

export interface WireframeBlockV2 extends WireframeBlockV1 {
  parentId: string | null;
}

export interface WireframeDocumentV1 {
  version: 1;
  name: string;
  grid: { columns: number; rowHeight: number };
  blocks: WireframeBlockV1[];
}

export interface WireframeDocumentV2 {
  version: typeof WIREFRAME_DOCUMENT_VERSION;
  name: string;
  grid: WireframeGrid;
  canvas: { rows: number };
  blocks: WireframeBlockV2[];
}

export type WireframeDocument = WireframeDocumentV2;
export type WireframeBlock = WireframeBlockV2;
export type BlockGeometry = Pick<WireframeBlockV1, 'x' | 'y' | 'width' | 'height'>;

export class WireframeDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireframeDocumentValidationError';
  }
}

export function createEmptyDocument(name = 'Nueva pantalla'): WireframeDocumentV2 {
  if (name.length > MAX_DOCUMENT_NAME_LENGTH) {
    throw new WireframeDocumentValidationError('El nombre del documento es demasiado largo');
  }

  return {
    version: WIREFRAME_DOCUMENT_VERSION,
    name,
    grid: { columns: GRID_COLUMNS, rowHeight: DEFAULT_ROW_HEIGHT },
    canvas: { rows: MIN_CANVAS_ROWS },
    blocks: [],
  };
}

export function normalizeBlockGeometry(
  geometry: BlockGeometry,
  columns = GRID_COLUMNS,
): BlockGeometry {
  const x = clampInteger(geometry.x, 0, columns - 1);
  const y = Math.max(0, toInteger(geometry.y));
  const width = clampInteger(geometry.width, 1, columns - x);
  const height = Math.max(1, toInteger(geometry.height));
  return { x, y, width, height };
}

export function parseWireframeDocument(input: unknown): WireframeDocumentV2 {
  const record = asRecord(input, 'El documento debe ser un objeto');
  if (record.version !== 1 && record.version !== WIREFRAME_DOCUMENT_VERSION) {
    throw new WireframeDocumentValidationError('La versión del documento no está soportada');
  }

  const legacy = record.version === 1;
  assertExactKeys(
    record,
    legacy
      ? ['version', 'name', 'grid', 'blocks']
      : ['version', 'name', 'grid', 'canvas', 'blocks'],
    'documento',
  );
  const name = readString(record.name, 'name', MAX_DOCUMENT_NAME_LENGTH);
  const grid = parseGrid(record.grid);
  const blocks = parseBlocks(record.blocks, legacy);
  const rows = legacy
    ? Math.max(
        MIN_CANVAS_ROWS,
        ...blocks
          .filter((block) => block.parentId === null)
          .map((block) => block.y + block.height + 2),
      )
    : parseCanvas(record.canvas);

  if (rows > MAX_CANVAS_ROWS) {
    throw new WireframeDocumentValidationError(
      `El lienzo no puede superar ${MAX_CANVAS_ROWS} filas`,
    );
  }

  validateHierarchy(blocks, rows);
  return { version: WIREFRAME_DOCUMENT_VERSION, name, grid, canvas: { rows }, blocks };
}

export function serializeWireframeDocument(document: WireframeDocumentV2): string {
  return `${JSON.stringify(parseWireframeDocument(document), null, 2)}\n`;
}

function parseGrid(input: unknown): WireframeGrid {
  const grid = asRecord(input, 'grid debe ser un objeto');
  assertExactKeys(grid, ['columns', 'rowHeight'], 'grid');
  if (grid.columns !== GRID_COLUMNS || grid.rowHeight !== DEFAULT_ROW_HEIGHT) {
    throw new WireframeDocumentValidationError('La grilla debe tener 12 columnas y filas de 40 px');
  }
  return { columns: GRID_COLUMNS, rowHeight: DEFAULT_ROW_HEIGHT };
}

function parseCanvas(input: unknown): number {
  const canvas = asRecord(input, 'canvas debe ser un objeto');
  assertExactKeys(canvas, ['rows'], 'canvas');
  const rows = readPositiveInteger(canvas.rows, 'canvas.rows');
  if (rows < MIN_CANVAS_ROWS || rows > MAX_CANVAS_ROWS) {
    throw new WireframeDocumentValidationError(
      `canvas.rows debe estar entre ${MIN_CANVAS_ROWS} y ${MAX_CANVAS_ROWS}`,
    );
  }
  return rows;
}

function parseBlocks(input: unknown, legacy: boolean): WireframeBlockV2[] {
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
      legacy
        ? ['id', 'title', 'description', 'x', 'y', 'width', 'height']
        : ['id', 'parentId', 'title', 'description', 'x', 'y', 'width', 'height'],
      `blocks[${index}]`,
    );

    const id = readString(block.id, `blocks[${index}].id`, 100);
    if (!id.trim() || ids.has(id)) {
      throw new WireframeDocumentValidationError(`El ID de bloque está vacío o repetido: ${id}`);
    }
    ids.add(id);

    const parentId = legacy ? null : readParentId(block.parentId, index);
    return {
      id,
      parentId,
      title: readString(block.title, `blocks[${index}].title`, MAX_TITLE_LENGTH),
      description: readString(
        block.description,
        `blocks[${index}].description`,
        MAX_DESCRIPTION_LENGTH,
      ),
      x: readNonNegativeInteger(block.x, `blocks[${index}].x`),
      y: readNonNegativeInteger(block.y, `blocks[${index}].y`),
      width: readPositiveInteger(block.width, `blocks[${index}].width`),
      height: readPositiveInteger(block.height, `blocks[${index}].height`),
    };
  });
}

function readParentId(input: unknown, index: number): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || !input.trim() || input.length > 100) {
    throw new WireframeDocumentValidationError(`blocks[${index}].parentId debe ser un ID o null`);
  }
  return input;
}

function validateHierarchy(blocks: WireframeBlockV2[], rows: number): void {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  for (const block of blocks) {
    const parent = block.parentId === null ? null : byId.get(block.parentId);
    if (
      block.parentId !== null &&
      (!parent || parent.id === block.id || parent.parentId !== null)
    ) {
      throw new WireframeDocumentValidationError(
        `El padre de ${block.id} no existe o no es un bloque raíz`,
      );
    }

    const maxColumns = parent?.width ?? GRID_COLUMNS;
    const maxRows = parent?.height ?? rows;
    if (block.x + block.width > maxColumns || block.y + block.height > maxRows) {
      throw new WireframeDocumentValidationError(
        `El bloque ${block.id} queda fuera de ${parent ? 'su padre' : 'el lienzo'}`,
      );
    }
  }
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
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new WireframeDocumentValidationError(`${field} debe ser un entero`);
  }
  return input;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, toInteger(value)));
}

function toInteger(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}
