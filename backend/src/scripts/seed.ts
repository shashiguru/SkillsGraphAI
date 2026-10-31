import { isNeo4jConfigured } from '../config/env.js';
import { closeDriver, checkHealth } from '../services/neo4j/driver.js';
import { seedDataset } from '../services/neo4j/seed.js';
import { compareCounts, getGraphCounts } from '../services/neo4j/graphStats.js';

async function main() {
  if (!isNeo4jConfigured()) {
    console.error('Neo4j is not configured. Set NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD in backend/.env');
    process.exitCode = 1;
    return;
  }
  const health = await checkHealth();
  if (!health.connected) {
    console.error(`Cannot connect to Neo4j: ${health.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Connected to Neo4j (${health.serverVersion}) in ${health.latencyMs}ms. Seeding...`);
  const report = await seedDataset();
  const counts = await getGraphCounts();
  const mismatches = compareCounts(report.expected, counts);
  console.log(`Seed finished in ${report.durationMs}ms (dataset hash ${report.datasetHash}).`);
  console.log('Nodes:', counts.nodes);
  console.log('Relationships:', counts.relationships);
  if (report.unresolvedCertificationSkills.length) {
    console.warn('Unresolved certification skills:', report.unresolvedCertificationSkills);
  }
  if (mismatches.length) {
    console.error('Count mismatches after seeding:', mismatches);
    process.exitCode = 1;
  } else {
    console.log('Counts match the dataset files.');
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDriver());
