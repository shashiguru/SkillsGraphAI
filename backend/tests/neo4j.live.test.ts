import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isNeo4jConfigured } from '../src/config/env.js';
import { checkHealth, closeDriver, writeRows } from '../src/services/neo4j/driver.js';
import { seedDataset } from '../src/services/neo4j/seed.js';
import { compareCounts, getGraphCounts } from '../src/services/neo4j/graphStats.js';
import { expectedCounts, loadDataset } from '../src/services/neo4j/dataset.js';
import * as repo from '../src/services/neo4j/careerGraphRepository.js';
import { findRoleByName } from '../src/services/neo4j/catalogRepository.js';
import { upsertProfile } from '../src/services/neo4j/userRepository.js';
import { buildCareerGraph, buildGraphAnalysis } from '../src/services/career/graphAnalysis.js';

const TEST_USER = 'test-user-alex';
const ALEX_SKILLS = ['C#', 'Angular', 'TypeScript', 'SQL', 'Azure', 'API Development', 'Docker'];

describe.skipIf(!isNeo4jConfigured())('Neo4j (live)', () => {
  let aiEngineerId = '';

  beforeAll(async () => {
    const health = await checkHealth();
    if (!health.connected) throw new Error(`Neo4j not reachable: ${health.error}`);
    await seedDataset();
    await upsertProfile(
      {
        name: 'Alex',
        currentRole: 'Full Stack Developer',
        yearsExperience: 9,
        industry: 'Software',
        technicalSkills: ALEX_SKILLS.map((name) => ({ name })),
        softSkills: [],
        learningHoursPerWeek: 8,
      },
      TEST_USER,
    );
    aiEngineerId = (await findRoleByName('AI Engineer'))!.id;
  });

  afterAll(async () => {
    await writeRows(`MATCH (u:User {user_id: $id}) DETACH DELETE u`, { id: TEST_USER });
    await closeDriver();
  });

  it('connects and reports health', async () => {
    const h = await checkHealth();
    expect(h.connected).toBe(true);
  });

  it('imports the dataset with counts matching the files', async () => {
    const mismatches = compareCounts(expectedCounts(loadDataset()), await getGraphCounts());
    expect(mismatches).toEqual([]);
  });

  it('is idempotent: a second seed does not change counts', async () => {
    const before = await getGraphCounts();
    await seedDataset();
    const after = await getGraphCounts();
    expect(after.nodes.Skill).toBe(before.nodes.Skill);
    expect(after.relationships).toEqual(before.relationships);
  });

  it('QUERY A: returns the AI Engineer required skills', async () => {
    const skills = await repo.getRoleRequiredSkills(aiEngineerId);
    const names = skills.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['Python', 'Generative AI', 'LLM Application Development', 'Prompt Engineering', 'API Development', 'Model Evaluation']),
    );
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
  });

  it('QUERY B: returns the stored user skills', async () => {
    const skills = await repo.getUserSkills(TEST_USER);
    expect(skills.map((s) => s.name).sort()).toEqual([...ALEX_SKILLS].sort());
  });

  it('QUERY C: finds matched and missing skills for Alex', async () => {
    const [matched, missing] = await Promise.all([
      repo.findMatchedSkills(TEST_USER, aiEngineerId),
      repo.findMissingSkills(TEST_USER, aiEngineerId),
    ]);
    expect(matched.map((s) => s.name)).toEqual(['API Development']);
    expect(missing.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Python', 'Generative AI', 'LLM Application Development', 'Prompt Engineering', 'Model Evaluation']),
    );
    expect(matched.length + missing.length).toBe((await repo.getRoleRequiredSkills(aiEngineerId)).length);
  });

  it('QUERY D/E: traverses prerequisite chains and orders learning', async () => {
    const analysis = await buildGraphAnalysis(TEST_USER, aiEngineerId, 'Full Stack Developer');
    const order = analysis.learningOrder.map((s) => s.skill.name);
    const idx = (n: string) => order.indexOf(n);
    expect(order).toContain('Machine Learning');
    expect(idx('Python')).toBeLessThan(idx('Machine Learning'));
    expect(idx('Machine Learning')).toBeLessThan(idx('Generative AI'));
    expect(idx('Generative AI')).toBeLessThan(idx('LLM Application Development'));
    // Programming Fundamentals is implied by C#/TypeScript/SQL, so it must not be scheduled for learning.
    expect(order).not.toContain('Programming Fundamentals');
    expect(analysis.prerequisites.length).toBeGreaterThan(0);
  });

  it('QUERY F/G: recommends courses and certifications that exist in the graph', async () => {
    const analysis = await buildGraphAnalysis(TEST_USER, aiEngineerId, 'Full Stack Developer');
    const names = analysis.recommendedCourses.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Python for Developers', 'Build LLM Applications']));
    expect(analysis.certifications.map((c) => c.name)).toContain('Databricks Generative AI Engineer Associate');
  });

  it('QUERY H/I/J: adjacent roles, role match summaries and alternatives', async () => {
    const adjacent = await repo.getAdjacentRoles(aiEngineerId);
    expect(adjacent.map((r) => r.name)).toEqual(expect.arrayContaining(['Full Stack Developer', 'Generative AI Engineer']));
    const summaries = await repo.getRoleMatchSummaries(TEST_USER);
    expect(summaries).toHaveLength(12);
    const fullStack = summaries.find((s) => s.name === 'Full Stack Developer')!;
    // Alex matches half of the Full Stack Developer requirements in the real dataset.
    expect(fullStack.matchPercentage).toBeGreaterThanOrEqual(50);
    const alternatives = await repo.findAlternativeRoles(TEST_USER, aiEngineerId, 'Full Stack Developer');
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.some((a) => a.id === aiEngineerId)).toBe(false);
  });

  it('QUERY K/L: returns a Cytoscape subgraph with real identifiers and connecting paths', async () => {
    const analysis = await buildGraphAnalysis(TEST_USER, aiEngineerId, 'Full Stack Developer');
    const graph = await buildCareerGraph(analysis);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    expect(graph.nodes.some((n) => n.type === 'User')).toBe(true);
    expect(graph.nodes.some((n) => n.type === 'Role' && n.label === 'AI Engineer')).toBe(true);
    expect(graph.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))).toBe(true);
    expect(new Set(graph.edges.map((e) => e.id)).size).toBe(graph.edges.length);
    const types = new Set(graph.edges.map((e) => e.type));
    for (const t of ['HAS_SKILL', 'REQUIRES_SKILL', 'PREREQUISITE_FOR', 'TEACHES']) expect(types.has(t)).toBe(true);
    expect(analysis.graphPaths.length).toBeGreaterThan(0);
  });

  it('handles a role with no matching relationships without throwing', async () => {
    expect(await repo.getDirectPrerequisites([])).toEqual([]);
    expect(await repo.getRoleRequiredSkills('R-DOES-NOT-EXIST')).toEqual([]);
  });
});
