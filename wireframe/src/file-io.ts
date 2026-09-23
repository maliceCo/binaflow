import {
  parseWireframeDocument,
  serializeWireframeDocument,
  type WireframeDocumentV2,
} from './model';

export const MAX_WIREFRAME_FILE_SIZE = 1024 * 1024;

export class WireframeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireframeFileError';
  }
}

export interface DownloadEnvironment {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createAnchor: () => HTMLAnchorElement;
  appendAnchor: (anchor: HTMLAnchorElement) => void;
  removeAnchor: (anchor: HTMLAnchorElement) => void;
}

export async function readWireframeFile(file: File): Promise<WireframeDocumentV2> {
  if (file.size > MAX_WIREFRAME_FILE_SIZE) {
    throw new WireframeFileError('El archivo supera el límite de 1 MiB.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFileText(file)) as unknown;
  } catch {
    throw new WireframeFileError('El archivo no contiene JSON válido.');
  }

  try {
    return parseWireframeDocument(parsed);
  } catch {
    throw new WireframeFileError('El archivo no coincide con el formato de wireframe v1 o v2.');
  }
}

export function createWireframeDownload(
  document: WireframeDocumentV2,
  environment: DownloadEnvironment = createBrowserDownloadEnvironment(),
): void {
  const blob = new Blob([serializeWireframeDocument(document)], {
    type: 'application/json;charset=utf-8',
  });
  const url = environment.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = environment.createAnchor();
    anchor.href = url;
    anchor.download = safeWireframeFilename(document.name);
    environment.appendAnchor(anchor);
    anchor.click();
  } finally {
    try {
      if (anchor) environment.removeAnchor(anchor);
    } finally {
      environment.revokeObjectURL(url);
    }
  }
}

export function safeWireframeFilename(name: string): string {
  const cleaned = Array.from(name)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.json$/i, '')
    .slice(0, 96)
    .trim();

  return `${cleaned || 'wireframe'}.json`;
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

function createBrowserDownloadEnvironment(): DownloadEnvironment {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => window.document.createElement('a'),
    appendAnchor: (anchor) => window.document.body.append(anchor),
    removeAnchor: (anchor) => anchor.remove(),
  };
}
