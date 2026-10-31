import { readRows } from './driver.js';
import type { CertificationRef, CourseRef, RequiredSkill, RoleRef, SkillRef } from '../../types/graph.js';

export interface SkillListItem extends SkillRef {
  requiredByRoleCount: number;
}

export async function listSkills(opts: { q?: string; category?: string; limit?: number } = {}): Promise<SkillListItem[]> {
  return readRows<SkillListItem>(
    `MATCH (s:Skill)
     WHERE ($q IS NULL OR toLower(s.name) CONTAINS toLower($q))
       AND ($category IS NULL OR s.category = $category)
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level, elementId(s) AS elementId,
            COUNT { (s)<-[:REQUIRES_SKILL]-(:Role) } AS requiredByRoleCount
     ORDER BY s.name
     LIMIT toInteger($limit)`,
    { q: opts.q?.trim() || null, category: opts.category || null, limit: opts.limit ?? 100 },
  );
}

export interface SkillDetail extends SkillRef {
  prerequisites: SkillRef[];
  unlocks: SkillRef[];
  requiredByRoles: { id: string; name: string; importance: string }[];
  courses: Pick<CourseRef, 'id' | 'name' | 'level' | 'estimatedHours'>[];
  certifications: { id: string; name: string }[];
}

export async function getSkillDetail(skillId: string): Promise<SkillDetail | null> {
  const rows = await readRows<SkillDetail>(
    `MATCH (s:Skill {skill_id: $skillId})
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level, elementId(s) AS elementId,
       [(p:Skill)-[:PREREQUISITE_FOR]->(s) | {id: p.skill_id, name: p.name, category: p.category, level: p.level}] AS prerequisites,
       [(s)-[:PREREQUISITE_FOR]->(n:Skill) | {id: n.skill_id, name: n.name, category: n.category, level: n.level}] AS unlocks,
       [(r:Role)-[req:REQUIRES_SKILL]->(s) | {id: r.role_id, name: r.name, importance: req.importance}] AS requiredByRoles,
       [(c:Course)-[:TEACHES]->(s) | {id: c.course_id, name: c.name, level: c.level, estimatedHours: c.estimated_hours}] AS courses,
       [(ce:Certification)-[:VALIDATES]->(s) | {id: ce.cert_id, name: ce.name}] AS certifications`,
    { skillId },
  );
  return rows[0] ?? null;
}

export async function listSkillCategories(): Promise<string[]> {
  const rows = await readRows<{ category: string }>(
    `MATCH (s:Skill) RETURN DISTINCT s.category AS category ORDER BY category`,
  );
  return rows.map((r) => r.category);
}

export async function findSkillsByNames(names: string[]): Promise<SkillRef[]> {
  if (!names.length) return [];
  return readRows<SkillRef>(
    `MATCH (s:Skill) WHERE toLower(s.name) IN $names
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level, elementId(s) AS elementId`,
    { names: names.map((n) => n.toLowerCase()) },
  );
}

export async function getRole(roleId: string): Promise<RoleRef | null> {
  const rows = await readRows<RoleRef>(
    `MATCH (r:Role {role_id: $roleId})
     RETURN r.role_id AS id, r.name AS name, r.description AS description, r.seniority AS seniority, elementId(r) AS elementId`,
    { roleId },
  );
  return rows[0] ?? null;
}

export async function findRoleByName(name: string): Promise<RoleRef | null> {
  const rows = await readRows<RoleRef>(
    `MATCH (r:Role) WHERE toLower(r.name) = toLower($name)
     RETURN r.role_id AS id, r.name AS name, r.description AS description, r.seniority AS seniority, elementId(r) AS elementId
     LIMIT 1`,
    { name },
  );
  return rows[0] ?? null;
}

export interface RoleDetail extends RoleRef {
  requiredSkills: RequiredSkill[];
  relatedRoles: { id: string; name: string; relationshipType: string | null; direction: 'outgoing' | 'incoming' }[];
}

export async function getRoleDetail(roleId: string): Promise<RoleDetail | null> {
  const role = await getRole(roleId);
  if (!role) return null;
  const [requiredSkills, relatedRoles] = await Promise.all([
    readRows<RequiredSkill>(
      `MATCH (:Role {role_id: $roleId})-[req:REQUIRES_SKILL]->(s:Skill)
       RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level, elementId(s) AS elementId,
              req.importance AS importance, coalesce(req.proficiency_required, s.level) AS proficiencyRequired,
              coalesce(req.proficiency_derived, false) AS proficiencyDerived, elementId(req) AS relationshipId
       ORDER BY CASE req.importance WHEN 'Required' THEN 0 ELSE 1 END, s.name`,
      { roleId },
    ),
    readRows<RoleDetail['relatedRoles'][number]>(
      `MATCH (r:Role {role_id: $roleId})-[rel:RELATED_TO]-(o:Role)
       RETURN DISTINCT o.role_id AS id, o.name AS name, rel.relationship_type AS relationshipType,
              CASE WHEN startNode(rel) = r THEN 'outgoing' ELSE 'incoming' END AS direction
       ORDER BY o.name`,
      { roleId },
    ),
  ]);
  return { ...role, requiredSkills, relatedRoles };
}

/** The skill category most frequently required by each role, used as a "family" filter in the explorer. */
export async function getRoleFamilies(): Promise<Map<string, string>> {
  const rows = await readRows<{ id: string; family: string }>(
    `MATCH (r:Role)-[:REQUIRES_SKILL]->(s:Skill)
     WITH r, s.category AS cat, count(*) AS c
     ORDER BY c DESC, cat
     WITH r, collect(cat)[0] AS family
     RETURN r.role_id AS id, family`,
  );
  return new Map(rows.map((r) => [r.id, r.family]));
}

export async function listAllCourses(): Promise<CourseRef[]> {
  return readRows<CourseRef>(
    `MATCH (c:Course)
     OPTIONAL MATCH (c)-[:TEACHES]->(s:Skill)
     WITH c, collect(s) AS taught
     RETURN c.course_id AS id, c.name AS name, c.description AS description, c.level AS level,
            coalesce(c.estimated_hours, 0) AS estimatedHours, elementId(c) AS elementId,
            [x IN taught | x.skill_id] AS teachesSkillIds, [x IN taught | x.name] AS teachesSkillNames
     ORDER BY c.name`,
  );
}

export async function listAllCertifications(): Promise<CertificationRef[]> {
  return readRows<CertificationRef>(
    `MATCH (c:Certification)
     OPTIONAL MATCH (c)-[:VALIDATES]->(s:Skill)
     WITH c, collect(s) AS validated
     RETURN c.cert_id AS id, c.name AS name, elementId(c) AS elementId,
            [x IN validated | x.skill_id] AS validatesSkillIds, [x IN validated | x.name] AS validatesSkillNames
     ORDER BY c.name`,
  );
}
