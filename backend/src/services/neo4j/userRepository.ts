import { readRows, writeRows } from './driver.js';
import { findSkillsByNames } from './catalogRepository.js';
import { DEFAULT_USER_ID, type Profile, type ProfileInput } from '../../schemas/profile.js';

interface UserRow {
  userId: string;
  name: string;
  currentRole: string;
  yearsExperience: number;
  industry: string | null;
  softSkills: string[] | null;
  unmappedSkills: string[] | null;
  targetRoleId: string | null;
  learningHoursPerWeek: number;
  updatedAt: string | null;
}

export async function getProfile(userId = DEFAULT_USER_ID): Promise<Profile | null> {
  const users = await readRows<UserRow>(
    `MATCH (u:User {user_id: $userId})
     RETURN u.user_id AS userId, u.name AS name, u.current_role AS currentRole, u.years_experience AS yearsExperience,
            u.industry AS industry, u.soft_skills AS softSkills, u.unmapped_skills AS unmappedSkills,
            u.target_role_id AS targetRoleId, u.learning_hours_per_week AS learningHoursPerWeek,
            toString(u.updated_at) AS updatedAt`,
    { userId },
  );
  if (!users.length) return null;
  const u = users[0];
  const skills = await readRows<Profile['technicalSkills'][number]>(
    `MATCH (:User {user_id: $userId})-[hs:HAS_SKILL]->(s:Skill)
     RETURN s.skill_id AS skillId, s.name AS name, s.category AS category,
            hs.proficiency_level AS proficiencyLevel, hs.years_experience AS yearsExperience
     ORDER BY s.name`,
    { userId },
  );
  return {
    userId: u.userId,
    name: u.name,
    currentRole: u.currentRole,
    yearsExperience: u.yearsExperience,
    industry: u.industry ?? '',
    technicalSkills: skills,
    unmappedSkills: u.unmappedSkills ?? [],
    softSkills: u.softSkills ?? [],
    targetRoleId: u.targetRoleId,
    learningHoursPerWeek: u.learningHoursPerWeek,
    updatedAt: u.updatedAt,
  };
}

/** Creates or replaces the profile and its HAS_SKILL relationships (idempotent). */
export async function upsertProfile(input: ProfileInput, userId = DEFAULT_USER_ID): Promise<Profile> {
  // Resolve submitted skills against the graph: by id when given, otherwise by case-insensitive name.
  const byName = await findSkillsByNames(input.technicalSkills.filter((s) => !s.skillId).map((s) => s.name));
  const nameMap = new Map(byName.map((s) => [s.name.toLowerCase(), s]));
  const resolved: { skillId: string; proficiencyLevel: string; yearsExperience: number | null }[] = [];
  const unmapped: string[] = [];
  for (const s of input.technicalSkills) {
    const skillId = s.skillId ?? nameMap.get(s.name.toLowerCase())?.id;
    if (!skillId) {
      unmapped.push(s.name);
      continue;
    }
    resolved.push({
      skillId,
      proficiencyLevel: s.proficiencyLevel ?? 'Intermediate',
      yearsExperience: s.yearsExperience ?? null,
    });
  }

  await writeRows(
    `MERGE (u:User {user_id: $userId})
     SET u.name = $name, u.current_role = $currentRole, u.years_experience = $yearsExperience,
         u.industry = $industry, u.soft_skills = $softSkills, u.unmapped_skills = $unmapped,
         u.target_role_id = $targetRoleId, u.learning_hours_per_week = $learningHoursPerWeek,
         u.updated_at = datetime()
     WITH u
     OPTIONAL MATCH (u)-[old:HAS_SKILL]->(:Skill)
     DELETE old
     WITH DISTINCT u
     UNWIND $skills AS sk
     MATCH (s:Skill {skill_id: sk.skillId})
     MERGE (u)-[hs:HAS_SKILL]->(s)
     SET hs.proficiency_level = sk.proficiencyLevel, hs.years_experience = sk.yearsExperience`,
    {
      userId,
      name: input.name,
      currentRole: input.currentRole,
      yearsExperience: input.yearsExperience,
      industry: input.industry ?? '',
      softSkills: input.softSkills,
      unmapped: [...new Set(unmapped)],
      targetRoleId: input.targetRoleId ?? null,
      learningHoursPerWeek: input.learningHoursPerWeek,
      skills: resolved,
    },
  );

  const profile = await getProfile(userId);
  if (!profile) throw new Error('Profile was not persisted');
  return profile;
}

export async function setTargetRole(roleId: string, userId = DEFAULT_USER_ID): Promise<void> {
  await writeRows(`MATCH (u:User {user_id: $userId}) SET u.target_role_id = $roleId, u.updated_at = datetime()`, {
    userId,
    roleId,
  });
}

export interface ProfileSummary {
  userId: string;
  name: string;
  currentRole: string;
  targetRoleId: string | null;
  skillCount: number;
  updatedAt: string | null;
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  return readRows<ProfileSummary>(
    `MATCH (u:User)
     WHERE u.user_id IS NOT NULL
     OPTIONAL MATCH (u)-[:HAS_SKILL]->(s:Skill)
     WITH u, count(s) AS skillCount
     RETURN u.user_id AS userId, u.name AS name, u.current_role AS currentRole,
            u.target_role_id AS targetRoleId, skillCount, toString(u.updated_at) AS updatedAt
     ORDER BY u.updated_at DESC`,
  );
}

/** Deletes a profile together with the analyses stored for it. */
export async function deleteProfile(userId: string): Promise<boolean> {
  const existing = await readRows<{ n: number }>(`MATCH (u:User {user_id: $userId}) RETURN count(u) AS n`, { userId });
  if (!existing[0] || Number(existing[0].n) === 0) return false;
  await writeRows(
    `MATCH (u:User {user_id: $userId})
     OPTIONAL MATCH (u)-[:HAS_ANALYSIS]->(a:Analysis)
     DETACH DELETE a, u`,
    { userId },
  );
  return true;
}
