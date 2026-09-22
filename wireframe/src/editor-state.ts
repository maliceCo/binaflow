import {
  MAX_BLOCKS,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  createEmptyDocument,
  normalizeBlockGeometry,
  parseWireframeDocument,
  type BlockGeometry,
  type WireframeBlockV1,
  type WireframeDocumentV1,
} from './model';

export interface EditorState {
  document: WireframeDocumentV1;
  selectedBlockId: string | null;
}

export type EditorAction =
  | { type: 'rename-document'; name: string }
  | { type: 'add-block'; id: string }
  | { type: 'select-block'; id: string | null }
  | { type: 'update-block-text'; id: string; field: 'title' | 'description'; value: string }
  | { type: 'set-block-geometry'; id: string; geometry: BlockGeometry }
  | { type: 'duplicate-block'; sourceId: string; id: string }
  | { type: 'delete-block'; id: string }
  | { type: 'replace-document'; document: WireframeDocumentV1 }
  | { type: 'new-document'; name?: string };

export function createEditorState(document = createEmptyDocument()): EditorState {
  return {
    document: parseWireframeDocument(document),
    selectedBlockId: null,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'rename-document':
      return {
        ...state,
        document: {
          ...state.document,
          name: action.name.slice(0, MAX_DOCUMENT_NAME_LENGTH),
        },
      };
    case 'add-block':
      return addBlock(state, action.id);
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
      return duplicateBlock(state, action.sourceId, action.id);
    case 'delete-block':
      return deleteBlock(state, action.id);
    case 'replace-document':
      return createEditorState(action.document);
    case 'new-document':
      return createEditorState(createEmptyDocument(action.name ?? 'Nueva pantalla'));
  }
}

function addBlock(state: EditorState, id: string): EditorState {
  if (
    state.document.blocks.length >= MAX_BLOCKS ||
    state.document.blocks.some((block) => block.id === id)
  ) {
    return state;
  }

  const geometry = findFirstOpenPosition(state.document.blocks);
  const block: WireframeBlockV1 = {
    id,
    title: 'Nuevo bloque',
    description: '',
    ...geometry,
  };

  return {
    document: {
      ...state.document,
      blocks: [...state.document.blocks, block],
    },
    selectedBlockId: id,
  };
}

function updateBlockText(
  state: EditorState,
  action: Extract<EditorAction, { type: 'update-block-text' }>,
): EditorState {
  const block = state.document.blocks.find((candidate) => candidate.id === action.id);
  if (!block) {
    return state;
  }

  const value =
    action.field === 'title'
      ? action.value.slice(0, MAX_TITLE_LENGTH)
      : action.value.slice(0, MAX_DESCRIPTION_LENGTH);

  return {
    ...state,
    document: {
      ...state.document,
      blocks: state.document.blocks.map((candidate) =>
        candidate.id === action.id ? { ...candidate, [action.field]: value } : candidate,
      ),
    },
  };
}

function updateBlockGeometry(state: EditorState, id: string, geometry: BlockGeometry): EditorState {
  if (!state.document.blocks.some((block) => block.id === id)) {
    return state;
  }

  return {
    ...state,
    document: {
      ...state.document,
      blocks: state.document.blocks.map((block) =>
        block.id === id ? { ...block, ...normalizeBlockGeometry(geometry) } : block,
      ),
    },
  };
}

function duplicateBlock(state: EditorState, sourceId: string, id: string): EditorState {
  const source = state.document.blocks.find((block) => block.id === sourceId);
  if (
    !source ||
    state.document.blocks.length >= MAX_BLOCKS ||
    state.document.blocks.some((block) => block.id === id)
  ) {
    return state;
  }

  const geometry =
    source.x + source.width < state.document.grid.columns
      ? normalizeBlockGeometry({ ...source, x: source.x + 1 })
      : normalizeBlockGeometry({ ...source, x: 0, y: source.y + source.height });
  const duplicate: WireframeBlockV1 = {
    ...source,
    id,
    ...geometry,
  };

  return {
    document: {
      ...state.document,
      blocks: [...state.document.blocks, duplicate],
    },
    selectedBlockId: id,
  };
}

function deleteBlock(state: EditorState, id: string): EditorState {
  if (!state.document.blocks.some((block) => block.id === id)) {
    return state;
  }

  return {
    document: {
      ...state.document,
      blocks: state.document.blocks.filter((block) => block.id !== id),
    },
    selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
  };
}

function findFirstOpenPosition(blocks: WireframeBlockV1[]): BlockGeometry {
  const width = 3;
  const height = 3;
  const maxBottom = blocks.reduce((bottom, block) => Math.max(bottom, block.y + block.height), 0);
  const maxRow = Math.max(18, maxBottom + 18);

  for (let y = 0; y <= maxRow; y += 1) {
    for (let x = 0; x <= 12 - width; x += 1) {
      const candidate = { x, y, width, height };
      if (!blocks.some((block) => geometriesOverlap(block, candidate))) {
        return candidate;
      }
    }
  }

  return { x: 0, y: maxBottom, width, height };
}

function geometriesOverlap(block: WireframeBlockV1, geometry: BlockGeometry): boolean {
  return (
    block.x < geometry.x + geometry.width &&
    block.x + block.width > geometry.x &&
    block.y < geometry.y + geometry.height &&
    block.y + block.height > geometry.y
  );
}
