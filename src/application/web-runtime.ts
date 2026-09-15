import { createExecutionHost, type ExecutionHost } from './execution-host.js';
import { openApplicationContext, type ApplicationContext } from './runtime.js';
import type { ProjectCatalogEntry } from '../web/launcher-contracts.js';
import { FileProjectCatalog } from '../web/project-catalog.js';

export class ProjectBusyError extends Error {
  readonly code = 'project-busy';

  constructor(message = 'The active project has an operation in progress') {
    super(message);
    this.name = 'ProjectBusyError';
  }
}

export class ProjectLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectLifecycleError';
    this.code = code;
  }
}

export interface ActiveProjectRuntime {
  readonly project: ProjectCatalogEntry;
  readonly context: ApplicationContext;
  readonly host: ExecutionHost;
}

export interface PersonalWebRuntimeOptions {
  readonly catalog: Pick<FileProjectCatalog, 'list' | 'updateOwnership'>;
  readonly ownerDeviceId: string;
  readonly openProject?: (project: ProjectCatalogEntry) => Promise<ActiveProjectRuntime>;
}

export interface PersonalWebRuntime {
  listProjects(): Promise<ProjectCatalogEntry[]>;
  getActiveProject(): ProjectCatalogEntry | undefined;
  getActiveHost(): ExecutionHost | undefined;
  selectProject(projectId: string): Promise<ProjectCatalogEntry>;
  closeActiveProject(): Promise<void>;
  close(): Promise<void>;
}

export function createPersonalWebRuntime(options: PersonalWebRuntimeOptions): PersonalWebRuntime {
  let active: ActiveProjectRuntime | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  return {
    listProjects: async () => (await options.catalog.list()).projects,
    getActiveProject: () => active?.project,
    getActiveHost: () => active?.host,
    selectProject,
    closeActiveProject: async () => {
      assertRuntimeOpen();
      if (!active) return;
      assertIdle(active.host);
      const previous = active;
      active = undefined;
      await previous.host.close();
    },
    close: async () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        if (!active) return;
        const previous = active;
        active = undefined;
        await previous.host.close();
      })();
      return closePromise;
    },
  };

  async function selectProject(projectId: string): Promise<ProjectCatalogEntry> {
    assertRuntimeOpen();
    const catalog = await options.catalog.list();
    const project = catalog.projects.find((item) => item.projectId === projectId);
    if (!project) throw new ProjectLifecycleError('not-found', 'Project is not registered');
    if (project.ownership.status !== 'active') {
      throw new ProjectLifecycleError('project-inactive', 'Project is not active on this device');
    }
    if (active?.project.projectId === projectId) return project;
    if (active) {
      assertIdle(active.host);
      const previous = active;
      active = undefined;
      await previous.host.close();
    }
    const openProject = options.openProject ?? openDefaultProject;
    const next = await openProject(project);
    try {
      await options.catalog.updateOwnership(projectId, {
        status: 'active',
        ownerDeviceId: options.ownerDeviceId,
      });
    } catch (error) {
      await next.host.close();
      throw error;
    }
    active = next;
    return project;
  }

  function assertRuntimeOpen(): void {
    if (closed) throw new ProjectLifecycleError('runtime-closed', 'The web runtime is closed');
  }
}

function assertIdle(host: ExecutionHost): void {
  const state = host.getLifecycleState();
  if (state !== 'idle') throw new ProjectBusyError();
}

async function openDefaultProject(project: ProjectCatalogEntry): Promise<ActiveProjectRuntime> {
  const context = await openApplicationContext({
    configPath: project.configPath,
    cwd: project.workspacePath,
  });
  if (!context.guidedExecution || !context.findRun) {
    context.close();
    throw new ProjectLifecycleError(
      'invalid-runtime',
      'Project runtime does not provide execution',
    );
  }
  const host = createExecutionHost({
    application: context.application,
    guidedExecution: context.guidedExecution,
    ...(context.application.guidedPreparation
      ? { guidedPreparation: { service: context.application.guidedPreparation } }
      : {}),
    findRun: context.findRun,
    close: context.close,
  });
  return { project, context, host };
}
