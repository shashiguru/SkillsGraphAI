import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..', '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

// backend/.env wins; the repo-root .env is a fallback (dotenv never overrides existing values).
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(3000)),
  FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().default('http://localhost:5173')),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.string().default('info')),

  NEO4J_URI: optionalString,
  NEO4J_USERNAME: optionalString,
  NEO4J_PASSWORD: optionalString,
  NEO4J_DATABASE: z.preprocess(emptyToUndefined, z.string().default('neo4j')),

  NOSANA_API_KEY: optionalString,
  NOSANA_BASE_URL: z.preprocess(emptyToUndefined, z.string().default('https://inference.nosana.com/v1')),
  NOSANA_MODEL: optionalString,

  DAYTONA_API_KEY: optionalString,
  DAYTONA_API_URL: z.preprocess(emptyToUndefined, z.string().default('https://app.daytona.io/api')),
  DAYTONA_TARGET: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isNeo4jConfigured = (e: Env = env) => Boolean(e.NEO4J_URI && e.NEO4J_USERNAME && e.NEO4J_PASSWORD);
export const isNosanaConfigured = (e: Env = env) => Boolean(e.NOSANA_API_KEY);
export const isDaytonaConfigured = (e: Env = env) => Boolean(e.DAYTONA_API_KEY);
