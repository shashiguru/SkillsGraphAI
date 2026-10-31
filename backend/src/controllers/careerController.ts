import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response.js';
import { badRequest, notFound } from '../utils/errors.js';
import { getProfile } from '../services/neo4j/userRepository.js';
import { buildCareerGraph, buildGraphAnalysis } from '../services/career/graphAnalysis.js';
import { recalculateRoadmap, setSkillCompleted, startAnalysis, startDemoAnalysis } from '../services/career/careerAnalysisService.js';
import { getAnalysis, listAnalyses } from '../services/career/analysisStore.js';
import { buildDashboardSummary, buildRoadmapView, getLatestAnalysis } from '../services/career/views.js';
import { getNeo4jStatus } from './integrationsController.js';
import { getNosanaStatus } from '../services/nosana/nosanaClient.js';
import { getDaytonaStatus } from '../services/daytona/sandboxRunner.js';

const SkillGapBody = z.object({ targetRoleId: z.string().min(1).max(40).optional() });
const AnalyzeBody = z.object({
  targetRoleId: z.string().min(1).max(40).optional(),
  learningHoursPerWeek: z.number().min(1).max(80).optional(),
  mode: z.enum(['live', 'demo']).default('live'),
});
const RoadmapBody = z.object({
  analysisId: z.string().uuid().optional(),
  learningHoursPerWeek: z.number().min(1).max(80),
});
const CompleteBody = z.object({
  analysisId: z.string().uuid().optional(),
  completed: z.boolean().default(true),
});
const idParam = z.string().uuid();

/** Graph-only skill gap (Neo4j facts, no AI or sandbox). The full pipeline lives at POST /career/analyze. */
export async function skillGap(req: Request, res: Response) {
  const body = SkillGapBody.parse(req.body ?? {});
  const profile = await getProfile(req.profileId);
  if (!profile) throw notFound('Profile. Save your profile first');
  const roleId = body.targetRoleId ?? profile.targetRoleId;
  if (!roleId) throw badRequest('No target role selected');
  const analysis = await buildGraphAnalysis(req.profileId, roleId, profile.currentRole);
  const graph = await buildCareerGraph(analysis);
  ok(res, { source: 'neo4j', analysis, graph });
}

export async function analyze(req: Request, res: Response) {
  const body = AnalyzeBody.parse(req.body ?? {});
  const analysis = body.mode === 'demo' ? startDemoAnalysis() : await startAnalysis(body, undefined, req.profileId);
  ok(res, { analysisId: analysis.id, status: analysis.status, mode: analysis.mode }, 202);
}

export async function readAnalysis(req: Request, res: Response) {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) throw badRequest('Invalid analysis id');
  const analysis = await getAnalysis(id.data);
  if (!analysis) throw notFound('Analysis');
  ok(res, analysis);
}

export async function history(req: Request, res: Response) {
  const items = await listAnalyses(req.profileId, 20);
  ok(res, items, 200, { count: items.length });
}

export async function readGraph(req: Request, res: Response) {
  const id = idParam.safeParse(req.params.analysisId);
  if (!id.success) throw badRequest('Invalid analysis id');
  const analysis = await getAnalysis(id.data);
  if (!analysis) throw notFound('Analysis');
  if (!analysis.cytoscape) throw notFound('Graph for this analysis');
  ok(res, { analysisId: analysis.id, mode: analysis.mode, graph: analysis.cytoscape });
}

async function resolveAnalysis(userId: string, id?: string) {
  const analysis = id ? await getAnalysis(id) : await getLatestAnalysis(userId);
  if (!analysis) throw notFound(id ? 'Analysis' : 'Analysis. Run "Analyze My Career" first');
  return analysis;
}

/** Re-runs the sandbox schedule with a new weekly budget (a real Daytona execution). */
export async function recalculate(req: Request, res: Response) {
  const body = RoadmapBody.parse(req.body ?? {});
  const target = await resolveAnalysis(req.profileId, body.analysisId);
  const updated = await recalculateRoadmap(target.id, body.learningHoursPerWeek);
  ok(res, buildRoadmapView(updated));
}

export async function readRoadmap(req: Request, res: Response) {
  ok(res, buildRoadmapView(await resolveAnalysis(req.profileId)));
}

export async function completeItem(req: Request, res: Response) {
  const body = CompleteBody.parse(req.body ?? {});
  const skillId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).safeParse(req.params.id);
  if (!skillId.success) throw badRequest('Invalid roadmap item id');
  const target = await resolveAnalysis(req.profileId, body.analysisId);
  ok(res, buildRoadmapView(await setSkillCompleted(target.id, skillId.data, body.completed)));
}

export async function dashboardSummary(req: Request, res: Response) {
  ok(res, await buildDashboardSummary(req.profileId));
}

export async function allIntegrationsStatus(_req: Request, res: Response) {
  const [neo4j, nosana, daytona] = await Promise.all([getNeo4jStatus(), getNosanaStatus(), getDaytonaStatus()]);
  ok(res, { checkedAt: new Date().toISOString(), neo4j, nosana, daytona });
}
