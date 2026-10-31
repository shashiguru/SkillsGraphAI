import { z } from 'zod';

export const DEFAULT_USER_ID = 'default-user';

const skillInput = z.object({
  skillId: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120),
  proficiencyLevel: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).optional(),
  yearsExperience: z.number().min(0).max(60).optional(),
});

export const ProfileInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  currentRole: z.string().trim().min(1, 'Current role is required').max(120),
  yearsExperience: z.number().min(0).max(60),
  industry: z.string().trim().max(120).optional().default(''),
  technicalSkills: z.array(skillInput).max(100).default([]),
  softSkills: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  targetRoleId: z.string().min(1).max(40).optional(),
  learningHoursPerWeek: z.number().min(1, 'At least 1 hour').max(80),
});

export type ProfileInput = z.infer<typeof ProfileInputSchema>;
export type SkillInput = z.infer<typeof skillInput>;

export interface Profile {
  userId: string;
  name: string;
  currentRole: string;
  yearsExperience: number;
  industry: string;
  technicalSkills: {
    skillId: string;
    name: string;
    category: string;
    proficiencyLevel: string | null;
    yearsExperience: number | null;
  }[];
  /** Skill names the user typed that do not exist in the Neo4j graph. They cannot be analysed. */
  unmappedSkills: string[];
  softSkills: string[];
  targetRoleId: string | null;
  learningHoursPerWeek: number;
  updatedAt: string | null;
}
