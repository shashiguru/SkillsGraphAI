import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { DEFAULT_PROFILE_ID, useActiveProfileId } from '@/lib/activeProfile';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SkillPicker } from '@/components/profile/SkillPicker';
import { ErrorState, LoadingState, errorMessage } from '@/components/shared/states';
import { useCreateProfile, useDeleteProfile, useProfile, useRoles, useSaveProfile } from '@/services/api';
import type { Profile, ProfileInput } from '@/types/api';

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'] as const;

export const ProfileFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  currentRole: z.string().trim().min(1, 'Current role is required').max(120),
  yearsExperience: z.number({ error: 'Enter a number' }).min(0, 'Cannot be negative').max(60, 'Maximum is 60'),
  industry: z.string().trim().max(120),
  learningHoursPerWeek: z.number({ error: 'Enter a number' }).min(1, 'At least 1 hour').max(80, 'Maximum is 80'),
  targetRoleId: z.string(),
  softSkillsText: z.string().max(600),
  technicalSkills: z
    .array(z.object({ skillId: z.string().optional(), name: z.string().min(1), proficiencyLevel: z.enum(LEVELS) }))
    .min(1, 'Add at least one skill from the graph'),
});
export type ProfileFormValues = z.infer<typeof ProfileFormSchema>;

/** Prefill from the demo persona. Replaced by the saved profile when one exists. */
export const ALEX_DEFAULTS: ProfileFormValues = {
  name: 'Alex',
  currentRole: 'Full Stack Developer',
  yearsExperience: 9,
  industry: 'Software',
  learningHoursPerWeek: 8,
  targetRoleId: '',
  softSkillsText: 'Communication, Mentoring',
  technicalSkills: ['C#', 'Angular', 'TypeScript', 'SQL', 'Azure', 'API Development', 'Docker'].map((name) => ({
    name,
    proficiencyLevel: 'Intermediate' as const,
  })),
};

/** A new profile starts empty so nothing from another profile leaks into it. */
export const BLANK_PROFILE: ProfileFormValues = {
  name: '',
  currentRole: '',
  yearsExperience: 0,
  industry: '',
  learningHoursPerWeek: 8,
  targetRoleId: '',
  softSkillsText: '',
  technicalSkills: [],
};

const fromProfile = (p: Profile): ProfileFormValues => ({
  name: p.name,
  currentRole: p.currentRole,
  yearsExperience: p.yearsExperience,
  industry: p.industry,
  learningHoursPerWeek: p.learningHoursPerWeek,
  targetRoleId: p.targetRoleId ?? '',
  softSkillsText: p.softSkills.join(', '),
  technicalSkills: p.technicalSkills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    proficiencyLevel: (LEVELS as readonly string[]).includes(s.proficiencyLevel ?? '') ? (s.proficiencyLevel as (typeof LEVELS)[number]) : 'Intermediate',
  })),
});

export const toProfileInput = (v: ProfileFormValues): ProfileInput => ({
  name: v.name,
  currentRole: v.currentRole,
  yearsExperience: v.yearsExperience,
  industry: v.industry,
  learningHoursPerWeek: v.learningHoursPerWeek,
  targetRoleId: v.targetRoleId || undefined,
  softSkills: v.softSkillsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  technicalSkills: v.technicalSkills.map((s) => ({ ...(s.skillId ? { skillId: s.skillId } : {}), name: s.name, proficiencyLevel: s.proficiencyLevel })),
});

function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function CareerProfile() {
  const profile = useProfile();
  const roles = useRoles();
  const save = useSaveProfile();
  const create = useCreateProfile();
  const remove = useDeleteProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') === '1';
  const activeId = useActiveProfileId();
  const form = useForm<ProfileFormValues>({ resolver: zodResolver(ProfileFormSchema), defaultValues: ALEX_DEFAULTS });
  const { register, handleSubmit, control, reset, formState } = form;
  const skills = useFieldArray({ control, name: 'technicalSkills' });
  const errors = formState.errors;

  useEffect(() => {
    if (creating) reset(BLANK_PROFILE);
    else if (profile.data) reset(fromProfile(profile.data));
  }, [profile.data, creating, reset]);

  const onSubmit = handleSubmit((values) => {
    const input = toProfileInput(values);
    if (creating) {
      // Creating switches the active profile, which remounts this page, so navigate from the promise.
      void create.mutateAsync(input).then(() => navigate('/profile', { replace: true })).catch(() => undefined);
    } else {
      save.mutate(input);
    }
  });
  const saving = save.isPending || create.isPending;
  const saveError = creating ? create.error : save.error;
  const selectedNames = skills.fields.map((f) => f.name);

  return (
    <>
      <PageHeader title="My Profile" description="Tell SkillGraph what you know. Skills are matched against the Neo4j skill graph." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {creating ? (
          <Button type="button" variant="outline" onClick={() => setParams({}, { replace: true })}>
            Cancel new profile
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => setParams({ new: '1' })}>
            <Plus className="size-4" /> New profile
          </Button>
        )}
        {!creating && profile.data && activeId !== DEFAULT_PROFILE_ID && (
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete profile "${profile.data?.name}" and its analyses? This cannot be undone.`)) remove.mutate(activeId);
            }}
          >
            <Trash2 className="size-4" /> Delete this profile
          </Button>
        )}
        {remove.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(remove.error)}</p>}
      </div>
      {profile.isPending && !creating && <LoadingState label="Loading your profile..." />}
      {profile.isError && <ErrorState error={profile.error} onRetry={() => profile.refetch()} title="Could not load your saved profile" />}
      {(creating || !profile.isPending) && (
        <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3" noValidate aria-label="Profile form">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>About you</CardTitle>
              <CardDescription>{creating ? 'New profile. It starts blank and your other profiles are not changed.' : profile.data ? 'Editing your saved profile' : 'Prefilled with the demo persona Alex. Edit and save to make it yours.'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" error={errors.name?.message}>
                <Input id="name" {...register('name')} />
              </Field>
              <Field label="Current role" htmlFor="currentRole" error={errors.currentRole?.message}>
                <Input id="currentRole" {...register('currentRole')} />
              </Field>
              <Field label="Years of experience" htmlFor="yearsExperience" error={errors.yearsExperience?.message}>
                <Input id="yearsExperience" type="number" step="any" {...register('yearsExperience', { valueAsNumber: true })} />
              </Field>
              <Field label="Industry" htmlFor="industry" error={errors.industry?.message}>
                <Input id="industry" {...register('industry')} />
              </Field>
              <Field label="Learning hours per week" htmlFor="learningHoursPerWeek" error={errors.learningHoursPerWeek?.message}>
                <Input id="learningHoursPerWeek" type="number" step="any" {...register('learningHoursPerWeek', { valueAsNumber: true })} />
              </Field>
              <Field label="Target role" htmlFor="targetRoleId">
                <select
                  id="targetRoleId"
                  {...register('targetRoleId')}
                  className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <option value="">{roles.isPending ? 'Loading roles...' : roles.isError ? 'Roles unavailable' : 'Select a target role'}</option>
                  {(roles.data?.roles ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {roles.isError && <p className="text-xs text-red-600">{errorMessage(roles.error)}</p>}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Soft skills (comma separated)" htmlFor="softSkillsText" error={errors.softSkillsText?.message}>
                  <Input id="softSkillsText" {...register('softSkillsText')} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Save</CardTitle>
              <CardDescription>Writes your User node and HAS_SKILL relationships to Neo4j.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'Saving...' : creating ? 'Create profile' : 'Save profile'}
              </Button>
              {!creating && save.isSuccess && (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700" role="status">
                  <CheckCircle2 className="size-4" /> Profile saved
                </p>
              )}
              {!creating && save.isSuccess && save.data.unmappedSkills.length > 0 && (
                <p className="text-xs text-amber-700" role="status">
                  Not in the graph and ignored: {save.data.unmappedSkills.join(', ')}
                </p>
              )}
              {saveError && <p role="alert" className="text-sm text-red-700">{errorMessage(saveError)}</p>}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Technical skills</CardTitle>
              <CardDescription>Only skills that exist in the graph can be added.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SkillPicker
                selectedNames={selectedNames}
                onPick={(s) => skills.append({ skillId: s.id, name: s.name, proficiencyLevel: 'Intermediate' })}
              />
              {errors.technicalSkills?.message && (
                <p role="alert" className="text-xs text-red-600">
                  {errors.technicalSkills.message}
                </p>
              )}
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Selected skills">
                {skills.fields.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm">
                    <span className="flex-1 font-medium">{f.name}</span>
                    <select
                      aria-label={`Proficiency for ${f.name}`}
                      {...register(`technicalSkills.${i}.proficiencyLevel` as const)}
                      className="rounded border border-border bg-white px-1.5 py-1 text-xs"
                    >
                      {LEVELS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => skills.remove(i)} className="text-slate-400 hover:text-red-600">
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {!creating && profile.data && profile.data.unmappedSkills.length > 0 && (
                <p className="text-xs text-muted">
                  Previously ignored (not in graph): {profile.data.unmappedSkills.map((n) => <Badge key={n} className="mr-1">{n}</Badge>)}
                </p>
              )}
            </CardContent>
          </Card>
        </form>
      )}
    </>
  );
}
