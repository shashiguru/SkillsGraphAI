import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { badRequest, notFound } from '../utils/errors.js';
import { ProfileInputSchema } from '../schemas/profile.js';
import crypto from 'node:crypto';
import { DEFAULT_USER_ID } from '../schemas/profile.js';
import { deleteProfile, getProfile, listProfiles, upsertProfile } from '../services/neo4j/userRepository.js';
import { getRole } from '../services/neo4j/catalogRepository.js';

async function assertTargetRoleExists(roleId?: string) {
  if (roleId && !(await getRole(roleId))) throw badRequest(`Unknown targetRoleId ${roleId}`);
}

export async function readProfile(req: Request, res: Response) {
  const profile = await getProfile(req.profileId);
  if (!profile) throw notFound('Profile');
  ok(res, profile);
}

export async function createProfile(req: Request, res: Response) {
  const input = ProfileInputSchema.parse(req.body);
  await assertTargetRoleExists(input.targetRoleId);
  ok(res, await upsertProfile(input, req.profileId), 201);
}

export async function updateProfile(req: Request, res: Response) {
  const input = ProfileInputSchema.parse(req.body);
  if (!(await getProfile(req.profileId))) throw notFound('Profile');
  await assertTargetRoleExists(input.targetRoleId);
  ok(res, await upsertProfile(input, req.profileId));
}

export async function listAllProfiles(_req: Request, res: Response) {
  const profiles = await listProfiles();
  ok(res, profiles, 200, { count: profiles.length });
}

/** Creates an additional profile with a fresh id. Existing profiles are never touched. */
export async function createAdditionalProfile(req: Request, res: Response) {
  const input = ProfileInputSchema.parse(req.body);
  await assertTargetRoleExists(input.targetRoleId);
  const userId = `p-${crypto.randomUUID().slice(0, 8)}`;
  ok(res, await upsertProfile(input, userId), 201);
}

export async function removeProfile(req: Request, res: Response) {
  const id = String(req.params.id);
  if (id === DEFAULT_USER_ID) throw badRequest('The default profile cannot be deleted');
  if (!(await deleteProfile(id))) throw notFound('Profile');
  ok(res, { deleted: id });
}