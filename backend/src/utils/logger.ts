import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'apiKey', '*.apiKey', 'password', '*.password'],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'production' || env.NODE_ENV === 'test'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
