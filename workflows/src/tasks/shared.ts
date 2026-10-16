import { createCaller, type Caller } from '../client.js';
import { loadConfig, type WorkflowConfig } from '../config.js';

/** Config is read inside each run (every task run is a fresh instance with the service's env). */
export function connect(): { cfg: WorkflowConfig; api: Caller } {
  const cfg = loadConfig();
  return { cfg, api: createCaller(cfg) };
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function log(event: string, data: Record<string, unknown> = {}): void {
  // One JSON line per event: searchable in Render's log explorer.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}
