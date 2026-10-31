import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Target, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { EmptyState, ErrorState, LoadingState, errorMessage } from '@/components/shared/states';
import { useProfile, useRoles, useSaveProfile } from '@/services/api';
import { profileToInput } from '@/lib/profile';
import type { RoleCard } from '@/types/api';

export function RoleCardView({
  role,
  isTarget,
  hasProfile,
  saving,
  onSetTarget,
}: {
  role: RoleCard;
  isTarget: boolean;
  hasProfile: boolean;
  saving: boolean;
  onSetTarget: (id: string) => void;
}) {
  return (
    <Card data-testid={`role-${role.id}`} className={isTarget ? 'border-brand ring-1 ring-brand/30' : undefined}>
      <CardContent className="flex h-full flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">{role.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="violet">{role.family}</Badge>
              <Badge variant="outline">{role.seniority}</Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{Math.round(role.matchPercentage)}%</div>
            <div className="text-xs text-muted">match</div>
          </div>
        </div>
        <Progress value={role.matchPercentage} aria-label={`${role.name} skill match`} />
        <p className="line-clamp-2 text-sm text-muted">{role.description}</p>
        <p className="text-xs text-slate-600">
          {role.matchedSkillCount} of {role.requiredSkillCount} required skills matched
        </p>
        {role.missingSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Missing skills">
            {role.missingSkills.map((s) => (
              <Badge key={s} variant="warning">
                {s}
              </Badge>
            ))}
          </div>
        ) : (
          <Badge variant="success" className="w-fit">
            No missing skills
          </Badge>
        )}
        <div className="mt-auto pt-2">
          {isTarget ? (
            <Badge variant="brand" className="gap-1">
              <CheckCircle2 className="size-3.5" /> Current target
            </Badge>
          ) : hasProfile ? (
            <Button size="sm" variant="outline" disabled={saving} onClick={() => onSetTarget(role.id)}>
              <Target /> Set as target
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to="/profile">Create a profile to set a target</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CareerExplorer() {
  const roles = useRoles();
  const profile = useProfile();
  const save = useSaveProfile();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('All');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (roles.data?.roles ?? [])
      .filter((r) => (family === 'All' || r.family === family) && (!q || r.name.toLowerCase().includes(q) || r.missingSkills.some((s) => s.toLowerCase().includes(q))))
      .sort((a, b) => b.matchPercentage - a.matchPercentage);
  }, [roles.data, search, family]);

  const families = ['All', ...(roles.data?.families ?? [])];

  return (
    <>
      <PageHeader title="Career Explorer" description="Every role in the graph, ranked by how many of its required skills you already have." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <Input aria-label="Search roles" placeholder="Search roles or missing skills" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by family">
          {families.map((f) => (
            <Button key={f} size="sm" variant={family === f ? 'default' : 'outline'} aria-pressed={family === f} onClick={() => setFamily(f)}>
              {f}
            </Button>
          ))}
        </div>
      </div>
      {save.isError && <p role="alert" className="mb-3 text-sm text-red-700">{errorMessage(save.error)}</p>}
      {!profile.isPending && !profile.data && !roles.isPending && (
        <p className="mb-3 text-sm text-muted">
          Match percentages are 0% until you <Link to="/profile" className="text-brand underline">save a profile</Link>.
        </p>
      )}
      {roles.isPending && <LoadingState label="Querying roles from Neo4j..." />}
      {roles.isError && <ErrorState error={roles.error} onRetry={() => roles.refetch()} title="Could not load roles" />}
      {roles.isSuccess && filtered.length === 0 && <EmptyState title="No roles match" description="Try a different search term or family filter." />}
      {roles.isSuccess && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <RoleCardView
              key={r.id}
              role={r}
              isTarget={profile.data?.targetRoleId === r.id}
              hasProfile={Boolean(profile.data)}
              saving={save.isPending}
              onSetTarget={(id) => profile.data && save.mutate(profileToInput(profile.data, { targetRoleId: id }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
