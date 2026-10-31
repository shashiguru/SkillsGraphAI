import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { getNosanaStatus, listModels, NosanaError, setModelOverride } from '../services/nosana/nosanaClient.js';
import { isNosanaConfigured } from '../config/env.js';
import { notConfigured } from '../utils/errors.js';

export async function nosanaStatus(_req: Request, res: Response) {
  ok(res, await getNosanaStatus());
}

const statusFor = (e: NosanaError) =>
  e.kind === 'auth' ? 401 : e.kind === 'credits' ? 402 : e.kind === 'rate_limited' ? 429 : e.kind === 'model_unavailable' ? 404 : 502;

export async function nosanaModels(_req: Request, res: Response) {
  if (!isNosanaConfigured()) throw notConfigured('Nosana', 'NOSANA_API_KEY');
  try {
    const models = await listModels();
    const status = await getNosanaStatus();
    ok(res, { models, selectedModel: status.selectedModel ?? null }, 200, { count: models.length });
  } catch (err) {
    if (err instanceof NosanaError) throw new AppError(statusFor(err), `nosana_${err.kind}`, err.message);
    throw err;
  }
}

export async function selectNosanaModel(req: Request, res: Response) {
  const { modelId } = z.object({ modelId: z.string().min(1).nullable() }).parse(req.body);
  if (modelId) {
    const models = await listModels().catch((e) => {
      if (e instanceof NosanaError) throw new AppError(statusFor(e), `nosana_${e.kind}`, e.message);
      throw e;
    });
    if (!models.some((m) => m.id === modelId)) {
      throw new AppError(404, 'model_unavailable', `Model ${modelId} is not currently served by Nosana`);
    }
  }
  setModelOverride(modelId ?? undefined);
  ok(res, await getNosanaStatus());
}
