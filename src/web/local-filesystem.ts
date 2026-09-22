import { homedir, platform } from 'node:os';
import { dirname, parse, resolve } from 'node:path';
import { readdir, realpath, stat } from 'node:fs/promises';

export interface LocalFilesystemRoot {
  label: string;
  path: string;
}

export interface LocalDirectoryItem {
  name: string;
  path: string;
  hasBinaflowConfig: boolean;
}

export interface LocalDirectoryListing {
  currentPath: string;
  parentPath: string | null;
  hasBinaflowConfig: boolean;
  items: LocalDirectoryItem[];
  nextOffset: number | null;
}

const MAX_ITEMS = 100;
const MAX_PATH_LENGTH = 4096;

export async function listLocalFilesystemRoots(): Promise<LocalFilesystemRoot[]> {
  const candidates =
    platform() === 'win32' ? [homedir(), parse(process.cwd()).root] : [homedir(), '/'];
  const roots: LocalFilesystemRoot[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      const path = await realDirectory(candidate);
      if (seen.has(path)) continue;
      seen.add(path);
      roots.push({ label: path === homedir() ? 'Home' : path, path });
    } catch {
      // An inaccessible default location is not a fatal browser error.
    }
  }
  return roots;
}

export async function listLocalDirectory(
  requestedPath: string,
  offset = 0,
  limit = MAX_ITEMS,
): Promise<LocalDirectoryListing> {
  if (!requestedPath || requestedPath.length > MAX_PATH_LENGTH) {
    throw new Error('Invalid directory path');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid directory offset');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ITEMS) {
    throw new Error('Invalid directory limit');
  }
  const currentPath = await realDirectory(requestedPath);
  const entries = await readdir(currentPath, { withFileTypes: true });
  const items: LocalDirectoryItem[] = [];
  for (const entry of entries) {
    const candidate = resolve(currentPath, entry.name);
    try {
      const path = await realDirectory(candidate);
      items.push({
        name: entry.name,
        path,
        hasBinaflowConfig: await fileExists(resolve(path, '.binaflow', 'config.json')),
      });
    } catch {
      // Hidden, broken, and inaccessible entries are not browseable projects.
    }
  }
  items.sort((left, right) => left.name.localeCompare(right.name));
  const page = items.slice(offset, offset + limit);
  const parentPath = dirname(currentPath) === currentPath ? null : dirname(currentPath);
  return {
    currentPath,
    parentPath,
    hasBinaflowConfig: await fileExists(resolve(currentPath, '.binaflow', 'config.json')),
    items: page,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}

async function realDirectory(path: string): Promise<string> {
  const resolved = await realpath(path);
  const details = await stat(resolved);
  if (!details.isDirectory()) throw new Error('Path is not a directory');
  return resolved;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
