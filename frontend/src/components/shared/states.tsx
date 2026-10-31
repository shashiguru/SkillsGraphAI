import type { ReactNode } from 'react';
import { AlertTriangle, FlaskConical, Inbox, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/services/apiClient';
import type { AnalysisMode } from '@/types/api';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <Card role="status" aria-live="polite">
      <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </CardContent>
    </Card>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function ErrorState({ error, onRetry, title = 'Could not load this data' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const notConfigured = error instanceof ApiError && error.code === 'not_configured';
  return (
    <Card role="alert" className="border-red-200 bg-red-50/40">
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <AlertTriangle className="size-4" />
          {notConfigured ? 'A required service is not configured' : title}
        </div>
        <p className="text-sm text-slate-700">{errorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Inbox className="size-8 text-slate-300" />
        <p className="text-sm font-semibold">{title}</p>
        <p className="max-w-md text-sm text-muted">{description}</p>
        {action}
      </CardContent>
    </Card>
  );
}

/** Shown whenever the data on screen came from the pre-generated demo scenario instead of a live run. */
export function DemoBanner({ mode }: { mode: AnalysisMode | undefined }) {
  if (mode !== 'demo') return null;
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Demo mode.</strong> This is a pre-generated Alex to AI Engineer scenario. Graph facts were computed offline from the starter dataset,
        the explanation is fixture text and the calculation was run locally. No live Neo4j, Nosana or Daytona call produced it.
      </p>
    </div>
  );
}
