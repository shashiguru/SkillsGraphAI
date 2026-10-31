import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { DemoBanner, EmptyState, ErrorState, LoadingState, errorMessage } from '@/components/shared/states';
import { useRecalculateRoadmap, useRoadmap, useToggleComplete } from '@/services/api';
import type { RoadmapView } from '@/types/api';

const COMPUTE_LABEL: Record<RoadmapView['computation'], { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  daytona: { label: 'Computed in Daytona sandbox', variant: 'success' },
  demo: { label: 'Demo calculation (local Python)', variant: 'warning' },
  unavailable: { label: 'Sandbox computation unavailable', variant: 'danger' },
};

function Checkbox({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="size-4 cursor-pointer accent-indigo-600"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function HoursControl({ value, pending, onApply, disabled }: { value: number; pending: boolean; onApply: (h: number) => void; disabled?: boolean }) {
  const [hours, setHours] = useState(value);
  useEffect(() => setHours(value), [value]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor="hours-slider" className="font-medium">Hours per week</label>
        <span className="tabular-nums font-semibold" data-testid="hours-value">{hours} h</span>
      </div>
      <input
        id="hours-slider"
        type="range"
        min={1}
        max={40}
        step={1}
        value={hours}
        disabled={disabled}
        onChange={(e) => setHours(Number(e.target.value))}
        className="w-full cursor-pointer accent-indigo-600"
      />
      <Button size="sm" disabled={pending || disabled || hours === value} onClick={() => onApply(hours)}>
        <RefreshCw className={pending ? 'animate-spin' : ''} /> {pending ? 'Recalculating...' : 'Recalculate schedule'}
      </Button>
    </div>
  );
}

export default function LearningRoadmap() {
  const roadmap = useRoadmap();
  const toggle = useToggleComplete();
  const recalc = useRecalculateRoadmap();
  const view = roadmap.data ?? null;

  return (
    <>
      <PageHeader title="Learning Roadmap" description="Skills ordered so every prerequisite comes first, with a weekly schedule that fits your available hours." />
      {roadmap.isPending && <LoadingState label="Loading your roadmap..." />}
      {roadmap.isError && <ErrorState error={roadmap.error} onRetry={() => roadmap.refetch()} />}
      {roadmap.isSuccess && !view && (
        <EmptyState
          title="No roadmap yet"
          description="Your roadmap is created by an analysis. Run Analyze My Career from the dashboard first."
          action={<Link to="/" className="text-sm text-brand hover:underline">Go to Dashboard</Link>}
        />
      )}
      {view && (
        <div className="space-y-6">
          <DemoBanner mode={view.mode} />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{view.targetRoleName}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant={COMPUTE_LABEL[view.computation].variant}>{COMPUTE_LABEL[view.computation].label}</Badge>
                  {view.computationNote && <span>{view.computationNote}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {view.totals ? (
                  <>
                    <dl className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-slate-50 p-3"><dt className="flex items-center justify-center gap-1 text-xs text-muted"><Clock className="size-3.5" />Total effort</dt><dd className="text-xl font-semibold">{view.totals.hours} h</dd></div>
                      <div className="rounded-lg bg-slate-50 p-3"><dt className="flex items-center justify-center gap-1 text-xs text-muted"><CalendarDays className="size-3.5" />Duration</dt><dd className="text-xl font-semibold">{view.totals.weeks} wk</dd></div>
                      <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-muted">Skills</dt><dd className="text-xl font-semibold">{view.totals.completedSkills}/{view.totals.skills}</dd></div>
                    </dl>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted"><span>Progress</span><span>{view.totals.progressPercent}%</span></div>
                      <Progress value={view.totals.progressPercent} aria-label="Roadmap progress" />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted">Hours and schedule need the sandbox computation. The graph order below is still valid.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Your pace</CardTitle>
                <CardDescription>Changing it re-runs the schedule in a Daytona sandbox.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <HoursControl
                  value={view.learningHoursPerWeek}
                  pending={recalc.isPending}
                  disabled={view.mode === 'demo' && view.computation === 'unavailable'}
                  onApply={(h) => recalc.mutate({ learningHoursPerWeek: h, analysisId: view.analysisId })}
                />
                {recalc.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(recalc.error)}</p>}
              </CardContent>
            </Card>
          </div>

          {toggle.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(toggle.error)}</p>}

          {view.items.length > 0 ? (
            <section aria-label="Roadmap phases" className="grid gap-4 md:grid-cols-2">
              {view.phases.map((p) => {
                const items = view.items.filter((i) => i.phase === p.phase);
                return (
                  <Card key={p.phase} data-testid={`phase-${p.phase}`}>
                    <CardHeader className="flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-base">Phase {p.phase}: {p.name}</CardTitle>
                        <CardDescription>{items.length} skill{items.length === 1 ? '' : 's'} · {p.hours} h</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {items.length === 0 && <p className="text-sm text-muted">Nothing in this phase.</p>}
                      <ul className="space-y-2">
                        {items.map((i) => (
                          <li key={i.skillId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                            <Checkbox
                              checked={i.completed}
                              label={`Mark ${i.skill} complete`}
                              disabled={toggle.isPending}
                              onChange={(completed) => toggle.mutate({ skillId: i.skillId, completed, analysisId: view.analysisId })}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`font-medium ${i.completed ? 'text-muted line-through' : ''}`}>{i.order}. {i.skill}</span>
                                <Badge variant={i.priority === 'high' ? 'danger' : i.priority === 'medium' ? 'warning' : 'default'}>{i.priority}</Badge>
                                {i.kind === 'prerequisite' && <Badge variant="violet">prerequisite</Badge>}
                              </div>
                              <p className="mt-0.5 text-xs text-muted">
                                {i.hours} h{i.hoursSource === 'level-default-estimate' && ' (estimate)'}
                                {i.course ? ` · ${i.course}` : ' · no course in graph'}
                              </p>
                              {i.prerequisites.length > 0 && <p className="text-xs text-muted">After: {i.prerequisites.join(', ')}</p>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Graph order</CardTitle>
                <CardDescription>Prerequisite order from Neo4j. Hours and phases were not computed.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  {view.graphOrder.map((g) => (
                    <li key={g.skillId} className="flex items-center gap-3">
                      <Checkbox checked={g.completed} label={`Mark ${g.skill} complete`} onChange={(completed) => toggle.mutate({ skillId: g.skillId, completed, analysisId: view.analysisId })} />
                      <span>{g.order}. {g.skill}</span>
                      <Badge variant={g.kind === 'missing' ? 'danger' : 'warning'}>{g.kind}</Badge>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {view.weeklySchedule.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Weekly schedule</CardTitle>
                <CardDescription>Packed against {view.learningHoursPerWeek} hours per week</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Weekly schedule">
                  {view.weeklySchedule.map((w) => (
                    <li key={w.week} className="rounded-lg border border-border p-3 text-sm">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-semibold">Week {w.week}</span>
                        <span className="text-xs text-muted">{w.hours} h</span>
                      </div>
                      <ul className="space-y-1 text-xs text-slate-700">
                        {w.items.map((it, idx) => (
                          <li key={idx} className="flex justify-between gap-2">
                            <span>{it.label}</span>
                            <span className="text-muted">{it.hours} h</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
