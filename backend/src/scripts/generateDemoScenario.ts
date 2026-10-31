import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDataset } from '../services/neo4j/dataset.js';
import { buildOfflineAnalysis } from '../services/career/offlineGraph.js';
import { classifyGraph } from '../services/career/graphAnalysis.js';
import { buildAnalysisInput } from '../services/daytona/analysisInput.js';
import { parseSandboxOutput, renderTemplate } from '../services/daytona/sandboxRunner.js';
import { CareerInsightSchema, type CareerInsightResult } from '../schemas/careerInsight.js';
import { enforceGraphEntities } from '../agents/careerAdvisorAgent.js';
import { DEMO_FIXTURE_PATH, summarize } from '../services/career/careerAnalysisService.js';
import type { CareerAnalysis } from '../types/career.js';

/**
 * Generates backend/src/services/career/demoScenario.json for the labelled "Demo mode".
 *  - Graph facts: computed from the CSV dataset with an in-memory replica of the Cypher queries.
 *  - Computation: the real trusted analysis.py, executed locally (NOT in Daytona).
 *  - AI explanation: authored text, validated against the graph allow-list (NOT live Nosana inference).
 * The result is always loaded with mode "demo" and never presented as a live run.
 */

const ALEX_SKILLS = ['C#', 'Angular', 'TypeScript', 'SQL', 'Azure', 'API Development', 'Docker'];

const insightText = {
  careerSummary:
    'Alex has nine years of full stack experience and already covers the API side of the AI Engineer role. The gap is the machine learning and generative AI stack: Python, Machine Learning, Generative AI, Prompt Engineering, LLM Application Development and Model Evaluation. The graph shows these form one connected chain, so the path is clear and achievable.',
  targetRole: 'AI Engineer',
  strengths: [
    { skill: 'API Development', reason: 'Required by the AI Engineer role and already in your skill set, so you can expose models as services from day one.' },
    { skill: 'TypeScript', reason: 'Strong typed-language background makes Python and structured LLM output handling quicker to pick up.' },
    { skill: 'Azure', reason: 'Cloud deployment experience carries over to hosting and operating AI services.' },
    { skill: 'SQL', reason: 'Data querying experience helps with the Statistics and Machine Learning foundations.' },
  ],
  skillExplanations: [
    { skill: 'Python', reason: 'Required for the role and a prerequisite of Machine Learning in the graph.', priority: 'high' },
    { skill: 'Statistics', reason: 'A prerequisite of Machine Learning that you do not yet have.', priority: 'medium' },
    { skill: 'Machine Learning', reason: 'The bridge skill: Generative AI and Model Evaluation both depend on it in the graph.', priority: 'high' },
    { skill: 'Generative AI', reason: 'Required for the role and a prerequisite of LLM Application Development.', priority: 'high' },
    { skill: 'Prompt Engineering', reason: 'Required for the role, quick to learn and a direct prerequisite of LLM Application Development.', priority: 'medium' },
    { skill: 'LLM Application Development', reason: 'The core capability of the AI Engineer role, building on Generative AI and Prompt Engineering.', priority: 'high' },
    { skill: 'Model Evaluation', reason: 'Recommended for the role and depends on both LLM Application Development and Machine Learning.', priority: 'low' },
  ],
  learningPriorities: [
    { skill: 'Prompt Engineering', rationale: 'Short course with immediate payoff and no prerequisites.', course: 'Prompt Engineering Workshop' },
    { skill: 'Python', rationale: 'Unlocks Machine Learning; your existing programming background makes this fast.', course: 'Python for Developers' },
    { skill: 'Statistics', rationale: 'Needed alongside Python before Machine Learning.', course: 'Practical Statistics' },
    { skill: 'Machine Learning', rationale: 'Central dependency for the generative AI skills that follow.', course: 'Machine Learning Foundations' },
    { skill: 'Generative AI', rationale: 'Builds directly on Machine Learning.', course: 'Generative AI Fundamentals' },
    { skill: 'LLM Application Development', rationale: 'The role-defining skill, learnt once its prerequisites are in place.', course: 'Build LLM Applications' },
    { skill: 'Model Evaluation', rationale: 'Last step: it depends on the skills before it.', course: 'MLOps in Practice' },
  ],
  sequenceExplanation:
    'The order follows prerequisite relationships in the graph: Python and Statistics lead to Machine Learning, which leads to Generative AI. Prompt Engineering and Generative AI both lead to LLM Application Development, which comes before Model Evaluation.',
  certificationAdvice: [
    { certification: 'Databricks Generative AI Engineer Associate', reason: 'Validates the generative AI skills at the end of this path.' },
    { certification: 'Azure Developer Associate', reason: 'Already validates your Azure and API Development experience.' },
  ],
  careerAdvice: [
    'Start with Prompt Engineering and Python in parallel; both have no unmet prerequisites.',
    'Reuse your API Development strength by wrapping each project in a small service.',
    'Treat the Machine Learning step as the main milestone: it unlocks most of the remaining skills.',
  ],
  roadmapSummary:
    'Foundations first (Python, Statistics, Prompt Engineering), then Machine Learning and Generative AI, then LLM Application Development and Model Evaluation.',
  phaseDescriptions: {
    foundations: 'Python, Statistics and Prompt Engineering have no unmet prerequisites and can start immediately.',
    core: 'Machine Learning is the central step that the generative AI skills depend on.',
    advanced: 'Generative AI and LLM Application Development build on the core.',
    practical: 'Model Evaluation closes the loop by measuring the applications you build.',
  },
};

function main() {
  const ds = loadDataset();
  const { analysis, graph } = buildOfflineAnalysis(ds, {
    userId: 'demo-user',
    userName: 'Alex',
    userSkillNames: ALEX_SKILLS,
    targetRoleName: 'AI Engineer',
    currentRoleName: 'Full Stack Developer',
  });
  const cytoscape = classifyGraph(graph, analysis);

  // Run the real analysis.py locally.
  const input = buildAnalysisInput(analysis, 8);
  const file = path.join(os.tmpdir(), `skillgraph-demo-${process.pid}.py`);
  fs.writeFileSync(file, renderTemplate(input));
  let output: ReturnType<typeof parseSandboxOutput>;
  try {
    const bin = ['python', 'python3', 'py'].find((b) => spawnSync(b, ['--version']).status === 0);
    if (!bin) throw new Error('Python is required to generate the demo scenario');
    const run = spawnSync(bin, [file], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`analysis.py failed: ${run.stderr}`);
    output = parseSandboxOutput(run.stdout);
  } finally {
    fs.rmSync(file, { force: true });
  }
  if ('failure' in output) throw new Error(output.failure);

  const { insight, dropped } = enforceGraphEntities(CareerInsightSchema.parse(insightText), analysis);
  if (dropped.length) throw new Error(`Demo insight mentions entities not in the graph: ${JSON.stringify(dropped)}`);
  const insightResult: CareerInsightResult = {
    insight,
    model: 'demo-fixture',
    durationMs: 0,
    attempts: 0,
    droppedEntities: [],
    repaired: false,
  };

  const now = new Date(0).toISOString();
  const demo: CareerAnalysis = {
    id: 'demo-template',
    userId: 'demo-user',
    createdAt: now,
    mode: 'demo',
    status: 'completed',
    profile: {
      name: 'Alex',
      currentRole: 'Full Stack Developer',
      yearsExperience: 9,
      industry: 'Software',
      learningHoursPerWeek: 8,
      skills: ALEX_SKILLS,
    },
    targetRoleId: analysis.targetRole.id,
    targetRoleName: analysis.targetRole.name,
    learningHoursPerWeek: 8,
    steps: {
      neo4j: { id: 'neo4j', label: 'Neo4j graph analysis', status: 'demo', detail: 'Computed offline from the starter dataset CSVs' },
      nosana: { id: 'nosana', label: 'Nosana AI reasoning', status: 'demo', detail: 'Fixture text validated against the graph' },
      daytona: { id: 'daytona', label: 'Daytona sandbox computation', status: 'demo', detail: 'analysis.py executed locally, not in Daytona' },
      compose: { id: 'compose', label: 'Compose career analysis', status: 'demo' },
      persist: { id: 'persist', label: 'Persist result', status: 'skipped', error: 'Demo analyses are kept in memory only' },
    },
    events: [],
    graph: analysis,
    cytoscape,
    summary: summarize(analysis),
    insight: insightResult,
    computation: { ...output.output, python: output.output.python ?? 'local' },
    completedSkillIds: [],
    persistedTo: 'memory',
  };

  fs.writeFileSync(DEMO_FIXTURE_PATH, JSON.stringify(demo, null, 2) + '\n');
  console.log(`Wrote ${DEMO_FIXTURE_PATH}`);
  console.log(
    `${demo.summary!.matchedSkillCount}/${demo.summary!.requiredSkillCount} matched, ${demo.summary!.gapSkillCount} to learn, ` +
      `${output.output.estimatedLearningHours} h, ${output.output.estimatedWeeks} weeks at 8 h/week`,
  );
}

main();
