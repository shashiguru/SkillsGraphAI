import crypto from 'node:crypto';
import { loadDataset, expectedCounts, type Dataset } from './dataset.js';
import { writeRows } from './driver.js';
import { logger } from '../../utils/logger.js';

export const CONSTRAINTS = [
  'CREATE CONSTRAINT skill_id IF NOT EXISTS FOR (n:Skill) REQUIRE n.skill_id IS UNIQUE',
  'CREATE CONSTRAINT role_id IF NOT EXISTS FOR (n:Role) REQUIRE n.role_id IS UNIQUE',
  'CREATE CONSTRAINT course_id IF NOT EXISTS FOR (n:Course) REQUIRE n.course_id IS UNIQUE',
  'CREATE CONSTRAINT cert_id IF NOT EXISTS FOR (n:Certification) REQUIRE n.cert_id IS UNIQUE',
  'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (n:User) REQUIRE n.user_id IS UNIQUE',
  'CREATE CONSTRAINT analysis_id IF NOT EXISTS FOR (n:Analysis) REQUIRE n.analysis_id IS UNIQUE',
  'CREATE CONSTRAINT dataset_import_id IF NOT EXISTS FOR (n:DatasetImport) REQUIRE n.import_id IS UNIQUE',
];

export const INDEXES = [
  'CREATE INDEX skill_name IF NOT EXISTS FOR (n:Skill) ON (n.name)',
  'CREATE INDEX skill_category IF NOT EXISTS FOR (n:Skill) ON (n.category)',
  'CREATE INDEX role_name IF NOT EXISTS FOR (n:Role) ON (n.name)',
  'CREATE INDEX course_name IF NOT EXISTS FOR (n:Course) ON (n.name)',
];

export const IMPORT_ID = 'skillgraph-starter-dataset';

export interface SeedReport {
  datasetHash: string;
  durationMs: number;
  unresolvedCertificationSkills: string[];
  expected: ReturnType<typeof expectedCounts>;
}

export async function seedDataset(dataset: Dataset = loadDataset()): Promise<SeedReport> {
  const started = Date.now();

  for (const stmt of [...CONSTRAINTS, ...INDEXES]) await writeRows(stmt);

  await writeRows(
    `UNWIND $rows AS row
     MERGE (s:Skill {skill_id: row.skill_id})
     SET s.name = row.name, s.category = row.category, s.level = row.level`,
    { rows: dataset.skills },
  );

  await writeRows(
    `UNWIND $rows AS row
     MERGE (r:Role {role_id: row.role_id})
     SET r.name = row.name, r.description = row.description, r.seniority = row.seniority`,
    { rows: dataset.roles },
  );

  await writeRows(
    `UNWIND $rows AS row
     MERGE (c:Course {course_id: row.course_id})
     SET c.name = row.name, c.description = row.description, c.level = row.level,
         c.estimated_hours = toInteger(row.estimated_hours)`,
    { rows: dataset.courses },
  );

  await writeRows(
    `UNWIND $rows AS row
     MERGE (c:Certification {cert_id: row.cert_id})
     SET c.name = row.name`,
    { rows: dataset.certifications },
  );

  // proficiency_required is not in the source CSV: it is derived from the skill's own level and flagged as such.
  await writeRows(
    `UNWIND $rows AS row
     MATCH (r:Role {role_id: row.role_id}), (s:Skill {skill_id: row.skill_id})
     MERGE (r)-[rel:REQUIRES_SKILL]->(s)
     SET rel.importance = row.importance,
         rel.proficiency_required = s.level,
         rel.proficiency_derived = true`,
    { rows: dataset.roleRequiresSkill },
  );

  await writeRows(
    `UNWIND $rows AS row
     MATCH (a:Skill {skill_id: row.prerequisite_skill_id}), (b:Skill {skill_id: row.target_skill_id})
     MERGE (a)-[:PREREQUISITE_FOR]->(b)`,
    { rows: dataset.skillPrerequisites },
  );

  await writeRows(
    `UNWIND $rows AS row
     MATCH (c:Course {course_id: row.course_id}), (s:Skill {skill_id: row.skill_id})
     MERGE (c)-[:TEACHES]->(s)`,
    { rows: dataset.courseTeachesSkill },
  );

  // The certification CSV references skills by name: resolve to ids here and report anything unmatched.
  const idByName = new Map(dataset.skills.map((s) => [s.name, s.skill_id]));
  const unresolved: string[] = [];
  const certRows = dataset.certificationValidatesSkill.flatMap((r) => {
    const skillId = idByName.get(r.skill_name);
    if (!skillId) {
      unresolved.push(`${r.cert_id}:${r.skill_name}`);
      return [];
    }
    return [{ cert_id: r.cert_id, skill_id: skillId }];
  });
  await writeRows(
    `UNWIND $rows AS row
     MATCH (c:Certification {cert_id: row.cert_id}), (s:Skill {skill_id: row.skill_id})
     MERGE (c)-[:VALIDATES]->(s)`,
    { rows: certRows },
  );

  await writeRows(
    `UNWIND $rows AS row
     MATCH (a:Role {role_id: row.role_id}), (b:Role {role_id: row.related_role_id})
     MERGE (a)-[rel:RELATED_TO]->(b)
     SET rel.relationship_type = row.relationship_type`,
    { rows: dataset.roleRelatedTo },
  );

  const datasetHash = crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex').slice(0, 16);
  const expected = expectedCounts(dataset);
  await writeRows(
    `MERGE (i:DatasetImport {import_id: $id})
     SET i.imported_at = datetime(), i.dataset_hash = $hash, i.expected_counts_json = $expected,
         i.import_runs = coalesce(i.import_runs, 0) + 1`,
    { id: IMPORT_ID, hash: datasetHash, expected: JSON.stringify(expected) },
  );

  if (unresolved.length) logger.warn({ unresolved }, 'Some certification skill names did not match a Skill node');
  return { datasetHash, durationMs: Date.now() - started, unresolvedCertificationSkills: unresolved, expected };
}
