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
