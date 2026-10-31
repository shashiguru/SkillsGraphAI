import { Pencil, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { useProfile, useRoles } from '@/services/api';

interface Props {
  running: boolean;
  /** Role chosen for this run. Empty string means "use the role saved in the profile". */
  targetRoleId: string;
  onTargetRoleChange: (id: string) => void;
  onAnalyze: (mode: 'live') => void;
}

/** Step 1 of the dashboard: who is being analysed, which role they aim for, and the Analyze button. */
export function ProfileOverviewCard({ running, targetRoleId, onTargetRoleChange, onAnalyze }: Props) {
  const profile = useProfile();
  const roles = useRoles();

  if (profile.isPending) return <LoadingState label="Loading your profile..." />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} title="Could not load your profile" />;

  const p = profile.data;
  if (!p) {
    return (
      <EmptyState
        title="Create your profile first"
        description="SkillGraph analyses the skills saved in your profile. The profile page is prefilled with the example persona Alex, so you can save it as is or change it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/profile" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              Set up my profile
            </Link>
          </div>
        }
      />
    );
  }

  const effectiveRole = targetRoleId || p.targetRoleId || '';
  const canAnalyze = Boolean(effectiveRole) && p.technicalSkills.length > 0 && !running;
  const hint = !p.technicalSkills.length
    ? 'Add at least one skill to your profile first.'
    : !effectiveRole
      ? 'Choose a target role to analyse against.'
      : null;

  return (
    <Card aria-label="Profile overview">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {p.name}
            <span className="ml-2 text-sm font-normal text-muted">
              {p.currentRole} · {p.yearsExperience} yrs{p.industry ? ` · ${p.industry}` : ''}
            </span>
          </CardTitle>
          <CardDescription>
            Your saved skills are what Neo4j compares against the target role. Change them in your profile and run the analysis again.
          </CardDescription>
        </div>
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
          <Pencil className="size-3.5" /> Edit profile
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Your skills ({p.technicalSkills.length})</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Your skills">
            {p.technicalSkills.map((s) => (
              <li key={s.skillId}>
                <Badge variant="success" title={s.category}>
                  {s.name}
                  {s.proficiencyLevel ? <span className="ml-1 opacity-70">· {s.proficiencyLevel}</span> : null}
                </Badge>
              </li>
            ))}
            {!p.technicalSkills.length && <li className="text-sm text-muted">No skills saved yet.</li>}
          </ul>
          {p.unmappedSkills.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">Not in the graph and ignored: {p.unmappedSkills.join(', ')}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-56 flex-1 text-sm font-medium">
            Target role
            <select
              aria-label="Target role"
              value={effectiveRole}
              onChange={(e) => onTargetRoleChange(e.target.value)}
              disabled={running}
              className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm font-normal shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <option value="">{roles.isPending ? 'Loading roles...' : 'Select a target role'}</option>
              {(roles.data?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <p className="text-xs font-medium text-muted">Learning time</p>
            <p className="h-9 content-center font-medium">{p.learningHoursPerWeek} h / week</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => onAnalyze('live')} disabled={!canAnalyze}>
              <Play /> {running ? 'Analyzing...' : 'Analyze My Career'}
            </Button>
          </div>
        </div>
        {hint && <p className="text-sm text-amber-700">{hint}</p>}
      </CardContent>
    </Card>
  );
}
