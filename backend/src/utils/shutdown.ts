import { logger } from './logger.js';

type Hook = { name: string; fn: () => Promise<void> };
const hooks: Hook[] = [];

export function onShutdown(name: string, fn: () => Promise<void>) {
  hooks.push({ name, fn });
}

export async function runShutdownHooks() {
  for (const hook of hooks.splice(0)) {
    try {
      await hook.fn();
      logger.info(`Closed ${hook.name}`);
    } catch (err) {
      logger.error({ err }, `Failed closing ${hook.name}`);
    }
  }
}
