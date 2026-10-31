import { isNeo4jConfigured } from '../config/env.js';
import { closeDriver, checkHealth } from '../services/neo4j/driver.js';
import { expectedCounts, loadDataset } from '../services/neo4j/dataset.js';
import { compareCounts, getDatasetImportStatus, getGraphCounts } from '../services/neo4j/graphStats.js';

async function main() {
  const dataset = loadDataset();
  const expected = expectedCounts(dataset);
  console.log('Expected from dataset files:', JSON.stringify(expected));
  if (!isNeo4jConfigured()) {
    console.error('Neo4j is not configured; cannot validate the database.');
    process.exitCode = 1;
    return;
  }
  const health = await checkHealth();
  if (!health.connected) {
    console.error(`Cannot connect to Neo4j: ${health.error}`);
    process.exitCode = 1;
    return;
  }
  const [counts, importStatus] = await Promise.all([getGraphCounts(), getDatasetImportStatus()]);
  console.log('Import status:', importStatus);
  console.log('Actual nodes:', counts.nodes);
  console.log('Actual relationships:', counts.relationships);
  const mismatches = compareCounts(expected, counts);
  if (mismatches.length) {
    console.error('VALIDATION FAILED:', mismatches);
    process.exitCode = 1;
  } else {
    console.log('VALIDATION PASSED: node and relationship counts match the dataset.');
  }
}

main()
  .catch((err) => {
    console.error('Validation error:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDriver());
