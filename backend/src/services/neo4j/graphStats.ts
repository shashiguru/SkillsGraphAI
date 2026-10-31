import { readRows } from './driver.js';
import { IMPORT_ID } from './seed.js';
import type { ExpectedCounts } from './dataset.js';

export interface GraphCounts {
  nodes: Record<string, number>;
  relationships: Record<string, number>;
}

export async function getGraphCounts(): Promise<GraphCounts> {
  const nodeRows = await readRows<{ label: string; count: number }>(
    `MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY label`,
  );
  const relRows = await readRows<{ type: string; count: number }>(
    `MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY type`,
  );
  return {
    nodes: Object.fromEntries(nodeRows.map((r) => [r.label, r.count])),
    relationships: Object.fromEntries(relRows.map((r) => [r.type, r.count])),
  };
}

export interface DatasetImportStatus {
  imported: boolean;
  importedAt?: string;
  datasetHash?: string;
  importRuns?: number;
}

export async function getDatasetImportStatus(): Promise<DatasetImportStatus> {
  const rows = await readRows<{ importedAt: string | null; hash: string; runs: number }>(
    `MATCH (i:DatasetImport {import_id: $id})
     RETURN toString(i.imported_at) AS importedAt, i.dataset_hash AS hash, i.import_runs AS runs`,
    { id: IMPORT_ID },
  );
  if (!rows.length) return { imported: false };
  return { imported: true, importedAt: rows[0].importedAt ?? undefined, datasetHash: rows[0].hash, importRuns: rows[0].runs };
}

export interface CountMismatch {
  kind: 'node' | 'relationship';
  name: string;
  expected: number;
  actual: number;
}

export function compareCounts(expected: ExpectedCounts, actual: GraphCounts): CountMismatch[] {
  const out: CountMismatch[] = [];
  for (const [name, exp] of Object.entries(expected.nodes)) {
    const act = actual.nodes[name] ?? 0;
    if (act !== exp) out.push({ kind: 'node', name, expected: exp, actual: act });
  }
  for (const [name, exp] of Object.entries(expected.relationships)) {
    const act = actual.relationships[name] ?? 0;
    if (act !== exp) out.push({ kind: 'relationship', name, expected: exp, actual: act });
  }
  return out;
}
