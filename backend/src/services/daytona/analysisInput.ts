import type { GraphAnalysis } from '../../types/graph.js';
import { AnalysisInputSchema, type AnalysisInput } from '../../schemas/analysis.js';

const asLevel = (l: string): 'Beginner' | 'Intermediate' | 'Advanced' =>
  l === 'Advanced' || l === 'Intermediate' || l === 'Beginner' ? l : 'Intermediate';

/** Converts graph-derived facts into the validated payload for the sandbox script. */
export function buildAnalysisInput(analysis: GraphAnalysis, learningHoursPerWeek: number): AnalysisInput {
  const missingIds = new Set(analysis.missingSkills.map((s) => s.id));
  const required = [...analysis.matchedSkills, ...analysis.missingSkills];
  const gapSkills = analysis.learningOrder.map((s) => ({
    id: s.skill.id,
    name: s.skill.name,
    level: asLevel(s.skill.level),
    category: s.skill.category,
    kind: missingIds.has(s.skill.id) ? ('missing' as const) : ('prerequisite' as const),
  }));
  return AnalysisInputSchema.parse({
    targetRole: analysis.targetRole.name,
    requiredSkills: required.map((s) => ({ id: s.id, name: s.name, importance: s.importance, level: asLevel(s.level) })),
    missingSkills: analysis.missingSkills.map((s) => ({ id: s.id, name: s.name, importance: s.importance, level: asLevel(s.level) })),
    gapSkills,
    prerequisites: analysis.prerequisites.map((e) => ({ from: e.prerequisiteId, to: e.targetId })),
    courses: analysis.recommendedCourses.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      estimatedHours: c.estimatedHours,
      teachesSkillIds: c.teachesSkillIds,
    })),
    learningHoursPerWeek,
  });
}
