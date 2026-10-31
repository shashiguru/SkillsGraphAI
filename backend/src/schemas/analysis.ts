import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'invalid id');
const name = z.string().min(1).max(200);
const level = z.enum(['Beginner', 'Intermediate', 'Advanced']);

/** Everything the sandbox script may receive. Validated before it is embedded in the trusted template. */
export const AnalysisInputSchema = z.object({
  targetRole: name,
  requiredSkills: z.array(z.object({ id, name, importance: z.string().max(40), level })).max(200),
  missingSkills: z.array(z.object({ id, name, importance: z.string().max(40), level })).max(200),
  gapSkills: z
    .array(z.object({ id, name, level, category: z.string().max(80), kind: z.enum(['missing', 'prerequisite']) }))
    .max(200),
  prerequisites: z.array(z.object({ from: id, to: id })).max(2000),
  courses: z
    .array(
      z.object({
        id,
        name,
        level: z.string().max(40),
        estimatedHours: z.number().min(0).max(1000),
        teachesSkillIds: z.array(id).max(100),
      }),
    )
    .max(500),
  learningHoursPerWeek: z.number().min(1).max(80),
});
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;

const roadmapItem = z.object({
  order: z.number(),
  skillId: z.string(),
  skill: z.string(),
  category: z.string().nullish(),
  level: z.string().nullish(),
  kind: z.string().nullish(),
  phase: z.number().int().min(1).max(4),
  phaseName: z.string(),
  priorityScore: z.number(),
  priority: z.enum(['high', 'medium', 'low']),
  difficulty: z.string().nullish(),
  hours: z.number(),
  hoursSource: z.enum(['course', 'level-default-estimate']),
  courseId: z.string().nullable(),
  course: z.string().nullable(),
  prerequisiteIds: z.array(z.string()),
  prerequisites: z.array(z.string()),
  unitId: z.string(),
  inCycle: z.boolean(),
});

export const AnalysisOutputSchema = z.object({
  executionStatus: z.literal('completed'),
  targetRole: z.string().nullish(),
  matchPercentage: z.number(),
  weightedMatchPercentage: z.number(),
  requiredSkillCount: z.number(),
  matchedSkillCount: z.number(),
  missingSkillCount: z.number(),
  gapSkillCount: z.number(),
  estimatedLearningHours: z.number(),
  estimatedWeeks: z.number(),
  learningHoursPerWeek: z.number(),
  estimatedHoursFromCourses: z.number(),
  estimatedHoursFromDefaults: z.number(),
  prioritySkills: z.array(
    z.object({ skillId: z.string(), skill: z.string(), score: z.number(), priority: z.enum(['high', 'medium', 'low']), kind: z.string().nullish() }),
  ),
  roadmap: z.array(roadmapItem),
  phases: z.array(z.object({ phase: z.number(), name: z.string(), skills: z.array(z.string()), hours: z.number() })),
  selectedCourses: z.array(z.object({ courseId: z.string(), course: z.string(), hours: z.number(), coversSkills: z.array(z.string()) })),
  weeklySchedule: z.array(
    z.object({
      week: z.number(),
      hours: z.number(),
      items: z.array(
        z.object({
          unitId: z.string(),
          label: z.string(),
          course: z.string().nullable(),
          skills: z.array(z.string()),
          hours: z.number(),
          phase: z.number(),
        }),
      ),
    }),
  ),
  validation: z.object({
    valid: z.boolean(),
    checkedEdges: z.number(),
    violations: z.array(z.object({ prerequisite: z.string(), dependent: z.string() })),
    cyclicSkills: z.array(z.string()),
    cycleBreaks: z.array(z.string()),
  }),
  python: z.string().optional(),
  computeMs: z.number().optional(),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
export type RoadmapItem = z.infer<typeof roadmapItem>;
