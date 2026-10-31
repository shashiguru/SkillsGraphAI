import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Daytona } from '@daytona/sdk';
import { BACKEND_ROOT, env, isDaytonaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notConfigured } from '../../utils/errors.js';
import { AnalysisInputSchema, AnalysisOutputSchema, type AnalysisInput, type AnalysisOutput } from '../../schemas/analysis.js';

export const TEMPLATE_PATH = path.join(BACKEND_ROOT, 'src', 'services', 'daytona', 'templates', 'analysis.py');
export const RESULT_BEGIN = '__SKILLGRAPH_RESULT_BEGIN__';
export const RESULT_END = '__SKILLGRAPH_RESULT_END__';
const PLACEHOLDER = '__INPUT_B64__';

export interface SandboxLogLine {
  at: string;
  source: 'backend' | 'sandbox';
  message: string;
}

export interface SandboxExecution {
  executionId: string;
  status: 'completed' | 'failed' | 'timeout';
  sandboxId: string | null;
  startedAt: string;
  durationMs: number;
  phases: { createMs?: number; prepareMs?: number; executeMs?: number; cleanupMs?: number };
  exitCode: number | null;
  pythonVersion: string | null;
  networkIsolated: boolean;
  logs: SandboxLogLine[];
  cleanedUp: boolean;
  error?: string;
}

export class DaytonaRunError extends Error {
  constructor(
    message: string,
    public readonly execution: SandboxExecution,
    public readonly kind: 'auth' | 'create' | 'execute' | 'timeout' | 'parse' | 'input' = 'execute',
  ) {
    super(message);
    this.name = 'DaytonaRunError';
  }
}

const history: SandboxExecution[] = [];
export const getExecutionHistory = () => [...history];
export const getLastExecution = (): SandboxExecution | null => history[0] ?? null;
function remember(exec: SandboxExecution) {
  history.unshift(exec);
  history.length = Math.min(history.length, 10);
}

let client: Daytona | null = null;
function getClient(): Daytona {
  if (!isDaytonaConfigured()) throw notConfigured('Daytona', 'DAYTONA_API_KEY');
  client ??= new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    ...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
  });
  return client;
}

export function renderTemplate(input: AnalysisInput): string {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes(PLACEHOLDER)) throw new Error('analysis.py template is missing its input placeholder');
  // Input is validated by Zod and embedded as base64 data (alphabet A-Z a-z 0-9 + / =), so it cannot alter the code.
  const b64 = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  return template.replace(PLACEHOLDER, b64);
}

/** Extracts and validates the structured result the template prints between marker lines. */
export function parseSandboxOutput(raw: string): { output: AnalysisOutput } | { failure: string } {
  const start = raw.indexOf(RESULT_BEGIN);
  const end = raw.indexOf(RESULT_END);
  if (start < 0 || end < 0 || end < start) return { failure: 'Sandbox output did not contain a result block' };
  const jsonText = raw.slice(start + RESULT_BEGIN.length, end).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { failure: 'Sandbox result block was not valid JSON' };
  }
  if ((parsed as { executionStatus?: string }).executionStatus === 'failed') {
    return { failure: `Analysis script reported an error: ${(parsed as { error?: string }).error ?? 'unknown'}` };
  }
  const result = AnalysisOutputSchema.safeParse(parsed);
  if (!result.success) return { failure: `Sandbox result failed validation: ${result.error.issues[0]?.message ?? 'invalid'}` };
  return { output: result.data };
}

/** Everything the script printed except the machine-readable block, for display in the monitor. */
function scriptLogLines(raw: string): string[] {
  const start = raw.indexOf(RESULT_BEGIN);
  const end = raw.indexOf(RESULT_END);
  const cleaned = start >= 0 && end > start ? raw.slice(0, start) + raw.slice(end + RESULT_END.length) : raw;
  return cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * STEP 4: executes the trusted analysis template inside an isolated Daytona sandbox.
 * The sandbox is always deleted in `finally`. Throws DaytonaRunError (with a full execution record) on failure.
 */
export async function runPythonAnalysis(rawInput: AnalysisInput): Promise<{ output: AnalysisOutput; execution: SandboxExecution }> {
  const startedMs = Date.now();
  const exec: SandboxExecution = {
    executionId: crypto.randomUUID(),
    status: 'failed',
    sandboxId: null,
    startedAt: new Date(startedMs).toISOString(),
    durationMs: 0,
    phases: {},
    exitCode: null,
    pythonVersion: null,
    networkIsolated: false,
    logs: [],
    cleanedUp: false,
  };
  const log = (source: SandboxLogLine['source'], message: string) =>
    exec.logs.push({ at: new Date().toISOString(), source, message });
  const finish = (status: SandboxExecution['status'], error?: string) => {
    exec.status = status;
    exec.error = error;
    exec.durationMs = Date.now() - startedMs;
    remember(exec);
  };

  const parsedInput = AnalysisInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    log('backend', 'Rejected analysis input: failed schema validation');
    finish('failed', 'Input failed validation');
    throw new DaytonaRunError('Analysis input failed validation', exec, 'input');
  }
  const code = renderTemplate(parsedInput.data);
  const daytona = getClient();

  let sandbox: Awaited<ReturnType<Daytona['create']>> | null = null;
  let outcome: { status: SandboxExecution['status']; error?: string } = { status: 'failed', error: 'Unknown failure' };
  try {
    // --- create sandbox
    const createStart = Date.now();
    log('backend', 'Creating isolated Daytona sandbox (python)');
    const baseParams = {
      language: 'python',
      ephemeral: true, // auto-deleted when stopped, as a second line of defence behind our explicit delete
      autoStopInterval: 5,
      labels: { app: 'skillgraph-ai', purpose: 'career-analysis' },
    };
    try {
      sandbox = await daytona.create({ ...baseParams, networkBlockAll: true }, { timeout: 90 });
      exec.networkIsolated = true;
    } catch (err) {
      // Network isolation is not available on every Daytona tier. Only retry for that specific rejection.
      if (/network|forbidden|not allowed|tier|limit/i.test(errMessage(err)) && !/auth|api key|unauthorized/i.test(errMessage(err))) {
        log('backend', `Network isolation unavailable (${errMessage(err).slice(0, 120)}). Creating sandbox without it`);
        sandbox = await daytona.create(baseParams, { timeout: 90 });
      } else {
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { phase: 'create' });
      }
    }
    exec.sandboxId = sandbox.id;
    exec.phases.createMs = Date.now() - createStart;
    log('backend', `Sandbox ${sandbox.id} ready in ${exec.phases.createMs}ms (network isolated: ${exec.networkIsolated})`);

    // --- prepare environment
    const prepStart = Date.now();
    const version = await sandbox.process.executeCommand('python3 --version', undefined, undefined, 30);
    exec.pythonVersion = version.result.trim() || null;
    exec.phases.prepareMs = Date.now() - prepStart;
    log('sandbox', `python3 --version -> ${exec.pythonVersion ?? 'unknown'} (exit ${version.exitCode})`);
    if (version.exitCode !== 0) throw Object.assign(new Error('python3 is not available in the sandbox'), { phase: 'prepare' });

    // --- execute trusted template
    const runStart = Date.now();
    log('backend', `Executing trusted analysis template (${code.length} bytes, 60s timeout)`);
    const run = await sandbox.process.codeRun(code, undefined, 60);
    exec.phases.executeMs = Date.now() - runStart;
    exec.exitCode = run.exitCode;
    const raw = run.result ?? '';
    scriptLogLines(raw).forEach((l) => log('sandbox', l));
    log('backend', `Execution finished with exit code ${run.exitCode} in ${exec.phases.executeMs}ms`);

    const parsed = parseSandboxOutput(raw);
    if (run.exitCode !== 0 || 'failure' in parsed) {
      const reason = 'failure' in parsed ? parsed.failure : `Script exited with code ${run.exitCode}`;
      outcome = { status: 'failed', error: reason };
      throw new DaytonaRunError(reason, exec, 'parse');
    }
    outcome = { status: 'completed' };
    return { output: parsed.output, execution: exec };
  } catch (err) {
    if (err instanceof DaytonaRunError) throw err;
    const message = errMessage(err);
    const timedOut = /timeout|timed out/i.test(message) || (err as Error)?.name?.includes('Timeout');
    const kind = timedOut ? 'timeout' : /auth|api key|unauthorized|forbidden/i.test(message) ? 'auth' : (err as { phase?: string }).phase === 'create' ? 'create' : 'execute';
    log('backend', `Failed: ${message}`);
    outcome = { status: timedOut ? 'timeout' : 'failed', error: message };
    throw new DaytonaRunError(message, exec, kind);
  } finally {
    if (sandbox) {
      const cleanStart = Date.now();
      try {
        log('backend', `Deleting sandbox ${sandbox.id}`);
        await sandbox.delete(60);
        exec.cleanedUp = true;
        log('backend', 'Sandbox deleted');
      } catch (cleanupErr) {
        log('backend', `Sandbox cleanup failed: ${errMessage(cleanupErr)} (ephemeral sandboxes are removed automatically on stop)`);
        logger.error({ err: cleanupErr, sandboxId: sandbox.id }, 'Daytona sandbox cleanup failed');
      }
      exec.phases.cleanupMs = Date.now() - cleanStart;
    }
    // Finalised only after cleanup, so the stored record includes cleanup timing and status.
    finish(outcome.status, outcome.error);
  }
}

export interface DaytonaStatus {
  configured: boolean;
  connected: boolean;
  apiUrl: string;
  latencyMs?: number;
  error?: string;
  lastExecution: SandboxExecution | null;
  recentExecutions: Pick<SandboxExecution, 'executionId' | 'status' | 'sandboxId' | 'startedAt' | 'durationMs' | 'cleanedUp' | 'error'>[];
}

/** Real health check: an authenticated list call against the Daytona API. No sandbox is created. */
export async function getDaytonaStatus(): Promise<DaytonaStatus> {
  const base: DaytonaStatus = {
    configured: isDaytonaConfigured(),
    connected: false,
    apiUrl: env.DAYTONA_API_URL,
    lastExecution: getLastExecution(),
    recentExecutions: getExecutionHistory().map(({ executionId, status, sandboxId, startedAt, durationMs, cleanedUp, error }) => ({
      executionId,
      status,
      sandboxId,
      startedAt,
      durationMs,
      cleanedUp,
      error,
    })),
  };
  if (!base.configured) return { ...base, error: 'Not configured (DAYTONA_API_KEY missing)' };
  const started = Date.now();
  try {
    const it = getClient().list({ limit: 1 })[Symbol.asyncIterator]();
    await it.next();
    return { ...base, connected: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ...base, error: errMessage(err) };
  }
}
