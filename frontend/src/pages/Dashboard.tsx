import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/states';
import { ProfileOverviewCard } from '@/components/dashboard/ProfileOverviewCard';
import { AnalysisProgressCard } from '@/components/dashboard/AnalysisProgressCard';
import { AnalysisResults } from '@/components/dashboard/AnalysisResults';
import { useActiveProfileId } from '@/lib/activeProfile';
import { useAnalysis, useHistory, useInvalidateAnalysisData, useStartAnalysis } from '@/services/api';

function DashboardContent() {
  // Starts empty on every visit: results only appear after a run in this session (or opened from the list).
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [targetRoleId, setTargetRoleId] = useState('');
  const start = useStartAnalysis();
  const analysis = useAnalysis(analysisId);
  const history = useHistory();
  const refreshData = useInvalidateAnalysisData();
  const progressRef = useRef<HTMLDivElement>(null);
  // Set when the user starts or opens an analysis, so the page scrolls to it once it has rendered.
  const scrollPending = useRef(false);

  const status = analysis.data?.status;
  const running = start.isPending || status === 'running';

  useEffect(() => {
    if (status && status !== 'running') refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const shownId = analysis.data?.id;
  useEffect(() => {
    if (shownId && scrollPending.current) {
      scrollPending.current = false;
      progressRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [shownId]);

  const launch = (mode: 'live') => {
    start.reset();
    start.mutate(
      { mode, ...(targetRoleId ? { targetRoleId } : {}) },
      {
        onSuccess: (r) => {
          scrollPending.current = true;
          setAnalysisId(r.analysisId);
        },
      },
    );
  };

  const finished = analysis.data && analysis.data.status !== 'running';

  return (
    <>
      <PageHeader title="Dashboard" description="Check your skills, run the analysis, then read what the knowledge graph found." />
      <div className="space-y-6">
        <ProfileOverviewCard running={running} targetRoleId={targetRoleId} onTargetRoleChange={setTargetRoleId} onAnalyze={launch} />

        {start.isError && <ErrorState error={start.error} title="Could not start the analysis" />}
        {start.isPending && <LoadingState label="Starting the analysis..." />}
        {analysisId && analysis.isError && <ErrorState error={analysis.error} onRetry={() => setAnalysisId(null)} title="Could not load this analysis" />}

        {analysis.data && (
          <div ref={progressRef} className="scroll-mt-4 space-y-6">
            <AnalysisProgressCard analysis={analysis.data} />
            {finished && <AnalysisResults analysis={analysis.data} />}
          </div>
        )}

        {history.data && history.data.length > 0 && (
          <Card aria-label="Recent analyses">
            <CardHeader>
              <CardTitle className="text-base">Recent analyses</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {history.data.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.targetRoleName}</span>
                      {r.mode === 'demo' && <Badge variant="warning">Demo</Badge>}
                      <Badge variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted">
                      {r.matchPercentage !== null && <span>{r.matchPercentage}% match</span>}
                      {r.estimatedHours !== null && <span>{r.estimatedHours} h</span>}
                      <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                      <Button
                        size="sm"
                        variant={r.id === analysisId ? 'secondary' : 'outline'}
                        disabled={running || r.id === analysisId}
                        onClick={() => {
                          scrollPending.current = true;
                          setAnalysisId(r.id);
                        }}
                      >
                        {r.id === analysisId ? 'Shown above' : 'View results'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

/** Keyed by profile so switching profiles starts again from an empty dashboard. */
export default function Dashboard() {
  const profileId = useActiveProfileId();
  return <DashboardContent key={profileId} />;
}
