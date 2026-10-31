import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response.js';
import { notFound } from '../utils/errors.js';
import * as catalog from '../services/neo4j/catalogRepository.js';
import { getRoleMatchSummaries } from '../services/neo4j/careerGraphRepository.js';

const SkillsQuery = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function listSkills(req: Request, res: Response) {
  const query = SkillsQuery.parse(req.query);
  const [skills, categories] = await Promise.all([catalog.listSkills(query), catalog.listSkillCategories()]);
  ok(res, { skills, categories }, 200, { count: skills.length });
}

export async function getSkill(req: Request, res: Response) {
  const skill = await catalog.getSkillDetail(String(req.params.id));
  if (!skill) throw notFound(`Skill ${req.params.id}`);
  ok(res, skill);
}

export async function listRoles(req: Request, res: Response) {
  const [summaries, families] = await Promise.all([getRoleMatchSummaries(req.profileId), catalog.getRoleFamilies()]);
  const roles = summaries.map((r) => ({ ...r, family: families.get(r.id) ?? 'General' }));
  ok(res, { roles, families: [...new Set(roles.map((r) => r.family))].sort() }, 200, { count: roles.length });
}

export async function getRole(req: Request, res: Response) {
  const role = await catalog.getRoleDetail(String(req.params.id));
  if (!role) throw notFound(`Role ${req.params.id}`);
  ok(res, role);
}
