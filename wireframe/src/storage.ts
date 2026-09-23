import {
  parseWireframeDocument,
  serializeWireframeDocument,
  type WireframeDocumentV1,
} from './model';

export const DRAFT_STORAGE_KEY = 'wireframe-editor.document.v1';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface DraftLoadResult {
  document: WireframeDocumentV1 | null;
  error: string | null;
}

export function loadDraft(storage?: StorageLike): DraftLoadResult {
  try {
    const serialized = (storage ?? getBrowserStorage()).getItem(DRAFT_STORAGE_KEY);
    if (serialized === null) {
      return { document: null, error: null };
    }

    return {
      document: parseWireframeDocument(JSON.parse(serialized) as unknown),
      error: null,
    };
  } catch {
    return {
      document: null,
      error: 'No se pudo restaurar el borrador guardado. Se abrió un documento vacío.',
    };
  }
}

export function saveDraft(
  document: WireframeDocumentV1,
  storage?: StorageLike,
): string | null {
  try {
    (storage ?? getBrowserStorage()).setItem(
      DRAFT_STORAGE_KEY,
      serializeWireframeDocument(document),
    );
    return null;
  } catch {
    return 'No se pudo guardar el borrador local. Puedes continuar editando y exportarlo después.';
  }
}

export function clearDraft(storage?: StorageLike): string | null {
  try {
    (storage ?? getBrowserStorage()).removeItem(DRAFT_STORAGE_KEY);
    return null;
  } catch {
    return 'No se pudo limpiar el borrador local.';
  }
}

function getBrowserStorage(): StorageLike {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('El almacenamiento local no está disponible');
  }
  return window.localStorage;
}
