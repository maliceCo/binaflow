import { DRAFT_STORAGE_KEY, type StorageLike, clearDraft, loadDraft, saveDraft } from './storage';
import { createEmptyDocument } from './model';

function createMemoryStorage(initial?: string): StorageLike {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
    removeItem: () => {
      value = null;
    },
  };
}

describe('wireframe draft storage', () => {
  it('loads no draft when storage is empty', () => {
    expect(loadDraft(createMemoryStorage())).toEqual({ document: null, error: null });
  });

  it('saves and restores a validated document', () => {
    const storage = createMemoryStorage();
    const document = createEmptyDocument('Guardado');

    expect(saveDraft(document, storage)).toBeNull();
    expect(loadDraft(storage)).toEqual({ document, error: null });
  });

  it('migrates a saved v1 draft to v2 and saves the migrated format', () => {
    const legacy = {
      version: 1,
      name: 'Borrador antiguo',
      grid: { columns: 12, rowHeight: 40 },
      blocks: [{ id: 'old', title: 'Bloque', description: '', x: 0, y: 2, width: 2, height: 2 }],
    };
    const storage = createMemoryStorage(JSON.stringify(legacy));
    const loaded = loadDraft(storage);

    expect(loaded.document).toMatchObject({ version: 2, canvas: { rows: 18 } });
    expect(loaded.document?.blocks[0]).toMatchObject({ id: 'old', parentId: null });
    expect(saveDraft(loaded.document!, storage)).toBeNull();
    expect(JSON.parse(storage.getItem(DRAFT_STORAGE_KEY)!).version).toBe(2);
  });

  it('rejects corrupt JSON and invalid documents without throwing', () => {
    expect(loadDraft(createMemoryStorage('{malformed'))).toEqual({
      document: null,
      error: expect.stringContaining('No se pudo restaurar'),
    });
    expect(loadDraft(createMemoryStorage(JSON.stringify({ version: 2 })))).toEqual({
      document: null,
      error: expect.stringContaining('No se pudo restaurar'),
    });
  });

  it('handles a localStorage getter that throws before returning a storage object', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    const document = createEmptyDocument();

    expect(loadDraft().error).toContain('No se pudo restaurar');
    expect(saveDraft(document)).toContain('No se pudo guardar');
    expect(clearDraft()).toContain('No se pudo limpiar');
    vi.restoreAllMocks();
  });

  it('reports storage read, write and clear failures', () => {
    const failingStorage: StorageLike = {
      getItem: () => {
        throw new Error('read failed');
      },
      setItem: () => {
        throw new Error('write failed');
      },
      removeItem: () => {
        throw new Error('remove failed');
      },
    };
    const document = createEmptyDocument();

    expect(loadDraft(failingStorage).error).toContain('No se pudo restaurar');
    expect(saveDraft(document, failingStorage)).toContain('No se pudo guardar');
    expect(clearDraft(failingStorage)).toContain('No se pudo limpiar');
  });

  it('uses the stable draft key for every operation', () => {
    const calls: string[] = [];
    const storage: StorageLike = {
      getItem: (key) => {
        calls.push(`get:${key}`);
        return null;
      },
      setItem: (key) => {
        calls.push(`set:${key}`);
      },
      removeItem: (key) => {
        calls.push(`remove:${key}`);
      },
    };

    loadDraft(storage);
    saveDraft(createEmptyDocument(), storage);
    clearDraft(storage);

    expect(calls).toEqual([
      `get:${DRAFT_STORAGE_KEY}`,
      `set:${DRAFT_STORAGE_KEY}`,
      `remove:${DRAFT_STORAGE_KEY}`,
    ]);
  });
});
