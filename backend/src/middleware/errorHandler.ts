import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  fail(res, 404, 'route_not_found', `No route for ${req.method} ${req.originalUrl}`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof ZodError) {
    return fail(res, 400, 'validation_error', 'Request validation failed', err.issues);
  }
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    return fail(res, err.status, err.code, err.message, err.details);
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    return fail(res, 400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'Neo4jError') {
    logger.error({ err, path: req.path }, 'Neo4j error');
    return fail(res, 503, 'neo4j_error', `Neo4j request failed: ${(err as Error).message}`);
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  return fail(res, 500, 'internal_error', 'Internal server error');
};
