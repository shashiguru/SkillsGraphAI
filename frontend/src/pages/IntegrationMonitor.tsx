import type { ReactNode } from 'react';
import { Box, Brain, Database, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, errorMessage } from '@/components/shared/states';
import { useIntegrations, useSelectNosanaModel } from '@/services/api';
import type { DaytonaStatus, Neo4jStatus, NosanaStatus } from '@/types/api';

type Health = { label: string; variant: 'success' | 'danger' | 'warning' };
export const healthOf = (s: { configured: boolean; connected: boolean }): Health =>
  !s.configured ? { label: 'Not configured', variant: 'warning' } : s.connected ? { label: 'Connected', variant: 'success' } : { label: 'Unreachable', variant: 'danger' };

function ServiceCard({ title, icon, status, children }: { title: string; icon: ReactNode; status: { configured: boolean; connected: boolean; error?: string; latencyMs?: number }; children?: ReactNode }) {
  const h = healthOf(status);
  return (
    <Card aria-label={`${title} status`} className="min-w-0">
      <CardHeader className="flex-row items-start justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-brand">{icon}</span> {title}
        </CardTitle>
        <Badge variant={h.variant}>{h.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status.latencyMs !== undefined && <p className="text-xs text-muted">Health check latency {status.latencyMs} ms</p>}
        {status.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{status.error}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex justify-between gap-3 text-xs">
    <dt className="text-muted">{k}</dt>
    <dd className="min-w-0 break-all text-right font-medium">{v}</dd>
  </div>
);

function Neo4jCard({ s }: { s: Neo4jStatus }) {
  return (
    <ServiceCard title="Neo4j" icon={<Database className="size-4" />} status={s}>
      {s.serverVersion && <Row k="Server version" v={s.serverVersion} />}
      {s.counts && (
        <div className="grid gap-3 min-[1700px]:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium">Nodes</p>
            <dl className="space-y-0.5">{Object.entries(s.counts.nodes).map(([k, v]) => <Row key={k} k={k} v={v} />)}</dl>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium">Relationships</p>
            <dl className="space-y-0.5">{Object.entries(s.counts.relationships).map(([k, v]) => <Row key={k} k={k} v={v} />)}</dl>
          </div>
        </div>
      )}
      <Row k="Last successful query" v={s.lastSuccessfulQueryAt ? new Date(s.lastSuccessfulQueryAt).toLocaleTimeString() : 'None yet'} />
      {s.lastError && <Row k="Last error" v={`${s.lastError.message}`} />}
    </ServiceCard>
  );
}

function NosanaCard({ s }: { s: NosanaStatus }) {
  const select = useSelectNosanaModel();
  const li = s.lastInference;
  return (
    <ServiceCard title="Nosana" icon={<Brain className="size-4" />} status={s}>
      <Row k="Endpoint" v={s.baseUrl} />
      <Row k="Active model" v={s.selectedModel ?? 'None'} />
      {s.configuredModelUnavailable && <p className="text-xs text-amber-700">Configured model "{s.configuredModelUnavailable}" is not currently being served.</p>}
      <div>
        <label htmlFor="nosana-model" className="mb-1 block text-xs font-medium">Available models ({s.models.length})</label>
        <select
          id="nosana-model"
          className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm disabled:opacity-50"
          value={s.selectedModel ?? ''}
          disabled={!s.models.length || select.isPending}
          onChange={(e) => select.mutate(e.target.value || null)}
        >
          {!s.models.length && <option value="">No models available</option>}
          {s.models.map((m) => (
            <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
          ))}
        </select>
        {select.isError && <p role="alert" className="mt-1 text-xs text-red-700">{errorMessage(select.error)}</p>}
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="mb-1 text-xs font-medium">Last inference</p>
        {!li && <p className="text-xs text-muted">No inference has run since the backend started.</p>}
        {li && (
          <dl className="space-y-0.5">
            <Row k="Result" v={<Badge variant={li.status === 'success' ? 'success' : 'danger'}>{li.status}</Badge>} />
            <Row k="At" v={new Date(li.at).toLocaleTimeString()} />
            {li.model && <Row k="Model" v={li.model} />}
            {li.durationMs !== undefined && <Row k="Duration" v={`${li.durationMs} ms`} />}
            {li.attempts !== undefined && <Row k="Attempts" v={li.attempts} />}
            {li.usage?.total_tokens !== undefined && <Row k="Tokens" v={li.usage.total_tokens} />}
            {li.error && <Row k="Error" v={`${li.error.kind}: ${li.error.message}`} />}
          </dl>
        )}
      </div>
    </ServiceCard>
  );
}

function DaytonaCard({ s }: { s: DaytonaStatus }) {
  const ex = s.lastExecution;
  return (
    <ServiceCard title="Daytona" icon={<Box className="size-4" />} status={s}>
      <Row k="API URL" v={s.apiUrl} />
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="mb-1 text-xs font-medium">Last sandbox execution</p>
        {!ex && <p className="text-xs text-muted">No sandbox has run since the backend started.</p>}
        {ex && (
          <>
            <dl className="space-y-0.5">
              <Row k="Sandbox id" v={ex.sandboxId ?? 'n/a'} />
              <Row k="Result" v={<Badge variant={ex.status === 'completed' ? 'success' : 'danger'}>{ex.status}</Badge>} />
              <Row k="Duration" v={`${ex.durationMs} ms`} />
              <Row k="Exit code" v={ex.exitCode ?? 'n/a'} />
              <Row k="Python" v={ex.pythonVersion ?? 'n/a'} />
              <Row k="Network isolated" v={ex.networkIsolated ? 'Yes' : 'No'} />
              <Row k="Cleaned up" v={ex.cleanedUp ? 'Yes' : 'No'} />
              {ex.error && <Row k="Error" v={ex.error} />}
            </dl>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100" aria-label="Sandbox logs">
              {ex.logs.length ? ex.logs.map((l) => `[${l.source}] ${l.message}`).join('\n') : 'No logs captured'}
            </pre>
          </>
        )}
      </div>
      {s.recentExecutions.length > 1 && (
        <p className="text-xs text-muted">{s.recentExecutions.length} recent executions recorded</p>
      )}
    </ServiceCard>
  );
}

export default function IntegrationMonitor() {
  const q = useIntegrations();
  return (
    <>
      <PageHeader
        title="Integration Monitor"
        description="Live health checks against Neo4j, Nosana and Daytona. Nothing on this page is simulated."
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={q.isFetching ? 'animate-spin' : ''} /> Re-check
          </Button>
        }
      />
      {q.isPending && <LoadingState label="Checking integrations..." />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not reach the backend" />}
      {q.data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 min-[1500px]:grid-cols-3">
            <Neo4jCard s={q.data.neo4j} />
            <NosanaCard s={q.data.nosana} />
            <DaytonaCard s={q.data.daytona} />
          </div>
          <p className="mt-4 text-xs text-muted">Checked at {new Date(q.data.checkedAt).toLocaleTimeString()}. Refreshes every 30 seconds.</p>
        </>
      )}
    </>
  );
}
