import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { isNeo4jConfigured } from '../config/env.js';
import { checkHealth, getNeo4jRuntimeStatus } from '../services/neo4j/driver.js';
import { getDatasetImportStatus, getGraphCounts } from '../services/neo4j/graphStats.js';

export interface Neo4jStatus {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  serverVersion?: string;
  error?: string;
  counts?: { nodes: Record<string, number>; relationships: Record<string, number> };
  datasetImport?: Awaited<ReturnType<typeof getDatasetImportStatus>>;
  lastSuccessfulQueryAt: string | null;
  lastError: { message: string; at: string } | null;
}

export async function getNeo4jStatus(): Promise<Neo4jStatus> {
  const configured = isNeo4jConfigured();
  const health = await checkHealth();
  const status: Neo4jStatus = {
    configured,
    connected: health.connected,
    latencyMs: health.latencyMs,
    serverVersion: health.serverVersion,
    error: health.error,
    lastSuccessfulQueryAt: null,
    lastError: null,
  };
  if (health.connected) {
    try {
      const [counts, datasetImport] = await Promise.all([getGraphCounts(), getDatasetImportStatus()]);
      status.counts = counts;
      status.datasetImport = datasetImport;
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
    }
  }
  const runtime = getNeo4jRuntimeStatus();
  status.lastSuccessfulQueryAt = runtime.lastSuccessfulQueryAt;
  status.lastError = runtime.lastError;
  return status;
}

export async function neo4jStatus(_req: Request, res: Response) {
  ok(res, await getNeo4jStatus());
}
