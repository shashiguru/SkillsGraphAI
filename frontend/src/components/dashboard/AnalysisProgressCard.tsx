import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AnalysisTimeline } from '@/components/analysis/AnalysisTimeline';
import type { CareerAnalysis, StepId } from '@/types/api';

const STEPS: StepId[] = ['neo4j', 'nosana', 'daytona', 'compose', 'persist'];

/** Step 2 of the dashboard: the real pipeline steps and recorded events, updating while the analysis runs. */
export function AnalysisProgressCard({ analysis }: { analysis: CareerAnalysis }) {
  const running = analysis.status === 'running';
  const finished = STEPS.filter((id) => !['pending', 'running'].includes(analysis.steps[id].status)).length;
  const percent = running ? Math.round((100 * finished) / STEPS.length) : 100;
  const failed = analysis.status === 'failed';

  return (
    <Card aria-label="Analysis progress">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{running ? 'Analyzing...' : 'How the analysis ran'}</CardTitle>
          <div className="flex items-center gap-2">
            {analysis.mode === 'demo' && <Badge variant="warning">Demo mode</Badge>}
            <Badge variant={analysis.status === 'completed' ? 'success' : analysis.status === 'partial' ? 'warning' : failed ? 'danger' : 'brand'}>
              {running ? 'Running' : analysis.status === 'completed' ? 'Completed' : analysis.status === 'partial' ? 'Completed with gaps' : 'Failed'}
            </Badge>
          </div>
        </div>
        <CardDescription>
          {running
            ? 'Neo4j finds the gaps first, then Nosana explains them and Daytona computes the schedule at the same time. Each line below is a real recorded event.'
            : `Finished ${analysis.completedAt ? new Date(analysis.completedAt).toLocaleTimeString() : ''}. Every step below is a real recorded event.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percent} aria-label="Pipeline progress" />
        {failed && analysis.error && <p className="text-sm text-red-700">{analysis.error}</p>}
        <AnalysisTimeline analysis={analysis} />
        {!running && analysis.mode === 'live' && analysis.status !== 'failed' && (
          <p className="text-xs text-muted">
            Want to check the services themselves? See the{' '}
            <Link to="/integrations" className="text-brand hover:underline">
              Integration Monitor
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
