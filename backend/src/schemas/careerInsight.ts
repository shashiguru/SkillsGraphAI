import { z } from 'zod';

const priority = z.enum(['high', 'medium', 'low']);

export const CareerInsightSchema = z.object({
  careerSummary: z.string().min(20),
  targetRole: z.string().min(1),
  strengths: z.array(z.object({ skill: z.string().min(1), reason: z.string().min(1) })),
  skillExplanations: z.array(z.object({ skill: z.string().min(1), reason: z.string().min(1), priority })),
  learningPriorities: z.array(
    z.object({
      skill: z.string().min(1),
      rationale: z.string().min(1),
      course: z.string().min(1).nullish(),
    }),
  ),
  sequenceExplanation: z.string().default(''),
  certificationAdvice: z.array(z.object({ certification: z.string().min(1), reason: z.string().min(1) })).default([]),
  careerAdvice: z.array(z.string().min(1)),
  roadmapSummary: z.string().min(1),
  phaseDescriptions: z
    .object({
      foundations: z.string().default(''),
      core: z.string().default(''),
      advanced: z.string().default(''),
      practical: z.string().default(''),
    })
    .default({ foundations: '', core: '', advanced: '', practical: '' }),
});

export type CareerInsight = z.infer<typeof CareerInsightSchema>;

export interface CareerInsightResult {
  insight: CareerInsight;
  model: string;
  durationMs: number;
  attempts: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  /** Entities the model mentioned that are not in the Neo4j context. They were removed, never shown. */
  droppedEntities: { field: string; value: string }[];
  repaired: boolean;
}
