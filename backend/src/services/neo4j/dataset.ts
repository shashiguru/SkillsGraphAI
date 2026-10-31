import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { REPO_ROOT } from '../../config/env.js';

export const DATASET_DIR = path.join(REPO_ROOT, 'dataset');

function readCsv<T extends Record<string, string>>(file: string, dir = DATASET_DIR): T[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) throw new Error(`Dataset file missing: ${full}`);
  return parse(fs.readFileSync(full, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as T[];
}

export interface Dataset {
  skills: { skill_id: string; name: string; category: string; level: string }[];
  roles: { role_id: string; name: string; description: string; seniority: string }[];
  courses: { course_id: string; name: string; description: string; level: string; estimated_hours: string }[];
  certifications: { cert_id: string; name: string; validates_skills: string }[];
  roleRequiresSkill: { role_id: string; skill_id: string; importance: string }[];
  skillPrerequisites: { prerequisite_skill_id: string; target_skill_id: string }[];
  courseTeachesSkill: { course_id: string; skill_id: string }[];
  certificationValidatesSkill: { cert_id: string; skill_name: string }[];
  roleRelatedTo: { role_id: string; related_role_id: string; relationship_type: string }[];
}

export function loadDataset(dir = DATASET_DIR): Dataset {
  return {
    skills: readCsv('skills.csv', dir),
    roles: readCsv('roles.csv', dir),
    courses: readCsv('courses.csv', dir),
    certifications: readCsv('certifications.csv', dir),
    roleRequiresSkill: readCsv('role_requires_skill.csv', dir),
    skillPrerequisites: readCsv('skill_prerequisites.csv', dir),
    courseTeachesSkill: readCsv('course_teaches_skill.csv', dir),
    certificationValidatesSkill: readCsv('certification_validates_skill.csv', dir),
    roleRelatedTo: readCsv('role_related_to.csv', dir),
  };
}

/** Distinct (a,b) pairs, since the graph uses MERGE and collapses duplicate rows. */
const distinctPairs = (pairs: string[][]) => new Set(pairs.map((p) => p.join('\u0000'))).size;

export interface ExpectedCounts {
  nodes: { Skill: number; Role: number; Course: number; Certification: number };
  relationships: {
    REQUIRES_SKILL: number;
    PREREQUISITE_FOR: number;
    TEACHES: number;
    VALIDATES: number;
    RELATED_TO: number;
  };
}

export function expectedCounts(ds: Dataset): ExpectedCounts {
  return {
    nodes: {
      Skill: new Set(ds.skills.map((s) => s.skill_id)).size,
      Role: new Set(ds.roles.map((s) => s.role_id)).size,
      Course: new Set(ds.courses.map((s) => s.course_id)).size,
      Certification: new Set(ds.certifications.map((s) => s.cert_id)).size,
    },
    relationships: {
      REQUIRES_SKILL: distinctPairs(ds.roleRequiresSkill.map((r) => [r.role_id, r.skill_id])),
      PREREQUISITE_FOR: distinctPairs(ds.skillPrerequisites.map((r) => [r.prerequisite_skill_id, r.target_skill_id])),
      TEACHES: distinctPairs(ds.courseTeachesSkill.map((r) => [r.course_id, r.skill_id])),
      VALIDATES: distinctPairs(ds.certificationValidatesSkill.map((r) => [r.cert_id, r.skill_name])),
      RELATED_TO: distinctPairs(ds.roleRelatedTo.map((r) => [r.role_id, r.related_role_id])),
    },
  };
}
