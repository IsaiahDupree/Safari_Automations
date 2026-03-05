export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout: number;
  actionDelay: number;
  verbose: boolean;
}

export const DEFAULT_CONFIG: AutomationConfig = {
  instanceType: 'local',
  timeout: 30000,
  actionDelay: 1000,
  verbose: false,
};
