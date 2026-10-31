import type { AnalysisInput } from '../../src/schemas/analysis.js';

/** Mirrors the Alex -> AI Engineer graph facts (ids from the starter dataset). Used for algorithm tests only. */
export const aiEngineerInput: AnalysisInput = {
  targetRole: 'AI Engineer',
  requiredSkills: [
    { id: 'SK002', name: 'Python', importance: 'Required', level: 'Beginner' },
    { id: 'SK012', name: 'Generative AI', importance: 'Required', level: 'Intermediate' },
    { id: 'SK013', name: 'LLM Application Development', importance: 'Required', level: 'Advanced' },
    { id: 'SK014', name: 'Prompt Engineering', importance: 'Required', level: 'Beginner' },
    { id: 'SK017', name: 'API Development', importance: 'Required', level: 'Intermediate' },
    { id: 'SK031', name: 'Model Evaluation', importance: 'Recommended', level: 'Intermediate' },
  ],
  missingSkills: [
    { id: 'SK002', name: 'Python', importance: 'Required', level: 'Beginner' },
    { id: 'SK012', name: 'Generative AI', importance: 'Required', level: 'Intermediate' },
    { id: 'SK013', name: 'LLM Application Development', importance: 'Required', level: 'Advanced' },
    { id: 'SK014', name: 'Prompt Engineering', importance: 'Required', level: 'Beginner' },
    { id: 'SK031', name: 'Model Evaluation', importance: 'Recommended', level: 'Intermediate' },
  ],
  gapSkills: [
    { id: 'SK002', name: 'Python', level: 'Beginner', category: 'Programming', kind: 'missing' },
    { id: 'SK008', name: 'Statistics', level: 'Intermediate', category: 'Data', kind: 'prerequisite' },
    { id: 'SK010', name: 'Machine Learning', level: 'Advanced', category: 'AI/ML', kind: 'prerequisite' },
    { id: 'SK012', name: 'Generative AI', level: 'Intermediate', category: 'AI/ML', kind: 'missing' },
    { id: 'SK013', name: 'LLM Application Development', level: 'Advanced', category: 'AI/ML', kind: 'missing' },
    { id: 'SK014', name: 'Prompt Engineering', level: 'Beginner', category: 'AI/ML', kind: 'missing' },
    { id: 'SK031', name: 'Model Evaluation', level: 'Intermediate', category: 'AI/ML', kind: 'missing' },
  ],
  prerequisites: [
    { from: 'SK002', to: 'SK010' },
    { from: 'SK008', to: 'SK010' },
    { from: 'SK010', to: 'SK012' },
    { from: 'SK012', to: 'SK013' },
    { from: 'SK014', to: 'SK013' },
    { from: 'SK013', to: 'SK031' },
    { from: 'SK010', to: 'SK031' },
  ],
  courses: [
    { id: 'C001', name: 'Python for Developers', level: 'Beginner', estimatedHours: 8, teachesSkillIds: ['SK002'] },
    { id: 'C002', name: 'Statistics Essentials', level: 'Intermediate', estimatedHours: 12, teachesSkillIds: ['SK008'] },
    { id: 'C003', name: 'Machine Learning Foundations', level: 'Intermediate', estimatedHours: 30, teachesSkillIds: ['SK010', 'SK008'] },
    { id: 'C004', name: 'Generative AI Fundamentals', level: 'Intermediate', estimatedHours: 12, teachesSkillIds: ['SK012', 'SK014'] },
    { id: 'C005', name: 'Build LLM Applications', level: 'Intermediate', estimatedHours: 20, teachesSkillIds: ['SK013'] },
  ],
  learningHoursPerWeek: 8,
};
