import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_ROOT, isDaytonaConfigured, isNeo4jConfigured, isNosanaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError, badRequest, notConfigured, notFound, upstreamFailure } from '../../utils/errors.js';
import type { Profile } from '../../schemas/profile.js';
import type { CareerGraph, GraphAnalysis } from '../../types/graph.js';
import type { CareerInsightResult } from '../../schemas/careerInsight.js';
import type { AnalysisInput, AnalysisOutput } from '../../schemas/analysis.js';
import type {
  AnalysisEvent,
  AnalysisSummary,
  CareerAnalysis,
  ExecutionRecord,
  ProfileSnapshot,
  StepId,
  StepState,
} from '../../types/career.js';
import { DaytonaRunError, runPythonAnalysis, type SandboxExecution } from '../daytona/sandboxRunner.js';
import { buildAnalysisInput } from '../daytona/analysisInput.js';
import { generateCareerInsight } from '../../agents/careerAdvisorAgent.js';
import { NosanaError } from '../nosana/nosanaClient.js';
import { buildCareerGraph, buildGraphAnalysis } from './graphAnalysis.js';
import { getAnalysis, persist, remember } from './analysisStore.js';
import { getProfile } from '../neo4j/userRepository.js';
import { getRole } from '../neo4j/catalogRepository.js';

export const DEMO_FIXTURE_PATH = path.join(BACKEND_ROOT, 'src', 'services', 'career', 'demoScenario.json');

/** Everything the pipeline touches outside this module, so failure paths can be tested without credentials. */
export interface PipelineDeps {
  configured: { neo4j: () => boolean; nosana: () => boolean; daytona: () => boolean };
  buildGraphAnalysis: (userId: string, roleId: string, currentRole?: string) => Promise<GraphAnalysis>;
  buildCareerGraph: (analysis: GraphAnalysis) => Promise<CareerGraph>;
  generateInsight: (profile: ProfileSnapshot, analysis: GraphAnalysis) => Promise<CareerInsightResult>;
  runSandbox: (input: AnalysisInput) => Promise<{ output: AnalysisOutput; execution: SandboxExecution }>;
  persist: (analysis: CareerAnalysis) => Promise<'neo4j' | 'memory'>;
}

export const defaultDeps: PipelineDeps = {
  configured: { neo4j: isNeo4jConfigured, nosana: isNosanaConfigured, daytona: isDaytonaConfigured },
  buildGraphAnalysis,
  buildCareerGraph,
  generateInsight: generateCareerInsight,
  runSandbox: runPythonAnalysis,
  persist,
};

const STEP_LABELS: Record<StepId, string> = {
  neo4j: 'Neo4j graph analysis',
  nosana: 'Nosana AI reasoning',
  daytona: 'Daytona sandbox computation',
  compose: 'Compose career analysis',
  persist: 'Persist result',
};

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const emptySteps = (): Record<StepId, StepState> =>
  Object.fromEntries((Object.keys(STEP_LABELS) as StepId[]).map((id) => [id, { id, label: STEP_LABELS[id], status: 'pending' }])) as Record<StepId, StepState>;

function emit(a: CareerAnalysis, step: AnalysisEvent['step'], status: AnalysisEvent['status'], message: string, durationMs?: number) {
  a.events.push({ seq: a.events.length + 1, at: new Date().toISOString(), step, status, message, durationMs });
}

function begin(a: CareerAnalysis, step: StepId, message: string) {
  a.steps[step] = { ...a.steps[step], status: 'running', startedAt: new Date().toISOString(), error: undefined };
  emit(a, step, 'started', message);
}

function succeed(a: CareerAnalysis, step: StepId, startedMs: number, message: string, detail?: string) {
  const durationMs = Date.now() - startedMs;
  a.steps[step] = { ...a.steps[step], status: 'live', durationMs, detail };
  emit(a, step, 'succeeded', message, durationMs);
}

function fail(a: CareerAnalysis, step: StepId, startedMs: number, error: string, status: StepState['status'] = 'failed') {
  const durationMs = Date.now() - startedMs;
  a.steps[step] = { ...a.steps[step], status, durationMs, error };
  emit(a, step, status === 'skipped' ? 'skipped' : 'failed', error, durationMs);
}

function skip(a: CareerAnalysis, step: StepId, reason: string) {
  a.steps[step] = { ...a.steps[step], status: 'skipped', error: reason };
  emit(a, step, 'skipped', reason);
}

export const snapshotProfile = (p: Profile, learningHoursPerWeek = p.learningHoursPerWeek): ProfileSnapshot => ({
  name: p.name,
  currentRole: p.currentRole,
  yearsExperience: p.yearsExperience,
  industry: p.industry,
  learningHoursPerWeek,
  skills: p.technicalSkills.map((s) => s.name),
});

export function summarize(g: GraphAnalysis): AnalysisSummary {
  const required = g.matchedSkills.length + g.missingSkills.length;
  return {
    requiredSkillCount: required,
    matchedSkillCount: g.matchedSkills.length,
    missingSkillCount: g.missingSkills.length,
    gapSkillCount: g.learningOrder.length,
    matchPercentage: required ? Math.round((100 * g.matchedSkills.length) / required) : 0,
  };
}

const toExecutionRecord = (e: SandboxExecution): ExecutionRecord => ({
  executionId: e.executionId,
  status: e.status,
  sandboxId: e.sandboxId,
  startedAt: e.startedAt,
  durationMs: e.durationMs,
  phases: e.phases,
  exitCode: e.exitCode,
  pythonVersion: e.pythonVersion,
  networkIsolated: e.networkIsolated,
  logs: e.logs,
  cleanedUp: e.cleanedUp,
  error: e.error,
});

/** Creates the running record for a live analysis. The pipeline fills it in asynchronously. */
export function createAnalysisRecord(profile: ProfileSnapshot, userId: string, role: { id: string; name: string }): CareerAnalysis {
  const analysis: CareerAnalysis = {
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    mode: 'live',
    status: 'running',
    profile,
    targetRoleId: role.id,
    targetRoleName: role.name,
    learningHoursPerWeek: profile.learningHoursPerWeek,
    steps: emptySteps(),
    events: [],
    completedSkillIds: [],
    persistedTo: null,
  };
  emit(analysis, 'pipeline', 'started', `Analysis started for ${profile.name} targeting ${role.name}`);
  remember(analysis);
  return analysis;
}

async function runNosana(a: CareerAnalysis, deps: PipelineDeps, graph: GraphAnalysis) {
  if (!deps.configured.nosana()) return skip(a, 'nosana', 'Nosana is not configured (NOSANA_API_KEY missing). AI explanation unavailable');
  const started = Date.now();
  begin(a, 'nosana', 'Asking Nosana to explain the graph facts');
  try {
    const result = await deps.generateInsight(a.profile, graph);
    a.insight = result;
    const dropped = result.droppedEntities.length;
    succeed(
      a,
      'nosana',
      started,
      `Nosana (${result.model}) returned a validated insight${dropped ? `; ${dropped} entities not in the graph were discarded` : ''}`,
      `model ${result.model}`,
    );
  } catch (err) {
    const msg = err instanceof NosanaError ? `Nosana ${err.kind}: ${err.message}` : errMessage(err);
    fail(a, 'nosana', started, msg);
    logger.warn({ err }, 'Nosana step failed');
  }
}

async function runDaytona(a: CareerAnalysis, deps: PipelineDeps, graph: GraphAnalysis, hoursPerWeek: number) {
  if (!deps.configured.daytona()) return skip(a, 'daytona', 'Daytona is not configured (DAYTONA_API_KEY missing). Sandbox computation unavailable');
  const started = Date.now();
  begin(a, 'daytona', 'Running trusted analysis script in a Daytona sandbox');
  try {
    const { output, execution } = await deps.runSandbox(buildAnalysisInput(graph, hoursPerWeek));
    a.computation = output;
    a.execution = toExecutionRecord(execution);
    succeed(a, 'daytona', started, `Sandbox ${execution.sandboxId} computed ${output.roadmap.length} roadmap items in ${execution.durationMs}ms`, `sandbox ${execution.sandboxId}`);
  } catch (err) {
    if (err instanceof DaytonaRunError) a.execution = toExecutionRecord(err.execution);
    fail(a, 'daytona', started, errMessage(err));
    logger.warn({ err }, 'Daytona step failed');
  }
}

/**
 * The orchestration pipeline. Never throws: every outcome ends up in the record.
 * Neo4j is mandatory (it provides the facts). Nosana and Daytona failing yields a `partial` result.
 */
export async function runPipeline(a: CareerAnalysis, deps: PipelineDeps = defaultDeps): Promise<CareerAnalysis> {
  try {
    // --- Step 1: Neo4j
    if (!deps.configured.neo4j()) {
      fail(a, 'neo4j', Date.now(), 'Neo4j is not configured. Set NEO4J_* in backend/.env, or run the labelled demo scenario', 'skipped');
      throw new Error('Neo4j is required to produce graph facts');
    }
    const graphStarted = Date.now();
    begin(a, 'neo4j', 'Querying the knowledge graph');
    let graph: GraphAnalysis;
    try {
      graph = await deps.buildGraphAnalysis(a.userId, a.targetRoleId, a.profile.currentRole);
      a.graph = graph;
      a.summary = summarize(graph);
      a.cytoscape = await deps.buildCareerGraph(graph);
      succeed(
        a,
        'neo4j',
        graphStarted,
        `Graph analysis complete: ${a.summary.matchedSkillCount}/${a.summary.requiredSkillCount} required skills matched, ${a.summary.gapSkillCount} to learn`,
        `${a.cytoscape.nodes.length} nodes, ${a.cytoscape.edges.length} edges`,
      );
    } catch (err) {
      fail(a, 'neo4j', graphStarted, errMessage(err));
      throw err;
    }

    // --- Steps 2 + 3: Nosana and Daytona in parallel (both consume only the graph output)
    if (!graph.learningOrder.length) {
      skip(a, 'nosana', 'No skill gap: nothing to explain');
      skip(a, 'daytona', 'No skill gap: nothing to compute');
    } else {
      await Promise.all([runNosana(a, deps, graph), runDaytona(a, deps, graph, a.learningHoursPerWeek)]);
    }

    // --- Compose
    const composeStarted = Date.now();
    const noGap = !graph.learningOrder.length;
    const degraded = !noGap && (a.steps.nosana.status !== 'live' || a.steps.daytona.status !== 'live');
    a.status = degraded ? 'partial' : 'completed';
    succeed(
      a,
      'compose',
      composeStarted,
      degraded
        ? `Composed a partial analysis (Nosana: ${a.steps.nosana.status}, Daytona: ${a.steps.daytona.status})`
        : 'Composed the full career analysis',
    );
  } catch (err) {
    a.status = 'failed';
    a.error = errMessage(err);
    emit(a, 'pipeline', 'failed', `Analysis failed: ${a.error}`);
  }

  // --- Persist (also for failed runs, so the history shows what happened)
  const persistStarted = Date.now();
  begin(a, 'persist', 'Saving the analysis');
  a.completedAt = new Date().toISOString();
  try {
    a.persistedTo = await deps.persist(a);
    if (a.persistedTo === 'neo4j') {
      succeed(a, 'persist', persistStarted, 'Analysis saved to Neo4j');
      // The first write captured the step as "running"; store the final state too (best effort).
      await deps.persist(a).catch(() => undefined);
    } else {
      a.steps.persist = { ...a.steps.persist, status: 'skipped', durationMs: Date.now() - persistStarted, error: 'Not saved to Neo4j; kept in server memory only' };
      emit(a, 'persist', 'skipped', 'Not saved to Neo4j; kept in server memory only (lost on restart)', Date.now() - persistStarted);
    }
  } catch (err) {
    fail(a, 'persist', persistStarted, errMessage(err));
  }
  emit(a, 'pipeline', 'info', `Analysis ${a.status}`);
  return a;
}

/** Validates inputs that can be rejected immediately, creates the record and starts the pipeline in the background. */
export async function startAnalysis(
  opts: { targetRoleId?: string; learningHoursPerWeek?: number },
  deps: PipelineDeps = defaultDeps,
  userId?: string,
): Promise<CareerAnalysis> {
  if (!deps.configured.neo4j()) throw notConfigured('Neo4j', 'NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD');
  const profile = await getProfile(userId);
  if (!profile) throw notFound('Profile. Save your profile first');
  const roleId = opts.targetRoleId ?? profile.targetRoleId;
  if (!roleId) throw badRequest('No target role selected');
  const role = await getRole(roleId);
  if (!role) throw badRequest(`Unknown targetRoleId ${roleId}`);
  const snapshot = snapshotProfile(profile, opts.learningHoursPerWeek ?? profile.learningHoursPerWeek);
  const analysis = createAnalysisRecord(snapshot, profile.userId, role);
  // Fire and forget: the client polls GET /career/analysis/:id.
  void runPipeline(analysis, deps).catch((err) => {
    logger.error({ err }, 'Pipeline crashed unexpectedly');
    analysis.status = 'failed';
    analysis.error = errMessage(err);
  });
  return analysis;
}

/** Creates an analysis from the pre-generated demo fixture. It is always marked mode "demo". */
export function startDemoAnalysis(): CareerAnalysis {
  if (!fs.existsSync(DEMO_FIXTURE_PATH)) throw new AppError(500, 'demo_missing', 'Demo scenario fixture is missing. Run npm run demo:generate');
  const fixture = JSON.parse(fs.readFileSync(DEMO_FIXTURE_PATH, 'utf8')) as CareerAnalysis;
  const now = new Date().toISOString();
  const a: CareerAnalysis = {
    ...fixture,
    id: crypto.randomUUID(),
    createdAt: now,
    completedAt: now,
    mode: 'demo',
    status: 'completed',
    completedSkillIds: [],
    events: [],
    persistedTo: 'memory',
  };
  emit(a, 'pipeline', 'info', 'DEMO MODE: loaded the pre-generated Alex to AI Engineer scenario. No live Neo4j, Nosana or Daytona call was made');
  emit(a, 'neo4j', 'info', 'Graph facts computed offline from the starter dataset with the same algorithms');
  emit(a, 'nosana', 'info', 'AI explanation is fixture text validated against the graph allow-list, not live inference');
  emit(a, 'daytona', 'info', 'Computation by the same analysis.py run locally at fixture generation time, not in a Daytona sandbox');
  remember(a);
  return a;
}

const recalculating = new Set<string>();

/**
 * Re-runs the sandbox computation with a new weekly budget. Keeps the previous computation if the run fails.
 * Works on the stored graph facts, so no Neo4j or Nosana call is needed.
 */
export async function recalculateRoadmap(
  analysisId: string,
  learningHoursPerWeek: number,
  deps: PipelineDeps = defaultDeps,
): Promise<CareerAnalysis> {
  const a = await getAnalysis(analysisId);
  if (!a) throw notFound(`Analysis ${analysisId}`);
  if (a.status === 'running') throw new AppError(409, 'analysis_running', 'The analysis is still running');
  if (!a.graph) throw badRequest('This analysis has no graph facts to recompute from');
  if (!deps.configured.daytona()) throw notConfigured('Daytona', 'DAYTONA_API_KEY');
  if (recalculating.has(a.id)) throw new AppError(409, 'recalculation_in_progress', 'A recalculation is already running');

  recalculating.add(a.id);
  const started = Date.now();
  emit(a, 'daytona', 'started', `Recalculating the schedule for ${learningHoursPerWeek} h/week in a Daytona sandbox`);
  try {
    const { output, execution } = await deps.runSandbox(buildAnalysisInput(a.graph, learningHoursPerWeek));
    a.computation = output;
    a.execution = toExecutionRecord(execution);
    a.learningHoursPerWeek = learningHoursPerWeek;
    a.profile = { ...a.profile, learningHoursPerWeek };
    if (a.mode === 'live') a.steps.daytona = { ...a.steps.daytona, status: 'live', error: undefined, durationMs: Date.now() - started, detail: `sandbox ${execution.sandboxId}` };
    emit(a, 'daytona', 'succeeded', `Schedule recalculated in sandbox ${execution.sandboxId}: ${output.estimatedWeeks} weeks`, Date.now() - started);
    if (a.mode === 'live' && a.status === 'partial' && a.steps.nosana.status === 'live') a.status = 'completed';
    a.persistedTo = await deps.persist(a);
    return a;
  } catch (err) {
    if (err instanceof DaytonaRunError) a.execution = toExecutionRecord(err.execution);
    emit(a, 'daytona', 'failed', `Recalculation failed: ${errMessage(err)}`, Date.now() - started);
    await deps.persist(a).catch(() => undefined);
    throw upstreamFailure('daytona', `Sandbox recalculation failed: ${errMessage(err)}`);
  } finally {
    recalculating.delete(a.id);
  }
}

/** Marks a roadmap skill complete or incomplete. */
export async function setSkillCompleted(
  analysisId: string,
  skillId: string,
  completed: boolean,
  deps: Pick<PipelineDeps, 'persist'> = defaultDeps,
): Promise<CareerAnalysis> {
  const a = await getAnalysis(analysisId);
  if (!a) throw notFound(`Analysis ${analysisId}`);
  const valid = a.graph?.learningOrder.some((s) => s.skill.id === skillId);
  if (!valid) throw notFound(`Roadmap item ${skillId}`);
  const set = new Set(a.completedSkillIds);
  if (completed) set.add(skillId);
  else set.delete(skillId);
  a.completedSkillIds = [...set];
  a.persistedTo = await deps.persist(a);
  return a;
}
