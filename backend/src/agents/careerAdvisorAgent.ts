import { CareerInsightSchema, type CareerInsight, type CareerInsightResult } from '../schemas/careerInsight.js';
import { chatCompletion, NosanaError, resolveModel, type ChatMessage } from '../services/nosana/nosanaClient.js';
import type { GraphAnalysis } from '../types/graph.js';

export interface AdvisorProfile {
  name: string;
  currentRole: string;
  yearsExperience: number;
  learningHoursPerWeek: number;
  industry?: string;
}

/** Only these facts (read from Neo4j) are given to the model, and only these entities may come back. */
export function buildGraphContext(profile: AdvisorProfile, analysis: GraphAnalysis) {
  return {
    user: {
      name: profile.name,
      currentRole: profile.currentRole,
      yearsExperience: profile.yearsExperience,
      industry: profile.industry || undefined,
      learningHoursPerWeek: profile.learningHoursPerWeek,
      currentSkills: analysis.userSkills.map((s) => s.name),
    },
    targetRole: analysis.targetRole.name,
    targetRoleDescription: analysis.targetRole.description,
    matchedSkills: analysis.matchedSkills.map((s) => ({ skill: s.name, importance: s.importance })),
    missingSkills: analysis.missingSkills.map((s) => ({ skill: s.name, importance: s.importance, level: s.level, category: s.category })),
    prerequisiteSkillsToLearnFirst: analysis.prerequisiteGapSkills.map((s) => ({ skill: s.name, level: s.level })),
    prerequisiteRelationships: analysis.prerequisites.map((e) => `${e.prerequisiteName} is a prerequisite for ${e.targetName}`),
    graphLearningOrder: analysis.learningOrder.map((s) => s.skill.name),
    availableCourses: analysis.recommendedCourses.map((c) => ({
      course: c.name,
      level: c.level,
      hours: c.estimatedHours,
      teaches: c.teachesSkillNames,
    })),
    certifications: analysis.certifications.map((c) => ({ certification: c.name, validates: c.validatesSkillNames, relevance: c.relevance })),
    relatedRoles: analysis.relatedRoles.map((r) => r.name),
    skillsWithoutAnyCourse: analysis.skillsWithoutCourse,
  };
}

const SYSTEM_PROMPT = `You are the reasoning layer of SkillGraph AI, a career navigation product.
A Neo4j knowledge graph has already determined the facts. You must explain and personalise them.

STRICT RULES
1. Use ONLY the skills, courses, certifications and roles present in the provided JSON. Never invent or rename any.
2. Do not add skills, prerequisites or courses that are not in the JSON, even if you believe they are useful.
3. "skill" fields must exactly match a skill name from the JSON. "course" must exactly match a course name from the JSON, or be null.
4. Do not invent numbers (hours, percentages, durations). A separate sandbox computes those. You may refer to course hours given in the JSON.
5. Ground every explanation in the user's actual current skills and experience.
6. Respond with a single JSON object and nothing else. No markdown fences, no commentary.

JSON SHAPE
{
  "careerSummary": string,
  "targetRole": string,
  "strengths": [{ "skill": string, "reason": string }],
  "skillExplanations": [{ "skill": string, "reason": string, "priority": "high" | "medium" | "low" }],
  "learningPriorities": [{ "skill": string, "rationale": string, "course": string | null }],
  "sequenceExplanation": string,
  "certificationAdvice": [{ "certification": string, "reason": string }],
  "careerAdvice": [string],
  "roadmapSummary": string,
  "phaseDescriptions": { "foundations": string, "core": string, "advanced": string, "practical": string }
}
"strengths" must come from the user's current skills. "skillExplanations" must cover every missing skill and every prerequisite skill to learn first.
"learningPriorities" must follow graphLearningOrder.`;

/** Extracts a JSON object from model output that may include fences or reasoning text. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('No JSON object found in model output');
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** Removes anything the model mentioned that Neo4j did not return. Nothing invented reaches the UI. */
export function enforceGraphEntities(insight: CareerInsight, analysis: GraphAnalysis) {
  const gapSkills = new Set([...analysis.missingSkills.map((s) => norm(s.name)), ...analysis.prerequisiteGapSkills.map((s) => norm(s.name))]);
  const knownSkills = new Set([...gapSkills, ...analysis.userSkills.map((s) => norm(s.name)), ...analysis.matchedSkills.map((s) => norm(s.name))]);
  const courses = new Set(analysis.recommendedCourses.map((c) => norm(c.name)));
  const certs = new Set(analysis.certifications.map((c) => norm(c.name)));
  const dropped: CareerInsightResult['droppedEntities'] = [];

  const keep = <T>(items: T[], field: string, get: (t: T) => string, allowed: Set<string>) =>
    items.filter((it) => {
      const v = get(it);
      if (allowed.has(norm(v))) return true;
      dropped.push({ field, value: v });
      return false;
    });

  const cleaned: CareerInsight = {
    ...insight,
    targetRole: analysis.targetRole.name,
    strengths: keep(insight.strengths, 'strengths.skill', (x) => x.skill, knownSkills),
    skillExplanations: keep(insight.skillExplanations, 'skillExplanations.skill', (x) => x.skill, gapSkills),
    learningPriorities: keep(insight.learningPriorities, 'learningPriorities.skill', (x) => x.skill, gapSkills).map((p) => {
      if (p.course && !courses.has(norm(p.course))) {
        dropped.push({ field: 'learningPriorities.course', value: p.course });
        return { ...p, course: null };
      }
      return p;
    }),
    certificationAdvice: keep(insight.certificationAdvice, 'certificationAdvice.certification', (x) => x.certification, certs),
  };
  return { insight: cleaned, dropped };
}

/**
 * STEP 3: asks Nosana to reason over graph facts. Throws NosanaError on any failure:
 * we never return an insight unless a real, validated inference succeeded.
 */
export async function generateCareerInsight(profile: AdvisorProfile, analysis: GraphAnalysis): Promise<CareerInsightResult> {
  const { model, models } = await resolveModel();
  // Reasoning models spend many tokens thinking before the JSON appears, so leave generous headroom.
  const modelLimit = models.find((m) => m.id === model)?.max_output_tokens;
  const maxTokens = Math.min(12_000, modelLimit ?? 12_000);
  const context = buildGraphContext(profile, analysis);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Graph facts (JSON):\n${JSON.stringify(context, null, 2)}\n\nProduce the JSON response now.` },
  ];

  const started = Date.now();
  let attempts = 0;
  let repaired = false;
  let lastProblem = '';
  let usage: CareerInsightResult['usage'];

  for (let pass = 0; pass < 2; pass++) {
    const completion = await chatCompletion({ model, messages, jsonMode: true, disableThinking: true, maxTokens, temperature: 0.2, timeoutMs: 240_000 });
    attempts += completion.attempts;
    usage = completion.usage;
    try {
      const parsed = CareerInsightSchema.parse(extractJson(completion.content));
      const { insight, dropped } = enforceGraphEntities(parsed, analysis);
      return {
        insight,
        model: completion.model,
        durationMs: Date.now() - started,
        attempts,
        usage,
        droppedEntities: dropped,
        repaired,
      };
    } catch (err) {
      lastProblem = err instanceof Error ? err.message.slice(0, 600) : String(err);
      repaired = true;
      messages.push({ role: 'assistant', content: completion.content.slice(0, 4000) });
      messages.push({
        role: 'user',
        content: `Your previous reply was invalid: ${lastProblem}\nReturn ONLY a corrected JSON object matching the required shape, using only entities from the graph facts.`,
      });
    }
  }
  throw new NosanaError('invalid_response', `Model did not return valid structured JSON after a repair attempt: ${lastProblem}`);
}
