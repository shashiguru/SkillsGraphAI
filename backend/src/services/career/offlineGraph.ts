import type { Dataset } from '../neo4j/dataset.js';
import { computeLearningOrder } from '../neo4j/careerGraphRepository.js';
import type {
  AdjacentRole,
  AlternativeRole,
  CareerGraph,
  CertificationRef,
  CourseRef,
  CytoEdge,
  CytoNode,
  GraphAnalysis,
  GraphPath,
  PrerequisiteEdge,
  PrerequisiteNode,
  RequiredSkill,
  RoleMatchSummary,
  RoleRef,
  SkillRef,
  UserSkill,
} from '../../types/graph.js';

const MAX_DEPTH = 6;

/**
 * In-memory replica of the Neo4j analysis (queries A-L) computed directly from the CSV dataset.
 * It exists ONLY to build the labelled demo scenario and to cross-check the Cypher in tests.
 * Live analyses never use it: they always read the real graph.
 */
export function buildOfflineAnalysis(
  ds: Dataset,
  input: { userId: string; userName?: string; userSkillNames: string[]; targetRoleName: string; currentRoleName?: string },
): { analysis: GraphAnalysis; graph: CareerGraph } {
  const skills = new Map<string, SkillRef>(
    ds.skills.map((s) => [s.skill_id, { id: s.skill_id, name: s.name, category: s.category, level: s.level, elementId: `demo:${s.skill_id}` }]),
  );
  const skillByName = new Map([...skills.values()].map((s) => [s.name.toLowerCase(), s]));
  const roles = new Map<string, RoleRef>(
    ds.roles.map((r) => [r.role_id, { id: r.role_id, name: r.name, description: r.description, seniority: r.seniority, elementId: `demo:${r.role_id}` }]),
  );
  const target = [...roles.values()].find((r) => r.name === input.targetRoleName);
  if (!target) throw new Error(`Unknown role ${input.targetRoleName}`);

  const owned = new Set<string>();
  for (const n of input.userSkillNames) {
    const s = skillByName.get(n.toLowerCase());
    if (!s) throw new Error(`Unknown skill ${n}`);
    owned.add(s.id);
  }

  // Adjacency over distinct prerequisite pairs.
  const forward = new Map<string, Set<string>>(); // prerequisite -> targets
  const backward = new Map<string, Set<string>>(); // target -> prerequisites
  for (const e of ds.skillPrerequisites) {
    if (!forward.has(e.prerequisite_skill_id)) forward.set(e.prerequisite_skill_id, new Set());
    if (!backward.has(e.target_skill_id)) backward.set(e.target_skill_id, new Set());
    forward.get(e.prerequisite_skill_id)!.add(e.target_skill_id);
    backward.get(e.target_skill_id)!.add(e.prerequisite_skill_id);
  }

  const requiredFor = (roleId: string): RequiredSkill[] => {
    const seen = new Set<string>();
    const out: RequiredSkill[] = [];
    for (const r of ds.roleRequiresSkill.filter((x) => x.role_id === roleId)) {
      const s = skills.get(r.skill_id);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({
        ...s,
        importance: r.importance,
        proficiencyRequired: s.level,
        proficiencyDerived: true,
        relationshipId: `demo:REQ:${roleId}>${s.id}`,
      });
    }
    return out.sort((a, b) => Number(a.importance !== 'Required') - Number(b.importance !== 'Required') || a.name.localeCompare(b.name));
  };

  const required = requiredFor(target.id);
  const matchedSkills = required.filter((s) => owned.has(s.id));
  const missingSkills = required.filter((s) => !owned.has(s.id));
  const missingIds = new Set(missingSkills.map((s) => s.id));

  // QUERY E: reverse breadth-first closure, depth limited.
  const closureEdges = new Map<string, PrerequisiteEdge>();
  const reached = new Set<string>(missingIds);
  let frontier = [...missingIds];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const t of frontier) {
      for (const p of backward.get(t) ?? []) {
        const id = `demo:PRE:${p}>${t}`;
        if (!closureEdges.has(id)) {
          closureEdges.set(id, {
            id,
            prerequisiteId: p,
            prerequisiteName: skills.get(p)!.name,
            targetId: t,
            targetName: skills.get(t)!.name,
          });
        }
        if (!reached.has(p)) {
          reached.add(p);
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  const edges = [...closureEdges.values()].sort((a, b) => a.targetName.localeCompare(b.targetName) || a.prerequisiteName.localeCompare(b.prerequisiteName));

  const impliedBy = (id: string): boolean => {
    let level = [...(forward.get(id) ?? [])];
    const seen = new Set<string>();
    for (let d = 1; d <= MAX_DEPTH && level.length; d++) {
      const next: string[] = [];
      for (const n of level) {
        if (owned.has(n)) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(...(forward.get(n) ?? []));
      }
      level = next;
    }
    return false;
  };

  const nodes: PrerequisiteNode[] = [...reached]
    .map((id) => ({ ...skills.get(id)!, userHas: owned.has(id), implied: impliedBy(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prerequisiteGapSkills = nodes.filter((n) => !n.userHas && !n.implied && !missingIds.has(n.id));
  const gapNodes = [...nodes.filter((n) => missingIds.has(n.id)), ...prerequisiteGapSkills];
  const learningOrder = computeLearningOrder(gapNodes, edges);
  const gapIds = new Set(gapNodes.map((n) => n.id));

  const teachesFor = (courseId: string, only: Set<string>) =>
    [...new Set(ds.courseTeachesSkill.filter((r) => r.course_id === courseId && only.has(r.skill_id)).map((r) => r.skill_id))];

  const recommendedCourses: CourseRef[] = ds.courses
    .map((c) => {
      const ids = teachesFor(c.course_id, gapIds);
      return {
        id: c.course_id,
        name: c.name,
        description: c.description,
        level: c.level,
        estimatedHours: Number(c.estimated_hours) || 0,
        teachesSkillIds: ids,
        teachesSkillNames: ids.map((i) => skills.get(i)!.name),
        elementId: `demo:${c.course_id}`,
      };
    })
    .filter((c) => c.teachesSkillIds.length)
    .sort((a, b) => b.teachesSkillIds.length - a.teachesSkillIds.length || a.name.localeCompare(b.name));

  const certsFor = (only: Set<string>): CertificationRef[] =>
    ds.certifications
      .map((c) => {
        const ids = [
          ...new Set(
            ds.certificationValidatesSkill
              .filter((r) => r.cert_id === c.cert_id)
              .map((r) => skillByName.get(r.skill_name.toLowerCase())?.id)
              .filter((id): id is string => !!id && only.has(id)),
          ),
        ];
        return { id: c.cert_id, name: c.name, validatesSkillIds: ids, validatesSkillNames: ids.map((i) => skills.get(i)!.name), elementId: `demo:${c.cert_id}` };
      })
      .filter((c) => c.validatesSkillIds.length)
      .sort((a, b) => b.validatesSkillIds.length - a.validatesSkillIds.length || a.name.localeCompare(b.name));

  const gapCerts = certsFor(gapIds);
  const gapCertIds = new Set(gapCerts.map((c) => c.id));
  const certifications: GraphAnalysis['certifications'] = [
    ...gapCerts.map((c) => ({ ...c, relevance: 'closes_gap' as const })),
    ...certsFor(new Set(matchedSkills.map((s) => s.id)))
      .filter((c) => !gapCertIds.has(c.id))
      .map((c) => ({ ...c, relevance: 'validates_existing' as const })),
  ];

  // Roles
  const roleAdj = new Map<string, Map<string, { type: string | null; outgoing: boolean }>>();
  const link = (a: string, b: string, type: string, outgoing: boolean) => {
    if (!roleAdj.has(a)) roleAdj.set(a, new Map());
    roleAdj.get(a)!.set(b, { type, outgoing });
  };
  for (const r of ds.roleRelatedTo) {
    link(r.role_id, r.related_role_id, r.relationship_type, true);
    if (!roleAdj.get(r.related_role_id)?.has(r.role_id)) link(r.related_role_id, r.role_id, r.relationship_type, false);
  }
  const relatedRoles: AdjacentRole[] = [...(roleAdj.get(target.id) ?? [])]
    .map(([id, v]) => ({ ...roles.get(id)!, relationshipType: v.type, direction: v.outgoing ? ('outgoing' as const) : ('incoming' as const) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const within2 = (from: string): Set<string> => {
    const out = new Set<string>();
    for (const [n1] of roleAdj.get(from) ?? []) {
      out.add(n1);
      for (const [n2] of roleAdj.get(n1) ?? []) out.add(n2);
    }
    out.delete(from);
    return out;
  };

  const summaries: RoleMatchSummary[] = [...roles.values()]
    .map((r) => {
      const req = requiredFor(r.id);
      const matched = req.filter((s) => owned.has(s.id)).length;
      return {
        ...r,
        requiredSkillCount: req.length,
        matchedSkillCount: matched,
        matchPercentage: req.length ? Math.round((100 * matched) / req.length) : 0,
        missingSkills: req.filter((s) => !owned.has(s.id)).map((s) => s.name),
        relatedRoles: [...(roleAdj.get(r.id)?.keys() ?? [])].map((id) => roles.get(id)!.name).sort(),
      };
    })
    .sort((a, b) => b.matchPercentage - a.matchPercentage || a.name.localeCompare(b.name));

  const current = input.currentRoleName ? [...roles.values()].find((r) => r.name === input.currentRoleName) : undefined;
  const nearTarget = within2(target.id);
  const nearCurrent = current ? within2(current.id) : new Set<string>();
  const targetReq = new Set(required.map((s) => s.id));
  const alternativeRoles: AlternativeRole[] = summaries
    .filter((s) => s.id !== target.id && s.id !== current?.id && (nearTarget.has(s.id) || nearCurrent.has(s.id)))
    .map((s) => {
      const shared = requiredFor(s.id).filter((x) => targetReq.has(x.id)).length;
      const connection: string[] = [];
      if (nearTarget.has(s.id)) connection.push('Related to the target role');
      if (nearCurrent.has(s.id)) connection.push('Related to your current role');
      if (shared > 0) connection.push(`Shares ${shared} required skills with the target`);
      return { ...s, sharedSkillCountWithTarget: shared, connection };
    })
    .sort((a, b) => b.matchPercentage - a.matchPercentage || b.sharedSkillCountWithTarget - a.sharedSkillCountWithTarget)
    .slice(0, 6);

  // QUERY L (direct chains only): shortest prerequisite path from an owned skill to each missing required skill.
  const graphPaths: GraphPath[] = [];
  for (const a of owned) {
    for (const b of missingIds) {
      const prev = new Map<string, string | null>([[a, null]]);
      let layer = [a];
      for (let d = 0; d < MAX_DEPTH && layer.length && !prev.has(b); d++) {
        const next: string[] = [];
        for (const n of layer) {
          for (const m of forward.get(n) ?? []) {
            if (!prev.has(m)) {
              prev.set(m, n);
              next.push(m);
            }
          }
        }
        layer = next;
      }
      if (!prev.has(b) || a === b) continue;
      const ids: string[] = [];
      for (let c: string | null = b; c; c = prev.get(c) ?? null) ids.unshift(c);
      const names = ids.map((i) => skills.get(i)!.name);
      graphPaths.push({
        kind: 'direct',
        fromSkillId: ids[0],
        toSkillId: b,
        skillIds: ids,
        skillNames: names,
        length: ids.length - 1,
        description: `${names[0]} is a prerequisite chain towards ${names[names.length - 1]}`,
      });
    }
  }
  graphPaths.sort((a, b) => a.length - b.length).splice(20);

  const userSkills: UserSkill[] = [...owned]
    .map((id) => ({ ...skills.get(id)!, proficiencyLevel: 'Intermediate', yearsExperience: null, relationshipId: `demo:HAS:${input.userId}>${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const taught = new Set(recommendedCourses.flatMap((c) => c.teachesSkillIds));
  const analysis: GraphAnalysis = {
    userId: input.userId,
    targetRole: target,
    matchedSkills,
    missingSkills,
    prerequisiteGapSkills,
    prerequisites: edges,
    learningOrder,
    recommendedCourses,
    certifications,
    relatedRoles,
    alternativeRoles,
    graphPaths,
    userSkills,
    skillsWithoutCourse: gapNodes.filter((n) => !taught.has(n.id)).map((n) => n.name),
  };

  // QUERY K equivalent: same node/edge selection as getCareerSubgraph.
  const cn = new Map<string, CytoNode>();
  const ce = new Map<string, CytoEdge>();
  const addNode = (id: string, type: CytoNode['type'], entityId: string, label: string, properties: Record<string, unknown>) => {
    if (!cn.has(id)) cn.set(id, { id, entityId, type, label, properties });
  };
  const skillNode = (id: string) => {
    const s = skills.get(id)!;
    addNode(`demo:${id}`, 'Skill', id, s.name, { skill_id: id, name: s.name, category: s.category, level: s.level });
  };
  const userName = input.userName ?? 'You';
  addNode(`demo:user:${input.userId}`, 'User', input.userId, userName, { user_id: input.userId, name: userName });
  addNode(`demo:${target.id}`, 'Role', target.id, target.name, { role_id: target.id, name: target.name, seniority: target.seniority });
  for (const id of owned) {
    skillNode(id);
    ce.set(`demo:HAS:${id}`, { id: `demo:HAS:${id}`, source: `demo:user:${input.userId}`, target: `demo:${id}`, type: 'HAS_SKILL', properties: {} });
  }
  for (const s of required) {
    skillNode(s.id);
    ce.set(s.relationshipId, { id: s.relationshipId, source: `demo:${target.id}`, target: `demo:${s.id}`, type: 'REQUIRES_SKILL', properties: { importance: s.importance } });
  }
  for (const e of edges) {
    skillNode(e.prerequisiteId);
    skillNode(e.targetId);
    ce.set(e.id, { id: e.id, source: `demo:${e.prerequisiteId}`, target: `demo:${e.targetId}`, type: 'PREREQUISITE_FOR', properties: {} });
  }
  for (const c of recommendedCourses) {
    addNode(`demo:${c.id}`, 'Course', c.id, c.name, { course_id: c.id, name: c.name, level: c.level, estimated_hours: c.estimatedHours });
    for (const sid of c.teachesSkillIds) {
      skillNode(sid);
      ce.set(`demo:TEACH:${c.id}>${sid}`, { id: `demo:TEACH:${c.id}>${sid}`, source: `demo:${c.id}`, target: `demo:${sid}`, type: 'TEACHES', properties: {} });
    }
  }
  return { analysis, graph: { nodes: [...cn.values()], edges: [...ce.values()] } };
}
