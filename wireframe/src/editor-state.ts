import {
  GRID_COLUMNS,
  MAX_BLOCKS,
  MAX_CANVAS_ROWS,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  createEmptyDocument,
  normalizeBlockGeometry,
  parseWireframeDocument,
  type BlockGeometry,
  type WireframeBlockV2,
  type WireframeDocumentV2,
} from './model';

export interface EditorState {
  document: WireframeDocumentV2;
  selectedBlockId: string | null;
  notice: string | null;
}

export type EditorAction =
  | { type: 'rename-document'; name: string }
  | { type: 'add-block'; id: string }
  | { type: 'add-child'; id: string; parentId: string }
  | { type: 'grow-canvas' }
  | { type: 'move-to-parent'; id: string; parentId: string | null }
  | { type: 'select-block'; id: string | null }
  | { type: 'update-block-text'; id: string; field: 'title' | 'description'; value: string }
  | { type: 'set-block-geometry'; id: string; geometry: BlockGeometry }
  | { type: 'duplicate-block'; sourceId: string; id: string; childIds?: string[] }
  | { type: 'delete-block'; id: string }
  | { type: 'replace-document'; document: WireframeDocumentV2 }
  | { type: 'new-document'; name?: string };

export function createEditorState(document = createEmptyDocument()): EditorState {
  return { document: parseWireframeDocument(document), selectedBlockId: null, notice: null };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'rename-document':
      return {
        ...state,
        document: { ...state.document, name: action.name.slice(0, MAX_DOCUMENT_NAME_LENGTH) },
      };
    case 'add-block':
      return addBlock(state, action.id, null);
    case 'add-child':
      return addBlock(state, action.id, action.parentId);
    case 'grow-canvas':
      if (state.document.canvas.rows >= MAX_CANVAS_ROWS) {
        return withNotice(state, `El lienzo ya alcanzó el máximo de ${MAX_CANVAS_ROWS} filas.`);
      }
      return {
        ...state,
        notice: null,
        document: {
          ...state.document,
          canvas: { rows: Math.min(MAX_CANVAS_ROWS, state.document.canvas.rows + 6) },
        },
      };
    case 'move-to-parent':
      return moveToParent(state, action.id, action.parentId);
    case 'select-block':
      return {
        ...state,
        selectedBlockId:
          action.id !== null && state.document.blocks.some((block) => block.id === action.id)
            ? action.id
            : null,
      };
    case 'update-block-text':
      return updateBlockText(state, action);
    case 'set-block-geometry':
      return updateBlockGeometry(state, action.id, action.geometry);
    case 'duplicate-block':
      return duplicateBlock(state, action.sourceId, action.id, action.childIds ?? []);
    case 'delete-block':
      return deleteBlock(state, action.id);
    case 'replace-document':
      return createEditorState(action.document);
    case 'new-document':
      return createEditorState(createEmptyDocument(action.name ?? 'Nueva pantalla'));
  }
}

function withNotice(state: EditorState, notice: string): EditorState {
  return { ...state, notice };
}

function isValidNewId(blocks: WireframeBlockV2[], id: string): boolean {
  return !!id.trim() && id.length <= 100 && !blocks.some((block) => block.id === id);
}

function addBlock(state: EditorState, id: string, parentId: string | null): EditorState {
  const blocks = state.document.blocks;
  if (!isValidNewId(blocks, id)) return state;
  if (blocks.length >= MAX_BLOCKS)
    return withNotice(state, `No se permiten más de ${MAX_BLOCKS} bloques.`);

  const parent = parentId === null ? null : blocks.find((block) => block.id === parentId);
  if (parentId !== null && (!parent || parent.parentId !== null)) {
    return withNotice(state, 'Solo puedes añadir bloques dentro de un bloque raíz.');
  }

  const width = parent ? Math.min(2, parent.width) : 3;
  const height = parent ? 1 : 3;
  const position = findFirstOpenPosition(
    blocks.filter((block) => block.parentId === parentId),
    parent?.width ?? GRID_COLUMNS,
    parent?.height ?? state.document.canvas.rows,
    width,
    height,
  );
  if (!position) {
    const message = parent
      ? 'No hay espacio dentro del bloque seleccionado.'
      : 'No hay espacio en el lienzo. Amplíalo para añadir otro bloque.';
    return withNotice(state, message);
  }
  const geometry = position;

  const block: WireframeBlockV2 = {
    id,
    parentId,
    title: 'Nuevo bloque',
    description: '',
    ...geometry,
  };
  return {
    ...state,
    notice: null,
    document: { ...state.document, blocks: [...blocks, block] },
    selectedBlockId: id,
  };
}

function moveToParent(state: EditorState, id: string, parentId: string | null): EditorState {
  const { blocks } = state.document;
  const block = blocks.find((item) => item.id === id);
  if (!block) return state;
  if (blocks.some((item) => item.parentId === id)) {
    return withNotice(
      state,
      'Un bloque que contiene otros bloques no puede moverse dentro de otro.',
    );
  }
  const parent = parentId === null ? null : blocks.find((item) => item.id === parentId);
  if (parentId !== null && (!parent || parent.parentId !== null || parent.id === id)) {
    return withNotice(state, 'El destino debe ser otro bloque raíz.');
  }
  if (block.parentId === parentId) return { ...state, notice: null };

  const oldParent =
    block.parentId === null ? null : blocks.find((item) => item.id === block.parentId)!;
  const absoluteX = block.x + (oldParent?.x ?? 0);
  const absoluteY = block.y + (oldParent?.y ?? 0);
  const x = absoluteX - (parent?.x ?? 0);
  const y = absoluteY - (parent?.y ?? 0);
  const cols = parent?.width ?? GRID_COLUMNS;
  const rows = parent?.height ?? state.document.canvas.rows;
  if (x < 0 || y < 0 || x + block.width > cols || y + block.height > rows) {
    return withNotice(
      state,
      'El bloque no cabe completo en ese destino. Cambia su tamaño o amplía el lienzo.',
    );
  }

  return {
    ...state,
    notice: null,
    document: {
      ...state.document,
      blocks: blocks.map((item) => (item.id === id ? { ...item, parentId, x, y } : item)),
    },
  };
}

function updateBlockText(
  state: EditorState,
  action: Extract<EditorAction, { type: 'update-block-text' }>,
): EditorState {
  if (!state.document.blocks.some((block) => block.id === action.id)) return state;
  const max = action.field === 'title' ? MAX_TITLE_LENGTH : MAX_DESCRIPTION_LENGTH;
  return {
    ...state,
    document: {
      ...state.document,
      blocks: state.document.blocks.map((block) =>
        block.id === action.id ? { ...block, [action.field]: action.value.slice(0, max) } : block,
      ),
    },
  };
}

function updateBlockGeometry(state: EditorState, id: string, geometry: BlockGeometry): EditorState {
  const blocks = state.document.blocks;
  const block = blocks.find((item) => item.id === id);
  if (!block) return state;

  const parent =
    block.parentId === null ? null : blocks.find((item) => item.id === block.parentId)!;
  const cols = parent?.width ?? GRID_COLUMNS;
  const rows = parent?.height ?? state.document.canvas.rows;
  const normalized = normalizeBlockGeometry(geometry, cols);
  normalized.y = Math.min(normalized.y, rows - 1);
  normalized.height = Math.min(normalized.height, rows - normalized.y);

  const children = blocks.filter((item) => item.parentId === id);
  const minimumWidth = children.reduce((max, child) => Math.max(max, child.x + child.width), 1);
  const minimumHeight = children.reduce((max, child) => Math.max(max, child.y + child.height), 1);
  normalized.width = Math.max(normalized.width, minimumWidth);
  normalized.height = Math.max(normalized.height, minimumHeight);

  if (normalized.x + normalized.width > cols || normalized.y + normalized.height > rows) {
    return withNotice(
      state,
      'El bloque no puede encoger ni salir de sus límites mientras contiene bloques hijos.',
    );
  }

  return {
    ...state,
    notice: null,
    document: {
      ...state.document,
      blocks: blocks.map((item) => (item.id === id ? { ...item, ...normalized } : item)),
    },
  };
}

function duplicateBlock(
  state: EditorState,
  sourceId: string,
  id: string,
  childIds: string[],
): EditorState {
  const blocks = state.document.blocks;
  const source = blocks.find((item) => item.id === sourceId);
  const children = blocks.filter((item) => item.parentId === sourceId);
  if (!source) return state;
  if (blocks.length + children.length + 1 > MAX_BLOCKS) {
    return withNotice(state, `No se pueden duplicar más de ${MAX_BLOCKS} bloques.`);
  }
  if (!isValidNewId(blocks, id)) return state;
  if (childIds.length !== children.length) {
    return withNotice(state, 'No se pudieron generar IDs únicos para la copia.');
  }
  const allNewIds = [id, ...childIds];
  if (
    new Set(allNewIds).size !== allNewIds.length ||
    childIds.some(
      (childId) =>
        !childId.trim() || childId.length > 100 || blocks.some((item) => item.id === childId),
    )
  ) {
    return state;
  }

  const parent =
    source.parentId === null ? null : blocks.find((item) => item.id === source.parentId)!;
  const maxCols = parent?.width ?? GRID_COLUMNS;
  const shiftedX = source.x + source.width < maxCols ? source.x + 1 : 0;
  const shiftedY = shiftedX === 0 ? source.y + source.height : source.y;
  const geometry = normalizeBlockGeometry({ ...source, x: shiftedX, y: shiftedY }, maxCols);
  const rows = parent?.height ?? state.document.canvas.rows;
  if (geometry.y + geometry.height > rows) {
    return withNotice(
      state,
      'No hay espacio para duplicar aquí. Amplía el lienzo o cambia la posición.',
    );
  }

  const duplicate: WireframeBlockV2 = { ...source, ...geometry, id };
  const copies = children.map((child, index) => ({ ...child, id: childIds[index]!, parentId: id }));
  return {
    ...state,
    notice: null,
    document: { ...state.document, blocks: [...blocks, duplicate, ...copies] },
    selectedBlockId: id,
  };
}

function deleteBlock(state: EditorState, id: string): EditorState {
  if (!state.document.blocks.some((block) => block.id === id)) return state;
  const removed = new Set([
    id,
    ...state.document.blocks.filter((block) => block.parentId === id).map((block) => block.id),
  ]);
  return {
    ...state,
    notice: null,
    document: {
      ...state.document,
      blocks: state.document.blocks.filter((block) => !removed.has(block.id)),
    },
    selectedBlockId:
      state.selectedBlockId !== null && removed.has(state.selectedBlockId)
        ? null
        : state.selectedBlockId,
  };
}

function findFirstOpenPosition(
  blocks: WireframeBlockV2[],
  columns: number,
  rows: number,
  width: number,
  height: number,
): BlockGeometry | null {
  for (let y = 0; y + height <= rows; y += 1) {
    for (let x = 0; x <= columns - width; x += 1) {
      const candidate = { x, y, width, height };
      if (!blocks.some((block) => geometriesOverlap(block, candidate))) return candidate;
    }
  }
  return null;
}

function geometriesOverlap(block: WireframeBlockV2, geometry: BlockGeometry): boolean {
  return (
    block.x < geometry.x + geometry.width &&
    block.x + block.width > geometry.x &&
    block.y < geometry.y + geometry.height &&
    block.y + block.height > geometry.y
  );
}
