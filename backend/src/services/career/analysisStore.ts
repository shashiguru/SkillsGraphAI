import { isNeo4jConfigured } from '../../config/env.js';
import { readRows, writeRows } from '../neo4j/driver.js';
import { logger } from '../../utils/logger.js';
import type { AnalysisListItem, CareerAnalysis } from '../../types/career.js';

const MAX_IN_MEMORY = 50;
const memory = new Map<string, CareerAnalysis>();

export const toListItem = (a: CareerAnalysis): AnalysisListItem => ({
  id: a.id,
  createdAt: a.createdAt,
  mode: a.mode,
  status: a.status,
  targetRoleName: a.targetRoleName,
  matchPercentage: a.summary?.matchPercentage ?? null,
  gapSkillCount: a.summary?.gapSkillCount ?? null,
  estimatedHours: a.computation?.estimatedLearningHours ?? null,
});

/** Registers (or refreshes) the in-memory copy. Used for running analyses so polling sees live progress. */
export function remember(analysis: CareerAnalysis): void {
  memory.set(analysis.id, analysis);
  if (memory.size > MAX_IN_MEMORY) {
    const oldest = [...memory.values()]
      .filter((a) => a.status !== 'running')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) memory.delete(oldest.id);
  }
}

let constraintReady = false;
async function ensureConstraint() {
  if (constraintReady) return;
  await writeRows('CREATE CONSTRAINT analysis_id IF NOT EXISTS FOR (a:Analysis) REQUIRE a.analysis_id IS UNIQUE');
  constraintReady = true;
}

/**
 * Persists a finished analysis. Live analyses go to Neo4j as an `Analysis` node linked to the User
 * (the full result is stored as JSON). If Neo4j is unavailable the in-memory copy is kept and the
 * result is reported honestly as `memory`. Demo analyses are never written to the user's graph.
 */
export async function persist(analysis: CareerAnalysis): Promise<'neo4j' | 'memory'> {
  remember(analysis);
  if (analysis.mode === 'demo' || !isNeo4jConfigured()) return 'memory';
  try {
    await ensureConstraint();
    await writeRows(
      `MERGE (a:Analysis {analysis_id: $id})
       SET a.created_at = $createdAt, a.status = $status, a.mode = $mode, a.target_role = $targetRole,
           a.match_percentage = $matchPercentage, a.updated_at = datetime(), a.payload = $payload
       WITH a
       MATCH (u:User {user_id: $userId})
       MERGE (u)-[:HAS_ANALYSIS]->(a)`,
      {
        id: analysis.id,
        userId: analysis.userId,
        createdAt: analysis.createdAt,
        status: analysis.status,
        mode: analysis.mode,
        targetRole: analysis.targetRoleName,
        matchPercentage: analysis.summary?.matchPercentage ?? null,
        payload: JSON.stringify({ ...analysis, persistedTo: 'neo4j' }),
      },
    );
    return 'neo4j';
  } catch (err) {
    logger.error({ err }, 'Failed to persist analysis to Neo4j; keeping in-memory copy');
    return 'memory';
  }
}

export async function getAnalysis(id: string): Promise<CareerAnalysis | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  if (!isNeo4jConfigured()) return null;
  try {
    const rows = await readRows<{ payload: string }>(`MATCH (a:Analysis {analysis_id: $id}) RETURN a.payload AS payload`, { id });
    if (!rows.length) return null;
    const analysis = JSON.parse(rows[0].payload) as CareerAnalysis;
    remember(analysis);
    return analysis;
  } catch (err) {
    logger.error({ err }, 'Failed to read analysis from Neo4j');
    return null;
  }
}

export async function listAnalyses(userId: string, limit = 20): Promise<AnalysisListItem[]> {
  const items = new Map<string, AnalysisListItem>();
  for (const a of memory.values()) if (a.userId === userId || a.mode === 'demo') items.set(a.id, toListItem(a));
  if (isNeo4jConfigured()) {
    try {
      const rows = await readRows<{ payload: string }>(
        `MATCH (:User {user_id: $userId})-[:HAS_ANALYSIS]->(a:Analysis)
         RETURN a.payload AS payload ORDER BY a.created_at DESC LIMIT toInteger($limit)`,
        { userId, limit },
      );
      for (const r of rows) {
        const a = JSON.parse(r.payload) as CareerAnalysis;
        if (!items.has(a.id)) items.set(a.id, toListItem(a));
      }
    } catch (err) {
      logger.error({ err }, 'Failed to list analyses from Neo4j');
    }
  }
  return [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Test helper. */
export function clearMemoryStore(): void {
  memory.clear();
}
