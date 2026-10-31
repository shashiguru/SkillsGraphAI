import { ArrowRight, CheckCircle2, CircleDashed, Info, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalysisEvent, CareerAnalysis, StepId } from '@/types/api';
import { StepBadge } from './StepBadge';

const ORDER: StepId[] = ['neo4j', 'nosana', 'daytona', 'compose', 'persist'];

const fmt = (ms?: number) => (ms === undefined ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function EventIcon({ status, stepRunning }: { status: AnalysisEvent['status']; stepRunning: boolean }) {
  if (status === 'succeeded') return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (status === 'failed') return <XCircle className="size-4 text-red-600" />;
  if (status === 'skipped') return <MinusCircle className="size-4 text-amber-600" />;
  // A started event only spins while its step is still running; afterwards it is just a log line.\n  if (status === 'started') return stepRunning ? <Loader2 className="size-4 animate-spin text-brand" /> : <ArrowRight className="size-4 text-slate-400" />;
  return <Info className="size-4 text-slate-400" />;
}

/** Renders the real event log recorded by the backend pipeline. Nothing here is simulated. */
export function AnalysisTimeline({ analysis }: { analysis: CareerAnalysis }) {
  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]" data-testid="analysis-timeline">
      <ol className="space-y-3">
        {ORDER.map((id) => {
          const step = analysis.steps[id];
          return (
            <li key={id} className="flex items-start gap-3">
              <span className="mt-0.5">
                {step.status === 'running' ? (
                  <Loader2 className="size-4 animate-spin text-brand" />
                ) : step.status === 'pending' ? (
                  <CircleDashed className="size-4 text-slate-300" />
                ) : step.status === 'failed' ? (
                  <XCircle className="size-4 text-red-600" />
                ) : step.status === 'live' ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <MinusCircle className="size-4 text-amber-600" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{step.label}</p>
                <div className="mt-1 flex items-center gap-2">
                  <StepBadge status={step.status} />
                  {step.durationMs !== undefined && <span className="text-xs text-muted">{fmt(step.durationMs)}</span>}
                </div>
                {step.error && <p className="mt-1 text-xs text-slate-600">{step.error}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 text-sm" aria-label="Event log">
        {analysis.events.map((e) => (
          <li key={e.seq} className="flex items-start gap-2">
            <EventIcon status={e.status} stepRunning={analysis.status === 'running' && analysis.steps[e.step as StepId]?.status === 'running'} />
            <span className="w-16 shrink-0 text-xs tabular-nums text-muted">{time(e.at)}</span>
            <span className={cn('min-w-0 flex-1', e.status === 'failed' && 'text-red-700')}>{e.message}</span>
            {e.durationMs !== undefined && <span className="shrink-0 text-xs text-muted">{fmt(e.durationMs)}</span>}
          </li>
        ))}
        {!analysis.events.length && <li className="text-muted">Waiting for the first event...</li>}
      </ul>
    </div>
  );
}
