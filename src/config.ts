export type WorkspaceMode = 'read-only' | 'read-write';

export interface AgentProfile {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: WorkspaceMode;
  timeoutMs: number;
  retryLimit: number;
}

export interface BinaflowConfig {
  dataDir: string;
  piCommand: string;
  profiles: Record<string, AgentProfile>;
}

export function resolveProfile(
  config: Pick<BinaflowConfig, 'profiles'>,
  profileName: string,
): AgentProfile {
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`Unknown agent profile: ${profileName}`);
  return profile;
}
