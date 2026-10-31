import type { Response } from 'express';

export interface ApiMeta {
  timestamp: string;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta: ApiMeta;
}

export function ok<T>(res: Response, data: T, status = 200, meta: Record<string, unknown> = {}) {
  const body: ApiEnvelope<T> = { data, error: null, meta: { timestamp: new Date().toISOString(), ...meta } };
  return res.status(status).json(body);
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown) {
  const body: ApiEnvelope<never> = {
    data: null,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    meta: { timestamp: new Date().toISOString() },
  };
  return res.status(status).json(body);
}
