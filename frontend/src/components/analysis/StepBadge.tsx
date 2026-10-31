import { Badge } from '@/components/ui/badge';
import type { StepStatus } from '@/types/api';

const MAP: Record<StepStatus, { label: string; variant: 'default' | 'success' | 'danger' | 'warning' | 'brand' }> = {
  pending: { label: 'Pending', variant: 'default' },
  running: { label: 'Running', variant: 'brand' },
  live: { label: 'Live', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  skipped: { label: 'Skipped', variant: 'warning' },
  demo: { label: 'Demo', variant: 'warning' },
};

export function StepBadge({ status }: { status: StepStatus }) {
  const m = MAP[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
