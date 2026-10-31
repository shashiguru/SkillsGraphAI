import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { runShutdownHooks } from './utils/shutdown.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`SkillGraph backend listening on http://localhost:${env.PORT}`);
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Shutting down');
  server.close();
  await runShutdownHooks();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
