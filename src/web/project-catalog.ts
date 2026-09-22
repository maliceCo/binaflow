import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import type {
  LauncherProjectRoot,
  ProjectCatalog,
  ProjectCatalogEntry,
  ProjectOwnership,
} from './launcher-contracts.js';
import { parseProjectCatalog } from './launcher-contracts.js';
import { resolveDefaultWebSettingsPath, type WebSettingsEnvironment } from './settings-store.js';

export const PROJECT_CATALOG_FILE = 'projects.json';
export const PROJECT_DIRECTORY_LIMITS = {
  maxSegments: 32,
  maxSegmentBytes: 255,
  maxItems: 200,
} as const;

export interface ProjectDirectoryItem {
  name: string;
  segments: string[];
  hasBinaflowConfig: boolean;
}

export interface ProjectRootCandidate {
  id: string;
  label: string;
  path: string;
}

export interface ProjectDirectoryListing {
  rootId: string;
  segments: string[];
  hasBinaflowConfig: boolean;
  items: ProjectDirectoryItem[];
  nextOffset: number | null;
}

export interface ProjectRootDiscoveryOptions {
  cwd?: string;
  homeDir?: string;
  candidates?: string[];
}

export interface RegisterProjectInput {
  workspacePath: string;
  projectId?: string;
  name?: string;
  ownerDeviceId: string;
}

export interface InitializeProjectInput {
  rootId: string;
  segments: readonly string[];
}

export function resolveDefaultProjectCatalogPath(environment: WebSettingsEnvironment = {}): string {
  return resolve(dirname(resolveDefaultWebSettingsPath(environment)), PROJECT_CATALOG_FILE);
}

export async function discoverProjectRootCandidates(
  options: ProjectRootDiscoveryOptions = {},
): Promise<ProjectRootCandidate[]> {
  const homeDir = options.homeDir ?? process.env.HOME ?? process.cwd();
  const paths = options.candidates ?? [
    options.cwd ?? process.cwd(),
    homeDir,
    resolve(homeDir, 'Projects'),
    resolve(homeDir, 'projects'),
    resolve(homeDir, 'src'),
    resolve(homeDir, 'Documents'),
  ];
  const seen = new Set<string>();
  const result: ProjectRootCandidate[] = [];
  for (const candidate of paths) {
    let path: string;
    try {
      path = await realDirectory(candidate);
    } catch {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    result.push({ id: rootCandidateId(path), label: rootCandidateLabel(path, homeDir), path });
  }
  return result;
}

export class FileProjectCatalog {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly catalogPath: string) {}

  async list(): Promise<ProjectCatalog> {
    await this.mutationQueue;
    return this.read();
  }

  register(input: RegisterProjectInput): Promise<ProjectCatalogEntry> {
    return this.enqueue(async () => {
      const workspacePath = await validateWorkspace(input.workspacePath);
      const config = await readProjectConfig(workspacePath);
      const catalog = await this.read();
      const existing = catalog.projects.find((project) => project.workspacePath === workspacePath);
      if (existing) return existing;
      if (
        input.projectId &&
        catalog.projects.some((project) => project.projectId === input.projectId)
      ) {
        throw new Error('Project ID is already registered');
      }
      const projectId = input.projectId ?? randomUUID();
      const now = new Date().toISOString();
      const entry: ProjectCatalogEntry = {
        projectId,
        name: input.name ?? basename(workspacePath),
        workspacePath,
        configPath: resolve(workspacePath, '.binaflow', 'config.json'),
        dataDirPath: resolve(
          dirname(resolve(workspacePath, '.binaflow', 'config.json')),
          config.dataDir,
        ),
        ownership: { status: 'active', ownerDeviceId: input.ownerDeviceId },
        updatedAt: now,
      };
      const next = parseProjectCatalog({
        schemaVersion: 1,
        projects: [...catalog.projects, entry],
      });
      await this.save(next);
      return entry;
    });
  }

  remove(projectId: string): Promise<void> {
    return this.enqueue(async () => {
      const catalog = await this.read();
      const next = catalog.projects.filter((project) => project.projectId !== projectId);
      if (next.length !== catalog.projects.length) {
        await this.save({ schemaVersion: 1, projects: next });
      }
    });
  }

  updateOwnership(projectId: string, ownership: ProjectOwnership): Promise<ProjectCatalogEntry> {
    return this.enqueue(async () => {
      const catalog = await this.read();
      const project = catalog.projects.find((item) => item.projectId === projectId);
      if (!project) throw new Error('Project not found');
      const updated = { ...project, ownership, updatedAt: new Date().toISOString() };
      await this.save({
        schemaVersion: 1,
        projects: catalog.projects.map((item) => (item.projectId === projectId ? updated : item)),
      });
      return updated;
    });
  }

  private async read(): Promise<ProjectCatalog> {
    try {
      return parseProjectCatalog(JSON.parse(await readFile(this.catalogPath, 'utf8')));
    } catch (error) {
      if (isMissingFile(error)) return { schemaVersion: 1, projects: [] };
      throw new Error(`Cannot load project catalog ${this.catalogPath}`);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async save(catalog: ProjectCatalog): Promise<void> {
    const validated = parseProjectCatalog(catalog);
    await mkdir(dirname(this.catalogPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.catalogPath}.${process.pid}-${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.catalogPath);
      await chmod(this.catalogPath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export async function listProjectDirectory(
  roots: readonly LauncherProjectRoot[],
  rootId: string,
  segments: readonly string[] = [],
  offset: number = 0,
  limit: number = PROJECT_DIRECTORY_LIMITS.maxItems,
): Promise<ProjectDirectoryListing> {
  const root = roots.find((item) => item.rootId === rootId);
  if (!root) throw new Error('Project root not found');
  validateSegments(segments);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid directory offset');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PROJECT_DIRECTORY_LIMITS.maxItems) {
    throw new Error('Invalid directory limit');
  }
  const rootPath = await realDirectory(root.path);
  const requestedPath = resolve(rootPath, ...segments);
  assertContained(rootPath, requestedPath);
  const directoryPath = await realDirectory(requestedPath);
  assertContained(rootPath, directoryPath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const items: ProjectDirectoryItem[] = [];
  for (const entry of entries) {
    const childPath = resolve(directoryPath, entry.name);
    let childRealPath: string;
    try {
      childRealPath = await realDirectory(childPath);
    } catch {
      continue;
    }
    assertContained(rootPath, childRealPath);
    const childSegments = [...segments, entry.name];
    const hasBinaflowConfig = await fileExists(resolve(childRealPath, '.binaflow', 'config.json'));
    items.push({ name: entry.name, segments: childSegments, hasBinaflowConfig });
  }
  items.sort((left, right) => left.name.localeCompare(right.name));
  const page = items.slice(offset, offset + limit);
  return {
    rootId,
    segments: [...segments],
    hasBinaflowConfig: await fileExists(resolve(directoryPath, '.binaflow', 'config.json')),
    items: page,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}

export async function initializeProjectFromDirectory(
  roots: readonly LauncherProjectRoot[],
  input: InitializeProjectInput,
): Promise<void> {
  const root = roots.find((item) => item.rootId === input.rootId);
  if (!root) throw new Error('Project root not found');
  validateSegments(input.segments);
  const rootPath = await realDirectory(root.path);
  const workspacePath = resolve(rootPath, ...input.segments);
  assertContained(rootPath, workspacePath);
  await initializeProjectAtPath(workspacePath);
}

export async function initializeProjectAtPath(workspacePath: string): Promise<void> {
  const resolvedWorkspace = await realDirectory(workspacePath);
  const configDirectory = resolve(resolvedWorkspace, '.binaflow');
  const configPath = resolve(configDirectory, 'config.json');
  if (await fileExists(configPath)) throw new Error('Binaflow config already exists');
  await mkdir(configDirectory, { recursive: true });
  try {
    await writeFile(
      configPath,
      `${JSON.stringify({ dataDir: './data', profiles: {} }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await mkdir(resolve(configDirectory, 'data'), { recursive: true });
  } catch (cause) {
    await rm(configPath, { force: true });
    throw cause;
  }
}

export async function registerProjectAtPath(
  catalog: FileProjectCatalog,
  workspacePath: string,
  ownerDeviceId: string,
  projectId?: string,
): Promise<ProjectCatalogEntry> {
  return catalog.register({ workspacePath, ownerDeviceId, ...(projectId ? { projectId } : {}) });
}

export async function registerProjectFromDirectory(
  catalog: FileProjectCatalog,
  roots: readonly LauncherProjectRoot[],
  rootId: string,
  segments: readonly string[],
  ownerDeviceId: string,
  projectId?: string,
): Promise<ProjectCatalogEntry> {
  const root = roots.find((item) => item.rootId === rootId);
  if (!root) throw new Error('Project root not found');
  validateSegments(segments);
  const rootPath = await realDirectory(root.path);
  const candidate = resolve(rootPath, ...segments);
  assertContained(rootPath, candidate);
  const workspacePath = await realDirectory(candidate);
  assertContained(rootPath, workspacePath);
  return catalog.register({ workspacePath, ownerDeviceId, ...(projectId ? { projectId } : {}) });
}

async function validateWorkspace(path: string): Promise<string> {
  const workspacePath = await realDirectory(path);
  const configPath = resolve(workspacePath, '.binaflow', 'config.json');
  if (!(await fileExists(configPath))) throw new Error('Project configuration was not found');
  await readProjectConfig(workspacePath);
  return workspacePath;
}

async function readProjectConfig(workspacePath: string): Promise<{ dataDir: string }> {
  const configPath = resolve(workspacePath, '.binaflow', 'config.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new Error('Project configuration is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Project configuration must be an object');
  }
  const dataDir = (value as Record<string, unknown>).dataDir;
  if (dataDir !== undefined && (typeof dataDir !== 'string' || !dataDir)) {
    throw new Error('Project dataDir is invalid');
  }
  return { dataDir: dataDir ?? './data' };
}

async function realDirectory(path: string): Promise<string> {
  const realPath = await realpath(path);
  const details = await stat(realPath);
  if (!details.isDirectory()) throw new Error('Project path is not a directory');
  return realPath;
}

function validateSegments(segments: readonly string[]): void {
  if (segments.length > PROJECT_DIRECTORY_LIMITS.maxSegments)
    throw new Error('Directory depth exceeds its limit');
  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      throw new Error('Invalid directory segment');
    }
    if (new TextEncoder().encode(segment).byteLength > PROJECT_DIRECTORY_LIMITS.maxSegmentBytes) {
      throw new Error('Directory segment exceeds its limit');
    }
  }
}

function rootCandidateId(path: string): string {
  const hex = createHash('sha256').update(path, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  const variant = hex[16] ?? '8';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(variant, 16) % 4] ?? '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function rootCandidateLabel(path: string, homeDir: string): string {
  if (path === homeDir) return 'Home';
  return basename(path) || path;
}

function assertContained(rootPath: string, candidatePath: string): void {
  if (candidatePath !== rootPath && !candidatePath.startsWith(`${rootPath}${sep}`)) {
    throw new Error('Path is outside the authorized project root');
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
