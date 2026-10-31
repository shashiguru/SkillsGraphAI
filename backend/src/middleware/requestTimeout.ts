import type { RequestHandler } from 'express';
import { fail } from '../utils/response.js';

/** Fails requests that exceed `ms`. Long-running work (career analysis) runs async and is polled. */
export const requestTimeout =
  (ms: number): RequestHandler =>
  (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) fail(res, 504, 'request_timeout', `Request exceeded ${ms}ms`);
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
