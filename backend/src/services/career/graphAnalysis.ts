import * as repo from '../neo4j/careerGraphRepository.js';
import { getRole } from '../neo4j/catalogRepository.js';
import { notFound } from '../../utils/errors.js';
import type { CareerGraph, CertificationRef, GraphAnalysis } from '../../types/graph.js';

/**
 * Pure Neo4j analysis (workflow STEP 2). Everything returned is read from the graph;
 * no LLM or sandbox is involved. This is the only source of entities the AI may talk about.
 */
export async function buildGraphAnalysis(
  userId: string,
  roleId: string,
  currentRoleName?: string,
): Promise<GraphAnalysis> {
  const targetRole = await getRole(roleId);
  if (!targetRole) throw notFound(`Role ${roleId}`);

  const [userSkills, matchedSkills, missingSkills, relatedRoles, alternativeRoles, graphPaths] = await Promise.all([
    repo.getUserSkills(userId),
    repo.findMatchedSkills(userId, roleId),
    repo.findMissingSkills(userId, roleId),
    repo.getAdjacentRoles(roleId),
    repo.findAlternativeRoles(userId, roleId, currentRoleName),
    repo.findConnectingPaths(userId, roleId),
  ]);

  const missingIds = missingSkills.map((s) => s.id);
  const closure = await repo.getPrerequisiteClosure(missingIds, userId);
  const missingSet = new Set(missingIds);

  // Prerequisites the user neither owns nor implicitly satisfies are part of the learning plan too.
  const prerequisiteGapSkills = closure.nodes.filter((n) => !n.userHas && !n.implied && !missingSet.has(n.id));
  const gapNodes = [
    ...closure.nodes.filter((n) => missingSet.has(n.id)),
    ...prerequisiteGapSkills,
  ];
  // Missing skills absent from the closure (no edges at all) still need a node entry.
  for (const m of missingSkills) {
    if (!gapNodes.some((n) => n.id === m.id)) {
      gapNodes.push({ id: m.id, name: m.name, category: m.category, level: m.level, elementId: m.elementId, userHas: false, implied: false });
    }
  }

  const learningOrder = repo.computeLearningOrder(gapNodes, closure.edges);
  const gapIds = gapNodes.map((n) => n.id);

  const [recommendedCourses, gapCerts, existingCerts] = await Promise.all([
    repo.findCoursesForSkills(gapIds),
    repo.findCertificationsForSkills(gapIds),
    repo.findCertificationsForSkills(matchedSkills.map((s) => s.id)),
  ]);

  const gapCertIds = new Set(gapCerts.map((c) => c.id));
  const certifications: GraphAnalysis['certifications'] = [
    ...gapCerts.map((c: CertificationRef) => ({ ...c, relevance: 'closes_gap' as const })),
    ...existingCerts
      .filter((c) => !gapCertIds.has(c.id))
      .map((c) => ({ ...c, relevance: 'validates_existing' as const })),
  ];

  const taught = new Set(recommendedCourses.flatMap((c) => c.teachesSkillIds));
  const skillsWithoutCourse = gapNodes.filter((n) => !taught.has(n.id)).map((n) => n.name);

  return {
    userId,
    targetRole,
    matchedSkills,
    missingSkills,
    prerequisiteGapSkills,
    prerequisites: closure.edges,
    learningOrder,
    recommendedCourses,
    certifications,
    relatedRoles,
    alternativeRoles,
    graphPaths,
    userSkills,
    skillsWithoutCourse,
  };
}

/** QUERY K wrapper: loads the Cytoscape subgraph and classifies skill nodes from the analysis. */
export async function buildCareerGraph(analysis: GraphAnalysis): Promise<CareerGraph> {
  const gapIds = analysis.learningOrder.map((s) => s.skill.id);
  const graph = await repo.getCareerSubgraph(analysis.userId, analysis.targetRole.id, gapIds);
  return classifyGraph(graph, analysis);
}

/** Pure: assigns the display status (existing / missing / prerequisite ...) to each node from the analysis. */
export function classifyGraph(graph: CareerGraph, analysis: GraphAnalysis): CareerGraph {
  const owned = new Set(analysis.userSkills.map((s) => s.id));
  const missing = new Set(analysis.missingSkills.map((s) => s.id));
  const prereqGap = new Set(analysis.prerequisiteGapSkills.map((s) => s.id));

  for (const node of graph.nodes) {
    if (node.type === 'User') node.status = 'user';
    else if (node.type === 'Role') node.status = 'target';
    else if (node.type === 'Course') node.status = 'course';
    else if (owned.has(node.entityId)) node.status = 'existing';
    else if (missing.has(node.entityId)) node.status = 'missing';
    else if (prereqGap.has(node.entityId)) node.status = 'prerequisite';
    else node.status = 'implied';
  }
  return graph;
}
