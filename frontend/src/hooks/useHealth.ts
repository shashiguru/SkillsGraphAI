import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/apiClient';

export interface HealthData {
  status: string;
  service: string;
  uptimeSeconds: number;
  configured: { neo4j: boolean; nosana: boolean; daytona: boolean };
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthData>('/health'),
    refetchInterval: 15_000,
    retry: false,
  });
}
