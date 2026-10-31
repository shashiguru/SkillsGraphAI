import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/shared/states';
import Dashboard from '@/pages/Dashboard';
const CareerProfile = lazy(() => import('@/pages/CareerProfile'));
const CareerExplorer = lazy(() => import('@/pages/CareerExplorer'));
const SkillGapAnalysis = lazy(() => import('@/pages/SkillGapAnalysis'));
const KnowledgeGraph = lazy(() => import('@/pages/KnowledgeGraph'));
const LearningRoadmap = lazy(() => import('@/pages/LearningRoadmap'));
const IntegrationMonitor = lazy(() => import('@/pages/IntegrationMonitor'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="profile" element={<CareerProfile />} />
            <Route path="explorer" element={<CareerExplorer />} />
            <Route path="skill-gap" element={<SkillGapAnalysis />} />
            <Route path="graph" element={<KnowledgeGraph />} />
            <Route path="roadmap" element={<LearningRoadmap />} />
            <Route path="integrations" element={<IntegrationMonitor />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
