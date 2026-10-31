// Shapes returned by the backend. Kept in sync by hand with backend/src/types and backend/src/schemas.

export interface SkillRef {
  id: string;
  name: string;
  category: string;
  level: string;
  elementId?: string;
}
export interface SkillListItem extends SkillRef {
  requiredByRoleCount: number;
}
export interface RequiredSkill extends SkillRef {
  importance: string;
  proficiencyRequired: string;
  proficiencyDerived: boolean;
}
export interface RoleRef {
  id: string;
  name: string;
  description: string;
  seniority: string;
}
export interface RoleCard extends RoleRef {
  family: string;
  requiredSkillCount: number;
  matchedSkillCount: number;
  matchPercentage: number;
  missingSkills: string[];
  relatedRoles: string[];
}
export interface RoleDetail extends RoleRef {
  requiredSkills: RequiredSkill[];
  relatedRoles: { id: string; name: string; relationshipType: string | null; direction: string }[];
}

export interface ProfileSkill {
  skillId: string;
  name: string;
  category: string;
  proficiencyLevel: string | null;
  yearsExperience: number | null;
}
export interface Profile {
  userId: string;
  name: string;
  currentRole: string;
  yearsExperience: number;
  industry: string;
  technicalSkills: ProfileSkill[];
  unmappedSkills: string[];
  softSkills: string[];
  targetRoleId: string | null;
  learningHoursPerWeek: number;
  updatedAt: string | null;
}
export interface ProfileSummary {
  userId: string;
  name: string;
  currentRole: string;
  targetRoleId: string | null;
  skillCount: number;
  updatedAt: string | null;
}
export interface ProfileInput {
  name: string;
  currentRole: string;
  yearsExperience: number;
  industry: string;
  technicalSkills: { skillId?: string; name: string; proficiencyLevel?: string }[];
  softSkills: string[];
  targetRoleId?: string;
  learningHoursPerWeek: number;
}

// ---- analysis -------------------------------------------------------------------------------

export type StepId = 'neo4j' | 'nosana' | 'daytona' | 'compose' | 'persist';
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

export interface PrerequisiteEdge {
  id: string;
  prerequisiteId: string;
  prerequisiteName: string;
  targetId: string;
  targetName: string;
}
export interface LearningStep {
  skill: SkillRef & { userHas: boolean; implied: boolean };
  order: number;
  depth: number;
  prerequisiteIds: string[];
  inCycle: boolean;
}
export interface CourseRef {
  id: string;
  name: string;
  level: string;
  estimatedHours: number;
  teachesSkillNames: string[];
  teachesSkillIds: string[];
}
export interface CertificationRef {
  id: string;
  name: string;
  validatesSkillNames: string[];
  relevance: 'closes_gap' | 'validates_existing';
}
export interface RoleMatchSummary extends RoleRef {
  requiredSkillCount: number;
  matchedSkillCount: number;
  matchPercentage: number;
  missingSkills: string[];
  relatedRoles: string[];
  sharedSkillCountWithTarget?: number;
  connection?: string[];
}
export interface GraphPath {
  kind: 'direct' | 'bridge';
  skillNames: string[];
  length: number;
  description: string;
}
export interface GraphAnalysis {
  userId: string;
  targetRole: RoleRef;
  matchedSkills: RequiredSkill[];
  missingSkills: RequiredSkill[];
  prerequisiteGapSkills: SkillRef[];
  prerequisites: PrerequisiteEdge[];
  learningOrder: LearningStep[];
  recommendedCourses: CourseRef[];
  certifications: CertificationRef[];
  relatedRoles: (RoleRef & { relationshipType: string | null })[];
  alternativeRoles: RoleMatchSummary[];
  graphPaths: GraphPath[];
  userSkills: SkillRef[];
  skillsWithoutCourse: string[];
}

export interface CytoNode {
  id: string;
  entityId: string;
  type: 'User' | 'Skill' | 'Role' | 'Course';
  label: string;
  status?: 'existing' | 'missing' | 'prerequisite' | 'implied' | 'target' | 'course' | 'user';
  properties: Record<string, unknown>;
}
export interface CytoEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}
export interface CareerGraph {
  nodes: CytoNode[];
  edges: CytoEdge[];
}

export interface CareerInsight {
  careerSummary: string;
  targetRole: string;
  strengths: { skill: string; reason: string }[];
  skillExplanations: { skill: string; reason: string; priority: 'high' | 'medium' | 'low' }[];
  learningPriorities: { skill: string; rationale: string; course?: string | null }[];
  sequenceExplanation: string;
  certificationAdvice: { certification: string; reason: string }[];
  careerAdvice: string[];
  roadmapSummary: string;
  phaseDescriptions: { foundations: string; core: string; advanced: string; practical: string };
}
export interface CareerInsightResult {
  insight: CareerInsight;
  model: string;
  durationMs: number;
  attempts: number;
  droppedEntities: { field: string; value: string }[];
  repaired: boolean;
}

export interface RoadmapItem {
  order: number;
  skillId: string;
  skill: string;
  category?: string | null;
  level?: string | null;
  kind?: string | null;
  phase: number;
  phaseName: string;
  priorityScore: number;
  priority: 'high' | 'medium' | 'low';
  hours: number;
  hoursSource: 'course' | 'level-default-estimate';
  courseId: string | null;
  course: string | null;
  prerequisites: string[];
  inCycle: boolean;
}
export interface WeeklyScheduleWeek {
  week: number;
  hours: number;
  items: { unitId: string; label: string; course: string | null; skills: string[]; hours: number; phase: number }[];
}
export interface AnalysisOutput {
  matchPercentage: number;
  weightedMatchPercentage: number;
  requiredSkillCount: number;
  matchedSkillCount: number;
  missingSkillCount: number;
  gapSkillCount: number;
  estimatedLearningHours: number;
  estimatedWeeks: number;
  learningHoursPerWeek: number;
  estimatedHoursFromCourses: number;
  estimatedHoursFromDefaults: number;
  prioritySkills: { skillId: string; skill: string; score: number; priority: 'high' | 'medium' | 'low'; kind?: string | null }[];
  roadmap: RoadmapItem[];
  phases: { phase: number; name: string; skills: string[]; hours: number }[];
  weeklySchedule: WeeklyScheduleWeek[];
  validation: { valid: boolean; checkedEdges: number; violations: { prerequisite: string; dependent: string }[] };
}
export interface ExecutionRecord {
  executionId: string;
  status: 'completed' | 'failed' | 'timeout';
  sandboxId: string | null;
  startedAt: string;
  durationMs: number;
  phases: { createMs?: number; prepareMs?: number; executeMs?: number; cleanupMs?: number };
  exitCode: number | null;
  pythonVersion: string | null;
  networkIsolated: boolean;
  logs: { at: string; source: 'backend' | 'sandbox'; message: string }[];
  cleanedUp: boolean;
  error?: string;
}
export interface AnalysisSummary {
  requiredSkillCount: number;
  matchedSkillCount: number;
  missingSkillCount: number;
  gapSkillCount: number;
  matchPercentage: number;
}
export interface CareerAnalysis {
  id: string;
  createdAt: string;
  completedAt?: string;
  mode: AnalysisMode;
  status: AnalysisStatus;
  error?: string;
  profile: { name: string; currentRole: string; yearsExperience: number; industry: string; learningHoursPerWeek: number; skills: string[] };
  targetRoleId: string;
  targetRoleName: string;
  learningHoursPerWeek: number;
  steps: Record<StepId, StepState>;
  events: AnalysisEvent[];
  graph?: GraphAnalysis;
  cytoscape?: CareerGraph;
  summary?: AnalysisSummary;
  insight?: CareerInsightResult;
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
export interface RoadmapView {
  analysisId: string;
  mode: AnalysisMode;
  targetRoleName: string;
  learningHoursPerWeek: number;
  computation: 'daytona' | 'demo' | 'unavailable';
  computationNote?: string;
  items: (RoadmapItem & { completed: boolean })[];
  graphOrder: { order: number; skillId: string; skill: string; kind: 'missing' | 'prerequisite'; depth: number; completed: boolean }[];
  phases: { phase: number; name: string; skills: string[]; hours: number }[];
  weeklySchedule: WeeklyScheduleWeek[];
  totals: { hours: number; weeks: number; skills: number; completedSkills: number; progressPercent: number } | null;
  completedSkillIds: string[];
}
export interface DashboardSummary {
  hasAnalysis: boolean;
  latest: null | {
    id: string;
    mode: AnalysisMode;
    status: AnalysisStatus;
    createdAt: string;
    targetRoleName: string;
    currentRole: string;
    userName: string;
    summary: AnalysisSummary;
    estimatedHours: number | null;
    estimatedWeeks: number | null;
    progressPercent: number;
    topMissingSkills: string[];
    steps: Record<StepId, StepState>;
    hasInsight: boolean;
  };
  recent: AnalysisListItem[];
}

// ---- integrations ---------------------------------------------------------------------------

export interface Neo4jStatus {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  serverVersion?: string;
  error?: string;
  counts?: { nodes: Record<string, number>; relationships: Record<string, number> };
  datasetImport?: unknown;
  lastSuccessfulQueryAt: string | null;
  lastError: { message: string; at: string } | null;
}
export interface NosanaModel {
  id: string;
  name?: string;
  description?: string;
  available?: boolean;
  context_length?: number;
}
export interface NosanaStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string;
  latencyMs?: number;
  error?: string;
  errorKind?: string;
  models: NosanaModel[];
  selectedModel?: string;
  configuredModel?: string;
  configuredModelUnavailable?: string;
  lastInference?: {
    status: 'success' | 'failed';
    at: string;
    model?: string;
    durationMs?: number;
    attempts?: number;
    usage?: { total_tokens?: number };
    error?: { kind: string; message: string };
  };
}
export interface DaytonaStatus {
  configured: boolean;
  connected: boolean;
  apiUrl: string;
  latencyMs?: number;
  error?: string;
  lastExecution: ExecutionRecord | null;
  recentExecutions: { executionId: string; status: string; sandboxId: string | null; startedAt: string; durationMs: number; cleanedUp: boolean; error?: string }[];
}
export interface IntegrationsStatus {
  checkedAt: string;
  neo4j: Neo4jStatus;
  nosana: NosanaStatus;
  daytona: DaytonaStatus;
}
