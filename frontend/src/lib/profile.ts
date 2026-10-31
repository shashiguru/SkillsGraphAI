import type { Profile, ProfileInput } from '@/types/api';

/** Converts a stored profile back into the payload the save endpoint accepts. */
export function profileToInput(p: Profile, overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    name: p.name,
    currentRole: p.currentRole,
    yearsExperience: p.yearsExperience,
    industry: p.industry,
    learningHoursPerWeek: p.learningHoursPerWeek,
    softSkills: p.softSkills,
    targetRoleId: p.targetRoleId ?? undefined,
    technicalSkills: p.technicalSkills.map((s) => ({
      skillId: s.skillId,
      name: s.name,
      ...(s.proficiencyLevel ? { proficiencyLevel: s.proficiencyLevel } : {}),
    })),
    ...overrides,
  };
}
