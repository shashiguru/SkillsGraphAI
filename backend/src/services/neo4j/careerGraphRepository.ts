import { readRows } from './driver.js';
import type {
  AdjacentRole,
  AlternativeRole,
  CareerGraph,
  CertificationRef,
  CourseRef,
  CytoEdge,
  CytoNode,
  GraphPath,
  LearningStep,
  PrerequisiteClosure,
  PrerequisiteEdge,
  PrerequisiteNode,
  RequiredSkill,
  RoleMatchSummary,
  UserSkill,
} from '../../types/graph.js';

/** Maximum prerequisite chain length ever traversed. The starter dataset has chains of at most ~4. */
export const MAX_PREREQ_DEPTH = 6;

// ---------------------------------------------------------------------------
// QUERY A: all skills required by a target role
// ---------------------------------------------------------------------------
export async function getRoleRequiredSkills(roleId: string): Promise<RequiredSkill[]> {
  return readRows<RequiredSkill>(
    `MATCH (r:Role {role_id: $roleId})-[req:REQUIRES_SKILL]->(s:Skill)
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level,
            elementId(s) AS elementId, req.importance AS importance,
            coalesce(req.proficiency_required, s.level) AS proficiencyRequired,
            coalesce(req.proficiency_derived, false) AS proficiencyDerived,
            elementId(req) AS relationshipId
     ORDER BY CASE req.importance WHEN 'Required' THEN 0 ELSE 1 END, s.name`,
    { roleId },
  );
}

// ---------------------------------------------------------------------------
// QUERY B: a user's existing skills
// ---------------------------------------------------------------------------
export async function getUserSkills(userId: string): Promise<UserSkill[]> {
  return readRows<UserSkill>(
    `MATCH (:User {user_id: $userId})-[hs:HAS_SKILL]->(s:Skill)
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level,
            elementId(s) AS elementId, hs.proficiency_level AS proficiencyLevel,
            hs.years_experience AS yearsExperience, elementId(hs) AS relationshipId
     ORDER BY s.name`,
    { userId },
  );
}

// ---------------------------------------------------------------------------
// QUERY C: compare the user profile against the target role
// ---------------------------------------------------------------------------
export async function findMatchedSkills(userId: string, roleId: string): Promise<RequiredSkill[]> {
  return readRows<RequiredSkill>(
    `MATCH (r:Role {role_id: $roleId})-[req:REQUIRES_SKILL]->(s:Skill)
     WHERE EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(s) }
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level,
            elementId(s) AS elementId, req.importance AS importance,
            coalesce(req.proficiency_required, s.level) AS proficiencyRequired,
            coalesce(req.proficiency_derived, false) AS proficiencyDerived,
            elementId(req) AS relationshipId
     ORDER BY CASE req.importance WHEN 'Required' THEN 0 ELSE 1 END, s.name`,
    { userId, roleId },
  );
}

export async function findMissingSkills(userId: string, roleId: string): Promise<RequiredSkill[]> {
  return readRows<RequiredSkill>(
    `MATCH (r:Role {role_id: $roleId})-[req:REQUIRES_SKILL]->(s:Skill)
     WHERE NOT EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(s) }
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level,
            elementId(s) AS elementId, req.importance AS importance,
            coalesce(req.proficiency_required, s.level) AS proficiencyRequired,
            coalesce(req.proficiency_derived, false) AS proficiencyDerived,
            elementId(req) AS relationshipId
     ORDER BY CASE req.importance WHEN 'Required' THEN 0 ELSE 1 END, s.name`,
    { userId, roleId },
  );
}

// ---------------------------------------------------------------------------
// QUERY D: direct prerequisite relationships of the given skills
// ---------------------------------------------------------------------------
export async function getDirectPrerequisites(skillIds: string[]): Promise<PrerequisiteEdge[]> {
  if (!skillIds.length) return [];
  return readRows<PrerequisiteEdge>(
    `MATCH (p:Skill)-[rel:PREREQUISITE_FOR]->(t:Skill)
     WHERE t.skill_id IN $skillIds
     RETURN DISTINCT elementId(rel) AS id, p.skill_id AS prerequisiteId, p.name AS prerequisiteName,
            t.skill_id AS targetId, t.name AS targetName
     ORDER BY targetName, prerequisiteName`,
    { skillIds },
  );
}

// ---------------------------------------------------------------------------
// QUERY E: traverse prerequisite chains (transitive closure, depth-limited) and classify nodes
// ---------------------------------------------------------------------------
export async function getPrerequisiteClosure(skillIds: string[], userId: string): Promise<PrerequisiteClosure> {
  if (!skillIds.length) return { nodes: [], edges: [] };

  const edges = await readRows<PrerequisiteEdge>(
    `MATCH (t:Skill) WHERE t.skill_id IN $skillIds
     MATCH path = (:Skill)-[:PREREQUISITE_FOR*1..${MAX_PREREQ_DEPTH}]->(t)
     UNWIND relationships(path) AS rel
     WITH DISTINCT rel
     WITH rel, startNode(rel) AS p, endNode(rel) AS t
     RETURN elementId(rel) AS id, p.skill_id AS prerequisiteId, p.name AS prerequisiteName,
            t.skill_id AS targetId, t.name AS targetName
     ORDER BY targetName, prerequisiteName`,
    { skillIds },
  );

  const ids = [...new Set([...skillIds, ...edges.flatMap((e) => [e.prerequisiteId, e.targetId])])];
  const nodes = await readRows<PrerequisiteNode>(
    `MATCH (s:Skill) WHERE s.skill_id IN $ids
     RETURN s.skill_id AS id, s.name AS name, s.category AS category, s.level AS level, elementId(s) AS elementId,
            EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(s) } AS userHas,
            EXISTS { MATCH (s)-[:PREREQUISITE_FOR*1..${MAX_PREREQ_DEPTH}]->(:Skill)<-[:HAS_SKILL]-(:User {user_id: $userId}) } AS implied
     ORDER BY s.name`,
    { ids, userId },
  );
  return { nodes, edges };
}

/**
 * Determines learning order for the skills the user still has to learn (E, continued).
 * Pure graph topology: Kahn's algorithm over the prerequisite edges that Neo4j returned.
 * Skills trapped in a prerequisite cycle (the starter data contains API Development <-> System Design) are
 * appended last and flagged with inCycle.
 */
export function computeLearningOrder(
  gapSkills: PrerequisiteNode[],
  edges: PrerequisiteEdge[],
): LearningStep[] {
  const gapIds = new Set(gapSkills.map((s) => s.id));
  const byId = new Map(gapSkills.map((s) => [s.id, s]));
  const prereqs = new Map<string, Set<string>>();
  for (const s of gapSkills) prereqs.set(s.id, new Set());
  for (const e of edges) {
    if (gapIds.has(e.prerequisiteId) && gapIds.has(e.targetId) && e.prerequisiteId !== e.targetId) {
      prereqs.get(e.targetId)!.add(e.prerequisiteId);
    }
  }

  const depth = new Map<string, number>();
  const placed: string[] = [];
  const remaining = new Set(gapIds);
  let progressed = true;
  while (remaining.size && progressed) {
    progressed = false;
    const ready = [...remaining]
      .filter((id) => [...prereqs.get(id)!].every((p) => !remaining.has(p)))
      .sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
    for (const id of ready) {
      const ps = [...prereqs.get(id)!];
      depth.set(id, ps.length ? Math.max(...ps.map((p) => depth.get(p)!)) + 1 : 0);
      placed.push(id);
      remaining.delete(id);
      progressed = true;
    }
  }
  // Re-sort placed skills by depth to give a stable layered order.
  placed.sort((a, b) => depth.get(a)! - depth.get(b)! || byId.get(a)!.name.localeCompare(byId.get(b)!.name));
  const cyclic = [...remaining].sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
  const maxDepth = placed.length ? Math.max(...placed.map((id) => depth.get(id)!)) : -1;
  const out: LearningStep[] = [];
  for (const id of placed) {
    out.push({
      skill: byId.get(id)!,
      order: out.length + 1,
      depth: depth.get(id)!,
      prerequisiteIds: [...prereqs.get(id)!],
      inCycle: false,
    });
  }
  for (const id of cyclic) {
    out.push({
      skill: byId.get(id)!,
      order: out.length + 1,
      depth: maxDepth + 1,
      prerequisiteIds: [...prereqs.get(id)!],
      inCycle: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// QUERY F: courses teaching the given skills
// ---------------------------------------------------------------------------
export async function findCoursesForSkills(skillIds: string[]): Promise<CourseRef[]> {
  if (!skillIds.length) return [];
  return readRows<CourseRef>(
    `MATCH (c:Course)-[:TEACHES]->(s:Skill)
     WHERE s.skill_id IN $skillIds
     WITH c, collect(DISTINCT s) AS taught
     RETURN c.course_id AS id, c.name AS name, c.description AS description, c.level AS level,
            coalesce(c.estimated_hours, 0) AS estimatedHours, elementId(c) AS elementId,
            [x IN taught | x.skill_id] AS teachesSkillIds, [x IN taught | x.name] AS teachesSkillNames
     ORDER BY size(taught) DESC, c.name`,
    { skillIds },
  );
}

// ---------------------------------------------------------------------------
// QUERY G: certifications validating the given skills
// ---------------------------------------------------------------------------
export async function findCertificationsForSkills(skillIds: string[]): Promise<CertificationRef[]> {
  if (!skillIds.length) return [];
  return readRows<CertificationRef>(
    `MATCH (c:Certification)-[:VALIDATES]->(s:Skill)
     WHERE s.skill_id IN $skillIds
     WITH c, collect(DISTINCT s) AS validated
     RETURN c.cert_id AS id, c.name AS name, elementId(c) AS elementId,
            [x IN validated | x.skill_id] AS validatesSkillIds, [x IN validated | x.name] AS validatesSkillNames
     ORDER BY size(validated) DESC, c.name`,
    { skillIds },
  );
}

// ---------------------------------------------------------------------------
// QUERY H: adjacent job roles
// ---------------------------------------------------------------------------
export async function getAdjacentRoles(roleId: string): Promise<AdjacentRole[]> {
  return readRows<AdjacentRole>(
    `MATCH (r:Role {role_id: $roleId})-[rel:RELATED_TO]-(o:Role)
     RETURN DISTINCT o.role_id AS id, o.name AS name, o.description AS description, o.seniority AS seniority,
            elementId(o) AS elementId, rel.relationship_type AS relationshipType,
            CASE WHEN startNode(rel) = r THEN 'outgoing' ELSE 'incoming' END AS direction
     ORDER BY o.name`,
    { roleId },
  );
}

// ---------------------------------------------------------------------------
// QUERY I: matched required-skill count for every role
// ---------------------------------------------------------------------------
export async function getRoleMatchSummaries(userId: string): Promise<RoleMatchSummary[]> {
  const rows = await readRows<Omit<RoleMatchSummary, 'relatedRoles'>>(
    `MATCH (r:Role)
     OPTIONAL MATCH (r)-[:REQUIRES_SKILL]->(s:Skill)
     WITH r, s, EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(s) } AS has
     WITH r, count(s) AS requiredSkillCount,
          sum(CASE WHEN s IS NOT NULL AND has THEN 1 ELSE 0 END) AS matchedSkillCount,
          collect(CASE WHEN s IS NOT NULL AND NOT has THEN s.name END) AS missingSkills
     RETURN r.role_id AS id, r.name AS name, r.description AS description, r.seniority AS seniority,
            elementId(r) AS elementId, requiredSkillCount, matchedSkillCount,
            CASE WHEN requiredSkillCount = 0 THEN 0 ELSE toInteger(round(100.0 * matchedSkillCount / requiredSkillCount)) END AS matchPercentage,
            missingSkills
     ORDER BY matchPercentage DESC, name`,
    { userId },
  );
  const related = await readRows<{ id: string; related: string[] }>(
    `MATCH (r:Role)-[:RELATED_TO]-(o:Role)
     RETURN r.role_id AS id, collect(DISTINCT o.name) AS related`,
  );
  const relatedMap = new Map(related.map((r) => [r.id, r.related.sort()]));
  return rows.map((r) => ({ ...r, relatedRoles: relatedMap.get(r.id) ?? [] }));
}

// ---------------------------------------------------------------------------
// QUERY J: alternative career paths via related roles (<= 2 hops) and shared skills
// ---------------------------------------------------------------------------
export async function findAlternativeRoles(
  userId: string,
  targetRoleId: string,
  currentRoleName?: string,
): Promise<AlternativeRole[]> {
  const candidates = await readRows<{
    id: string;
    sharedSkillCountWithTarget: number;
    nearTarget: boolean;
    nearCurrent: boolean;
    relTypes: (string | null)[];
  }>(
    `MATCH (t:Role {role_id: $targetRoleId})
     OPTIONAL MATCH (cur:Role) WHERE $currentRoleName IS NOT NULL AND cur.name = $currentRoleName
     MATCH (r:Role) WHERE r.role_id <> t.role_id AND (cur IS NULL OR r.role_id <> cur.role_id)
     WITH t, cur, r,
          EXISTS { MATCH (t)-[:RELATED_TO*1..2]-(r) } AS nearTarget,
          (cur IS NOT NULL AND EXISTS { MATCH (cur)-[:RELATED_TO*1..2]-(r) }) AS nearCurrent
     WHERE nearTarget OR nearCurrent
     OPTIONAL MATCH (t)-[:REQUIRES_SKILL]->(shared:Skill)<-[:REQUIRES_SKILL]-(r)
     WITH r, nearTarget, nearCurrent, count(DISTINCT shared) AS sharedSkillCountWithTarget
     OPTIONAL MATCH (r)-[rel:RELATED_TO]-(:Role)
     RETURN r.role_id AS id, sharedSkillCountWithTarget, nearTarget, nearCurrent, collect(DISTINCT rel.relationship_type) AS relTypes`,
    { targetRoleId, currentRoleName: currentRoleName ?? null },
  );
  if (!candidates.length) return [];
  const summaries = await getRoleMatchSummaries(userId);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  return candidates
    .flatMap((c) => {
      const s = byId.get(c.id);
      if (!s) return [];
      const connection: string[] = [];
      if (c.nearTarget) connection.push('Related to the target role');
      if (c.nearCurrent) connection.push('Related to your current role');
      if (c.sharedSkillCountWithTarget > 0) connection.push(`Shares ${c.sharedSkillCountWithTarget} required skills with the target`);
      return [{ ...s, sharedSkillCountWithTarget: c.sharedSkillCountWithTarget, connection }];
    })
    .sort((a, b) => b.matchPercentage - a.matchPercentage || b.sharedSkillCountWithTarget - a.sharedSkillCountWithTarget)
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// QUERY L: paths connecting existing skills to the skills the target role requires
// ---------------------------------------------------------------------------
export async function findConnectingPaths(userId: string, roleId: string, limit = 20): Promise<GraphPath[]> {
  const direct = await readRows<{ ids: string[]; names: string[]; length: number }>(
    `MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(a:Skill)
     MATCH (:Role {role_id: $roleId})-[:REQUIRES_SKILL]->(b:Skill)
     WHERE a <> b AND NOT EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(b) }
     MATCH path = shortestPath((a)-[:PREREQUISITE_FOR*1..${MAX_PREREQ_DEPTH}]->(b))
     RETURN [n IN nodes(path) | n.skill_id] AS ids, [n IN nodes(path) | n.name] AS names, length(path) AS length
     ORDER BY length ASC
     LIMIT toInteger($limit)`,
    { userId, roleId, limit },
  );

  // Bridge paths: an existing skill and a required skill that grow from a shared prerequisite.
  const bridge = await readRows<{ ids: string[]; names: string[]; length: number }>(
    `MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(a:Skill)
     MATCH (:Role {role_id: $roleId})-[:REQUIRES_SKILL]->(b:Skill)
     WHERE a <> b AND NOT EXISTS { MATCH (:User {user_id: $userId})-[:HAS_SKILL]->(b) }
       AND NOT EXISTS { MATCH (a)-[:PREREQUISITE_FOR*1..${MAX_PREREQ_DEPTH}]->(b) }
     MATCH p1 = (anc:Skill)-[:PREREQUISITE_FOR*1..3]->(a)
     MATCH p2 = (anc)-[:PREREQUISITE_FOR*1..4]->(b)
     WHERE anc <> a AND anc <> b
     WITH a, b, anc, p1, p2, length(p1) + length(p2) AS len
     ORDER BY len ASC
     WITH a, b, head(collect({p1: p1, p2: p2, len: len})) AS best
     RETURN [n IN reverse(nodes(best.p1)) | n.skill_id] + [n IN tail(nodes(best.p2)) | n.skill_id] AS ids,
            [n IN reverse(nodes(best.p1)) | n.name] + [n IN tail(nodes(best.p2)) | n.name] AS names,
            best.len AS length
     ORDER BY length ASC, names
     LIMIT toInteger($limit)`,
    { userId, roleId, limit },
  );

  const seen = new Set<string>();
  const out: GraphPath[] = [];
  const push = (kind: 'direct' | 'bridge', r: { ids: string[]; names: string[]; length: number }) => {
    const key = `${kind}:${r.ids.join('>')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      kind,
      fromSkillId: kind === 'direct' ? r.ids[0] : r.ids[r.ids.length - 1],
      toSkillId: r.ids[r.ids.length - 1],
      skillIds: r.ids,
      skillNames: r.names,
      length: r.length,
      description:
        kind === 'direct'
          ? `${r.names[0]} is a prerequisite chain towards ${r.names[r.names.length - 1]}`
          : `Shared foundation: ${r.names.join(' -> ')}`,
    });
  };
  direct.forEach((r) => push('direct', r));
  bridge.forEach((r) => push('bridge', r));
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// QUERY K: the complete subgraph for Cytoscape (nodes and edges carry Neo4j elementIds)
// ---------------------------------------------------------------------------
interface EdgeRow {
  fromId: string;
  fromLabel: string;
  fromProps: Record<string, unknown>;
  toId: string;
  toLabel: string;
  toProps: Record<string, unknown>;
  relId: string;
  relType: string;
  relProps: Record<string, unknown>;
}

const EDGE_RETURN = `
  RETURN elementId(a) AS fromId, labels(a)[0] AS fromLabel, properties(a) AS fromProps,
         elementId(b) AS toId, labels(b)[0] AS toLabel, properties(b) AS toProps,
         elementId(rel) AS relId, type(rel) AS relType, properties(rel) AS relProps`;

export interface GraphContext {
  gapSkillIds: string[];
}

export async function getCareerSubgraph(userId: string, roleId: string, gapSkillIds: string[]): Promise<CareerGraph> {
  const [userRows, roleRows, prereqRows, courseRows, userNodeRows, roleNodeRows] = await Promise.all([
    readRows<EdgeRow>(
      `MATCH (a:User {user_id: $userId})-[rel:HAS_SKILL]->(b:Skill) ${EDGE_RETURN}`,
      { userId },
    ),
    readRows<EdgeRow>(
      `MATCH (a:Role {role_id: $roleId})-[rel:REQUIRES_SKILL]->(b:Skill) ${EDGE_RETURN}`,
      { roleId },
    ),
    gapSkillIds.length
      ? readRows<EdgeRow>(
          `MATCH (t:Skill) WHERE t.skill_id IN $gapSkillIds
           MATCH path = (:Skill)-[:PREREQUISITE_FOR*1..${MAX_PREREQ_DEPTH}]->(t)
           UNWIND relationships(path) AS rel
           WITH DISTINCT rel
           WITH rel, startNode(rel) AS a, endNode(rel) AS b ${EDGE_RETURN}`,
          { gapSkillIds },
        )
      : Promise.resolve([] as EdgeRow[]),
    gapSkillIds.length
      ? readRows<EdgeRow>(
          `MATCH (a:Course)-[rel:TEACHES]->(b:Skill) WHERE b.skill_id IN $gapSkillIds ${EDGE_RETURN}`,
          { gapSkillIds },
        )
      : Promise.resolve([] as EdgeRow[]),
    readRows<{ id: string; props: Record<string, unknown> }>(
      `MATCH (u:User {user_id: $userId}) RETURN elementId(u) AS id, properties(u) AS props`,
      { userId },
    ),
    readRows<{ id: string; props: Record<string, unknown> }>(
      `MATCH (r:Role {role_id: $roleId}) RETURN elementId(r) AS id, properties(r) AS props`,
      { roleId },
    ),
  ]);

  const nodes = new Map<string, CytoNode>();
  const edges = new Map<string, CytoEdge>();
  const addNode = (id: string, label: string, props: Record<string, unknown>) => {
    if (nodes.has(id)) return;
    const entityId = String(props.skill_id ?? props.role_id ?? props.course_id ?? props.user_id ?? id);
    nodes.set(id, {
      id,
      entityId,
      type: label as CytoNode['type'],
      label: String(props.name ?? entityId),
      properties: props,
    });
  };

  for (const u of userNodeRows) addNode(u.id, 'User', u.props);
  for (const r of roleNodeRows) addNode(r.id, 'Role', r.props);
  for (const row of [...userRows, ...roleRows, ...prereqRows, ...courseRows]) {
    addNode(row.fromId, row.fromLabel, row.fromProps);
    addNode(row.toId, row.toLabel, row.toProps);
    if (!edges.has(row.relId)) {
      edges.set(row.relId, {
        id: row.relId,
        source: row.fromId,
        target: row.toId,
        type: row.relType,
        properties: row.relProps,
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
