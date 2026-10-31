import { ArrowRight, Clock, Gauge, ListChecks, Sparkles, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CareerGraphView } from '@/components/graph/CareerGraphView';
import { DemoBanner } from '@/components/shared/states';
import type { CareerAnalysis } from '@/types/api';

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="rounded-lg bg-brand-soft p-2 text-brand">{icon}</div>
        <div>
          <p className="text-xs text-muted">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Step 3 of the dashboard: what the finished analysis found. */
export function AnalysisResults({ analysis }: { analysis: CareerAnalysis }) {
  const { summary, graph, computation, insight } = analysis;
  if (!summary || !graph) return null;

  const done = new Set(analysis.completedSkillIds);
  const order = graph.learningOrder;
  const progress = order.length ? Math.round((100 * order.filter((s) => done.has(s.skill.id)).length) / order.length) : 0;
  const hoursBySkill = new Map((computation?.roadmap ?? []).map((i) => [i.skillId, i.hours]));
  const ai = insight?.insight;
  const missingIds = new Set(graph.missingSkills.map((s) => s.id));

  return (
    <div className="space-y-6" aria-label="Analysis results">
      <DemoBanner mode={analysis.mode} />

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Gauge className="size-5" />} label="Skill match" value={`${summary.matchPercentage}%`} hint={`${summary.matchedSkillCount} of ${summary.requiredSkillCount} required skills`} />
        <Stat icon={<ListChecks className="size-5" />} label="Skills to learn" value={String(summary.gapSkillCount)} hint={`${summary.missingSkillCount} required, rest are prerequisites`} />
        <Stat
          icon={<Clock className="size-5" />}
          label="Estimated effort"
          value={computation ? `${computation.estimatedLearningHours} h` : 'Unavailable'}
          hint={computation ? `${computation.estimatedWeeks} weeks at ${analysis.learningHoursPerWeek} h/week` : 'Sandbox computation did not run'}
        />
        <Stat icon={<TrendingUp className="size-5" />} label="Roadmap progress" value={`${progress}%`} hint="Skills marked complete" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-label="Skill gaps">
          <CardHeader>
            <CardTitle>Your skill gaps</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{analysis.profile.currentRole}</Badge>
              <ArrowRight className="size-4 text-muted" />
              <Badge variant="violet">{analysis.targetRoleName}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={summary.matchPercentage} aria-label="Skill match" />
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Missing required skills ({graph.missingSkills.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {graph.missingSkills.map((s) => (
                  <Badge key={s.id} variant="danger" title={`${s.importance} · ${s.proficiencyRequired}`}>
                    {s.name}
                  </Badge>
                ))}
                {!graph.missingSkills.length && <span className="text-sm text-muted">None. You cover every required skill.</span>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Prerequisites you also need ({graph.prerequisiteGapSkills.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {graph.prerequisiteGapSkills.map((s) => (
                  <Badge key={s.id} variant="warning">
                    {s.name}
                  </Badge>
                ))}
                {!graph.prerequisiteGapSkills.length && <span className="text-sm text-muted">No extra prerequisites.</span>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Skills you already have for this role ({graph.matchedSkills.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {graph.matchedSkills.map((s) => (
                  <Badge key={s.id} variant="success">
                    {s.name}
                  </Badge>
                ))}
                {!graph.matchedSkills.length && <span className="text-sm text-muted">None of your skills are required by this role yet.</span>}
              </div>
            </div>
            <Link to="/skill-gap" className="inline-block text-sm text-brand hover:underline">
              Open the full skill gap analysis
            </Link>
          </CardContent>
        </Card>

        <Card aria-label="AI advice">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" /> What Nosana says
            </CardTitle>
            <CardDescription>
              {insight ? `Written by ${insight.model}, then checked against the graph so it only mentions real skills and courses.` : 'AI explanation'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {ai ? (
              <>
                <p>{ai.careerSummary}</p>
                {ai.learningPriorities.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted">Start with</p>
                    <ol className="space-y-2">
                      {ai.learningPriorities.slice(0, 3).map((p) => (
                        <li key={p.skill}>
                          <span className="font-medium">{p.skill}</span>
                          {p.course && <span className="text-muted"> · course: {p.course}</span>}
                          <p className="text-muted">{p.rationale}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {ai.careerAdvice[0] && <p className="rounded-lg bg-slate-50 p-3">{ai.careerAdvice[0]}</p>}
              </>
            ) : (
              <p className="text-muted">
                {analysis.steps.nosana.error ?? 'No AI explanation is available for this analysis.'} The graph results on this page are unaffected.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card aria-label="Learning order">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Learning order</CardTitle>
            <CardDescription>Every prerequisite comes before the skill that needs it.</CardDescription>
          </div>
          <Link to="/roadmap" className="text-sm text-brand hover:underline">
            Open the roadmap
          </Link>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {order.map((s) => (
              <li key={s.skill.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{s.order}</span>
                <span className="flex-1 font-medium">{s.skill.name}</span>
                <Badge variant={missingIds.has(s.skill.id) ? 'danger' : 'warning'}>{missingIds.has(s.skill.id) ? 'required' : 'prerequisite'}</Badge>
                {hoursBySkill.has(s.skill.id) && <span className="text-xs text-muted">{hoursBySkill.get(s.skill.id)} h</span>}
              </li>
            ))}
            {!order.length && <li className="text-sm text-muted">Nothing to learn for this role.</li>}
          </ol>
        </CardContent>
      </Card>

      {analysis.cytoscape && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Knowledge graph</CardTitle>
              <CardDescription>Your skills, the target role and the prerequisite chain between them</CardDescription>
            </div>
            <Link to="/graph" className="text-xs text-brand hover:underline">
              Open full graph
            </Link>
          </CardHeader>
          <CardContent>
            <CareerGraphView graph={analysis.cytoscape} height={320} compact />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
