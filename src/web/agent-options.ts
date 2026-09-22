import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AGENT_THINKING_LEVELS = [
  'Default',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export const AGENT_TOOL_OPTIONS = [
  {
    id: 'ls',
    label: 'List files',
    description: 'List files and directories.',
    writeCapable: false,
  },
  {
    id: 'find',
    label: 'Find files',
    description: 'Search for files and directories.',
    writeCapable: false,
  },
  { id: 'read', label: 'Read files', description: 'Read file contents.', writeCapable: false },
  {
    id: 'write',
    label: 'Write files',
    description: 'Create or replace files.',
    writeCapable: true,
  },
  {
    id: 'edit',
    label: 'Edit files',
    description: 'Apply targeted file edits.',
    writeCapable: true,
  },
  {
    id: 'bash',
    label: 'Run commands',
    description: 'Execute workspace commands.',
    writeCapable: true,
  },
] as const;

export interface AgentSkillOption {
  name: string;
  description: string;
  path: string;
  source: 'project' | 'global';
}

export async function discoverProjectSkills(workspacePath: string): Promise<AgentSkillOption[]> {
  const roots = [
    { path: join(workspacePath, '.pi', 'skills'), source: 'project' as const },
    { path: join(workspacePath, '.agents', 'skills'), source: 'project' as const },
    { path: join(homedir(), '.pi', 'agent', 'skills'), source: 'global' as const },
    { path: join(homedir(), '.agents', 'skills'), source: 'global' as const },
  ];
  const result: AgentSkillOption[] = [];
  for (const root of roots) await scanSkillRoot(root.path, root.source, result, new Set(), 0);
  const unique = new Map<string, AgentSkillOption>();
  for (const skill of result) if (!unique.has(skill.name)) unique.set(skill.name, skill);
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function scanSkillRoot(
  directory: string,
  source: 'project' | 'global',
  result: AgentSkillOption[],
  visited: Set<string>,
  depth: number,
): Promise<void> {
  if (depth > 8 || result.length >= 200) return;
  let realDirectory: string;
  try {
    realDirectory = await realpath(directory);
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
  } catch {
    return;
  }
  let entries;
  try {
    entries = await readdir(realDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.length >= 200) return;
    const path = join(realDirectory, entry.name);
    if (entry.isDirectory()) {
      await scanSkillRoot(path, source, result, visited, depth + 1);
      continue;
    }
    if (entry.name !== 'SKILL.md') continue;
    const skill = await readSkill(path, source);
    if (skill) result.push(skill);
  }
}

async function readSkill(
  path: string,
  source: 'project' | 'global',
): Promise<AgentSkillOption | undefined> {
  try {
    const details = await stat(path);
    if (!details.isFile() || details.size > 128 * 1024) return undefined;
    const text = await readFile(path, 'utf8');
    const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatter) return undefined;
    const name = frontmatter[1]?.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
    const description = frontmatter[1]?.match(/^description:\s*([^\n]+)$/m)?.[1]?.trim();
    if (!name || !description) return undefined;
    return { name, description, path, source };
  } catch {
    return undefined;
  }
}
