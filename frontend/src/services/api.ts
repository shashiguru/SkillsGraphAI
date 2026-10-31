import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/services/apiClient';
import { DEFAULT_PROFILE_ID, getActiveProfileId as getActiveId, setActiveProfileId } from '@/lib/activeProfile';
import type {
  AnalysisListItem,
  AnalysisMode,
  CareerAnalysis,
  DashboardSummary,
  IntegrationsStatus,
  NosanaStatus,
  Profile,
  ProfileInput,
  ProfileSummary,
  RoadmapView,
  RoleCard,
  RoleDetail,
  SkillListItem,
} from '@/types/api';

export const queryKeys = {
  skills: (q: string, category: string) => ['skills', q, category] as const,
  roles: ['roles'] as const,
  role: (id: string) => ['role', id] as const,
  profile: ['profile'] as const,
  profiles: ['profiles'] as const,
  dashboard: ['dashboard'] as const,
  history: ['history'] as const,
  analysis: (id: string | null) => ['analysis', id] as const,
  roadmap: ['roadmap'] as const,
  integrations: ['integrations'] as const,
};

/** A 404 simply means "nothing saved yet", so it is not treated as an error by callers. */
export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

export function useSkills(q = '', category = '', enabled = true) {
  return useQuery({
    queryKey: queryKeys.skills(q, category),
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (q) p.set('q', q);
      if (category) p.set('category', category);
      return api.get<{ skills: SkillListItem[]; categories: string[] }>(`/skills?${p.toString()}`);
    },
    enabled,
    retry: false,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.get<{ roles: RoleCard[]; families: string[] }>('/roles'),
    retry: false,
  });
}

export function useRoleDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.role(id ?? ''),
    queryFn: () => api.get<RoleDetail>(`/roles/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async () => {
      try {
        return await api.get<Profile>('/profile');
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    retry: false,
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileInput) => {
      const existing = qc.getQueryData<Profile | null>(queryKeys.profile);
      return existing ? api.put<Profile>('/profile', input) : api.post<Profile>('/profile', input);
    },
    onSuccess: (profile) => {
      qc.setQueryData(queryKeys.profile, profile);
      qc.invalidateQueries({ queryKey: queryKeys.roles });
      qc.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });
}

export function useProfiles() {
  return useQuery({ queryKey: queryKeys.profiles, queryFn: () => api.get<ProfileSummary[]>('/profiles'), retry: false });
}

/** Makes another profile active. Everything cached for the previous profile is dropped and refetched. */
export function useSwitchProfile() {
  const qc = useQueryClient();
  return (id: string) => {
    setActiveProfileId(id);
    qc.resetQueries();
  };
}

/** Creates an additional profile (never touches existing ones) and switches to it. */
export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => api.post<Profile>('/profiles', input),
    onSuccess: (profile) => {
      setActiveProfileId(profile.userId);
      qc.resetQueries();
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: string }>(`/profiles/${id}`),
    onSuccess: (_r, id) => {
      // If the active profile was deleted, fall back to the default one.
      if (id === getActiveId()) setActiveProfileId(DEFAULT_PROFILE_ID);
      qc.resetQueries();
    },
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    retry: false,
  });
}

export function useHistory() {
  return useQuery({ queryKey: queryKeys.history, queryFn: () => api.get<AnalysisListItem[]>('/career/history'), retry: false });
}

const isFinished = (a?: CareerAnalysis) => !!a && a.status !== 'running';

/** Polls the real pipeline status every 700ms while the analysis runs. */
export function useAnalysis(id: string | null) {
  return useQuery({
    queryKey: queryKeys.analysis(id),
    queryFn: () => api.get<CareerAnalysis>(`/career/analysis/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (isFinished(q.state.data) ? false : 700),
    staleTime: 0,
    retry: false,
  });
}

export function useStartAnalysis() {
  return useMutation({
    mutationFn: (body: { mode: AnalysisMode; targetRoleId?: string; learningHoursPerWeek?: number }) =>
      api.post<{ analysisId: string; status: string; mode: AnalysisMode }>('/career/analyze', body),
  });
}

export function useInvalidateAnalysisData() {
  const qc = useQueryClient();
  return () => {
    for (const key of [queryKeys.dashboard, queryKeys.history, queryKeys.roadmap, queryKeys.roles, queryKeys.integrations]) {
      qc.invalidateQueries({ queryKey: key });
    }
    qc.invalidateQueries({ queryKey: ['analysis'] });
    qc.invalidateQueries({ queryKey: ['latest-analysis'] });
  };
}

/** The most recent analysis with full detail, for the Skill Gap and Knowledge Graph pages. */
export function useLatestAnalysis() {
  return useQuery({
    queryKey: ['latest-analysis'],
    queryFn: async () => {
      const history = await api.get<AnalysisListItem[]>('/career/history');
      const latest = history.find((h) => h.status !== 'failed' && h.status !== 'running');
      if (!latest) return null;
      return api.get<CareerAnalysis>(`/career/analysis/${latest.id}`);
    },
    retry: false,
  });
}

export function useRoadmap() {
  return useQuery({
    queryKey: queryKeys.roadmap,
    queryFn: async () => {
      try {
        return await api.get<RoadmapView>('/roadmap');
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    retry: false,
  });
}

export function useToggleComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { skillId: string; completed: boolean; analysisId: string }) =>
      api.patch<RoadmapView>(`/roadmap/items/${v.skillId}/complete`, { completed: v.completed, analysisId: v.analysisId }),
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.roadmap, view);
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useRecalculateRoadmap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { learningHoursPerWeek: number; analysisId: string }) => api.post<RoadmapView>('/career/roadmap', v),
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.roadmap, view);
      qc.invalidateQueries({ queryKey: queryKeys.integrations });
      qc.invalidateQueries({ queryKey: ['latest-analysis'] });
    },
  });
}

export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations,
    queryFn: () => api.get<IntegrationsStatus>('/integrations/status'),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useSelectNosanaModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string | null) => api.put<NosanaStatus>('/integrations/nosana/model', { modelId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.integrations }),
  });
}
