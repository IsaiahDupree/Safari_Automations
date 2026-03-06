export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout?: number;
  actionDelay?: number;
  verbose?: boolean;
}
