import type { NextFunction, Request, Response } from 'express';
import { badRequest } from '../utils/errors.js';
import { DEFAULT_USER_ID } from '../schemas/profile.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The profile (User node id) this request acts on. */
      profileId: string;
    }
  }
}

const PROFILE_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Reads the active profile from the X-Profile-Id header. Falls back to the original single profile. */
export function profileContext(req: Request, _res: Response, next: NextFunction) {
  const raw = req.header('x-profile-id');
  if (raw !== undefined && !PROFILE_ID.test(raw)) return next(badRequest('Invalid X-Profile-Id header'));
  req.profileId = raw ?? DEFAULT_USER_ID;
  next();
}
