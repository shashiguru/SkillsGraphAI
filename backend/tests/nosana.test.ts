import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { chatCompletion, getNosanaStatus, listModels, NosanaError, resolveModel } from '../src/services/nosana/nosanaClient.js';
import { enforceGraphEntities, extractJson, generateCareerInsight } from '../src/agents/careerAdvisorAgent.js';
import { CareerInsightSchema } from '../src/schemas/careerInsight.js';
import type { GraphAnalysis } from '../src/types/graph.js';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const MODELS = {
  object: 'list',
  data: [
    { id: 'model-a', available: true },
    { id: 'model-b', available: true },
    { id: 'model-off', available: false },
  ],
};

let original: { key?: string; model?: string };
beforeEach(() => {
  original = { key: env.NOSANA_API_KEY, model: env.NOSANA_MODEL };
  env.NOSANA_API_KEY = 'nos_test_key';
  env.NOSANA_MODEL = undefined;
});
afterEach(() => {
  env.NOSANA_API_KEY = original.key;
  env.NOSANA_MODEL = original.model;
  vi.unstubAllGlobals();
});

const analysis = {
  userId: 'u',
  targetRole: { id: 'R009', name: 'AI Engineer', description: 'd', seniority: 'Intermediate' },
  userSkills: [{ id: 'SK017', name: 'API Development' }, { id: 'SK003', name: 'C#' }],
  matchedSkills: [{ id: 'SK017', name: 'API Development', importance: 'Required' }],
  missingSkills: [{ id: 'SK002', name: 'Python', importance: 'Required', level: 'Beginner', category: 'Programming' }],
  prerequisiteGapSkills: [{ id: 'SK010', name: 'Machine Learning', level: 'Advanced' }],
  prerequisites: [],
  learningOrder: [],
  recommendedCourses: [{ id: 'C001', name: 'Python for Developers', level: 'Beginner', estimatedHours: 8, teachesSkillNames: ['Python'], teachesSkillIds: ['SK002'] }],
  certifications: [{ id: 'CERT008', name: 'TensorFlow Developer Certificate (sample pathway)', validatesSkillNames: ['Python'], validatesSkillIds: ['SK002'], relevance: 'closes_gap' }],
  relatedRoles: [],
  alternativeRoles: [],
  graphPaths: [],
  skillsWithoutCourse: [],
} as unknown as GraphAnalysis;

const validInsight = {
  careerSummary: 'Your full-stack background is a strong foundation for AI engineering.',
  targetRole: 'AI Engineer',
  strengths: [{ skill: 'API Development', reason: 'Useful for AI apps.' }],
  skillExplanations: [{ skill: 'Python', reason: 'Core language.', priority: 'high' }],
  learningPriorities: [{ skill: 'Python', rationale: 'First.', course: 'Python for Developers' }],
  careerAdvice: ['Build a small project.'],
  roadmapSummary: 'Start with Python.',
};

describe('Nosana model discovery', () => {
  it('lists only available models using the Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, MODELS));
    vi.stubGlobal('fetch', fetchMock);
    const models = await listModels();
    expect(models.map((m) => m.id)).toEqual(['model-a', 'model-b']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://inference.nosana.com/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer nos_test_key');
  });

  it('never selects an embedding model (real /v1/models lists one first)', async () => {
    const real = {
      object: 'list',
      data: [
        { id: 'nvidia/nemotron-3-embed-1b', name: 'Managed embedding inference - Nemotron 3 Embed 1B', max_output_tokens: 1, available: true },
        { id: 'qwen/qwen3.8-27b', name: 'Managed Qwen inference - Qwen3.8 27B AWQ', max_output_tokens: 16384, available: true },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(200, real)));
    expect((await listModels()).map((m) => m.id)).toEqual(['qwen/qwen3.8-27b']);
    expect((await resolveModel()).model).toBe('qwen/qwen3.8-27b');
  });

  it('reports no model when only embedding models are served', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(200, { data: [{ id: 'x-embed', max_output_tokens: 1, available: true }] })));
    await expect(resolveModel()).rejects.toMatchObject({ kind: 'model_unavailable' });
  });

  it('selects the configured model when it is served', async () => {
    env.NOSANA_MODEL = 'model-b';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, MODELS)));
    expect((await resolveModel()).model).toBe('model-b');
  });

  it('falls back and reports when the configured model is not served', async () => {
    env.NOSANA_MODEL = 'ghost';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, MODELS)));
    const r = await resolveModel();
    expect(r.model).toBe('model-a');
    expect(r.fallbackFrom).toBe('ghost');
  });

  it('reports connected only after a successful /models call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: { message: 'bad key', code: 'invalid_api_key' } })));
    const status = await getNosanaStatus();
    expect(status.connected).toBe(false);
    expect(status.errorKind).toBe('auth');
  });
});

describe('Nosana inference error handling', () => {
  const call = () => chatCompletion({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] });

  it('returns content, model and usage on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(200, { model: 'model-a', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { total_tokens: 5 } })),
    );
    const r = await call();
    expect(r.content).toBe('OK');
    expect(r.usage?.total_tokens).toBe(5);
  });

  it.each([
    [401, 'auth'],
    [402, 'credits'],
    [404, 'model_unavailable'],
  ])('maps %i to %s and does not retry', async (status, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(json(status, { error: { message: 'nope' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(call()).rejects.toMatchObject({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 502 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(502, { error: { message: 'upstream', code: 'upstream_unreachable' } }))
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: 'fine' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await call();
    expect(r.content).toBe('fine');
    expect(r.attempts).toBe(2);
  });

  it('honours Retry-After on 429 and gives up after the attempt budget', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(429, { error: { message: 'slow' } }, { 'retry-after': '0.01' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(call()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats an empty completion as a failure, never as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] })));
    await expect(call()).rejects.toBeInstanceOf(NosanaError);
  });

  it('retries without response_format when the model rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: 'response_format is not supported' } }))
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await chatCompletion({ model: 'm', messages: [{ role: 'user', content: 'x' }], jsonMode: true });
    expect(r.content).toBe('{}');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('disables the thinking phase when asked, and drops the option if the model rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: 'Unknown field chat_template_kwargs' } }))
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await chatCompletion({ model: 'm', messages: [{ role: 'user', content: 'x' }], disableThinking: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).chat_template_kwargs).toBeUndefined();
  });
});

describe('Structured output validation', () => {
  it('extracts JSON from fenced model output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} done')).toEqual({ a: 2 });
    expect(() => extractJson('no json')).toThrow();
  });

  it('rejects insights with missing required fields', () => {
    expect(CareerInsightSchema.safeParse({ careerSummary: 'short' }).success).toBe(false);
    expect(CareerInsightSchema.safeParse(validInsight).success).toBe(true);
  });

  it('drops entities that Neo4j did not return', () => {
    const insight = CareerInsightSchema.parse({
      ...validInsight,
      skillExplanations: [...validInsight.skillExplanations, { skill: 'Quantum Computing', reason: 'x', priority: 'low' }],
      learningPriorities: [{ skill: 'Python', rationale: 'r', course: 'Invented Course' }],
      certificationAdvice: [{ certification: 'Fake Cert', reason: 'x' }],
    });
    const { insight: cleaned, dropped } = enforceGraphEntities(insight, analysis);
    expect(cleaned.skillExplanations.map((s) => s.skill)).toEqual(['Python']);
    expect(cleaned.learningPriorities[0].course).toBeNull();
    expect(cleaned.certificationAdvice).toEqual([]);
    expect(dropped.map((d) => d.value)).toEqual(expect.arrayContaining(['Quantum Computing', 'Invented Course', 'Fake Cert']));
  });

  it('end to end: repairs invalid JSON once, then returns a validated insight', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/models')) return Promise.resolve(json(200, MODELS));
      const n = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/chat/completions')).length;
      const content = n === 1 ? 'this is not json' : JSON.stringify(validInsight);
      return Promise.resolve(json(200, { model: 'model-a', choices: [{ message: { content } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateCareerInsight(
      { name: 'Alex', currentRole: 'Full Stack Developer', yearsExperience: 9, learningHoursPerWeek: 8 },
      analysis,
    );
    expect(result.repaired).toBe(true);
    expect(result.insight.targetRole).toBe('AI Engineer');
  });

  it('fails honestly (throws) when the model never returns valid JSON', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      String(url).endsWith('/models')
        ? Promise.resolve(json(200, MODELS))
        : Promise.resolve(json(200, { choices: [{ message: { content: 'still not json' } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateCareerInsight({ name: 'A', currentRole: 'Dev', yearsExperience: 1, learningHoursPerWeek: 5 }, analysis),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
