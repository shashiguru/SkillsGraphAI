import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import demo from '../../../backend/src/services/career/demoScenario.json';
import type { CareerAnalysis, Profile, RoadmapView, RoleCard, SkillListItem } from '@/types/api';

/** The labelled demo fixture produced by the backend. Real data shapes, used as a test fixture only. */
export const demoAnalysis = demo as unknown as CareerAnalysis;

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}
type Handler = unknown | ((call: RecordedCall) => unknown);
export type Routes = Record<string, Handler>;

/** Stubs fetch with envelope responses. Keys look like "GET /profile" and match on the path without the query string. */
export function mockApi(routes: Routes) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && (p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))));
    });
    if (!key) return new Response(JSON.stringify({ data: null, error: { code: 'not_found', message: `No mock for ${method} ${path}` } }), { status: 404 });
    const h = routes[key];
    const out = await (typeof h === 'function' ? (h as (c: RecordedCall) => unknown)(call) : h);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ data: out, error: null }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

export const apiError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ data: null, error: { code, message } }), { status });

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export const skillsFixture: SkillListItem[] = [
  { id: 'S001', name: 'Python', category: 'Programming', level: 'Beginner', requiredByRoleCount: 4 },
  { id: 'S002', name: 'Docker', category: 'DevOps', level: 'Intermediate', requiredByRoleCount: 3 },
  { id: 'S003', name: 'Machine Learning', category: 'AI', level: 'Advanced', requiredByRoleCount: 5 },
  { id: 'S004', name: 'Angular', category: 'Frontend', level: 'Intermediate', requiredByRoleCount: 1 },
];

export const rolesFixture: RoleCard[] = [
  {
    id: 'R009',
    name: 'AI Engineer',
    description: 'Builds applications on top of large language models.',
    seniority: 'Mid',
    family: 'AI',
    requiredSkillCount: 6,
    matchedSkillCount: 1,
    matchPercentage: 16.7,
    missingSkills: ['Python', 'Generative AI'],
    relatedRoles: ['ML Engineer'],
  },
  {
    id: 'R001',
    name: 'Frontend Developer',
    description: 'Builds user interfaces.',
    seniority: 'Mid',
    family: 'Engineering',
    requiredSkillCount: 4,
    matchedSkillCount: 4,
    matchPercentage: 100,
    missingSkills: [],
    relatedRoles: [],
  },
];

export const profileFixture: Profile = {
  userId: 'default-user',
  name: 'Alex',
  currentRole: 'Full Stack Developer',
  yearsExperience: 9,
  industry: 'Software',
  technicalSkills: [{ skillId: 'S004', name: 'Angular', category: 'Frontend', proficiencyLevel: 'Advanced', yearsExperience: null }],
  unmappedSkills: [],
  softSkills: ['Mentoring'],
  targetRoleId: 'R009',
  learningHoursPerWeek: 8,
  updatedAt: null,
};

/** Mirrors backend buildRoadmapView for the demo fixture. */
export function roadmapFromAnalysis(a: CareerAnalysis, overrides: Partial<RoadmapView> = {}): RoadmapView {
  const done = new Set(a.completedSkillIds);
  const c = a.computation!;
  const missing = new Set(a.graph!.missingSkills.map((s) => s.id));
  const graphOrder = a.graph!.learningOrder.map((s) => ({
    order: s.order,
    skillId: s.skill.id,
    skill: s.skill.name,
    kind: missing.has(s.skill.id) ? ('missing' as const) : ('prerequisite' as const),
    depth: s.depth,
    completed: done.has(s.skill.id),
  }));
  return {
    analysisId: a.id,
    mode: a.mode,
    targetRoleName: a.targetRoleName,
    learningHoursPerWeek: a.learningHoursPerWeek,
    computation: a.mode === 'demo' ? 'demo' : 'daytona',
    items: c.roadmap.map((i) => ({ ...i, completed: done.has(i.skillId) })),
    graphOrder,
    phases: c.phases,
    weeklySchedule: c.weeklySchedule,
    totals: { hours: c.estimatedLearningHours, weeks: c.estimatedWeeks, skills: graphOrder.length, completedSkills: 0, progressPercent: 0 },
    completedSkillIds: [],
    ...overrides,
  };
}
