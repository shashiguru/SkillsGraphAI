import type { CareerGraph, GraphAnalysis } from './graph.js';
import type { CareerInsightResult } from '../schemas/careerInsight.js';
import type { AnalysisOutput } from '../schemas/analysis.js';
import type { SandboxExecution } from '../services/daytona/sandboxRunner.js';

export type StepId = 'neo4j' | 'nosana' | 'daytona' | 'compose' | 'persist';

/**
 * live: really executed against the service. failed: attempted and errored.
 * skipped: not configured or not applicable. demo: taken from the labelled demo fixture.
 */
export type StepStatus = 'pending' | 'running' | 'live' | 'failed' | 'skipped' | 'demo';

export interface StepState {
  id: StepId;
  label: string;
  status: StepStatus;
  startedAt?: string;
  durationMs?: number;
  detail?: string;
  error?: string;
}

export interface AnalysisEvent {
  seq: number;
  at: string;
  step: StepId | 'pipeline';
  status: 'started' | 'succeeded' | 'failed' | 'skipped' | 'info';
  message: string;
  durationMs?: number;
}

export type AnalysisMode = 'live' | 'demo';
export type AnalysisStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface ProfileSnapshot {
  name: string;
  currentRole: string;
  yearsExperience: number;
  industry: string;
  learningHoursPerWeek: number;
  skills: string[];
}

export interface AnalysisSummary {
  requiredSkillCount: number;
  matchedSkillCount: number;
  missingSkillCount: number;
  /** Missing skills plus unsatisfied prerequisites. */
  gapSkillCount: number;
  /** matched / required, read straight from graph facts. */
  matchPercentage: number;
}

export type ExecutionRecord = Pick<
  SandboxExecution,
  'executionId' | 'status' | 'sandboxId' | 'startedAt' | 'durationMs' | 'phases' | 'exitCode' | 'pythonVersion' | 'networkIsolated' | 'logs' | 'cleanedUp' | 'error'
>;

export interface CareerAnalysis {
  id: string;
  userId: string;
  createdAt: string;
  completedAt?: string;
  mode: AnalysisMode;
  status: AnalysisStatus;
  /** Set when the pipeline could not produce a result at all. */
  error?: string;
  profile: ProfileSnapshot;
  targetRoleId: string;
  targetRoleName: string;
  learningHoursPerWeek: number;
  steps: Record<StepId, StepState>;
  events: AnalysisEvent[];
  /** Neo4j facts. Nothing in here is model generated. */
  graph?: GraphAnalysis;
  cytoscape?: CareerGraph;
  summary?: AnalysisSummary;
  /** Nosana result (validated against the graph allow-list). */
  insight?: CareerInsightResult;
  /** Daytona result (numbers computed by the trusted Python template). */
  computation?: AnalysisOutput;
  execution?: ExecutionRecord;
  completedSkillIds: string[];
  persistedTo: 'neo4j' | 'memory' | null;
}

export interface AnalysisListItem {
  id: string;
  createdAt: string;
  mode: AnalysisMode;
  status: AnalysisStatus;
  targetRoleName: string;
  matchPercentage: number | null;
  gapSkillCount: number | null;
  estimatedHours: number | null;
}
