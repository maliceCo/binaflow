import {
  MAX_BLOCKS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  createEmptyDocument,
  type WireframeBlockV1,
} from './model';
import { createEditorState, editorReducer, type EditorState } from './editor-state';

function addBlock(state: EditorState, id: string): EditorState {
  return editorReducer(state, { type: 'add-block', id });
}

function createStateWithBlock(): EditorState {
  return addBlock(createEditorState(createEmptyDocument('Original')), 'first');
}

describe('editor state', () => {
  it('adds blocks in the first available visible position and selects them', () => {
    const first = createStateWithBlock();
    const second = addBlock(first, 'second');

    expect(first.document.blocks[0]).toMatchObject({ x: 0, y: 0, width: 3, height: 3 });
    expect(second.document.blocks[1]).toMatchObject({ x: 3, y: 0, width: 3, height: 3 });
    expect(second.selectedBlockId).toBe('second');
  });

  it('selects existing blocks and clears missing selections', () => {
    const state = createStateWithBlock();

    expect(editorReducer(state, { type: 'select-block', id: 'first' }).selectedBlockId).toBe(
      'first',
    );
    expect(
      editorReducer(state, { type: 'select-block', id: 'missing' }).selectedBlockId,
    ).toBeNull();
    expect(editorReducer(state, { type: 'select-block', id: null }).selectedBlockId).toBeNull();
  });

  it('updates text with the document limits', () => {
    const state = createStateWithBlock();
    const withTitle = editorReducer(state, {
      type: 'update-block-text',
      id: 'first',
      field: 'title',
      value: 'x'.repeat(MAX_TITLE_LENGTH + 10),
    });
    const withDescription = editorReducer(withTitle, {
      type: 'update-block-text',
      id: 'first',
      field: 'description',
      value: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 10),
    });

    expect(withDescription.document.blocks[0]!.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(withDescription.document.blocks[0]!.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
  });

  it('normalizes geometry and renames the document without mutating the previous state', () => {
    const state = createStateWithBlock();
    const next = editorReducer(
      editorReducer(state, { type: 'rename-document', name: 'Nueva pantalla' }),
      {
        type: 'set-block-geometry',
        id: 'first',
        geometry: { x: 10.4, y: -3, width: 20, height: 0 },
      },
    );

    expect(next.document.name).toBe('Nueva pantalla');
    expect(next.document.blocks[0]).toMatchObject({ x: 10, y: 0, width: 2, height: 1 });
    expect(state.document.name).toBe('Original');
    expect(state.document.blocks[0]).toMatchObject({ x: 0, y: 0, width: 3, height: 3 });
  });

  it('duplicates with a new ID and places the copy below when there is no room', () => {
    const state = createStateWithBlock();
    const shifted = editorReducer(state, {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 10, y: 4, width: 2, height: 3 },
    });
    const duplicate = editorReducer(shifted, {
      type: 'duplicate-block',
      sourceId: 'first',
      id: 'copy',
    });

    expect(duplicate.document.blocks[1]).toMatchObject({
      id: 'copy',
      x: 0,
      y: 7,
      width: 2,
      height: 3,
    });
    expect(duplicate.selectedBlockId).toBe('copy');
  });

  it('rejects empty and whitespace IDs without mutating state', () => {
    const state = createStateWithBlock();

    for (const id of ['', '   ', 'first']) {
      expect(editorReducer(state, { type: 'add-block', id })).toBe(state);
    }
    expect(editorReducer(state, { type: 'duplicate-block', sourceId: 'first', id: '   ' })).toBe(
      state,
    );

    expect(addBlock(state, 'valid')).toMatchObject({
      selectedBlockId: 'valid',
      document: { blocks: [...state.document.blocks, expect.objectContaining({ id: 'valid' })] },
    });
  });

  it('deletes a block and clears its selection', () => {
    const state = createStateWithBlock();
    const deleted = editorReducer(state, { type: 'delete-block', id: 'first' });

    expect(deleted.document.blocks).toEqual([]);
    expect(deleted.selectedBlockId).toBeNull();
  });

  it('replaces and creates documents without retaining mutable references', () => {
    const document = createEmptyDocument('Importada');
    const replaced = editorReducer(createStateWithBlock(), { type: 'replace-document', document });
    const fresh = editorReducer(replaced, { type: 'new-document', name: 'Nueva' });

    expect(replaced.document).toEqual(document);
    expect(fresh.document.name).toBe('Nueva');
    expect(fresh.document.blocks).toEqual([]);
  });

  it('does not exceed the block limit or accept duplicate IDs', () => {
    let state = createEditorState();
    for (let index = 0; index < MAX_BLOCKS; index += 1) {
      state = addBlock(state, `block-${index}`);
    }
    const full = addBlock(state, 'overflow');
    const duplicate = addBlock(state, 'block-0');

    expect(full.document.blocks).toHaveLength(MAX_BLOCKS);
    expect(duplicate).toBe(state);
  });

  it('keeps unrelated blocks unchanged when an action targets a missing block', () => {
    const state = createStateWithBlock();
    const missingText = editorReducer(state, {
      type: 'update-block-text',
      id: 'missing',
      field: 'title',
      value: 'No debe aparecer',
    });
    const missingGeometry = editorReducer(state, {
      type: 'set-block-geometry',
      id: 'missing',
      geometry: { x: 1, y: 1, width: 1, height: 1 },
    });

    expect(missingText).toBe(state);
    expect(missingGeometry).toBe(state);
  });

  it('keeps block values as plain serializable records', () => {
    const state = createStateWithBlock();
    const block: WireframeBlockV1 = state.document.blocks[0]!;

    expect(Object.keys(block).sort()).toEqual([
      'description',
      'height',
      'id',
      'title',
      'width',
      'x',
      'y',
    ]);
  });
});
