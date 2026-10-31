import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { aiEngineerInput } from './fixtures/aiEngineerInput.js';
import { AnalysisOutputSchema } from '../src/schemas/analysis.js';

const pythonBin = ['python', 'python3', 'py'].find((bin) => spawnSync(bin, ['--version']).status === 0);

const state = vi.hoisted(() => ({
  created: [] as { deleted: boolean; id: string }[],
  mode: 'ok' as 'ok' | 'run-throws' | 'timeout' | 'script-fails' | 'create-fails',
  python: 'python',
}));

vi.mock('@daytona/sdk', () => {
  class Daytona {
    async create() {
      if (state.mode === 'create-fails') throw new Error('invalid api key');
      const record = { deleted: false, id: `sbx-${state.created.length + 1}` };
      state.created.push(record);
      return {
        id: record.id,
        process: {
          executeCommand: async () => ({ exitCode: 0, result: 'Python 3.12.0' }),
          codeRun: async (code: string) => {
            if (state.mode === 'run-throws') throw new Error('connection reset');
            if (state.mode === 'timeout') throw Object.assign(new Error('Execution timed out after 60s'), { name: 'DaytonaTimeoutError' });
            if (state.mode === 'script-fails') return { exitCode: 1, result: 'Traceback: boom' };
            const fs = await import('node:fs');
            const os = await import('node:os');
            const path = await import('node:path');
            const cp = await import('node:child_process');
            const file = path.join(os.tmpdir(), `sg-run-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
            fs.writeFileSync(file, code);
            const r = cp.spawnSync(state.python, [file], { encoding: 'utf8' });
            fs.unlinkSync(file);
            return { exitCode: r.status ?? 1, result: (r.stderr ?? '') + (r.stdout ?? '') };
          },
        },
        delete: async () => {
          record.deleted = true;
        },
      };
    }
    list() {
      return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) };
    }
  }
  return { Daytona };
});

const { runPythonAnalysis, parseSandboxOutput, renderTemplate, DaytonaRunError, getDaytonaStatus } = await import(
  '../src/services/daytona/sandboxRunner.js'
);

describe.skipIf(!pythonBin)('analysis.py algorithm (local python, NOT Daytona)', () => {
  function runLocal(input: unknown) {
    const file = path.join(os.tmpdir(), `sg-input-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(input));
    const script = path.join(process.cwd(), 'src', 'services', 'daytona', 'templates', 'analysis.py');
    const r = spawnSync(pythonBin!, [script, file], { encoding: 'utf8' });
    fs.unlinkSync(file);
    return { ...r, parsed: parseSandboxOutput(r.stdout) };
  }

  it('computes a valid, topologically ordered plan', () => {
    const r = runLocal(aiEngineerInput);
    expect(r.status).toBe(0);
    if (!('output' in r.parsed)) throw new Error(JSON.stringify(r.parsed));
    const out = r.parsed.output;
    expect(out.matchPercentage).toBeCloseTo(16.7, 1); // 1 of 6 required skills
    expect(out.missingSkillCount).toBe(5);
    expect(out.validation.valid).toBe(true);
    const idx = (n: string) => out.roadmap.findIndex((s) => s.skill === n);
    expect(idx('Python')).toBeLessThan(idx('Machine Learning'));
    expect(idx('Machine Learning')).toBeLessThan(idx('Generative AI'));
    expect(idx('Generative AI')).toBeLessThan(idx('LLM Application Development'));
    expect(idx('LLM Application Development')).toBeLessThan(idx('Model Evaluation'));
    // phases never go backwards along the order
    const phases = out.roadmap.map((r) => r.phase);
    expect([...phases].sort((a, b) => a - b)).toEqual(phases);
  });

  it('packs the schedule against hours per week and conserves total hours', () => {
    const slow = runLocal({ ...aiEngineerInput, learningHoursPerWeek: 4 });
    const fast = runLocal({ ...aiEngineerInput, learningHoursPerWeek: 16 });
    if (!('output' in slow.parsed) || !('output' in fast.parsed)) throw new Error('failed');
    for (const out of [slow.parsed.output, fast.parsed.output]) {
      expect(out.weeklySchedule.every((w) => w.hours <= out.learningHoursPerWeek + 1e-6)).toBe(true);
      const scheduled = out.weeklySchedule.reduce((a, w) => a + w.hours, 0);
      expect(scheduled).toBeCloseTo(out.estimatedLearningHours, 1);
    }
    expect(slow.parsed.output.estimatedWeeks).toBeGreaterThan(fast.parsed.output.estimatedWeeks);
    expect(slow.parsed.output.estimatedLearningHours).toBe(fast.parsed.output.estimatedLearningHours);
  });

  it('marks hours as estimates when no course teaches a skill', () => {
    const r = runLocal({ ...aiEngineerInput, courses: aiEngineerInput.courses.filter((c) => c.id !== 'C001') });
    if (!('output' in r.parsed)) throw new Error('failed');
    const python = r.parsed.output.roadmap.find((s) => s.skill === 'Python')!;
    expect(python.hoursSource).toBe('level-default-estimate');
    expect(r.parsed.output.estimatedHoursFromDefaults).toBeGreaterThan(0);
  });

  it('never groups skills into a course unit that forces a prerequisite after its dependent', () => {
    // Regression: with the real dataset, "MLOps in Practice" (ML + Model Evaluation) and "Build LLM Applications"
    // (Generative AI + LLM App Dev) are cheapest per skill but together form a cycle between units.
    const courses = [
      { id: 'C010', name: 'MLOps in Practice', level: 'Advanced', estimatedHours: 14, teachesSkillIds: ['SK010', 'SK031'] },
      { id: 'C005', name: 'Build LLM Applications', level: 'Intermediate', estimatedHours: 12, teachesSkillIds: ['SK012', 'SK013'] },
      ...aiEngineerInput.courses.filter((c) => c.id === 'C001' || c.id === 'C002'),
    ];
    const r = runLocal({ ...aiEngineerInput, courses });
    if (!('output' in r.parsed)) throw new Error('failed');
    const out = r.parsed.output;
    expect(out.validation.violations).toEqual([]);
    expect(out.validation.cycleBreaks).toEqual([]);
    const idx = (n: string) => out.roadmap.findIndex((s) => s.skill === n);
    expect(idx('LLM Application Development')).toBeLessThan(idx('Model Evaluation'));
    expect(idx('Machine Learning')).toBeLessThan(idx('Generative AI'));
  });

  it('detects prerequisite cycles instead of hanging', () => {
    const cyclic = {
      ...aiEngineerInput,
      prerequisites: [...aiEngineerInput.prerequisites, { from: 'SK031', to: 'SK010' }],
    };
    const r = runLocal(cyclic);
    expect(r.status).toBe(0);
    if (!('output' in r.parsed)) throw new Error('failed');
    expect(r.parsed.output.validation.cyclicSkills.length).toBeGreaterThan(0);
  });

  it('fails with a structured error and non-zero exit on invalid input', () => {
    const r = runLocal({ ...aiEngineerInput, learningHoursPerWeek: 0 });
    expect(r.status).toBe(1);
    expect('failure' in r.parsed).toBe(true);
  });
});

describe('sandbox output parsing', () => {
  it('rejects output without a result block', () => {
    expect(parseSandboxOutput('just logs')).toMatchObject({ failure: expect.stringContaining('result block') });
  });
  it('rejects schema-invalid results', () => {
    const raw = `__SKILLGRAPH_RESULT_BEGIN__\n{"executionStatus":"completed"}\n__SKILLGRAPH_RESULT_END__`;
    expect('failure' in parseSandboxOutput(raw)).toBe(true);
  });
  it('surfaces script-reported errors', () => {
    const raw = `__SKILLGRAPH_RESULT_BEGIN__\n{"executionStatus":"failed","error":"bad"}\n__SKILLGRAPH_RESULT_END__`;
    expect(parseSandboxOutput(raw)).toEqual({ failure: 'Analysis script reported an error: bad' });
  });
  it('output schema is strict about required fields', () => {
    expect(AnalysisOutputSchema.safeParse({}).success).toBe(false);
  });
});

describe('template rendering', () => {
  it('embeds input only as base64 data', () => {
    const code = renderTemplate({ ...aiEngineerInput, targetRole: `AI"; import os; os.system("x") #` });
    expect(code).not.toContain('os.system');
    expect(code).not.toContain('__INPUT_B64__');
  });
});

describe.skipIf(!pythonBin)('runPythonAnalysis (Daytona SDK mocked, real python for the script)', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = env.DAYTONA_API_KEY;
    env.DAYTONA_API_KEY = 'dtn_test';
    state.created.length = 0;
    state.mode = 'ok';
    state.python = pythonBin!;
  });
  afterEach(() => {
    env.DAYTONA_API_KEY = originalKey;
  });

  it('runs, parses output, records the execution and deletes the sandbox', async () => {
    const { output, execution } = await runPythonAnalysis(aiEngineerInput);
    expect(output.roadmap.length).toBe(7);
    expect(execution.status).toBe('completed');
    expect(execution.sandboxId).toBe('sbx-1');
    expect(execution.cleanedUp).toBe(true);
    expect(state.created[0].deleted).toBe(true);
    expect(execution.logs.some((l) => l.source === 'sandbox')).toBe(true);
  });

  it.each([
    ['run-throws', 'execute'],
    ['timeout', 'timeout'],
    ['script-fails', 'parse'],
  ] as const)('cleans up the sandbox when execution fails (%s)', async (mode, kind) => {
    state.mode = mode;
    const err = await runPythonAnalysis(aiEngineerInput).catch((e) => e);
    expect(err).toBeInstanceOf(DaytonaRunError);
    expect(err.kind).toBe(kind);
    expect(err.execution.cleanedUp).toBe(true);
    expect(state.created[0].deleted).toBe(true);
    expect(err.execution.status).toBe(mode === 'timeout' ? 'timeout' : 'failed');
  });

  it('reports create failures without leaking a sandbox', async () => {
    state.mode = 'create-fails';
    const err = await runPythonAnalysis(aiEngineerInput).catch((e) => e);
    expect(err).toBeInstanceOf(DaytonaRunError);
    expect(err.kind).toBe('auth');
    expect(state.created).toHaveLength(0);
  });

  it('rejects invalid input before touching Daytona', async () => {
    const err = await runPythonAnalysis({ ...aiEngineerInput, learningHoursPerWeek: 0 }).catch((e) => e);
    expect(err.kind).toBe('input');
    expect(state.created).toHaveLength(0);
  });

  it('reports connected after a successful authenticated list call', async () => {
    const status = await getDaytonaStatus();
    expect(status.connected).toBe(true);
    expect(status.lastExecution).not.toBeNull();
  });
});
