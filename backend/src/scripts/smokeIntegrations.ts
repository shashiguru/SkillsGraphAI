/**
 * End-to-end smoke test of the real Alex scenario against a RUNNING backend (npm run dev).
 *
 *   npm run test:integrations                 # uses http://localhost:3000/api
 *   API_URL=http://localhost:4000/api npm run test:integrations
 *
 * It saves Alex's profile, starts a live analysis, polls the real event log and checks every step.
 * Steps that are not configured are reported as SKIPPED, never as a pass. The exit code is 1 when
 * a configured integration failed, or when --strict is passed and anything was skipped.
 */
const API = (process.env.API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
const STRICT = process.argv.includes('--strict');

interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(`Cannot reach ${API}. Start the backend first with: npm run dev`);
  }
  const json = (await res.json()) as Envelope<T>;
  if (!res.ok || json.error) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.message ?? ''}`);
  return json.data as T;
}

const ALEX = {
  name: 'Alex',
  currentRole: 'Full Stack Developer',
  yearsExperience: 9,
  industry: 'Software',
  technicalSkills: ['C#', 'Angular', 'TypeScript', 'SQL', 'Azure', 'API Development', 'Docker'].map((name) => ({ name, proficiencyLevel: 'Intermediate' })),
  softSkills: ['Communication', 'Mentoring'],
  learningHoursPerWeek: 8,
};

type Row = { check: string; result: 'PASS' | 'FAIL' | 'SKIPPED'; detail: string };
const rows: Row[] = [];
const record = (check: string, result: Row['result'], detail = '') => {
  rows.push({ check, result, detail });
  console.log(`${result.padEnd(8)} ${check}${detail ? `  (${detail})` : ''}`);
};

async function main() {
  console.log(`Smoke testing ${API}\n`);
  const health = await call<{ status: string }>('GET', '/health');
  record('Backend health', health.status === 'ok' ? 'PASS' : 'FAIL', health.status);

  const status = await call<{
    neo4j: { configured: boolean; connected: boolean; error?: string };
    nosana: { configured: boolean; connected: boolean; error?: string; models: unknown[]; selectedModel?: string };
    daytona: { configured: boolean; connected: boolean; error?: string };
  }>('GET', '/integrations/status');
  for (const [name, s] of Object.entries(status) as [string, { configured: boolean; connected: boolean; error?: string }][]) {
    if (name === 'checkedAt') continue;
    if (!s.configured) record(`${name} connectivity`, 'SKIPPED', 'not configured');
    else record(`${name} connectivity`, s.connected ? 'PASS' : 'FAIL', s.connected ? '' : s.error);
  }
  if (!status.neo4j.connected) {
    console.log('\nNeo4j is required for the analysis pipeline. Fix connectivity and rerun.');
    return;
  }

  const { roles } = await call<{ roles: { id: string; name: string }[] }>('GET', '/roles');
  const target = roles.find((r) => r.name === 'AI Engineer');
  if (!target) throw new Error('AI Engineer role not found. Did you run npm run seed?');
  const existing = await call<unknown>('GET', '/profile').catch(() => null);
  const saved = await call<{ technicalSkills: unknown[]; unmappedSkills: string[] }>(existing ? 'PUT' : 'POST', '/profile', { ...ALEX, targetRoleId: target.id });
  record('Save Alex profile', saved.technicalSkills.length === 7 ? 'PASS' : 'FAIL', `${saved.technicalSkills.length} skills mapped, unmapped: ${saved.unmappedSkills.join(', ') || 'none'}`);

  const started = await call<{ analysisId: string; mode: string }>('POST', '/career/analyze', { mode: 'live' });
  record('Start live analysis', started.mode === 'live' ? 'PASS' : 'FAIL', started.analysisId);

  type Analysis = {
    status: string;
    steps: Record<string, { status: string; error?: string; durationMs?: number }>;
    events: { step: string; status: string; message: string }[];
    summary?: { matchPercentage: number; matchedSkillCount: number; requiredSkillCount: number; gapSkillCount: number };
    graph?: { missingSkills: { name: string }[]; learningOrder: { skill: { name: string } }[] };
    computation?: { estimatedLearningHours: number; estimatedWeeks: number; validation: { valid: boolean } };
    execution?: { sandboxId: string | null; cleanedUp: boolean; status: string };
    insight?: { model: string; insight: { careerSummary: string } };
  };
  const deadline = Date.now() + 600_000;
  let a: Analysis;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    a = await call<Analysis>('GET', `/career/analysis/${started.analysisId}`);
  } while (a.status === 'running' && Date.now() < deadline);
  record('Pipeline finished', a.status === 'running' ? 'FAIL' : 'PASS', `status ${a.status}`);

  console.log('\nRecorded events:');
  for (const e of a.events) console.log(`  [${e.step}] ${e.status}: ${e.message}`);
  console.log('');

  for (const [id, step] of Object.entries(a.steps)) {
    if (step.status === 'live') record(`Step ${id}`, 'PASS', step.durationMs ? `${step.durationMs} ms` : '');
    else if (step.status === 'skipped') record(`Step ${id}`, 'SKIPPED', step.error ?? '');
    else record(`Step ${id}`, 'FAIL', `${step.status}${step.error ? `: ${step.error}` : ''}`);
  }

  if (a.summary && a.graph) {
    const s = a.summary;
    const ok = s.matchedSkillCount === 1 && s.requiredSkillCount === 6 && a.graph.missingSkills.some((m) => m.name === 'Python');
    record('Alex graph facts', ok ? 'PASS' : 'FAIL', `${s.matchPercentage}% match, ${s.gapSkillCount} skills to learn`);
    const order = a.graph.learningOrder.map((l) => l.skill.name);
    record('Prerequisite order', order.indexOf('Python') < order.indexOf('Machine Learning') ? 'PASS' : 'FAIL', order.join(' > '));
  }
  if (a.computation) {
    record('Sandbox result valid', a.computation.validation.valid ? 'PASS' : 'FAIL', `${a.computation.estimatedLearningHours} h, ${a.computation.estimatedWeeks} weeks`);
    if (a.execution) record('Sandbox cleaned up', a.execution.cleanedUp ? 'PASS' : 'FAIL', `sandbox ${a.execution.sandboxId}`);
  }
  if (a.insight) record('AI explanation', 'PASS', `model ${a.insight.model}`);

  if (a.computation && a.status !== 'failed') {
    const view = await call<{ learningHoursPerWeek: number; totals: { weeks: number } | null }>('POST', '/career/roadmap', { analysisId: started.analysisId, learningHoursPerWeek: 16 });
    record('Roadmap recalculation (16 h/week)', view.learningHoursPerWeek === 16 && view.totals ? 'PASS' : 'FAIL', `${view.totals?.weeks} weeks`);
    // Put the stored analysis back to Alex's real pace so the UI is not left showing the experiment.
    await call('POST', '/career/roadmap', { analysisId: started.analysisId, learningHoursPerWeek: ALEX.learningHoursPerWeek });
  }
}

main()
  .catch((err) => record('Smoke test', 'FAIL', err instanceof Error ? err.message : String(err)))
  .finally(() => {
    const failed = rows.filter((r) => r.result === 'FAIL').length;
    const skipped = rows.filter((r) => r.result === 'SKIPPED').length;
    console.log(`\n${rows.filter((r) => r.result === 'PASS').length} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed > 0 || (STRICT && skipped > 0) ? 1 : 0);
  });
