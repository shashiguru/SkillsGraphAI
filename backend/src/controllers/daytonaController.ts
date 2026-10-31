import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { getDaytonaStatus } from '../services/daytona/sandboxRunner.js';

export async function daytonaStatus(_req: Request, res: Response) {
  ok(res, await getDaytonaStatus());
}
