import {
  MAX_BLOCKS,
  MAX_CANVAS_ROWS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  createEmptyDocument,
  type WireframeBlockV2,
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
    const document = createEmptyDocument();
    document.blocks = Array.from({ length: MAX_BLOCKS }, (_, index) => ({
      id: `block-${index}`,
      parentId: null,
      title: `Bloque ${index}`,
      description: '',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    const state = createEditorState(document);
    const full = addBlock(state, 'overflow');
    const duplicate = addBlock(state, 'block-0');

    expect(full.document.blocks).toHaveLength(MAX_BLOCKS);
    expect(full.notice).toMatch(/200/);
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

  it('adds children with relative coordinates and refuses deeper nesting', () => {
    const parent = editorReducer(createStateWithBlock(), {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 6, height: 6 },
    });
    const child = editorReducer(parent, { type: 'add-child', id: 'child', parentId: 'first' });
    const secondChild = editorReducer(child, {
      type: 'add-child',
      id: 'child-2',
      parentId: 'first',
    });
    expect(secondChild.document.blocks[1]).toMatchObject({ parentId: 'first', x: 0, y: 0 });
    expect(secondChild.document.blocks[2]).toMatchObject({ parentId: 'first', x: 2, y: 0 });
    const rejected = editorReducer(secondChild, {
      type: 'add-child',
      id: 'grandchild',
      parentId: 'child',
    });
    expect(rejected.document.blocks).toHaveLength(3);
    expect(rejected.notice).toMatch(/bloque raíz/);
  });

  it('reparents without changing visual position and rejects a child that cannot fit', () => {
    const state = editorReducer(createStateWithBlock(), {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 6, height: 6 },
    });
    const withSecond = editorReducer(addBlock(state, 'second'), {
      type: 'set-block-geometry',
      id: 'second',
      geometry: { x: 3, y: 0, width: 3, height: 3 },
    });
    const movedIn = editorReducer(withSecond, {
      type: 'move-to-parent',
      id: 'second',
      parentId: 'first',
    });
    expect(movedIn.document.blocks[1]).toMatchObject({ parentId: 'first', x: 3, y: 0 });
    const movedParent = editorReducer(movedIn, {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 2, y: 2, width: 6, height: 6 },
    });
    expect(movedParent.document.blocks[1]).toMatchObject({ parentId: 'first', x: 3, y: 0 });
    const movedOut = editorReducer(movedParent, {
      type: 'move-to-parent',
      id: 'second',
      parentId: null,
    });
    expect(movedOut.document.blocks[1]).toMatchObject({ parentId: null, x: 5, y: 2 });
  });

  it('rejects reparenting when relative coordinates would place the child outside its parent', () => {
    const parent = createStateWithBlock();
    const other = addBlock(parent, 'other');
    const rejected = editorReducer(other, {
      type: 'move-to-parent',
      id: 'other',
      parentId: 'first',
    });
    expect(rejected.document).toBe(other.document);
    expect(rejected.document.blocks[1]).toMatchObject({ parentId: null, x: 3, y: 0 });
    expect(rejected.notice).toMatch(/no cabe/);
  });

  it('duplicates a parent together with its child under new IDs', () => {
    const parent = editorReducer(createStateWithBlock(), {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 6, height: 6 },
    });
    const child = editorReducer(parent, { type: 'add-child', id: 'child', parentId: 'first' });
    const duplicate = editorReducer(child, {
      type: 'duplicate-block',
      sourceId: 'first',
      id: 'copy',
      childIds: ['copy-child'],
    });
    expect(duplicate.document.blocks).toHaveLength(4);
    expect(duplicate.document.blocks[2]).toMatchObject({ id: 'copy', parentId: null });
    expect(duplicate.document.blocks[3]).toMatchObject({ id: 'copy-child', parentId: 'copy' });
  });

  it('keeps children inside resized parents and deletes parent families', () => {
    const parent = editorReducer(createStateWithBlock(), {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 6, height: 6 },
    });
    const child = editorReducer(parent, { type: 'add-child', id: 'child', parentId: 'first' });
    const undersized = editorReducer(child, {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(undersized.document.blocks[0]).toMatchObject({ width: 2, height: 1 });
    const deleted = editorReducer(undersized, { type: 'delete-block', id: 'first' });
    expect(deleted.document.blocks).toEqual([]);
  });

  it('grows the canvas on demand and reports when a root cannot fit', () => {
    const state = editorReducer(createStateWithBlock(), {
      type: 'set-block-geometry',
      id: 'first',
      geometry: { x: 0, y: 0, width: 12, height: 18 },
    });
    const full = addBlock(state, 'second');
    expect(full.document.blocks).toHaveLength(1);
    expect(full.notice).toMatch(/Amplíalo/);
    const grown = editorReducer(full, { type: 'grow-canvas' });
    const added = addBlock(grown, 'second');
    expect(added.document.canvas.rows).toBe(24);
    expect(added.document.blocks).toHaveLength(2);
  });

  it('caps canvas growth at 500 rows', () => {
    const document = createEmptyDocument();
    document.canvas.rows = MAX_CANVAS_ROWS - 2;
    const almostFull = editorReducer(createEditorState(document), { type: 'grow-canvas' });
    expect(almostFull.document.canvas.rows).toBe(MAX_CANVAS_ROWS);
    const full = editorReducer(almostFull, { type: 'grow-canvas' });
    expect(full.document.canvas.rows).toBe(MAX_CANVAS_ROWS);
    expect(full.notice).toMatch(/máximo de 500 filas/);
  });

  it('keeps block values as plain serializable records', () => {
    const state = createStateWithBlock();
    const block: WireframeBlockV2 = state.document.blocks[0]!;

    expect(Object.keys(block).sort()).toEqual([
      'description',
      'height',
      'id',
      'parentId',
      'title',
      'width',
      'x',
      'y',
    ]);
  });
});
