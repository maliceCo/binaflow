export type WorkspaceMode = 'read-only' | 'read-write';
export type ProjectTrust = 'never' | 'always';

export type SkillPolicy =
  { mode: 'discover' } | { mode: 'none' } | { mode: 'only'; paths: string[]; required?: string[] };

export interface AgentProfile {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: WorkspaceMode;
  projectTrust?: ProjectTrust;
  timeoutMs: number;
  retryLimit: number;
  skills?: SkillPolicy;
}

export function resolveProfile(
  config: { profiles: Record<string, AgentProfile> },
  profileName: string,
): AgentProfile {
  const profile = Object.prototype.hasOwnProperty.call(config.profiles, profileName)
    ? config.profiles[profileName]
    : undefined;
  if (!profile) throw new Error(`Unknown agent profile: ${profileName}`);
  return profile;
}
