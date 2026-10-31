import { env, isNosanaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notConfigured } from '../../utils/errors.js';

/** Shapes follow https://learn.nosana.com/llm/ (OpenAI-compatible). */
export interface NosanaModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  max_output_tokens?: number;
  pricing?: { prompt?: string; completion?: string };
  available?: boolean;
  owned_by?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type NosanaErrorKind =
  | 'auth' // 401 invalid_api_key
  | 'credits' // 402 insufficient_credits
  | 'model_unavailable' // 404 model_not_found
  | 'rate_limited' // 429
  | 'upstream' // 502 / 503 / 504
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'invalid_response'
  | 'not_configured'
  | 'unknown';

export class NosanaError extends Error {
  constructor(
    public readonly kind: NosanaErrorKind,
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'NosanaError';
  }
  get retryable() {
    return this.kind === 'rate_limited' || this.kind === 'upstream' || this.kind === 'timeout' || this.kind === 'network';
  }
}

export interface ChatCompletionResult {
  content: string;
  reasoning?: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finishReason?: string;
  durationMs: number;
  attempts: number;
}

export interface LastInference {
  status: 'success' | 'failed';
  at: string;
  model?: string;
  durationMs?: number;
  attempts?: number;
  usage?: ChatCompletionResult['usage'];
  error?: { kind: string; message: string; status?: number };
}

const runtime: {
  selectedModel?: string;
  modelOverride?: string;
  requestedModelUnavailable?: string;
  lastInference?: LastInference;
  lastError?: { kind: string; message: string; at: string };
} = {};

export const getNosanaRuntime = () => ({ ...runtime });

function baseUrl() {
  return env.NOSANA_BASE_URL.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  if (!isNosanaConfigured()) throw notConfigured('Nosana', 'NOSANA_API_KEY');
  // Docs: the header must be `Authorization: Bearer nos_...`
  return { Authorization: `Bearer ${env.NOSANA_API_KEY}`, 'Content-Type': 'application/json' };
}

function classify(status: number, body: unknown): NosanaError {
  const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
  const message = err?.message ?? `Nosana request failed with status ${status}`;
  const code = err?.code;
  if (status === 401) return new NosanaError('auth', message, status, code ?? 'invalid_api_key');
  if (status === 402) return new NosanaError('credits', message, status, code ?? 'insufficient_credits');
  if (status === 404) return new NosanaError('model_unavailable', message, status, code ?? 'model_not_found');
  if (status === 429) return new NosanaError('rate_limited', message, status, code ?? 'rate_limited');
  if (status === 502 || status === 503 || status === 504) return new NosanaError('upstream', message, status, code);
  if (status >= 400 && status < 500) return new NosanaError('bad_request', message, status, code);
  return new NosanaError('unknown', message, status, code);
}

async function request(path: string, init: { method: string; body?: unknown; timeoutMs: number }): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: authHeaders(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new NosanaError('timeout', `Nosana did not respond within ${init.timeoutMs}ms`);
    }
    throw new NosanaError('network', `Cannot reach Nosana: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = classify(res.status, body);
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new NosanaError(e.kind, e.message, e.status, e.code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
  if (body === null) throw new NosanaError('invalid_response', 'Nosana returned a non-JSON response', res.status);
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<{ value: T; attempts: number }> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return { value: await fn(), attempts: attempt };
    } catch (err) {
      if (!(err instanceof NosanaError) || !err.retryable || attempt >= maxAttempts) throw err;
      const delay = Math.min(err.retryAfterMs ?? 800 * 2 ** (attempt - 1), 8000);
      logger.warn({ kind: err.kind, attempt, delay }, 'Transient Nosana failure, retrying');
      await sleep(delay);
    }
  }
}

/**
 * /v1/models also lists embedding models (for example "nvidia/nemotron-3-embed-1b" with max_output_tokens 1).
 * They cannot answer chat completions, so they must never be auto-selected or offered in the monitor.
 */
export function isChatModel(m: NosanaModel): boolean {
  const text = `${m.id} ${m.name ?? ''} ${m.description ?? ''}`;
  if (/embed|rerank/i.test(text)) return false;
  if (m.max_output_tokens !== undefined && m.max_output_tokens <= 1) return false;
  return true;
}

/** GET /v1/models, chat-capable models only. The API lists only models with a GPU currently serving them. */
export async function listModels(): Promise<NosanaModel[]> {
  try {
    const { value } = await withRetry(() => request('/models', { method: 'GET', timeoutMs: 15_000 }), 2);
    const data = (value as { data?: NosanaModel[] }).data;
    if (!Array.isArray(data)) throw new NosanaError('invalid_response', 'Nosana /models response had no data array');
    return data.filter((m) => m.available !== false && isChatModel(m));
  } catch (err) {
    noteError(err);
    throw err;
  }
}

/**
 * Chooses the model. Priority: runtime override (monitor) > NOSANA_MODEL > first served model.
 * A configured model that is not currently served is NOT silently trusted: we fall back and report it.
 */
export async function resolveModel(): Promise<{ model: string; models: NosanaModel[]; fallbackFrom?: string }> {
  const models = await listModels();
  if (!models.length) throw new NosanaError('model_unavailable', 'Nosana is reachable but no model is currently being served');
  const wanted = runtime.modelOverride ?? env.NOSANA_MODEL;
  if (wanted) {
    if (models.some((m) => m.id === wanted)) {
      runtime.selectedModel = wanted;
      runtime.requestedModelUnavailable = undefined;
      return { model: wanted, models };
    }
    runtime.requestedModelUnavailable = wanted;
    runtime.selectedModel = models[0].id;
    return { model: models[0].id, models, fallbackFrom: wanted };
  }
  runtime.selectedModel = models[0].id;
  return { model: models[0].id, models };
}

export function setModelOverride(modelId: string | undefined) {
  runtime.modelOverride = modelId;
}

function noteError(err: unknown) {
  if (err instanceof NosanaError) runtime.lastError = { kind: err.kind, message: err.message, at: new Date().toISOString() };
  else runtime.lastError = { kind: 'unknown', message: String(err), at: new Date().toISOString() };
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Ask reasoning models to skip their thinking phase (chat_template_kwargs.enable_thinking=false). */
  disableThinking?: boolean;
  timeoutMs?: number;
}

/** POST /v1/chat/completions. Records the outcome as the "last inference" for the integration monitor. */
export async function chatCompletion(opts: ChatOptions): Promise<ChatCompletionResult> {
  const started = Date.now();
  // Optional request extras. Some served models reject them, in which case we retry once without.
  const makeBody = (extras: boolean) => ({
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(extras && opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    // Qwen-style reasoning models otherwise think for minutes before answering.
    ...(extras && opts.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });

  try {
    let jsonMode = Boolean(opts.jsonMode || opts.disableThinking);
    let outcome: { value: unknown; attempts: number };
    try {
      outcome = await withRetry(() =>
        request('/chat/completions', { method: 'POST', body: makeBody(jsonMode), timeoutMs: opts.timeoutMs ?? 120_000 }),
      );
    } catch (err) {
      // Some served models reject response_format: retry once without it rather than failing the analysis.
      if (jsonMode && err instanceof NosanaError && err.kind === 'bad_request' && /response_format|json|chat_template|enable_thinking/i.test(err.message)) {
        jsonMode = false;
        outcome = await withRetry(() =>
          request('/chat/completions', { method: 'POST', body: makeBody(false), timeoutMs: opts.timeoutMs ?? 120_000 }),
        );
      } else {
        throw err;
      }
    }

    const body = outcome.value as {
      model?: string;
      choices?: { message?: { content?: string | null; reasoning?: string | null }; finish_reason?: string }[];
      usage?: ChatCompletionResult['usage'];
    };
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new NosanaError(
        'invalid_response',
        choice?.finish_reason === 'length'
          ? 'Model hit the output token limit before producing an answer (reasoning models may need a higher limit)'
          : 'Nosana returned an empty completion',
      );
    }
    const result: ChatCompletionResult = {
      content,
      reasoning: choice?.message?.reasoning ?? undefined,
      model: body.model ?? opts.model,
      usage: body.usage,
      finishReason: choice?.finish_reason,
      durationMs: Date.now() - started,
      attempts: outcome.attempts,
    };
    runtime.lastInference = {
      status: 'success',
      at: new Date().toISOString(),
      model: result.model,
      durationMs: result.durationMs,
      attempts: result.attempts,
      usage: result.usage,
    };
    return result;
  } catch (err) {
    noteError(err);
    const e = err instanceof NosanaError ? err : new NosanaError('unknown', String(err));
    runtime.lastInference = {
      status: 'failed',
      at: new Date().toISOString(),
      model: opts.model,
      durationMs: Date.now() - started,
      error: { kind: e.kind, message: e.message, status: e.status },
    };
    throw e;
  }
}

export interface NosanaStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string;
  latencyMs?: number;
  error?: string;
  errorKind?: string;
  models: NosanaModel[];
  selectedModel?: string;
  configuredModel?: string;
  configuredModelUnavailable?: string;
  lastInference?: LastInference;
  lastError?: { kind: string; message: string; at: string };
}

/** Real health check = successful authenticated GET /v1/models. */
export async function getNosanaStatus(): Promise<NosanaStatus> {
  const base: NosanaStatus = {
    configured: isNosanaConfigured(),
    connected: false,
    baseUrl: env.NOSANA_BASE_URL,
    models: [],
    configuredModel: runtime.modelOverride ?? env.NOSANA_MODEL,
  };
  if (!base.configured) {
    return { ...base, error: 'Not configured (NOSANA_API_KEY missing)', errorKind: 'not_configured' };
  }
  const started = Date.now();
  try {
    const { model, models, fallbackFrom } = await resolveModel();
    return {
      ...base,
      connected: true,
      latencyMs: Date.now() - started,
      models,
      selectedModel: model,
      configuredModelUnavailable: fallbackFrom,
      lastInference: runtime.lastInference,
      lastError: runtime.lastError,
    };
  } catch (err) {
    const e = err instanceof NosanaError ? err : new NosanaError('unknown', String(err));
    return {
      ...base,
      error: e.message,
      errorKind: e.kind,
      selectedModel: runtime.selectedModel,
      lastInference: runtime.lastInference,
      lastError: runtime.lastError,
    };
  }
}
