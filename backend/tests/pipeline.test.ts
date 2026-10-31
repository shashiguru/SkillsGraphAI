import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { isNeo4jConfigured } from '../src/config/env.js';
import {
  createAnalysisRecord,
  DEMO_FIXTURE_PATH,
  recalculateRoadmap,
  runPipeline,
  setSkillCompleted,
  startDemoAnalysis,
  summarize,
  type PipelineDeps,
} from '../src/services/career/careerAnalysisService.js';
import { clearMemoryStore, getAnalysis } from '../src/services/career/analysisStore.js';
import { DaytonaRunError, type SandboxExecution } from '../src/services/daytona/sandboxRunner.js';
import { NosanaError } from '../src/services/nosana/nosanaClient.js';
import { CareerInsightSchema } from '../src/schemas/careerInsight.js';
import type { CareerAnalysis } from '../src/types/career.js';

const fixture = JSON.parse(fs.readFileSync(DEMO_FIXTURE_PATH, 'utf8')) as CareerAnalysis;
const graph = fixture.graph!;

const execution = (over: Partial<SandboxExecution> = {}): SandboxExecution => ({
  executionId: 'exec-1',
  status: 'completed',
  sandboxId: 'sbx-123',
  startedAt: new Date().toISOString(),
  durationMs: 1234,
  phases: { createMs: 10, executeMs: 20, cleanupMs: 5 },
  exitCode: 0,
  pythonVersion: 'Python 3.12',
  networkIsolated: true,
  logs: [{ at: new Date().toISOString(), source: 'backend', message: 'ok' }],
  cleanedUp: true,
  ...over,
});

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps & { order: string[] } {
  const order: string[] = [];
  const deps: PipelineDeps = {
    configured: { neo4j: () => true, nosana: () => true, daytona: () => true },
    buildGraphAnalysis: vi.fn().mockResolvedValue(graph),
    buildCareerGraph: vi.fn().mockResolvedValue(fixture.cytoscape),
    generateInsight: vi.fn().mockImplementation(async () => {
      order.push('nosana:start');
      await new Promise((r) => setTimeout(r, 15));
      order.push('nosana:end');
      return { ...fixture.insight!, model: 'test-model' };
    }),
    runSandbox: vi.fn().mockImplementation(async () => {
      order.push('daytona:start');
      await new Promise((r) => setTimeout(r, 15));
      order.push('daytona:end');
      return { output: fixture.computation!, execution: execution() };
    }),
    persist: vi.fn().mockResolvedValue('memory'),
    ...over,
  };
  return Object.assign(deps, { order });
}

const newRecord = () =>
  createAnalysisRecord({ ...fixture.profile }, 'default-user', { id: fixture.targetRoleId, name: fixture.targetRoleName });

beforeEach(() => clearMemoryStore());

describe('demo fixture', () => {
  it('only contains graph entities and is internally consistent', () => {
    expect(fixture.mode).toBe('demo');
    expect(CareerInsightSchema.safeParse(fixture.insight!.insight).success).toBe(true);
    expect(fixture.insight!.droppedEntities).toEqual([]);
    expect(fixture.computation!.validation.valid).toBe(true);
    expect(fixture.summary).toEqual(summarize(graph));
    const nodeIds = new Set(fixture.cytoscape!.nodes.map((n) => n.id));
    expect(fixture.cytoscape!.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))).toBe(true);
    expect(graph.learningOrder.map((s) => s.skill.name)).toEqual(expect.arrayContaining(['Python', 'Machine Learning', 'Statistics']));
  });
});

describe('analysis pipeline', () => {
  it('runs Nosana and Daytona in parallel and records real events', async () => {
    const deps = makeDeps();
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('completed');
    expect(a.steps.neo4j.status).toBe('live');
    expect(a.steps.nosana.status).toBe('live');
    expect(a.steps.daytona.status).toBe('live');
    expect(a.persistedTo).toBe('memory');
    // Both started before either finished: they really overlap.
    expect(deps.order.slice(0, 2).sort()).toEqual(['daytona:start', 'nosana:start']);
    expect(a.events.map((e) => e.seq)).toEqual(a.events.map((_, i) => i + 1));
    const done = a.events.find((e) => e.step === 'daytona' && e.status === 'succeeded')!;
    expect(done.durationMs).toBeGreaterThanOrEqual(10);
    expect(a.execution?.sandboxId).toBe('sbx-123');
    expect(await getAnalysis(a.id)).toBe(a);
  });

  it('passes only graph facts to the sandbox input', async () => {
    const deps = makeDeps();
    await runPipeline(newRecord(), deps);
    const input = (deps.runSandbox as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.targetRole).toBe('AI Engineer');
    expect(input.gapSkills).toHaveLength(graph.learningOrder.length);
    expect(input.learningHoursPerWeek).toBe(8);
  });

  it('degrades to partial when Nosana fails, keeping graph and Daytona results', async () => {
    const deps = makeDeps({ generateInsight: vi.fn().mockRejectedValue(new NosanaError('credits', 'Insufficient credits', 402)) });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('partial');
    expect(a.steps.nosana.status).toBe('failed');
    expect(a.steps.nosana.error).toContain('credits');
    expect(a.insight).toBeUndefined();
    expect(a.steps.daytona.status).toBe('live');
    expect(a.computation).toBeDefined();
    expect(a.graph).toBeDefined();
  });

  it('degrades to partial when Daytona fails and still records the execution', async () => {
    const failed = execution({ status: 'failed', error: 'boom', cleanedUp: true });
    const deps = makeDeps({ runSandbox: vi.fn().mockRejectedValue(new DaytonaRunError('Sandbox exploded', failed, 'execute')) });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('partial');
    expect(a.steps.daytona.status).toBe('failed');
    expect(a.steps.daytona.error).toBe('Sandbox exploded');
    expect(a.execution?.status).toBe('failed');
    expect(a.computation).toBeUndefined();
    expect(a.insight).toBeDefined();
  });

  it('marks unconfigured sponsors as skipped, never as live', async () => {
    const deps = makeDeps({ configured: { neo4j: () => true, nosana: () => false, daytona: () => false } });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('partial');
    expect(a.steps.nosana.status).toBe('skipped');
    expect(a.steps.daytona.status).toBe('skipped');
    expect(deps.generateInsight).not.toHaveBeenCalled();
    expect(deps.runSandbox).not.toHaveBeenCalled();
  });

  it('fails clearly when Neo4j is not configured', async () => {
    const deps = makeDeps({ configured: { neo4j: () => false, nosana: () => true, daytona: () => true } });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('failed');
    expect(a.steps.neo4j.status).toBe('skipped');
    expect(a.error).toMatch(/Neo4j/);
    expect(deps.generateInsight).not.toHaveBeenCalled();
  });

  it('fails when the graph query throws, and the record says why', async () => {
    const deps = makeDeps({ buildGraphAnalysis: vi.fn().mockRejectedValue(new Error('Connection refused')) });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('failed');
    expect(a.steps.neo4j.status).toBe('failed');
    expect(a.error).toBe('Connection refused');
    expect(a.completedAt).toBeDefined();
  });

  it('skips AI and sandbox work when there is no skill gap', async () => {
    const noGap = { ...graph, missingSkills: [], prerequisiteGapSkills: [], learningOrder: [] };
    const deps = makeDeps({ buildGraphAnalysis: vi.fn().mockResolvedValue(noGap) });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('completed');
    expect(deps.runSandbox).not.toHaveBeenCalled();
  });

  it('survives a persistence failure', async () => {
    const deps = makeDeps({ persist: vi.fn().mockRejectedValue(new Error('disk full')) });
    const a = await runPipeline(newRecord(), deps);
    expect(a.status).toBe('completed');
    expect(a.steps.persist.status).toBe('failed');
  });
});

describe('demo mode', () => {
  it('is always labelled demo and never claims live execution', () => {
    const a = startDemoAnalysis();
    expect(a.mode).toBe('demo');
    expect(a.id).not.toBe(fixture.id);
    expect(Object.values(a.steps).filter((s) => ['neo4j', 'nosana', 'daytona'].includes(s.id)).every((s) => s.status === 'demo')).toBe(true);
    expect(a.events[0].message).toMatch(/DEMO MODE/);
    expect(a.execution).toBeUndefined();
    expect(a.insight?.model).toBe('demo-fixture');
  });
});

describe('roadmap actions', () => {
  it('recalculates with a new weekly budget and records the sandbox run', async () => {
    const deps = makeDeps();
    const a = await runPipeline(newRecord(), deps);
    const run = vi.fn().mockResolvedValue({ output: { ...fixture.computation!, estimatedWeeks: 3, learningHoursPerWeek: 16 }, execution: execution({ sandboxId: 'sbx-456' }) });
    const updated = await recalculateRoadmap(a.id, 16, { ...deps, runSandbox: run });
    expect(run.mock.calls[0][0].learningHoursPerWeek).toBe(16);
    expect(updated.learningHoursPerWeek).toBe(16);
    expect(updated.computation?.estimatedWeeks).toBe(3);
    expect(updated.execution?.sandboxId).toBe('sbx-456');
  });

  it('keeps the previous computation when a recalculation fails', async () => {
    const deps = makeDeps();
    const a = await runPipeline(newRecord(), deps);
    const before = a.computation;
    const failing = vi.fn().mockRejectedValue(new DaytonaRunError('timeout', execution({ status: 'timeout' }), 'timeout'));
    await expect(recalculateRoadmap(a.id, 20, { ...deps, runSandbox: failing })).rejects.toMatchObject({ status: 502 });
    expect(a.computation).toBe(before);
    expect(a.learningHoursPerWeek).toBe(8);
    expect(a.events.at(-1)?.status).toBe('failed');
  });

  it('refuses to recalculate when Daytona is not configured', async () => {
    const deps = makeDeps();
    const a = await runPipeline(newRecord(), deps);
    await expect(
      recalculateRoadmap(a.id, 10, { ...deps, configured: { ...deps.configured, daytona: () => false } }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('toggles completion only for skills in the roadmap', async () => {
    const a = startDemoAnalysis();
    const id = graph.learningOrder[0].skill.id;
    expect((await setSkillCompleted(a.id, id, true)).completedSkillIds).toEqual([id]);
    expect((await setSkillCompleted(a.id, id, false)).completedSkillIds).toEqual([]);
    await expect(setSkillCompleted(a.id, 'SK999', true)).rejects.toMatchObject({ status: 404 });
  });
});

describe('career HTTP API (demo scenario)', () => {
  const app = createApp();

  it('analyze -> poll -> graph -> roadmap -> complete -> dashboard', async () => {
    const created = await request(app).post('/api/career/analyze').send({ mode: 'demo' });
    expect(created.status).toBe(202);
    const id = created.body.data.analysisId as string;
    expect(created.body.data.mode).toBe('demo');

    const got = await request(app).get(`/api/career/analysis/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.mode).toBe('demo');
    expect(got.body.data.summary.matchPercentage).toBeGreaterThanOrEqual(0);

    const g = await request(app).get(`/api/career/graph/${id}`);
    expect(g.status).toBe(200);
    expect(g.body.data.graph.nodes.length).toBeGreaterThan(5);

    const road = await request(app).get('/api/roadmap');
    expect(road.status).toBe(200);
    expect(road.body.data.analysisId).toBe(id);
    expect(road.body.data.computation).toBe('demo');
    expect(road.body.data.items.length).toBe(graph.learningOrder.length);

    const skillId = road.body.data.items[0].skillId;
    const done = await request(app).patch(`/api/roadmap/items/${skillId}/complete`).send({ completed: true });
    expect(done.status).toBe(200);
    expect(done.body.data.totals.completedSkills).toBe(1);

    const dash = await request(app).get('/api/dashboard/summary');
    expect(dash.body.data.hasAnalysis).toBe(true);
    expect(dash.body.data.latest.mode).toBe('demo');
    expect(dash.body.data.latest.progressPercent).toBeGreaterThan(0);

    const hist = await request(app).get('/api/career/history');
    expect(hist.body.data.some((h: { id: string }) => h.id === id)).toBe(true);
  });

  it('validates input and unknown ids', async () => {
    expect((await request(app).get('/api/career/analysis/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/career/analysis/6f1b2f64-8a43-4d6b-9d87-2d0f3a9c7e11')).status).toBe(404);
    expect((await request(app).post('/api/career/roadmap').send({ learningHoursPerWeek: 0 })).status).toBe(400);
    expect((await request(app).post('/api/career/analyze').send({ mode: 'weird' })).status).toBe(400);
  });

  it('reports integration status truthfully', async () => {
    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    for (const k of ['neo4j', 'nosana', 'daytona']) expect(res.body.data[k]).toHaveProperty('configured');
  });

  it.skipIf(isNeo4jConfigured())('live analysis without Neo4j is a clear 503, not a fake result', async () => {
    const res = await request(app).post('/api/career/analyze').send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
  });
});
