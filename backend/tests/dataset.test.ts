import { describe, expect, it } from 'vitest';
import { expectedCounts, loadDataset } from '../src/services/neo4j/dataset.js';
import { computeLearningOrder } from '../src/services/neo4j/careerGraphRepository.js';
import type { PrerequisiteEdge, PrerequisiteNode } from '../src/types/graph.js';

describe('dataset files', () => {
  const ds = loadDataset();

  it('loads the supplied starter dataset', () => {
    expect(ds.skills).toHaveLength(40);
    expect(ds.roles).toHaveLength(12);
    expect(ds.courses).toHaveLength(20);
    expect(ds.certifications).toHaveLength(10);
  });

  it('has referentially consistent relationship files', () => {
    const skillIds = new Set(ds.skills.map((s) => s.skill_id));
    const skillNames = new Set(ds.skills.map((s) => s.name));
    const roleIds = new Set(ds.roles.map((r) => r.role_id));
    const courseIds = new Set(ds.courses.map((c) => c.course_id));
    const certIds = new Set(ds.certifications.map((c) => c.cert_id));
    expect(ds.roleRequiresSkill.every((r) => roleIds.has(r.role_id) && skillIds.has(r.skill_id))).toBe(true);
    expect(ds.skillPrerequisites.every((r) => skillIds.has(r.prerequisite_skill_id) && skillIds.has(r.target_skill_id))).toBe(true);
    expect(ds.courseTeachesSkill.every((r) => courseIds.has(r.course_id) && skillIds.has(r.skill_id))).toBe(true);
    expect(ds.certificationValidatesSkill.every((r) => certIds.has(r.cert_id) && skillNames.has(r.skill_name))).toBe(true);
    expect(ds.roleRelatedTo.every((r) => roleIds.has(r.role_id) && roleIds.has(r.related_role_id))).toBe(true);
  });

  it('computes expected counts', () => {
    const c = expectedCounts(ds);
    expect(c.nodes).toEqual({ Skill: 40, Role: 12, Course: 20, Certification: 10 });
    expect(c.relationships.REQUIRES_SKILL).toBe(ds.roleRequiresSkill.length);
  });
});

const node = (id: string): PrerequisiteNode => ({ id, name: id, category: 'x', level: 'Beginner', userHas: false, implied: false });
const edge = (p: string, t: string): PrerequisiteEdge => ({ id: `${p}-${t}`, prerequisiteId: p, prerequisiteName: p, targetId: t, targetName: t });

describe('computeLearningOrder', () => {
  it('orders prerequisites before dependants', () => {
    const order = computeLearningOrder([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('B', 'C')]);
    expect(order.map((s) => s.skill.id)).toEqual(['A', 'B', 'C']);
    expect(order.map((s) => s.depth)).toEqual([0, 1, 2]);
  });

  it('ignores prerequisites outside the gap set (already known)', () => {
    const order = computeLearningOrder([node('B')], [edge('OWNED', 'B')]);
    expect(order).toHaveLength(1);
    expect(order[0].prerequisiteIds).toEqual([]);
  });

  it('flags prerequisite cycles instead of looping forever', () => {
    const order = computeLearningOrder([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('B', 'A'), edge('A', 'C')]);
    expect(order.find((s) => s.skill.id === 'A')!.inCycle).toBe(true);
    expect(order.find((s) => s.skill.id === 'B')!.inCycle).toBe(true);
    expect(order).toHaveLength(3);
  });
});
