import neo4j, { type Driver, type QueryResult, type Record as Neo4jRecord } from 'neo4j-driver';
import { env, isNeo4jConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notConfigured } from '../../utils/errors.js';
import { onShutdown } from '../../utils/shutdown.js';

let driver: Driver | null = null;

export interface Neo4jRuntimeStatus {
  lastSuccessfulQueryAt: string | null;
  lastError: { message: string; at: string } | null;
}
const runtime: Neo4jRuntimeStatus = { lastSuccessfulQueryAt: null, lastError: null };
export const getNeo4jRuntimeStatus = (): Neo4jRuntimeStatus => ({ ...runtime });

/** Lazily creates a single pooled driver (the official driver manages connection pooling). */
export function getDriver(): Driver {
  if (!isNeo4jConfigured()) throw notConfigured('Neo4j', 'NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD');
  if (!driver) {
    driver = neo4j.driver(env.NEO4J_URI!, neo4j.auth.basic(env.NEO4J_USERNAME!, env.NEO4J_PASSWORD!), {
      maxConnectionPoolSize: 20,
      connectionAcquisitionTimeout: 20_000,
      connectionTimeout: 15_000,
      maxTransactionRetryTime: 10_000,
      disableLosslessIntegers: true, // return plain JS numbers
    });
    onShutdown('neo4j driver', closeDriver);
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    const d = driver;
    driver = null;
    await d.close();
  }
}

function noteSuccess() {
  runtime.lastSuccessfulQueryAt = new Date().toISOString();
}
function noteError(err: unknown) {
  runtime.lastError = { message: err instanceof Error ? err.message : String(err), at: new Date().toISOString() };
}

export type Params = Record<string, unknown>;

/** Runs a parameterized read query and returns plain row objects. */
export async function readRows<T = Record<string, unknown>>(cypher: string, params: Params = {}): Promise<T[]> {
  const session = getDriver().session({ database: env.NEO4J_DATABASE, defaultAccessMode: neo4j.session.READ });
  try {
    const result: QueryResult = await session.executeRead((tx) => tx.run(cypher, params));
    noteSuccess();
    return result.records.map((r: Neo4jRecord) => r.toObject() as T);
  } catch (err) {
    noteError(err);
    logger.error({ err, cypher: cypher.slice(0, 120) }, 'Neo4j read failed');
    throw err;
  } finally {
    await session.close();
  }
}

/** Runs a parameterized write query and returns plain row objects. */
export async function writeRows<T = Record<string, unknown>>(cypher: string, params: Params = {}): Promise<T[]> {
  const session = getDriver().session({ database: env.NEO4J_DATABASE, defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.executeWrite((tx) => tx.run(cypher, params));
    noteSuccess();
    return result.records.map((r) => r.toObject() as T);
  } catch (err) {
    noteError(err);
    logger.error({ err, cypher: cypher.slice(0, 120) }, 'Neo4j write failed');
    throw err;
  } finally {
    await session.close();
  }
}

export interface Neo4jHealth {
  connected: boolean;
  latencyMs?: number;
  serverVersion?: string;
  error?: string;
}

/** Real connectivity check: verifies the driver can reach the server and run a query. */
export async function checkHealth(): Promise<Neo4jHealth> {
  if (!isNeo4jConfigured()) return { connected: false, error: 'Not configured' };
  const started = Date.now();
  try {
    const info = await getDriver().getServerInfo({ database: env.NEO4J_DATABASE });
    await readRows('RETURN 1 AS ok');
    return { connected: true, latencyMs: Date.now() - started, serverVersion: info.agent };
  } catch (err) {
    noteError(err);
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}
