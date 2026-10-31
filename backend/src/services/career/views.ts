import type { RoadmapItem } from '../../schemas/analysis.js';
import type { AnalysisListItem, AnalysisMode, AnalysisStatus, CareerAnalysis } from '../../types/career.js';
import { listAnalyses, getAnalysis } from './analysisStore.js';
import { DEFAULT_USER_ID } from '../../schemas/profile.js';

export interface RoadmapView {
  analysisId: string;
  mode: AnalysisMode;
  targetRoleName: string;
  learningHoursPerWeek: number;
  /** daytona: numbers computed in the sandbox. unavailable: only graph ordering is known. */
  computation: 'daytona' | 'demo' | 'unavailable';
  computationNote?: string;
  items: (RoadmapItem & { completed: boolean })[];
  /** Graph-only ordering, always present. Used when the sandbox result is unavailable. */
  graphOrder: { order: number; skillId: string; skill: string; kind: 'missing' | 'prerequisite'; depth: number; completed: boolean }[];
  phases: { phase: number; name: string; skills: string[]; hours: number }[];
  weeklySchedule: NonNullable<CareerAnalysis['computation']>['weeklySchedule'];
  totals: { hours: number; weeks: number; skills: number; completedSkills: number; progressPercent: number } | null;
  completedSkillIds: string[];
}

export function buildRoadmapView(a: CareerAnalysis): RoadmapView {
  const done = new Set(a.completedSkillIds);
  const missing = new Set(a.graph?.missingSkills.map((s) => s.id) ?? []);
  const graphOrder = (a.graph?.learningOrder ?? []).map((s) => ({
    order: s.order,
    skillId: s.skill.id,
    skill: s.skill.name,
    kind: missing.has(s.skill.id) ? ('missing' as const) : ('prerequisite' as const),
    depth: s.depth,
    completed: done.has(s.skill.id),
  }));
  const c = a.computation;
  const skills = graphOrder.length;
  const completedSkills = graphOrder.filter((s) => s.completed).length;
  return {
    analysisId: a.id,
    mode: a.mode,
    targetRoleName: a.targetRoleName,
    learningHoursPerWeek: a.learningHoursPerWeek,
    computation: c ? (a.mode === 'demo' ? 'demo' : 'daytona') : 'unavailable',
    computationNote: c ? undefined : (a.steps.daytona.error ?? 'Sandbox computation has not run for this analysis'),
    items: (c?.roadmap ?? []).map((i) => ({ ...i, completed: done.has(i.skillId) })),
    graphOrder,
    phases: c?.phases ?? [],
    weeklySchedule: c?.weeklySchedule ?? [],
    totals: c
      ? {
          hours: c.estimatedLearningHours,
          weeks: c.estimatedWeeks,
          skills,
          completedSkills,
          progressPercent: skills ? Math.round((100 * completedSkills) / skills) : 0,
        }
      : null,
    completedSkillIds: a.completedSkillIds,
  };
}

/** The most recent analysis that produced graph facts. */
export async function getLatestAnalysis(userId = DEFAULT_USER_ID): Promise<CareerAnalysis | null> {
  const items = await listAnalyses(userId, 20);
  for (const item of items) {
    const a = await getAnalysis(item.id);
    if (a && a.status !== 'failed' && a.graph) return a;
  }
  return null;
}

export interface DashboardSummary {
  hasAnalysis: boolean;
  latest: null | {
    id: string;
    mode: AnalysisMode;
    status: AnalysisStatus;
    createdAt: string;
    targetRoleName: string;
    currentRole: string;
    userName: string;
    summary: NonNullable<CareerAnalysis['summary']>;
    estimatedHours: number | null;
    estimatedWeeks: number | null;
    progressPercent: number;
    topMissingSkills: string[];
    steps: CareerAnalysis['steps'];
    hasInsight: boolean;
  };
  recent: AnalysisListItem[];
}

export async function buildDashboardSummary(userId = DEFAULT_USER_ID): Promise<DashboardSummary> {
  const [latest, recent] = await Promise.all([getLatestAnalysis(userId), listAnalyses(userId, 5)]);
  if (!latest || !latest.summary) return { hasAnalysis: false, latest: null, recent };
  const view = buildRoadmapView(latest);
  return {
    hasAnalysis: true,
    latest: {
      id: latest.id,
      mode: latest.mode,
      status: latest.status,
      createdAt: latest.createdAt,
      targetRoleName: latest.targetRoleName,
      currentRole: latest.profile.currentRole,
      userName: latest.profile.name,
      summary: latest.summary,
      estimatedHours: latest.computation?.estimatedLearningHours ?? null,
      estimatedWeeks: latest.computation?.estimatedWeeks ?? null,
      progressPercent: view.graphOrder.length ? Math.round((100 * view.graphOrder.filter((s) => s.completed).length) / view.graphOrder.length) : 0,
      topMissingSkills: latest.graph?.missingSkills.slice(0, 5).map((s) => s.name) ?? [],
      steps: latest.steps,
      hasInsight: Boolean(latest.insight),
    },
    recent,
  };
}
